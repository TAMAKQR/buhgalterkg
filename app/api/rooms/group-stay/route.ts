import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus, StayStatus, UserRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/read-json-body';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { normalizeMealPlan } from '@/lib/meal-plan';

export const dynamic = 'force-dynamic';

const maxGroupRoomCount = 50;
const maxTransferStayCount = 80;
const maxGroupStayBodyBytes = 16 * 1024;
const maxMoneyAmount = 2_000_000_000;
const moneyAmountSchema = z.number().int().min(0).max(maxMoneyAmount);

const groupPaymentModeSchema = z.enum(['CASH', 'CARD', 'SITE', 'PENDING_TRANSFER', 'POSTPAY', 'POSTPAY_UNKNOWN']);

const isCardPayment = (paymentMode: z.infer<typeof groupPaymentModeSchema>) => (
    paymentMode === 'CARD'
);

const isPendingOnlinePayment = (paymentMode: z.infer<typeof groupPaymentModeSchema>) => (
    paymentMode === 'SITE' || paymentMode === 'PENDING_TRANSFER'
);

const isPostpaidPayment = (paymentMode: z.infer<typeof groupPaymentModeSchema>) => (
    paymentMode === 'POSTPAY' || paymentMode === 'POSTPAY_UNKNOWN'
);

const groupCheckInSchema = z.object({
    action: z.literal('group-checkin'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(maxGroupRoomCount),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: moneyAmountSchema,
    totalAmount: moneyAmountSchema,
    paymentMode: groupPaymentModeSchema,
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const groupBookingSchema = z.object({
    action: z.literal('group-booking'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(maxGroupRoomCount),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: moneyAmountSchema,
    totalAmount: moneyAmountSchema,
    paymentMode: groupPaymentModeSchema,
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const confirmTransferSchema = z.object({
    action: z.literal('confirm-transfer'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    stayIds: z.array(z.string().cuid()).min(1).max(maxTransferStayCount),
});

const editGroupSchema = z.object({
    action: z.literal('edit-group'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    groupRef: z.string().uuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(maxGroupRoomCount),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: moneyAmountSchema,
    totalAmount: moneyAmountSchema,
    paymentMode: groupPaymentModeSchema,
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const groupStaySchema = z.discriminatedUnion('action', [groupCheckInSchema, groupBookingSchema, confirmTransferSchema, editGroupSchema]);

const normalizeOptionalText = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

const splitAmount = (total: number, count: number) => {
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const payload = groupStaySchema.parse(await readJsonBody(request, maxGroupStayBodyBytes));

        assertHotelOperatorAccess(session, payload.hotelId);

        if (session.role === UserRole.OBSERVER) {
            return new NextResponse('Доступ только для просмотра', { status: 403 });
        }

        const [shift, assignmentPermissions] = await Promise.all([
            prisma.shift.findFirst({
                where: {
                    id: payload.shiftId,
                    hotelId: payload.hotelId,
                    status: ShiftStatus.OPEN,
                    ...(session.role === UserRole.MANAGER ? { managerId: session.id } : {})
                },
                select: { id: true },
            }),
            session.role === UserRole.MANAGER
                ? prisma.hotelAssignment.findFirst({
                    where: {
                        hotelId: payload.hotelId,
                        userId: session.id,
                        isActive: true
                    },
                    select: {
                        canEditBookings: true,
                        canEditStayPayments: true
                    }
                })
                : Promise.resolve(null),
        ]);

        if (!shift) {
            return new NextResponse('Можно использовать только свою открытую смену на этом объекте', { status: 403 });
        }

        const canEditBookings = session.role === UserRole.ADMIN || Boolean(assignmentPermissions?.canEditBookings);
        const canEditStayPayments = session.role === UserRole.ADMIN || Boolean(assignmentPermissions?.canEditStayPayments);

        if (payload.action === 'confirm-transfer') {
            if (session.role !== UserRole.ADMIN) {
                return new NextResponse('Банковский перевод может подтвердить только администратор', { status: 403 });
            }

            const candidateStays = await prisma.roomStay.findMany({
                where: {
                    id: { in: payload.stayIds },
                    hotelId: payload.hotelId,
                    status: StayStatus.CHECKED_IN,
                    onlinePaid: { gt: 0 },
                },
                select: { id: true, roomId: true },
            });

            if (candidateStays.length !== payload.stayIds.length) {
                return new NextResponse('Не все ожидающие переводы найдены', { status: 400 });
            }

            const confirmationRef = randomUUID();

            const updated = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, candidateStays.map((stay) => stay.roomId));

                // Re-read after the room locks. A concurrent confirmation may have
                // already moved onlinePaid into cardPaid while this request waited.
                const stays = await tx.roomStay.findMany({
                    where: {
                        id: { in: payload.stayIds },
                        hotelId: payload.hotelId,
                        status: StayStatus.CHECKED_IN,
                        onlinePaid: { gt: 0 },
                    },
                    select: {
                        id: true,
                        roomId: true,
                        cashPaid: true,
                        cardPaid: true,
                        onlinePaid: true,
                        room: { select: { label: true } },
                    },
                });

                if (stays.length !== payload.stayIds.length) {
                    throw new SessionError('Перевод уже подтвержден или проживание изменилось', 409);
                }

                const lockedShift = (await lockShiftsForLedgerMutation(tx, [payload.shiftId], {
                    hotelId: payload.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    requireOpenShiftIds: [payload.shiftId],
                })).get(payload.shiftId)!;

                const ledgerEntries: Prisma.CashEntryCreateManyInput[] = [];
                const desiredStates = stays.map((stay) => {
                    const confirmedAmount = stay.onlinePaid ?? 0;
                    const nextCash = stay.cashPaid ?? 0;
                    const nextCard = (stay.cardPaid ?? 0) + confirmedAmount;
                    const nextOnline = 0;
                    const nextAmount = sumStayPayments({ cashPaid: nextCash, cardPaid: nextCard, onlinePaid: nextOnline });
                    const paymentMethod = detectStayPaymentMethod({
                        cashPaid: nextCash,
                        cardPaid: nextCard,
                        onlinePaid: nextOnline,
                    });

                    ledgerEntries.push({
                        hotelId: payload.hotelId,
                        shiftId: payload.shiftId,
                        managerId: lockedShift.managerId,
                        stayId: stay.id,
                        entryType: LedgerEntryType.CASH_IN,
                        method: PaymentMethod.CARD,
                        amount: confirmedAmount,
                        note: `Подтверждение перевода №${stay.room.label}`,
                        meta: {
                            source: 'room_stay',
                            kind: 'confirm_pending_transfer',
                            confirmationRef,
                            stayId: stay.id,
                            roomId: stay.roomId,
                        },
                    });

                    return { stay, nextAmount, nextCash, nextCard, nextOnline, paymentMethod };
                });

                const updateGroups = new Map<string, typeof desiredStates>();
                for (const state of desiredStates) {
                    const key = JSON.stringify([
                        state.nextAmount,
                        state.nextCash,
                        state.nextCard,
                        state.nextOnline,
                        state.paymentMethod,
                    ]);
                    const states = updateGroups.get(key) ?? [];
                    states.push(state);
                    updateGroups.set(key, states);
                }

                for (const states of updateGroups.values()) {
                    const financialState = states[0];
                    const updateResult = await tx.roomStay.updateMany({
                        where: { id: { in: states.map((state) => state.stay.id) } },
                        data: {
                            amountPaid: financialState.nextAmount,
                            cashPaid: financialState.nextCash,
                            cardPaid: financialState.nextCard,
                            onlinePaid: financialState.nextOnline,
                            paymentMethod: financialState.paymentMethod,
                        },
                    });
                    if (updateResult.count !== states.length) {
                        throw new SessionError('Перевод уже подтвержден или проживание изменилось', 409);
                    }
                }

                if (ledgerEntries.length > 0) {
                    await tx.cashEntry.createMany({ data: ledgerEntries });
                }

                const updatedStays = await tx.roomStay.findMany({
                    where: { id: { in: desiredStates.map((state) => state.stay.id) } },
                });
                const updatedById = new Map(updatedStays.map((stay) => [stay.id, stay]));
                if (updatedById.size !== desiredStates.length) {
                    throw new SessionError('Перевод уже подтвержден или проживание изменилось', 409);
                }

                return desiredStates.map((state) => updatedById.get(state.stay.id)!);
            });

            return NextResponse.json({ success: true, stays: updated });
        }

        if (payload.action === 'edit-group' && !canEditBookings) {
            return new NextResponse('Нет права редактировать групповую бронь', { status: 403 });
        }

        const scheduledCheckIn = new Date(payload.scheduledCheckIn);
        const scheduledCheckOut = new Date(payload.scheduledCheckOut);

        if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
            return new NextResponse('Некорректные даты заезда', { status: 400 });
        }

        if (scheduledCheckOut <= scheduledCheckIn) {
            return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
        }

        const uniqueRoomIds = Array.from(new Set(payload.roomIds));
        if (uniqueRoomIds.length !== payload.roomIds.length) {
            return new NextResponse('В списке номеров есть повторы', { status: 400 });
        }

        const [rooms, hotel] = await Promise.all([
            prisma.room.findMany({
                where: {
                    id: { in: uniqueRoomIds },
                    hotelId: payload.hotelId,
                    isActive: true,
                },
                orderBy: { label: 'asc' },
                select: { id: true, label: true },
            }),
            prisma.hotel.findUnique({
                where: { id: payload.hotelId },
                select: {
                    usesExtranets: true,
                    extranetNames: true,
                    hasMealPlan: true,
                    allowGroupStays: true,
                    allowPostpaidStays: true,
                    allowOnlinePayments: true,
                    currency: true,
                },
            }),
        ]);

        if (rooms.length !== uniqueRoomIds.length) {
            return new NextResponse('Не все номера найдены', { status: 400 });
        }

        if (!hotel) {
            return new NextResponse('Точка не найдена', { status: 404 });
        }

        if (!hotel.allowGroupStays) {
            return new NextResponse('Групповые заезды отключены для этой точки', { status: 403 });
        }

        if (isPostpaidPayment(payload.paymentMode) && !hotel.allowPostpaidStays) {
            return new NextResponse('Постоплата не включена для этой точки', { status: 400 });
        }
        if ((payload.paymentMode === 'SITE' || payload.paymentMode === 'PENDING_TRANSFER') && !hotel.allowOnlinePayments) {
            return new NextResponse('Онлайн-оплата отключена для этой точки', { status: 400 });
        }

        if (payload.action === 'edit-group') {
            const groupStays = await prisma.roomStay.findMany({
                where: {
                    hotelId: payload.hotelId,
                    groupRef: payload.groupRef,
                    status: StayStatus.SCHEDULED,
                },
                select: { id: true, roomId: true },
            });

            if (groupStays.length < 2) {
                return new NextResponse('Групповая бронь не найдена', { status: 404 });
            }

            const currentRoomIds = new Set(groupStays.map((stay) => stay.roomId));
            if (uniqueRoomIds.length !== groupStays.length || uniqueRoomIds.some((roomId) => !currentRoomIds.has(roomId))) {
                return new NextResponse('Изменение состава номеров группы пока недоступно. Создайте новую группу или отмените лишние брони отдельно.', { status: 400 });
            }

            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const bookingNumber = normalizeOptionalText(payload.bookingNumber);
            if (resolvedBookingSource && !bookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }

            if (payload.paymentMode === 'POSTPAY_UNKNOWN' && (payload.totalAmount > 0 || payload.tariffAmount > 0)) {
                return new NextResponse('Для тарифа на уточнении сумма должна быть пустой', { status: 400 });
            }

            if (payload.paymentMode === 'POSTPAY' && payload.tariffAmount <= 0) {
                return new NextResponse('Укажите общую сумму тарифа для постоплаты', { status: 400 });
            }

            if (payload.paymentMode !== 'POSTPAY_UNKNOWN' && payload.tariffAmount <= 0) {
                return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
            }

            if (!isPostpaidPayment(payload.paymentMode) && payload.totalAmount > payload.tariffAmount) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const portions = splitAmount(payload.totalAmount, groupStays.length);
            const tariffPortions = splitAmount(payload.tariffAmount, groupStays.length);
            const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
            const guestName = normalizeOptionalText(payload.guestName) ?? 'Групповая бронь';
            const baseNote = [
                payload.guestCount ? `${payload.guestCount} чел.` : null,
                normalizeOptionalText(payload.notes),
                `Группа ${payload.groupRef.slice(0, 8)}`,
            ].filter(Boolean).join(' · ');
            const mealPlan = hotel.hasMealPlan ? normalizeMealPlan(payload.mealPlan) : [];

            const updated = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, uniqueRoomIds);

                const lockedGroupStays = await tx.roomStay.findMany({
                    where: {
                        hotelId: payload.hotelId,
                        groupRef: payload.groupRef,
                        status: StayStatus.SCHEDULED,
                    },
                    select: {
                        id: true,
                        roomId: true,
                        amountPaid: true,
                        totalAmount: true,
                        paymentMethod: true,
                        cashPaid: true,
                        cardPaid: true,
                        onlinePaid: true,
                        tariffPending: true,
                        room: { select: { label: true } },
                    },
                });
                const originalStayIds = new Set(groupStays.map((stay) => stay.id));
                if (
                    lockedGroupStays.length !== groupStays.length ||
                    lockedGroupStays.some((stay) => !originalStayIds.has(stay.id))
                ) {
                    throw new SessionError('Состав групповой брони уже изменился. Обновите данные', 409);
                }

                const orderedGroupStays = [...lockedGroupStays].sort(
                    (left, right) => (roomOrder.get(left.roomId) ?? 0) - (roomOrder.get(right.roomId) ?? 0),
                );
                const desiredFinancialStates = orderedGroupStays.map((stay, index) => {
                    const portion = isPostpaidPayment(payload.paymentMode) ? 0 : portions[index] ?? 0;
                    const tariffPortion = tariffPortions[index] ?? 0;
                    const cashPaid = payload.paymentMode === 'CASH' ? portion : 0;
                    const cardPaid = isCardPayment(payload.paymentMode) ? portion : 0;
                    const onlinePaid = isPendingOnlinePayment(payload.paymentMode) ? portion : 0;
                    const tariffPending = payload.paymentMode === 'POSTPAY_UNKNOWN';
                    const paymentMethod = detectStayPaymentMethod({ cashPaid, cardPaid, onlinePaid });
                    const totalAmount = tariffPending ? null : tariffPortion;

                    return {
                        stay,
                        portion,
                        cashPaid,
                        cardPaid,
                        onlinePaid,
                        tariffPending,
                        paymentMethod,
                        totalAmount,
                    };
                });
                const hasPaymentLedgerDiff = desiredFinancialStates.some((state) => (
                    (state.stay.amountPaid ?? 0) !== state.portion ||
                    (state.stay.cashPaid ?? 0) !== state.cashPaid ||
                    (state.stay.cardPaid ?? 0) !== state.cardPaid ||
                    (state.stay.onlinePaid ?? 0) !== state.onlinePaid ||
                    (state.stay.paymentMethod ?? null) !== state.paymentMethod
                ));
                const hasFinancialDiff = hasPaymentLedgerDiff || desiredFinancialStates.some((state) => (
                    (state.stay.totalAmount ?? null) !== state.totalAmount ||
                    state.stay.tariffPending !== state.tariffPending
                ));

                if (hasFinancialDiff && !canEditStayPayments) {
                    throw new SessionError('Нет права редактировать суммы', 403);
                }

                const linkedLedgerShifts = hasPaymentLedgerDiff
                    ? await tx.cashEntry.groupBy({
                        by: ['shiftId'],
                        where: {
                            stayId: { in: orderedGroupStays.map((stay) => stay.id) },
                            entryType: LedgerEntryType.CASH_IN,
                        },
                    })
                    : [];
                const postsLedger =
                    hasPaymentLedgerDiff &&
                    payload.totalAmount > 0 &&
                    (payload.paymentMode === 'CASH' || isCardPayment(payload.paymentMode));
                const lockedLedgerShifts = await lockShiftsForLedgerMutation(
                    tx,
                    [
                        ...linkedLedgerShifts.map((entry) => entry.shiftId),
                        payload.shiftId,
                    ],
                    {
                        hotelId: payload.hotelId,
                        actorId: session.id,
                        actorRole: session.role,
                        requireOpenShiftIds: [payload.shiftId],
                        allowClosedForAdmin: true,
                    },
                );
                const lockedPostingShift = postsLedger
                    ? lockedLedgerShifts.get(payload.shiftId)!
                    : null;

                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        id: { notIn: orderedGroupStays.map((stay) => stay.id) },
                        roomId: { in: uniqueRoomIds },
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: scheduledCheckOut },
                        scheduledCheckOut: { gt: scheduledCheckIn },
                    },
                    select: { room: { select: { label: true } } },
                });

                if (conflictingStay) {
                    throw new SessionError(`На эти даты уже есть бронь или проживание в №${conflictingStay.room.label}`, 409);
                }

                const stayIds = orderedGroupStays.map((stay) => stay.id);
                if (hasPaymentLedgerDiff) {
                    await tx.cashEntry.deleteMany({
                        where: {
                            stayId: { in: stayIds },
                            entryType: LedgerEntryType.CASH_IN,
                        },
                    });
                }

                // splitAmount produces at most two values for each total. Group
                // identical financial states so a large edit does not issue
                // one UPDATE per room while every locked stay still receives
                // exactly the same values as before.
                const updateGroups = new Map<string, typeof desiredFinancialStates>();
                for (const state of desiredFinancialStates) {
                    const key = JSON.stringify([
                        state.portion,
                        state.totalAmount,
                        state.paymentMethod,
                        state.cashPaid,
                        state.cardPaid,
                        state.onlinePaid,
                        state.tariffPending,
                    ]);
                    const states = updateGroups.get(key) ?? [];
                    states.push(state);
                    updateGroups.set(key, states);
                }

                for (const states of updateGroups.values()) {
                    const financialState = states[0];
                    const updateResult = await tx.roomStay.updateMany({
                        where: { id: { in: states.map((state) => state.stay.id) } },
                        data: {
                            guestName,
                            bookingSource: resolvedBookingSource,
                            bookingNumber,
                            scheduledCheckIn,
                            scheduledCheckOut,
                            mealPlan,
                            notes: baseNote,
                            amountPaid: financialState.portion,
                            totalAmount: financialState.totalAmount,
                            paymentMethod: financialState.paymentMethod,
                            cashPaid: financialState.cashPaid,
                            cardPaid: financialState.cardPaid,
                            onlinePaid: financialState.onlinePaid,
                            tariffPending: financialState.tariffPending,
                        },
                    });
                    if (updateResult.count !== states.length) {
                        throw new SessionError('Одна из броней группы уже изменилась. Обновите данные', 409);
                    }
                }

                const ledgerMethod =
                    payload.paymentMode === 'CASH'
                        ? PaymentMethod.CASH
                        : isCardPayment(payload.paymentMode)
                            ? PaymentMethod.CARD
                            : null;
                const ledgerEntries: Prisma.CashEntryCreateManyInput[] = [];
                if (hasPaymentLedgerDiff && ledgerMethod) {
                    for (const state of desiredFinancialStates) {
                        if (state.portion <= 0) continue;
                        ledgerEntries.push({
                            hotelId: payload.hotelId,
                            shiftId: payload.shiftId,
                            managerId: lockedPostingShift!.managerId,
                            stayId: state.stay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerMethod,
                            amount: state.portion,
                            note: `Предоплата группы №${state.stay.room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'group_booking_prepayment',
                                groupRef: payload.groupRef,
                                guestCount: payload.guestCount ?? null,
                                roomId: state.stay.roomId,
                                stayId: state.stay.id,
                            },
                        });
                    }
                }
                if (ledgerEntries.length > 0) {
                    await tx.cashEntry.createMany({ data: ledgerEntries });
                }

                const updatedStays = await tx.roomStay.findMany({ where: { id: { in: stayIds } } });
                const updatedById = new Map(updatedStays.map((stay) => [stay.id, stay]));
                if (updatedById.size !== stayIds.length) {
                    throw new SessionError('Одна из броней группы уже изменилась. Обновите данные', 409);
                }

                return stayIds.map((stayId) => updatedById.get(stayId)!);
            });

            return NextResponse.json({ success: true, groupRef: payload.groupRef, stays: updated });
        }

        const isGroupBooking = payload.action === 'group-booking';
        const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
        const resolvedBookingSource = normalizedBookingSource
            ? resolveBookingSource(normalizedBookingSource, hotel.extranetNames)
            : null;

        if (normalizedBookingSource && (!hotel.usesExtranets || !resolvedBookingSource)) {
            return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
        }

        const bookingNumber = normalizeOptionalText(payload.bookingNumber);
        if (resolvedBookingSource && !bookingNumber) {
            return new NextResponse('Укажите номер бронирования', { status: 400 });
        }

        if (payload.paymentMode === 'POSTPAY_UNKNOWN' && (payload.totalAmount > 0 || payload.tariffAmount > 0)) {
            return new NextResponse('Для тарифа на уточнении сумма должна быть пустой', { status: 400 });
        }

        if (payload.paymentMode === 'POSTPAY' && payload.tariffAmount <= 0) {
            return new NextResponse('Укажите общую сумму тарифа для постоплаты', { status: 400 });
        }

        if (payload.paymentMode !== 'POSTPAY_UNKNOWN' && payload.tariffAmount <= 0) {
            return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
        }

        if (!isGroupBooking && !isPostpaidPayment(payload.paymentMode) && payload.totalAmount <= 0) {
            return new NextResponse('Укажите общую сумму оплаты', { status: 400 });
        }

        if (!isPostpaidPayment(payload.paymentMode) && payload.totalAmount > payload.tariffAmount) {
            return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
        }

        const groupRef = randomUUID();
        const portions = splitAmount(payload.totalAmount, rooms.length);
        const tariffPortions = splitAmount(payload.tariffAmount, rooms.length);
        const guestName = normalizeOptionalText(payload.guestName) ?? (isGroupBooking ? 'Групповая бронь' : 'Групповой заезд');
        const baseNote = [
            payload.guestCount ? `${payload.guestCount} чел.` : null,
            normalizeOptionalText(payload.notes),
            `Группа ${groupRef.slice(0, 8)}`,
        ].filter(Boolean).join(' · ');
        const mealPlan = hotel.hasMealPlan ? normalizeMealPlan(payload.mealPlan) : [];
        const ledgerMethod =
            payload.paymentMode === 'CASH'
                ? PaymentMethod.CASH
                : isCardPayment(payload.paymentMode)
                    ? PaymentMethod.CARD
                    : null;

        const stays = await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, uniqueRoomIds);

            const inactiveRoom = await tx.room.findFirst({
                where: {
                    id: { in: uniqueRoomIds },
                    isActive: false,
                },
                select: { label: true },
            });
            if (inactiveRoom) {
                throw new SessionError(`Номер №${inactiveRoom.label} архивирован и недоступен для новых броней`, 409);
            }

            const lockedShift = (await lockShiftsForLedgerMutation(tx, [payload.shiftId], {
                hotelId: payload.hotelId,
                actorId: session.id,
                actorRole: session.role,
                requireOpenShiftIds: [payload.shiftId],
            })).get(payload.shiftId)!;

            if (!isGroupBooking) {
                const unavailableRoom = await tx.room.findFirst({
                    where: {
                        id: { in: uniqueRoomIds },
                        OR: [
                            { status: { not: RoomStatus.AVAILABLE } },
                            { currentStayId: { not: null } },
                        ],
                    },
                    select: { label: true },
                });
                if (unavailableRoom) {
                    throw new SessionError(`Номер №${unavailableRoom.label} сейчас не свободен`, 409);
                }
            }

            const conflictingStay = await tx.roomStay.findFirst({
                where: {
                    roomId: { in: uniqueRoomIds },
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                    scheduledCheckIn: { lt: scheduledCheckOut },
                    scheduledCheckOut: { gt: scheduledCheckIn },
                },
                select: { room: { select: { label: true } } },
            });

            if (conflictingStay) {
                throw new SessionError(`На эти даты уже есть бронь или проживание в №${conflictingStay.room.label}`, 409);
            }

            const created = [];
            const ledgerEntries: Prisma.CashEntryCreateManyInput[] = [];

            for (const [index, room] of rooms.entries()) {
                const portion = isPostpaidPayment(payload.paymentMode) ? 0 : portions[index] ?? 0;
                const tariffPortion = tariffPortions[index] ?? 0;
                const cashPaid = payload.paymentMode === 'CASH' ? portion : 0;
                const cardPaid = isCardPayment(payload.paymentMode) ? portion : 0;
                const onlinePaid = isPendingOnlinePayment(payload.paymentMode) ? portion : 0;
                const tariffPending = payload.paymentMode === 'POSTPAY_UNKNOWN';

                const stay = await tx.roomStay.create({
                    data: {
                        roomId: room.id,
                        hotelId: payload.hotelId,
                        shiftId: payload.shiftId,
                        scheduledCheckIn,
                        scheduledCheckOut,
                        actualCheckIn: isGroupBooking ? null : new Date(),
                        status: isGroupBooking ? StayStatus.SCHEDULED : StayStatus.CHECKED_IN,
                        guestName,
                        bookingSource: resolvedBookingSource,
                        bookingNumber,
                        groupRef,
                        mealPlan,
                        notes: baseNote,
                        amountPaid: portion,
                        totalAmount: tariffPending ? null : tariffPortion,
                        paymentMethod: detectStayPaymentMethod({ cashPaid, cardPaid, onlinePaid }),
                        cashPaid,
                        cardPaid,
                        onlinePaid,
                        tariffPending,
                    },
                });

                if (!isGroupBooking) {
                    await tx.room.update({
                        where: { id: room.id },
                        data: {
                            status: RoomStatus.OCCUPIED,
                            currentStayId: stay.id,
                        },
                    });
                }

                if (ledgerMethod && portion > 0) {
                    ledgerEntries.push({
                        hotelId: payload.hotelId,
                        shiftId: payload.shiftId,
                        managerId: lockedShift.managerId,
                        stayId: stay.id,
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerMethod,
                        amount: portion,
                        originalAmount: portion,
                        originalCurrency: hotel.currency,
                        note: isGroupBooking ? `Предоплата группы №${room.label}` : `Групповой заезд №${room.label}`,
                        meta: {
                            source: 'room_stay',
                            kind: isGroupBooking ? 'group_booking_prepayment' : 'group_checkin',
                            groupRef,
                            guestCount: payload.guestCount ?? null,
                            roomId: room.id,
                            stayId: stay.id,
                        },
                    });
                }

                created.push(stay);
            }

            if (ledgerEntries.length > 0) {
                await tx.cashEntry.createMany({ data: ledgerEntries });
            }

            return created;
        });

        return NextResponse.json({ success: true, groupRef, stays });
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return new NextResponse('Тело запроса слишком большое', { status: 413 });
        }
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to process group stay');
    }
}
