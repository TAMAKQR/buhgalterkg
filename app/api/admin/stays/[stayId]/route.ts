import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CancellationPaymentAction, LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { normalizeMealPlan } from '@/lib/meal-plan';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';

export const dynamic = 'force-dynamic';

const updateStaySchema = z
    .object({
        guestName: z.string().max(80).optional().nullable(),
        guestPhone: z.string().max(40).optional().nullable(),
        companyName: z.string().max(120).optional().nullable(),
        scheduledCheckIn: z.string().datetime().optional().nullable(),
        scheduledCheckOut: z.string().datetime().optional().nullable(),
        actualCheckIn: z.string().datetime().optional().nullable(),
        actualCheckOut: z.string().datetime().optional().nullable(),
        status: z.nativeEnum(StayStatus).optional(),
        bookingSource: z.string().max(80).optional().nullable(),
        bookingNumber: z.string().max(80).optional().nullable(),
        totalAmount: z.number().int().positive().optional(),
        tariffPending: z.boolean().optional(),
        amountPaid: z.number().int().min(0).optional(),
        cashPaid: z.number().int().min(0).optional(),
        cardPaid: z.number().int().min(0).optional(),
        onlinePaid: z.number().int().min(0).optional(),
        paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
        shiftId: z.string().cuid().optional().nullable(),
        cancellationPaymentAction: z.nativeEnum(CancellationPaymentAction).optional(),
        cancellationShiftId: z.string().cuid().optional(),
        mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
        notes: z.string().max(500).optional().nullable()
    })
    .refine((values) => Object.values(values).some((value) => value !== undefined), {
        message: 'Не переданы поля для обновления'
    });

const parseDateOrNull = (value?: string | null) => {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('INVALID_DATE');
    }
    return parsed;
};

const normalizeOptionalText = (value?: string | null) => {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
};

const getCashLedgerParts = ({
    amountPaid,
    cashPaid,
    cardPaid,
    onlinePaid,
    paymentMethod,
}: {
    amountPaid?: number | null;
    cashPaid?: number | null;
    cardPaid?: number | null;
    onlinePaid?: number | null;
    paymentMethod?: PaymentMethod | null;
}) => {
    const cash = cashPaid ?? 0;
    const card = cardPaid ?? 0;
    const online = onlinePaid ?? 0;

    if (cash > 0 || card > 0) {
        return { cash, card };
    }

    const total = amountPaid ?? 0;
    if (total <= 0 || online > 0) {
        return { cash: 0, card: 0 };
    }

    if (paymentMethod === PaymentMethod.CASH) {
        return { cash: total, card: 0 };
    }

    if (paymentMethod === PaymentMethod.CARD) {
        return { cash: 0, card: total };
    }

    return { cash: 0, card: 0 };
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ stayId: string }> }) {
    try {
        const { stayId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateStaySchema.parse(body);
        const stay = await prisma.roomStay.findFirst({
            where: {
                id: stayId,
                hotel: { country },
            },
            include: {
                shift: {
                    select: {
                        managerId: true
                    }
                },
                room: {
                    include: {
                        hotel: true
                    }
                }
            }
        });

        if (!stay) {
            return new NextResponse('Stay not found', { status: 404 });
        }

        const stayRecord = stay as typeof stay & {
            onlinePaid: number;
            room: typeof stay.room & {
                hotel: typeof stay.room.hotel & {
                    usesExtranets: boolean;
                    extranetNames: string[];
                    allowOnlinePayments: boolean;
                };
            };
        };

        const updateData = {} as Prisma.RoomStayUpdateInput & {
            onlinePaid?: number;
            bookingSource?: string | null;
            bookingNumber?: string | null;
            totalAmount?: number;
        };
        let requestedShift: { id: string; managerId: string } | null | undefined;

        if (Object.prototype.hasOwnProperty.call(payload, 'shiftId')) {
            if (payload.shiftId) {
                requestedShift = await prisma.shift.findFirst({
                    where: {
                        id: payload.shiftId,
                        hotelId: stay.hotelId,
                        hotel: { country }
                    },
                    select: {
                        id: true,
                        managerId: true
                    }
                });

                if (!requestedShift) {
                    return new NextResponse('Смена не найдена для этого отеля', { status: 400 });
                }

                updateData.shift = { connect: { id: requestedShift.id } };
            } else {
                requestedShift = null;
                updateData.shift = { disconnect: true };
            }
        }

        if (payload.guestName !== undefined) {
            updateData.guestName = normalizeOptionalText(payload.guestName);
        }

        if (payload.guestPhone !== undefined) {
            updateData.guestPhone = normalizeOptionalText(payload.guestPhone);
        }

        if (payload.companyName !== undefined) {
            updateData.companyName = normalizeOptionalText(payload.companyName);
        }

        if (payload.notes !== undefined) {
            updateData.notes = normalizeOptionalText(payload.notes);
        }

        if (payload.bookingNumber !== undefined) {
            updateData.bookingNumber = normalizeOptionalText(payload.bookingNumber);
        }

        if (payload.totalAmount !== undefined) {
            updateData.totalAmount = payload.totalAmount;
            updateData.tariffPending = false;
        }

        if (payload.tariffPending !== undefined) {
            updateData.tariffPending = payload.tariffPending;
        }

        if (payload.mealPlan !== undefined) {
            const normalizedMealPlan = normalizeMealPlan(payload.mealPlan);
            if (normalizedMealPlan.length > 0 && !stayRecord.room.hotel.hasMealPlan) {
                return new NextResponse('Питание отключено для этого объекта', { status: 400 });
            }
            updateData.mealPlan = normalizedMealPlan;
        }

        if (payload.scheduledCheckIn !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.scheduledCheckIn);
                if (!parsed) {
                    return new NextResponse('Укажите дату заезда', { status: 400 });
                }
                updateData.scheduledCheckIn = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата заезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.scheduledCheckOut !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.scheduledCheckOut);
                if (!parsed) {
                    return new NextResponse('Укажите дату выезда', { status: 400 });
                }
                updateData.scheduledCheckOut = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата выезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.actualCheckIn !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.actualCheckIn);
                updateData.actualCheckIn = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата фактического заезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.actualCheckOut !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.actualCheckOut);
                updateData.actualCheckOut = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата фактического выезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.status) {
            updateData.status = payload.status;
        }

        const isCancellingStay = payload.status === StayStatus.CANCELLED;
        const hasPaymentBreakdownPayload =
            payload.cashPaid !== undefined ||
            payload.cardPaid !== undefined ||
            payload.onlinePaid !== undefined;

        if (payload.amountPaid !== undefined) {
            updateData.amountPaid = payload.amountPaid;
        }

        if (payload.cashPaid !== undefined) {
            updateData.cashPaid = payload.cashPaid;
        }

        if (payload.cardPaid !== undefined) {
            updateData.cardPaid = payload.cardPaid;
        }

        if (payload.onlinePaid !== undefined) {
            updateData.onlinePaid = payload.onlinePaid;
        }

        if (payload.bookingSource !== undefined) {
            const normalized = normalizeBookingSource(payload.bookingSource);
            if (!normalized) {
                updateData.bookingSource = null;
            } else {
                const resolved = resolveBookingSource(normalized, stayRecord.room.hotel.extranetNames);
                if (!stayRecord.room.hotel.usesExtranets || !resolved) {
                    return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
                }
                updateData.bookingSource = resolved;
            }
        }

        if (payload.paymentMethod !== undefined) {
            updateData.paymentMethod = payload.paymentMethod ?? null;
        }

        const cancellationPaymentAction = payload.cancellationPaymentAction;

        const updatedStay = await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, [stay.roomId]);

            const lockedStay = await tx.roomStay.findUnique({
                where: { id: stayId },
                include: {
                    shift: {
                        select: { managerId: true },
                    },
                },
            });
            if (!lockedStay) {
                throw new SessionError('Бронь или проживание уже изменено', 409);
            }
            if (lockedStay.roomId !== stay.roomId || lockedStay.hotelId !== stay.hotelId) {
                throw new SessionError('Бронь или проживание перемещено. Обновите данные', 409);
            }

            const lockedRoom = await tx.room.findUnique({
                where: { id: stay.roomId },
                select: { status: true, currentStayId: true },
            });
            if (!lockedRoom) {
                throw new SessionError('Номер больше не доступен', 409);
            }

            const transactionUpdateData = { ...updateData } as typeof updateData;
            const nextCash = payload.cashPaid ?? lockedStay.cashPaid;
            const nextCard = payload.cardPaid ?? lockedStay.cardPaid;
            const nextOnline = payload.onlinePaid ?? lockedStay.onlinePaid;
            const nextBreakdownTotal = sumStayPayments({
                cashPaid: nextCash,
                cardPaid: nextCard,
                onlinePaid: nextOnline,
            });

            if (payload.onlinePaid !== undefined && payload.onlinePaid > 0 && !stayRecord.room.hotel.allowOnlinePayments) {
                throw new SessionError('Онлайн-оплата отключена для этой точки', 400);
            }

            if (hasPaymentBreakdownPayload && (nextBreakdownTotal > 0 || payload.amountPaid === undefined || payload.amountPaid === 0)) {
                transactionUpdateData.amountPaid = nextBreakdownTotal;
            } else if (payload.amountPaid !== undefined) {
                transactionUpdateData.amountPaid = payload.amountPaid;
            }

            if (payload.paymentMethod === undefined && hasPaymentBreakdownPayload) {
                transactionUpdateData.paymentMethod = detectStayPaymentMethod({
                    cashPaid: nextCash,
                    cardPaid: nextCard,
                    onlinePaid: nextOnline,
                });
            }

            const cancellationAmount = sumStayPayments({
                cashPaid: lockedStay.cashPaid,
                cardPaid: lockedStay.cardPaid,
                onlinePaid: lockedStay.onlinePaid,
            });
            const requiresLedgerRefund =
                isCancellingStay &&
                cancellationPaymentAction === CancellationPaymentAction.REFUND &&
                (lockedStay.cashPaid > 0 || lockedStay.cardPaid > 0);

            if (isCancellingStay && cancellationAmount > 0 && !cancellationPaymentAction) {
                throw new SessionError('Выберите: вернуть или удержать предоплату', 400);
            }
            if (requiresLedgerRefund && !payload.cancellationShiftId) {
                throw new SessionError('Для возврата выберите активную смену', 400);
            }

            const lockedCancellationShift = requiresLedgerRefund
                ? (await lockShiftsForLedgerMutation(tx, [payload.cancellationShiftId!], {
                    hotelId: stay.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    requireOpenShiftIds: [payload.cancellationShiftId!],
                })).get(payload.cancellationShiftId!)!
                : null;

            if (isCancellingStay) {
                transactionUpdateData.cancellationPaymentAction = cancellationAmount > 0 ? cancellationPaymentAction : null;
                transactionUpdateData.cancellationAmount = cancellationAmount;
                transactionUpdateData.cancelledAt = new Date();
                transactionUpdateData.cancelledById = session.id;

                if (cancellationPaymentAction === CancellationPaymentAction.REFUND) {
                    transactionUpdateData.amountPaid = 0;
                    transactionUpdateData.cashPaid = 0;
                    transactionUpdateData.cardPaid = 0;
                    transactionUpdateData.onlinePaid = 0;
                    transactionUpdateData.paymentMethod = null;
                }
            }

            const transactionCheckIn = transactionUpdateData.scheduledCheckIn instanceof Date
                ? transactionUpdateData.scheduledCheckIn
                : lockedStay.scheduledCheckIn;
            const transactionCheckOut = transactionUpdateData.scheduledCheckOut instanceof Date
                ? transactionUpdateData.scheduledCheckOut
                : lockedStay.scheduledCheckOut;
            const transactionStatus = payload.status ?? lockedStay.status;
            const nextPaymentTotal = hasPaymentBreakdownPayload
                ? nextBreakdownTotal
                : payload.amountPaid ?? lockedStay.amountPaid ?? 0;
            const nextTariffTotal = payload.totalAmount ?? lockedStay.totalAmount ?? 0;
            const nextBookingNumber = payload.bookingNumber !== undefined
                ? normalizeOptionalText(payload.bookingNumber)
                : lockedStay.bookingNumber;
            const nextBookingSource = transactionUpdateData.bookingSource !== undefined
                ? transactionUpdateData.bookingSource
                : lockedStay.bookingSource;

            if (transactionCheckOut <= transactionCheckIn) {
                throw new SessionError('Дата выезда должна быть позже даты заезда', 400);
            }

            if (payload.status === StayStatus.CHECKED_IN && lockedStay.status !== StayStatus.CHECKED_IN && nextPaymentTotal <= 0) {
                throw new SessionError('Укажите сумму оплаты перед заселением', 400);
            }

            const shouldValidateBookingIdentity =
                transactionStatus === StayStatus.SCHEDULED ||
                transactionStatus === StayStatus.CHECKED_IN ||
                payload.bookingNumber !== undefined ||
                payload.totalAmount !== undefined;

            if (shouldValidateBookingIdentity && (transactionStatus === StayStatus.SCHEDULED || transactionStatus === StayStatus.CHECKED_IN)) {
                if (nextBookingSource && !nextBookingNumber) {
                    throw new SessionError('Укажите номер бронирования', 400);
                }
                if (nextTariffTotal <= 0) {
                    throw new SessionError('Укажите общую сумму тарифа', 400);
                }
                if (nextPaymentTotal > nextTariffTotal) {
                    throw new SessionError('Оплата не может быть больше общей суммы тарифа', 400);
                }
            }

            if (transactionStatus === StayStatus.SCHEDULED || transactionStatus === StayStatus.CHECKED_IN) {
                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        id: { not: stay.id },
                        roomId: stay.roomId,
                        hotelId: stay.hotelId,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: transactionCheckOut },
                        scheduledCheckOut: { gt: transactionCheckIn }
                    },
                    select: { guestName: true }
                });

                if (conflictingStay) {
                    const guest = conflictingStay.guestName?.trim() || 'другая бронь';
                    throw new SessionError(`На эти даты уже есть ${guest} в этом номере`, 409);
                }
            }

            if (isCancellingStay) {
                const claimed = await tx.roomStay.updateMany({
                    where: {
                        id: stayId,
                        status: lockedStay.status,
                        NOT: { status: StayStatus.CANCELLED }
                    },
                    data: { status: StayStatus.CANCELLED }
                });

                if (claimed.count !== 1) {
                    throw new SessionError('Бронь уже отменена или изменена', 409);
                }
            }

            let result = await tx.roomStay.update({
                where: { id: stayId },
                data: transactionUpdateData
            });

            if (requiresLedgerRefund) {
                const linkedIncomeEntries = await tx.cashEntry.findMany({
                    where: {
                        stayId: lockedStay.id,
                        entryType: LedgerEntryType.CASH_IN
                    },
                    orderBy: { recordedAt: 'asc' }
                });
                let remainingCash = lockedStay.cashPaid;
                let remainingCard = lockedStay.cardPaid;

                for (const entry of linkedIncomeEntries) {
                    const remaining = entry.method === PaymentMethod.CASH ? remainingCash : remainingCard;
                    const refundAmount = Math.min(entry.amount, remaining);
                    if (refundAmount <= 0) continue;
                    await tx.cashEntry.create({
                        data: {
                            hotelId: stay.hotelId,
                            shiftId: payload.cancellationShiftId!,
                            managerId: lockedCancellationShift!.managerId,
                            stayId: lockedStay.id,
                            entryType: LedgerEntryType.CASH_OUT,
                            method: entry.method,
                            amount: refundAmount,
                            originalAmount: refundAmount === entry.amount ? entry.originalAmount : refundAmount,
                            originalCurrency: refundAmount === entry.amount ? entry.originalCurrency : stay.room.hotel.currency,
                            exchangeRate: refundAmount === entry.amount ? entry.exchangeRate : null,
                            note: `Возврат предоплаты №${stay.room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'booking_prepayment_refund',
                                stayId: lockedStay.id,
                                roomId: stay.roomId,
                                originalEntryId: entry.id,
                                refundedBy: session.id
                            }
                        }
                    });
                    if (entry.method === PaymentMethod.CASH) remainingCash -= refundAmount;
                    else remainingCard -= refundAmount;
                }

                for (const fallback of [
                    { amount: remainingCash, method: PaymentMethod.CASH },
                    { amount: remainingCard, method: PaymentMethod.CARD }
                ]) {
                    if (fallback.amount <= 0) continue;
                    await tx.cashEntry.create({
                        data: {
                            hotelId: stay.hotelId,
                            shiftId: payload.cancellationShiftId!,
                            managerId: lockedCancellationShift!.managerId,
                            stayId: lockedStay.id,
                            entryType: LedgerEntryType.CASH_OUT,
                            method: fallback.method,
                            amount: fallback.amount,
                            originalAmount: fallback.amount,
                            originalCurrency: stay.room.hotel.currency,
                            note: `Возврат предоплаты №${stay.room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'booking_prepayment_refund',
                                stayId: lockedStay.id,
                                roomId: stay.roomId,
                                refundedBy: session.id
                            }
                        }
                    });
                }
            }

            const shouldSyncStayLedger = !isCancellingStay && (
                payload.cashPaid !== undefined ||
                payload.cardPaid !== undefined ||
                payload.onlinePaid !== undefined ||
                payload.amountPaid !== undefined ||
                payload.paymentMethod !== undefined ||
                payload.shiftId !== undefined
            );

            let ledgerShiftId = result.shiftId;
            let ledgerManagerId = requestedShift?.managerId ?? (ledgerShiftId === lockedStay.shiftId ? lockedStay.shift?.managerId ?? null : null);
            let autoSelectedOpenShiftId: string | null = null;
            if (!ledgerShiftId && result.status === StayStatus.CHECKED_IN) {
                const activeShift = await tx.shift.findFirst({
                    where: {
                        hotelId: lockedStay.hotelId,
                        status: ShiftStatus.OPEN
                    },
                    orderBy: { openedAt: 'desc' },
                    select: {
                        id: true,
                        managerId: true
                    }
                });

                if (activeShift) {
                    ledgerShiftId = activeShift.id;
                    ledgerManagerId = activeShift.managerId;
                    autoSelectedOpenShiftId = activeShift.id;
                }
            }

            if (shouldSyncStayLedger) {
                const linkedLedgerEntries = await tx.cashEntry.findMany({
                    where: {
                        stayId: lockedStay.id,
                        entryType: LedgerEntryType.CASH_IN
                    },
                    orderBy: { recordedAt: 'asc' },
                    select: {
                        id: true,
                        recordedAt: true,
                        shiftId: true
                    }
                });

                let legacyEntries: Array<{ id: string; shiftId: string | null }> = [];
                const legacyShiftIds = Array.from(new Set([lockedStay.shiftId, ledgerShiftId].filter((id): id is string => Boolean(id))));
                if (linkedLedgerEntries.length === 0 && legacyShiftIds.length > 0) {
                    const legacyMetaCandidates = await tx.cashEntry.findMany({
                        where: {
                            stayId: null,
                            hotelId: stay.hotelId,
                            shiftId: { in: legacyShiftIds },
                            entryType: LedgerEntryType.CASH_IN,
                            meta: {
                                path: ['stayId'],
                                equals: lockedStay.id
                            }
                        },
                        select: {
                            id: true,
                            shiftId: true
                        }
                    });

                    if (legacyMetaCandidates.length > 0) {
                        legacyEntries = legacyMetaCandidates;
                    }

                    if (legacyEntries.length === 0) {
                        const stayStart = lockedStay.actualCheckIn ?? lockedStay.scheduledCheckIn;
                        const legacyCandidates = await tx.cashEntry.findMany({
                            where: {
                                stayId: null,
                                hotelId: stay.hotelId,
                                shiftId: { in: legacyShiftIds },
                                entryType: LedgerEntryType.CASH_IN,
                                recordedAt: {
                                    gte: new Date(stayStart.getTime() - 15 * 60 * 1000),
                                    lte: new Date()
                                },
                                OR: [
                                    { note: `Заселение №${stay.room.label}` },
                                    { note: `Продление №${stay.room.label}` }
                                ]
                            },
                            select: {
                                id: true,
                                shiftId: true,
                                method: true,
                                amount: true
                            }
                        });

                        const legacyTotals = legacyCandidates.reduce(
                            (totals, entry) => {
                                if (entry.method === PaymentMethod.CASH) {
                                    totals.cash += entry.amount;
                                } else if (entry.method === PaymentMethod.CARD) {
                                    totals.card += entry.amount;
                                }
                                return totals;
                            },
                            { cash: 0, card: 0 }
                        );

                        const expectedLegacyTotals = getCashLedgerParts(lockedStay);

                        if (legacyTotals.cash === expectedLegacyTotals.cash && legacyTotals.card === expectedLegacyTotals.card) {
                            legacyEntries = legacyCandidates.map((entry) => ({
                                id: entry.id,
                                shiftId: entry.shiftId,
                            }));
                        }
                    }
                }

                const entryIdsToDelete = [
                    ...linkedLedgerEntries.map((entry) => entry.id),
                    ...legacyEntries.map((entry) => entry.id)
                ];

                const nextLedgerParts = getCashLedgerParts(result);
                const shouldRecreateLedger =
                    result.status !== StayStatus.CANCELLED &&
                    Boolean(ledgerShiftId) &&
                    (
                        linkedLedgerEntries.length > 0 ||
                        legacyEntries.length > 0 ||
                        lockedStay.status === StayStatus.SCHEDULED ||
                        payload.status === StayStatus.CHECKED_IN ||
                        nextLedgerParts.cash > 0 ||
                        nextLedgerParts.card > 0
                    );

                const lockedLedgerShifts = await lockShiftsForLedgerMutation(
                    tx,
                    [
                        ...linkedLedgerEntries.map((entry) => entry.shiftId),
                        ...legacyEntries.map((entry) => entry.shiftId),
                        shouldRecreateLedger ? ledgerShiftId : null,
                        autoSelectedOpenShiftId,
                    ],
                    {
                        hotelId: stay.hotelId,
                        actorId: session.id,
                        actorRole: session.role,
                        requireOpenShiftIds: autoSelectedOpenShiftId ? [autoSelectedOpenShiftId] : [],
                        allowClosedForAdmin: true,
                    },
                );

                if (ledgerShiftId) {
                    ledgerManagerId = lockedLedgerShifts.get(ledgerShiftId)?.managerId ?? ledgerManagerId;
                }

                if (autoSelectedOpenShiftId) {
                    result = await tx.roomStay.update({
                        where: { id: stayId },
                        data: { shiftId: autoSelectedOpenShiftId }
                    });
                }

                if (entryIdsToDelete.length > 0) {
                    await tx.cashEntry.deleteMany({
                        where: {
                            id: { in: entryIdsToDelete }
                        }
                    });
                }

                if (shouldRecreateLedger) {
                    const recordedAt = linkedLedgerEntries[0]?.recordedAt ?? result.actualCheckIn ?? result.scheduledCheckIn;
                    const ledgerPayloads = [
                        { amount: nextLedgerParts.cash, method: PaymentMethod.CASH },
                        { amount: nextLedgerParts.card, method: PaymentMethod.CARD }
                    ].filter((entry) => entry.amount > 0);

                    for (const ledgerEntry of ledgerPayloads) {
                        await tx.cashEntry.create({
                            data: {
                                hotelId: stay.hotelId,
                                shiftId: ledgerShiftId as string,
                                managerId: ledgerManagerId,
                                stayId: lockedStay.id,
                                entryType: LedgerEntryType.CASH_IN,
                                method: ledgerEntry.method,
                                amount: ledgerEntry.amount,
                                note: `Заселение №${stay.room.label}`,
                                recordedAt,
                                meta: {
                                    source: 'room_stay',
                                    kind: 'admin_sync',
                                    stayId: lockedStay.id,
                                    roomId: stay.roomId
                                }
                            }
                        });
                    }
                }
            } else if (autoSelectedOpenShiftId) {
                await lockShiftsForLedgerMutation(tx, [autoSelectedOpenShiftId], {
                    hotelId: stay.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    requireOpenShiftIds: [autoSelectedOpenShiftId],
                });
                result = await tx.roomStay.update({
                    where: { id: lockedStay.id },
                    data: { shiftId: autoSelectedOpenShiftId },
                });
            }

            if (payload.status) {
                const nextRoomData: Prisma.RoomUpdateInput | null = (() => {
                    if (payload.status === StayStatus.CHECKED_IN) {
                        if (lockedRoom.currentStayId && lockedRoom.currentStayId !== lockedStay.id) {
                            throw new SessionError('Номер уже занят другим проживанием', 409);
                        }
                        return { status: RoomStatus.OCCUPIED, currentStayId: lockedStay.id };
                    }
                    if (lockedRoom.currentStayId !== lockedStay.id) {
                        return null;
                    }
                    if (payload.status === StayStatus.CHECKED_OUT) {
                        return { status: RoomStatus.DIRTY, currentStayId: null };
                    }
                    if (payload.status === StayStatus.CANCELLED) {
                        return { status: RoomStatus.AVAILABLE, currentStayId: null };
                    }
                    if (payload.status === StayStatus.SCHEDULED) {
                        return { status: RoomStatus.AVAILABLE, currentStayId: null };
                    }
                    return null;
                })();

                if (nextRoomData) {
                    await tx.room.update({ where: { id: stay.roomId }, data: nextRoomData });
                }
            }

            return {
                result,
                previousActualCheckIn: lockedStay.actualCheckIn,
                previousActualCheckOut: lockedStay.actualCheckOut,
            };
        });

        const {
            result: persistedStay,
            previousActualCheckIn,
            previousActualCheckOut,
        } = updatedStay;

        // Отправка уведомлений горничным
        const hotel = stay.room.hotel;
        const wasCheckedIn = previousActualCheckIn !== null;
        const wasCheckedOut = previousActualCheckOut !== null;
        const nowCheckedIn = (payload.actualCheckIn !== undefined && updateData.actualCheckIn !== null) ||
            (payload.status === StayStatus.CHECKED_IN);
        const nowCheckedOut = (payload.actualCheckOut !== undefined && updateData.actualCheckOut !== null) ||
            (payload.status === StayStatus.CHECKED_OUT);
        const roomSnapshotLines = (nowCheckedIn || nowCheckedOut)
            ? await buildCleaningRoomSnapshotLines(hotel.id, hotel.timezone)
            : undefined;

        // Уведомление при заселении
        if (!wasCheckedIn && nowCheckedIn) {
            try {
                await notifyCleaningCrewAboutCheckIn({
                    chatId: hotel.cleaningChatId,
                    hotelName: hotel.name,
                    roomLabel: stay.room.label,
                    checkOut: persistedStay.scheduledCheckOut?.toISOString() || stay.scheduledCheckOut?.toISOString(),
                    timezone: hotel.timezone,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about check-in', notificationError);
            }
        }

        // Уведомление при выселении
        if (!wasCheckedOut && nowCheckedOut) {
            try {
                await notifyCleaningCrew({
                    chatId: hotel.cleaningChatId,
                    roomId: stay.roomId,
                    hotelName: hotel.name,
                    roomLabel: stay.room.label,
                    managerName: session.displayName || session.username || null,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about check-out', notificationError);
            }
        }

        return NextResponse.json({ success: true, stay: persistedStay });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update stay');
    }
}
