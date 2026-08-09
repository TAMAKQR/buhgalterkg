import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { notifyAdminAboutCheckIn, notifyAdminAboutStayExtension, notifyAdminAboutStayTransfer, notifyCleaningCrew, notifyCleaningCrewAboutCheckIn, notifyCleaningCrewAboutCheckOut } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { CancellationPaymentAction, LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus, UserRole } from '@prisma/client';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { formatDateKey } from '@/lib/timezone';
import { normalizeMealPlan } from '@/lib/meal-plan';
import { convertCashToAccounting, makeDefaultMoneyBreakdown } from '@/lib/currency';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';

export const dynamic = 'force-dynamic';

const staySchema = z.object({
    shiftId: z.string().cuid().optional(),
    stayId: z.string().cuid().optional(),
    guestProfileId: z.string().cuid().optional(),
    intent: z.enum(['book', 'checkin', 'checkout', 'extend', 'transfer', 'move-booking', 'cancel-booking', 'adjust-payments', 'edit-stay']),
    guestName: z.string().optional(),
    guestPhone: z.string().max(40).optional().nullable(),
    companyName: z.string().max(120).optional().nullable(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
    targetRoomId: z.string().cuid().optional(),
    transferNote: z.string().trim().max(300).optional().nullable(),
    scheduledCheckIn: z.string().datetime().optional(),
    scheduledCheckOut: z.string().datetime().optional(),
    totalAmount: z.number().int().positive().optional(),
    amountPaid: z.number().int().positive().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    cashAmount: z.number().int().nonnegative().optional(),
    cashOriginalAmount: z.number().int().nonnegative().optional(),
    cashCurrency: z.enum(['KGS', 'KZT', 'USD']).optional(),
    cashExchangeRate: z.number().int().positive().optional(),
    cardAmount: z.number().int().nonnegative().optional(),
    onlineAmount: z.number().int().nonnegative().optional(),
    cancellationPaymentAction: z.nativeEnum(CancellationPaymentAction).optional()
});

const appendTransferNote = (existing: string | null | undefined, line: string) => {
    const notes = [existing?.trim(), line.trim()].filter(Boolean).join('\n');
    return notes.slice(0, 500);
};

const normalizeOptionalText = (value?: string | null) => {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { roomId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = staySchema.parse(body);

        const room = await prisma.room.findUnique({
            where: { id: roomId },
            include: { hotel: true }
        });

        if (!room) {
            return new NextResponse('Room not found', { status: 404 });
        }

        assertHotelOperatorAccess(session, room.hotelId);

        if (session.role === UserRole.OBSERVER) {
            return new NextResponse('Доступ только для просмотра', { status: 403 });
        }

        const assignmentPermissions = session.role === UserRole.MANAGER
            ? await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: room.hotelId,
                    userId: session.id,
                    isActive: true
                },
                select: {
                    canEditBookings: true,
                    canEditStayPayments: true,
                    canCancelBookings: true
                }
            })
            : null;
        const canEditBookings = session.role === UserRole.ADMIN || Boolean(assignmentPermissions?.canEditBookings);
        const canEditStayPayments = session.role === UserRole.ADMIN || Boolean(assignmentPermissions?.canEditStayPayments);
        const canCancelBookings = session.role === UserRole.ADMIN || Boolean(assignmentPermissions?.canCancelBookings);

        const shift = payload.shiftId
            ? await prisma.shift.findFirst({
                where: {
                    id: payload.shiftId,
                    hotelId: room.hotelId,
                    status: ShiftStatus.OPEN,
                    ...(session.role === UserRole.MANAGER ? { managerId: session.id } : {})
                }
            })
            : null;

        if (payload.shiftId && !shift) {
            return new NextResponse('Можно использовать только свою открытую смену на этом объекте', { status: 403 });
        }

        if (
            (payload.intent === 'checkin' || payload.intent === 'extend' || payload.intent === 'transfer') &&
            !shift &&
            session.role !== UserRole.ADMIN
        ) {
            return new NextResponse('Нужна активная смена для операции с проживанием', { status: 400 });
        }

        if (payload.intent === 'move-booking' && !canEditBookings) {
            return new NextResponse('Нет права переносить бронирования', { status: 403 });
        }

        if (!room.hotel.allowOnlinePayments && (payload.onlineAmount ?? 0) > 0) {
            return new NextResponse('Оплата на сайте отключена для этого объекта', { status: 403 });
        }

        if (
            payload.cashCurrency === 'USD' &&
            (payload.cashOriginalAmount ?? 0) <= 0 &&
            ((payload.cardAmount ?? 0) > 0 || (payload.onlineAmount ?? 0) > 0)
        ) {
            return new NextResponse(
                'USD и курс относятся только к наличным. Укажите сумму долларов в поле «Наличные» или выберите валюту отеля',
                { status: 400 }
            );
        }

        const guestProfile = payload.guestProfileId
            ? await prisma.guestProfile.findUnique({
                where: { id: payload.guestProfileId },
                select: {
                    id: true,
                    hotelId: true,
                    fullName: true,
                    phone: true
                }
            })
            : null;

        if (payload.guestProfileId && !guestProfile) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        if (guestProfile?.hotelId && guestProfile.hotelId !== room.hotelId) {
            return new NextResponse('Guest profile belongs to another hotel', { status: 403 });
        }

        const resolveCashPayment = (fallbackAmount: number) => (
            payload.cashCurrency === 'USD'
                ? convertCashToAccounting({
                    amount: payload.cashOriginalAmount ?? fallbackAmount,
                    currency: payload.cashCurrency,
                    exchangeRate: payload.cashExchangeRate,
                    accountingCurrency: room.hotel.currency
                })
                : makeDefaultMoneyBreakdown(fallbackAmount, room.hotel.currency)
        );

        if (payload.intent === 'book') {
            if (!payload.scheduledCheckIn || !payload.scheduledCheckOut) {
                return new NextResponse('Укажите даты брони', { status: 400 });
            }

            const scheduledCheckIn = new Date(payload.scheduledCheckIn);
            const scheduledCheckOut = new Date(payload.scheduledCheckOut);

            if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
                return new NextResponse('Некорректные даты брони', { status: 400 });
            }

            if (scheduledCheckOut <= scheduledCheckIn) {
                return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
            }

            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, room.hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!room.hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const cashMoney = resolveCashPayment(payload.cashAmount ?? 0);
            const cashAmount = cashMoney.accountingAmount;
            const cardAmount = payload.cardAmount ?? 0;
            const onlineAmount = payload.onlineAmount ?? 0;
            const totalTariffAmount = payload.totalAmount ?? 0;
            const bookingNumber = normalizeOptionalText(payload.bookingNumber);

            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            if (totalTariffAmount <= 0) {
                return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
            }

            if (resolvedBookingSource && !bookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }

            if ((cashAmount > 0 || cardAmount > 0) && !shift) {
                return new NextResponse('Для наличной или безналичной предоплаты нужна активная смена', { status: 400 });
            }

            const totalAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });
            const detectedMethod = detectStayPaymentMethod({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });

            if (totalAmount > totalTariffAmount) {
                return new NextResponse('Предоплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const stay = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedRoom = await tx.room.findUnique({
                    where: { id: room.id },
                    select: { isActive: true },
                });
                if (!lockedRoom?.isActive) {
                    throw new SessionError('Номер архивирован и недоступен для новых броней', 409);
                }

                const lockedLedgerShift = cashAmount > 0 || cardAmount > 0
                    ? (await lockShiftsForLedgerMutation(tx, [shift!.id], {
                        hotelId: room.hotelId,
                        actorId: session.id,
                        actorRole: session.role,
                        requireOpenShiftIds: [shift!.id],
                    })).get(shift!.id)!
                    : null;

                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        roomId: room.id,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: scheduledCheckOut },
                        scheduledCheckOut: { gt: scheduledCheckIn }
                    },
                    select: { id: true }
                });

                if (conflictingStay) {
                    throw new SessionError('На эти даты у номера уже есть бронь или проживание', 409);
                }

                const createdStay = await tx.roomStay.create({
                    data: {
                        roomId: room.id,
                        hotelId: room.hotelId,
                        shiftId: cashAmount > 0 || cardAmount > 0 ? shift?.id : null,
                        guestProfileId: guestProfile?.id ?? null,
                        bookingSource: resolvedBookingSource,
                        bookingNumber,
                        scheduledCheckIn,
                        scheduledCheckOut,
                        status: StayStatus.SCHEDULED,
                        guestName: normalizeOptionalText(payload.guestName) ?? guestProfile?.fullName ?? null,
                        guestPhone: normalizeOptionalText(payload.guestPhone) ?? guestProfile?.phone ?? null,
                        companyName: normalizeOptionalText(payload.companyName),
                        mealPlan: room.hotel.hasMealPlan ? normalizeMealPlan(payload.mealPlan) : [],
                        notes: normalizeOptionalText(payload.notes),
                        amountPaid: totalAmount,
                        totalAmount: totalTariffAmount,
                        paymentMethod: detectedMethod,
                        cashPaid: cashAmount,
                        cardPaid: cardAmount,
                        onlinePaid: onlineAmount
                    }
                });

                const ledgerPayloads = [
                    { amount: cashAmount, method: PaymentMethod.CASH },
                    { amount: cardAmount, method: PaymentMethod.CARD }
                ].filter((entry) => entry.amount > 0);

                for (const ledgerEntry of ledgerPayloads) {
                    await tx.cashEntry.create({
                        data: {
                            hotelId: room.hotelId,
                            shiftId: shift!.id,
                            managerId: lockedLedgerShift!.managerId,
                            stayId: createdStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
                            originalAmount: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalAmount : ledgerEntry.amount,
                            originalCurrency: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalCurrency : room.hotel.currency,
                            exchangeRate: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.exchangeRate : null,
                            note: `Предоплата №${room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'booking_prepayment',
                                stayId: createdStay.id,
                                roomId: room.id
                            }
                        }
                    });
                }

                return createdStay;
            });

            return NextResponse.json(stay);
        }

        if (payload.intent === 'cancel-booking') {
            if (!canCancelBookings) {
                return new NextResponse('Нет права отменять брони', { status: 403 });
            }

            if (!payload.stayId) {
                return new NextResponse('Не указана бронь', { status: 400 });
            }

            const scheduledStay = await prisma.roomStay.findFirst({
                where: {
                    id: payload.stayId,
                    roomId: room.id,
                    hotelId: room.hotelId,
                    status: StayStatus.SCHEDULED,
                },
            });

            if (!scheduledStay) {
                return new NextResponse('Бронь не найдена или уже изменена', { status: 404 });
            }

            const cancellationPaymentAction = payload.cancellationPaymentAction;

            const cancelledStay = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedScheduledStay = await tx.roomStay.findFirst({
                    where: {
                        id: scheduledStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.SCHEDULED,
                    },
                });
                if (!lockedScheduledStay) {
                    throw new SessionError('Бронь уже отменена или изменена', 409);
                }

                const prepaidAmount = sumStayPayments({
                    cashPaid: lockedScheduledStay.cashPaid,
                    cardPaid: lockedScheduledStay.cardPaid,
                    onlinePaid: lockedScheduledStay.onlinePaid,
                });
                if (prepaidAmount > 0 && !cancellationPaymentAction) {
                    throw new SessionError('Выберите: вернуть или удержать предоплату', 400);
                }

                const requiresLedgerRefund =
                    cancellationPaymentAction === CancellationPaymentAction.REFUND &&
                    (lockedScheduledStay.cashPaid > 0 || lockedScheduledStay.cardPaid > 0);
                if (requiresLedgerRefund && !shift) {
                    throw new SessionError('Для возврата наличной или безналичной предоплаты нужна активная смена', 400);
                }

                const lockedRefundShift =
                    requiresLedgerRefund
                        ? (await lockShiftsForLedgerMutation(tx, [shift!.id], {
                            hotelId: room.hotelId,
                            actorId: session.id,
                            actorRole: session.role,
                            requireOpenShiftIds: [shift!.id],
                        })).get(shift!.id)!
                        : null;

                const claimed = await tx.roomStay.updateMany({
                    where: {
                        id: lockedScheduledStay.id,
                        status: StayStatus.SCHEDULED
                    },
                    data: {
                        status: StayStatus.CANCELLED,
                        cancellationPaymentAction: prepaidAmount > 0 ? cancellationPaymentAction : null,
                        cancellationAmount: prepaidAmount,
                        cancelledAt: new Date(),
                        cancelledById: session.id,
                        ...(cancellationPaymentAction === CancellationPaymentAction.REFUND
                            ? {
                                amountPaid: 0,
                                cashPaid: 0,
                                cardPaid: 0,
                                onlinePaid: 0,
                                paymentMethod: null
                            }
                            : {})
                    }
                });
                if (claimed.count !== 1) {
                    throw new SessionError('Бронь уже отменена или изменена', 409);
                }

                if (cancellationPaymentAction === CancellationPaymentAction.REFUND) {
                    const linkedIncomeEntries = await tx.cashEntry.findMany({
                        where: {
                            stayId: lockedScheduledStay.id,
                            entryType: LedgerEntryType.CASH_IN
                        },
                        orderBy: { recordedAt: 'asc' }
                    });
                    let remainingCash = lockedScheduledStay.cashPaid;
                    let remainingCard = lockedScheduledStay.cardPaid;

                    for (const entry of linkedIncomeEntries) {
                        const remaining = entry.method === PaymentMethod.CASH ? remainingCash : remainingCard;
                        const refundAmount = Math.min(entry.amount, remaining);
                        if (refundAmount <= 0) continue;

                        await tx.cashEntry.create({
                            data: {
                                hotelId: room.hotelId,
                                shiftId: shift!.id,
                                managerId: lockedRefundShift!.managerId,
                                stayId: lockedScheduledStay.id,
                                entryType: LedgerEntryType.CASH_OUT,
                                method: entry.method,
                                amount: refundAmount,
                                originalAmount: refundAmount === entry.amount ? entry.originalAmount : refundAmount,
                                originalCurrency: refundAmount === entry.amount ? entry.originalCurrency : room.hotel.currency,
                                exchangeRate: refundAmount === entry.amount ? entry.exchangeRate : null,
                                note: `Возврат предоплаты №${room.label}`,
                                meta: {
                                    source: 'room_stay',
                                    kind: 'booking_prepayment_refund',
                                    stayId: lockedScheduledStay.id,
                                    roomId: room.id,
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
                                hotelId: room.hotelId,
                                shiftId: shift!.id,
                                managerId: lockedRefundShift!.managerId,
                                stayId: lockedScheduledStay.id,
                                entryType: LedgerEntryType.CASH_OUT,
                                method: fallback.method,
                                amount: fallback.amount,
                                originalAmount: fallback.amount,
                                originalCurrency: room.hotel.currency,
                                note: `Возврат предоплаты №${room.label}`,
                                meta: {
                                    source: 'room_stay',
                                    kind: 'booking_prepayment_refund',
                                    stayId: lockedScheduledStay.id,
                                    roomId: room.id,
                                    refundedBy: session.id
                                }
                            }
                        });
                    }
                }

                return tx.roomStay.findUniqueOrThrow({
                    where: { id: lockedScheduledStay.id },
                });
            });

            return NextResponse.json(cancelledStay);
        }

        if (payload.intent === 'edit-stay') {
            if (!canEditBookings) {
                return new NextResponse('Нет права редактировать бронь или проживание', { status: 403 });
            }

            if (!payload.stayId) {
                return new NextResponse('Не указана бронь или проживание', { status: 400 });
            }

            if (!payload.scheduledCheckIn || !payload.scheduledCheckOut) {
                return new NextResponse('Укажите даты заезда и выезда', { status: 400 });
            }

            const scheduledCheckIn = new Date(payload.scheduledCheckIn);
            const scheduledCheckOut = new Date(payload.scheduledCheckOut);

            if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
                return new NextResponse('Некорректные даты брони или проживания', { status: 400 });
            }

            if (scheduledCheckOut <= scheduledCheckIn) {
                return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
            }

            const targetStay = await prisma.roomStay.findFirst({
                where: {
                    id: payload.stayId,
                    roomId: room.id,
                    hotelId: room.hotelId,
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] }
                }
            });

            if (!targetStay) {
                return new NextResponse('Бронь или проживание не найдено', { status: 404 });
            }

            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, room.hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!room.hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const bookingNumber = normalizeOptionalText(payload.bookingNumber);
            const totalTariffAmount = payload.totalAmount ?? 0;

            if (resolvedBookingSource && !bookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }

            if (totalTariffAmount <= 0) {
                return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
            }

            const updatedStay = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedTargetStay = await tx.roomStay.findFirst({
                    where: {
                        id: targetStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] }
                    }
                });

                if (!lockedTargetStay) {
                    throw new SessionError('Бронь или проживание уже изменено', 409);
                }

                if ((lockedTargetStay.amountPaid ?? 0) > totalTariffAmount) {
                    throw new SessionError('Оплата не может быть больше общей суммы тарифа', 400);
                }

                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        id: { not: lockedTargetStay.id },
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: scheduledCheckOut },
                        scheduledCheckOut: { gt: scheduledCheckIn }
                    },
                    select: { id: true }
                });

                if (conflictingStay) {
                    throw new SessionError('На эти даты у номера уже есть бронь или проживание', 409);
                }

                return tx.roomStay.update({
                    where: { id: lockedTargetStay.id },
                    data: {
                        ...(payload.guestProfileId ? { guestProfileId: guestProfile?.id ?? null } : {}),
                        guestName: normalizeOptionalText(payload.guestName) ?? guestProfile?.fullName ?? null,
                        guestPhone: normalizeOptionalText(payload.guestPhone) ?? guestProfile?.phone ?? null,
                        companyName: normalizeOptionalText(payload.companyName),
                        bookingSource: resolvedBookingSource,
                        bookingNumber,
                        scheduledCheckIn,
                        scheduledCheckOut,
                        totalAmount: totalTariffAmount,
                        mealPlan: room.hotel.hasMealPlan
                            ? payload.mealPlan !== undefined ? normalizeMealPlan(payload.mealPlan) : lockedTargetStay.mealPlan
                            : [],
                        notes: normalizeOptionalText(payload.notes)
                    }
                });
            });

            return NextResponse.json(updatedStay);
        }

        if (payload.intent === 'adjust-payments') {
            if (!canEditStayPayments) {
                return new NextResponse('Нет права редактировать суммы', { status: 403 });
            }

            if (!payload.stayId) {
                return new NextResponse('Не указано проживание', { status: 400 });
            }

            const cashMoney = resolveCashPayment(payload.cashAmount ?? 0);
            const cashAmount = cashMoney.accountingAmount;
            const cardAmount = payload.cardAmount ?? 0;
            const onlineAmount = payload.onlineAmount ?? 0;

            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            const totalAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });
            if (totalAmount <= 0) {
                return new NextResponse('Укажите сумму оплаты', { status: 400 });
            }

            const targetStay = await prisma.roomStay.findFirst({
                where: {
                    id: payload.stayId,
                    roomId: room.id,
                    hotelId: room.hotelId,
                    status: { not: StayStatus.CANCELLED }
                },
                select: { id: true },
            });

            if (!targetStay) {
                return new NextResponse('Проживание не найдено', { status: 404 });
            }

            const adjustedStay = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedTargetStay = await tx.roomStay.findFirst({
                    where: {
                        id: targetStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: { not: StayStatus.CANCELLED },
                    },
                    include: {
                        shift: {
                            select: {
                                id: true,
                                managerId: true,
                            },
                        },
                    },
                });
                if (!lockedTargetStay) {
                    throw new SessionError('Проживание уже изменено или отменено', 409);
                }
                if (lockedTargetStay.totalAmount != null && totalAmount > lockedTargetStay.totalAmount) {
                    throw new SessionError('Оплата не может быть больше общей суммы тарифа', 400);
                }

                const linkedLedgerEntries = await tx.cashEntry.findMany({
                    where: {
                        stayId: lockedTargetStay.id,
                        entryType: LedgerEntryType.CASH_IN
                    },
                    orderBy: { recordedAt: 'asc' },
                    select: {
                        id: true,
                        shiftId: true,
                        managerId: true,
                        recordedAt: true
                    }
                });

                const ledgerShiftId = linkedLedgerEntries[0]?.shiftId ?? lockedTargetStay.shiftId ?? shift?.id ?? null;

                if ((cashAmount > 0 || cardAmount > 0) && !ledgerShiftId) {
                    return null;
                }

                const lockedLedgerShifts = await lockShiftsForLedgerMutation(
                    tx,
                    [
                        ...linkedLedgerEntries.map((entry) => entry.shiftId),
                        ledgerShiftId,
                    ],
                    {
                        hotelId: room.hotelId,
                        actorId: session.id,
                        actorRole: session.role,
                        requireOpenShiftIds: ledgerShiftId && ledgerShiftId === shift?.id ? [ledgerShiftId] : [],
                        allowClosedForAdmin: true,
                    },
                );
                const ledgerManagerId = ledgerShiftId
                    ? lockedLedgerShifts.get(ledgerShiftId)?.managerId
                        ?? linkedLedgerEntries[0]?.managerId
                        ?? lockedTargetStay.shift?.managerId
                        ?? shift?.managerId
                        ?? session.id
                    : session.id;

                if (linkedLedgerEntries.length) {
                    await tx.cashEntry.deleteMany({
                        where: {
                            id: { in: linkedLedgerEntries.map((entry) => entry.id) }
                        }
                    });
                }

                const updatedStay = await tx.roomStay.update({
                    where: { id: lockedTargetStay.id },
                    data: {
                        amountPaid: totalAmount,
                        paymentMethod: detectStayPaymentMethod({
                            cashPaid: cashAmount,
                            cardPaid: cardAmount,
                            onlinePaid: onlineAmount
                        }),
                        cashPaid: cashAmount,
                        cardPaid: cardAmount,
                        onlinePaid: onlineAmount,
                        shiftId: lockedTargetStay.shiftId ?? ledgerShiftId
                    }
                });

                const recordedAt = linkedLedgerEntries[0]?.recordedAt ?? new Date();
                const ledgerPayloads = [
                    { amount: cashAmount, method: PaymentMethod.CASH },
                    { amount: cardAmount, method: PaymentMethod.CARD }
                ].filter((entry) => entry.amount > 0);

                for (const ledgerEntry of ledgerPayloads) {
                    await tx.cashEntry.create({
                        data: {
                            hotelId: room.hotelId,
                            shiftId: ledgerShiftId as string,
                            managerId: ledgerManagerId,
                            stayId: lockedTargetStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
                            originalAmount: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalAmount : ledgerEntry.amount,
                            originalCurrency: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalCurrency : room.hotel.currency,
                            exchangeRate: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.exchangeRate : null,
                            note: `Корректировка оплаты №${room.label}`,
                            recordedAt,
                            meta: {
                                source: 'room_stay',
                                kind: 'manager_payment_adjustment',
                                stayId: lockedTargetStay.id,
                                roomId: room.id,
                                adjustedBy: session.id
                            }
                        }
                    });
                }

                return updatedStay;
            });

            if (!adjustedStay) {
                return new NextResponse('Для наличной или безналичной корректировки нужна активная смена', { status: 400 });
            }

            return NextResponse.json(adjustedStay);
        }

        if (payload.intent === 'move-booking') {
            if (!payload.stayId || !payload.targetRoomId) {
                return new NextResponse('Укажите бронь и номер назначения', { status: 400 });
            }
            const targetRoom = await prisma.room.findFirst({
                where: {
                    id: payload.targetRoomId,
                    hotelId: room.hotelId,
                    isActive: true,
                },
                select: { id: true, label: true },
            });
            if (!targetRoom) {
                return new NextResponse('Целевой номер не найден', { status: 404 });
            }

            const transferLine = targetRoom.id === room.id
                ? `Перенос дат брони в №${room.label}`
                : `Перенос брони: из №${room.label} в №${targetRoom.label}`;
            const movedBooking = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id, targetRoom.id]);

                const booking = await tx.roomStay.findFirst({
                    where: {
                        id: payload.stayId,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.SCHEDULED,
                    },
                });
                if (!booking) {
                    throw new SessionError('Бронь уже изменена или заселена', 409);
                }

                const nextCheckIn = payload.scheduledCheckIn ? new Date(payload.scheduledCheckIn) : booking.scheduledCheckIn;
                const nextCheckOut = payload.scheduledCheckOut ? new Date(payload.scheduledCheckOut) : booking.scheduledCheckOut;
                if (
                    Number.isNaN(nextCheckIn.getTime()) ||
                    Number.isNaN(nextCheckOut.getTime()) ||
                    nextCheckOut <= nextCheckIn
                ) {
                    throw new SessionError('Некорректные даты переноса брони', 400);
                }

                const conflict = await tx.roomStay.findFirst({
                    where: {
                        id: { not: booking.id },
                        roomId: targetRoom.id,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: nextCheckOut },
                        scheduledCheckOut: { gt: nextCheckIn },
                    },
                    select: { id: true },
                });
                if (conflict) {
                    throw new SessionError('На эти даты целевой номер уже занят или забронирован', 409);
                }

                const moved = await tx.roomStay.updateMany({
                    where: {
                        id: booking.id,
                        roomId: room.id,
                        status: StayStatus.SCHEDULED,
                    },
                    data: {
                        roomId: targetRoom.id,
                        scheduledCheckIn: nextCheckIn,
                        scheduledCheckOut: nextCheckOut,
                        notes: appendTransferNote(booking.notes, transferLine),
                    },
                });
                if (moved.count !== 1) {
                    throw new SessionError('Бронь уже изменена другой операцией', 409);
                }

                await tx.stayTransfer.create({
                    data: {
                        stayId: booking.id,
                        fromRoomId: room.id,
                        toRoomId: targetRoom.id,
                        shiftId: shift?.id ?? null,
                        note: targetRoom.id === room.id
                            ? 'Перенос дат брони перетаскиванием'
                            : 'Перенос брони перетаскиванием',
                    },
                });

                return tx.roomStay.findUniqueOrThrow({ where: { id: booking.id } });
            });

            return NextResponse.json(movedBooking);
        }

        if (payload.intent === 'checkin') {
            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, room.hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!room.hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const cashMoney = resolveCashPayment(
                payload.cashAmount ??
                (payload.paymentMethod === PaymentMethod.CASH ? payload.amountPaid ?? 0 : 0)
            );
            const cashAmount = cashMoney.accountingAmount;
            const cardAmount =
                payload.cardAmount ??
                (payload.paymentMethod === PaymentMethod.CARD ? payload.amountPaid ?? 0 : 0);
            const onlineAmount = payload.onlineAmount ?? 0;

            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            const scheduledStay = payload.stayId
                ? await prisma.roomStay.findFirst({
                    where: {
                        id: payload.stayId,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.SCHEDULED,
                    },
                    select: { id: true },
                })
                : null;

            if (payload.stayId && !scheduledStay) {
                return new NextResponse('Бронь не найдена или уже изменена', { status: 404 });
            }

            const requestedCheckIn = payload.scheduledCheckIn ? new Date(payload.scheduledCheckIn) : new Date();
            const requestedCheckOut = payload.scheduledCheckOut
                ? new Date(payload.scheduledCheckOut)
                : new Date(Date.now() + 12 * 60 * 60 * 1000);

            if (Number.isNaN(requestedCheckIn.getTime()) || Number.isNaN(requestedCheckOut.getTime())) {
                return new NextResponse('Некорректные даты заезда', { status: 400 });
            }

            if (requestedCheckOut <= requestedCheckIn) {
                return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
            }

            const ledgerPayloads = [
                { amount: cashAmount, method: PaymentMethod.CASH },
                { amount: cardAmount, method: PaymentMethod.CARD }
            ].filter((entry) => entry.amount > 0);

            const checkInResult = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedRoom = await tx.room.findUnique({
                    where: { id: room.id },
                    select: { status: true, currentStayId: true }
                });
                if (!lockedRoom || lockedRoom.status !== RoomStatus.AVAILABLE || lockedRoom.currentStayId) {
                    throw new SessionError('Номер сейчас не свободен для заселения', 409);
                }

                const lockedScheduledStay = scheduledStay
                    ? await tx.roomStay.findFirst({
                        where: {
                            id: scheduledStay.id,
                            roomId: room.id,
                            hotelId: room.hotelId,
                            status: StayStatus.SCHEDULED
                        }
                    })
                    : null;

                if (scheduledStay && !lockedScheduledStay) {
                    throw new SessionError('Бронь не найдена или уже изменена', 409);
                }

                const finalCheckIn = lockedScheduledStay && !payload.scheduledCheckIn
                    ? lockedScheduledStay.scheduledCheckIn
                    : requestedCheckIn;
                const finalCheckOut = lockedScheduledStay && !payload.scheduledCheckOut
                    ? lockedScheduledStay.scheduledCheckOut
                    : requestedCheckOut;

                if (finalCheckOut <= finalCheckIn) {
                    throw new SessionError('Дата выезда должна быть позже даты заезда', 400);
                }

                const nextCashAmount = (lockedScheduledStay?.cashPaid ?? 0) + cashAmount;
                const nextCardAmount = (lockedScheduledStay?.cardPaid ?? 0) + cardAmount;
                const nextOnlineAmount = (lockedScheduledStay?.onlinePaid ?? 0) + onlineAmount;
                const nextTotalTariffAmount = payload.totalAmount ?? lockedScheduledStay?.totalAmount ?? 0;
                const nextBookingSource = resolvedBookingSource ?? lockedScheduledStay?.bookingSource ?? null;
                const nextBookingNumber = normalizeOptionalText(payload.bookingNumber) ?? lockedScheduledStay?.bookingNumber ?? null;
                const totalAmount = sumStayPayments({
                    cashPaid: nextCashAmount,
                    cardPaid: nextCardAmount,
                    onlinePaid: nextOnlineAmount,
                });
                const detectedMethod = detectStayPaymentMethod({
                    cashPaid: nextCashAmount,
                    cardPaid: nextCardAmount,
                    onlinePaid: nextOnlineAmount,
                });

                if (totalAmount <= 0) {
                    throw new SessionError('Укажите сумму оплаты (наличные, безналичные и/или на сайте)', 400);
                }
                if (nextTotalTariffAmount <= 0) {
                    throw new SessionError('Укажите общую сумму тарифа', 400);
                }
                if (nextBookingSource && !nextBookingNumber) {
                    throw new SessionError('Укажите номер бронирования', 400);
                }
                if (totalAmount > nextTotalTariffAmount) {
                    throw new SessionError('Оплата не может быть больше общей суммы тарифа', 400);
                }

                if (lockedScheduledStay) {
                    const todayKey = formatDateKey(new Date(), room.hotel.timezone);
                    const checkInKey = formatDateKey(lockedScheduledStay.scheduledCheckIn, room.hotel.timezone);
                    if (checkInKey && todayKey && checkInKey > todayKey) {
                        throw new SessionError('Заселение по брони доступно только в день заезда', 400);
                    }
                }

                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        ...(lockedScheduledStay ? { id: { not: lockedScheduledStay.id } } : {}),
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: finalCheckOut },
                        scheduledCheckOut: { gt: finalCheckIn }
                    },
                    select: { status: true }
                });

                if (conflictingStay) {
                    throw new SessionError(
                        conflictingStay.status === StayStatus.SCHEDULED
                            ? 'На эти даты у номера уже есть бронь. Откройте бронь и заселите гостя по ней или отмените бронь.'
                            : 'На эти даты у номера уже есть проживание',
                        409
                    );
                }

                const lockedShift = (await lockShiftsForLedgerMutation(tx, [shift!.id], {
                    hotelId: room.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    requireOpenShiftIds: [shift!.id],
                })).get(shift!.id)!;

                let nextStay;
                if (lockedScheduledStay) {
                    const claimedStay = await tx.roomStay.updateMany({
                        where: { id: lockedScheduledStay.id, status: StayStatus.SCHEDULED },
                        data: {
                            shiftId: payload.shiftId,
                            guestProfileId: guestProfile?.id ?? lockedScheduledStay.guestProfileId,
                            bookingSource: nextBookingSource,
                            bookingNumber: nextBookingNumber,
                            scheduledCheckIn: finalCheckIn,
                            scheduledCheckOut: finalCheckOut,
                            status: StayStatus.CHECKED_IN,
                            actualCheckIn: new Date(),
                            guestName: normalizeOptionalText(payload.guestName) ?? guestProfile?.fullName ?? lockedScheduledStay.guestName,
                            guestPhone: normalizeOptionalText(payload.guestPhone) ?? guestProfile?.phone ?? lockedScheduledStay.guestPhone,
                            companyName: normalizeOptionalText(payload.companyName) ?? lockedScheduledStay.companyName,
                            mealPlan: room.hotel.hasMealPlan
                                ? payload.mealPlan !== undefined ? normalizeMealPlan(payload.mealPlan) : lockedScheduledStay.mealPlan
                                : [],
                            notes: normalizeOptionalText(payload.notes) ?? lockedScheduledStay.notes,
                            amountPaid: totalAmount,
                            totalAmount: nextTotalTariffAmount,
                            paymentMethod: detectedMethod,
                            cashPaid: nextCashAmount,
                            cardPaid: nextCardAmount,
                            onlinePaid: nextOnlineAmount
                        }
                    });
                    if (claimedStay.count !== 1) {
                        throw new SessionError('Бронь не найдена или уже изменена', 409);
                    }
                    nextStay = await tx.roomStay.findUniqueOrThrow({ where: { id: lockedScheduledStay.id } });
                } else {
                    nextStay = await tx.roomStay.create({
                        data: {
                            roomId: room.id,
                            shiftId: payload.shiftId,
                            hotelId: room.hotelId,
                            guestProfileId: guestProfile?.id ?? null,
                            bookingSource: nextBookingSource,
                            bookingNumber: nextBookingNumber,
                            scheduledCheckIn: requestedCheckIn,
                            scheduledCheckOut: requestedCheckOut,
                            status: StayStatus.CHECKED_IN,
                            actualCheckIn: new Date(),
                            guestName: normalizeOptionalText(payload.guestName) ?? guestProfile?.fullName ?? null,
                            guestPhone: normalizeOptionalText(payload.guestPhone) ?? guestProfile?.phone ?? null,
                            companyName: normalizeOptionalText(payload.companyName),
                            mealPlan: room.hotel.hasMealPlan ? normalizeMealPlan(payload.mealPlan) : [],
                            notes: normalizeOptionalText(payload.notes),
                            amountPaid: totalAmount,
                            totalAmount: nextTotalTariffAmount,
                            paymentMethod: detectedMethod,
                            cashPaid: cashAmount,
                            cardPaid: cardAmount,
                            onlinePaid: onlineAmount
                        }
                    });
                }

                const claimedRoom = await tx.room.updateMany({
                    where: {
                        id: room.id,
                        status: RoomStatus.AVAILABLE,
                        currentStayId: null
                    },
                    data: {
                        status: RoomStatus.OCCUPIED,
                        currentStayId: nextStay.id
                    }
                });
                if (claimedRoom.count !== 1) {
                    throw new SessionError('Номер уже занят другой операцией', 409);
                }

                for (const ledgerEntry of ledgerPayloads) {
                    await tx.cashEntry.create({
                        data: {
                            hotelId: room.hotelId,
                            shiftId: payload.shiftId,
                            managerId: lockedShift.managerId,
                            stayId: nextStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
                            originalAmount: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalAmount : ledgerEntry.amount,
                            originalCurrency: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalCurrency : room.hotel.currency,
                            exchangeRate: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.exchangeRate : null,
                            note: `Заселение №${room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'checkin',
                                stayId: nextStay.id,
                                roomId: room.id
                            }
                        }
                    });
                }

                return {
                    stay: nextStay,
                    totalAmount,
                    detectedMethod,
                    nextCashAmount,
                    nextCardAmount,
                    nextOnlineAmount,
                    nextBookingSource,
                };
            });
            const {
                stay,
                totalAmount,
                detectedMethod,
                nextCashAmount,
                nextCardAmount,
                nextOnlineAmount,
                nextBookingSource,
            } = checkInResult;

            const scheduledCheckOutIso = stay.scheduledCheckOut ? stay.scheduledCheckOut.toISOString() : undefined;

            try {
                await notifyAdminAboutCheckIn({
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    checkIn: stay.scheduledCheckIn.toISOString(),
                    checkOut: scheduledCheckOutIso,
                    amount: totalAmount,
                    paymentMethod: detectedMethod,
                    paymentDetails: {
                        cashAmount: nextCashAmount,
                        cardAmount: nextCardAmount,
                        onlineAmount: nextOnlineAmount
                    },
                    timezone: room.hotel.timezone,
                    currency: room.hotel.currency,
                    bookingSource: nextBookingSource,
                });
            } catch (notificationError) {
                console.error('Failed to send Telegram notification', notificationError);
            }

            try {
                const roomSnapshotLines = await buildCleaningRoomSnapshotLines(room.hotelId, room.hotel.timezone);
                await notifyCleaningCrewAboutCheckIn({
                    chatId: room.hotel.cleaningChatId,
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    guestName: stay.guestName,
                    checkOut: scheduledCheckOutIso,
                    timezone: room.hotel.timezone,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about check-in', notificationError);
            }

            return NextResponse.json(stay);
        }

        let currentStay = room.currentStayId
            ? await prisma.roomStay.findFirst({
                where: { id: room.currentStayId, roomId: room.id, status: StayStatus.CHECKED_IN }
            })
            : null;

        currentStay ??= await prisma.roomStay.findFirst({
            where: { roomId: room.id, status: StayStatus.CHECKED_IN },
            orderBy: [
                { updatedAt: 'desc' },
                { scheduledCheckIn: 'desc' }
            ]
        });

        if (!currentStay) {
            return new NextResponse('Не найден активный гость', { status: 400 });
        }

        if (payload.intent === 'extend') {
            if (!payload.scheduledCheckOut) {
                return new NextResponse('Укажите новую дату выезда', { status: 400 });
            }

            const nextCheckOut = new Date(payload.scheduledCheckOut);
            if (Number.isNaN(nextCheckOut.getTime())) {
                return new NextResponse('Некорректная дата выезда', { status: 400 });
            }

            if (nextCheckOut <= currentStay.scheduledCheckOut) {
                return new NextResponse('Новая дата выезда должна быть позже текущей', { status: 400 });
            }

            const cashMoney = resolveCashPayment(payload.cashAmount ?? 0);
            const cashAmount = cashMoney.accountingAmount;
            const cardAmount = payload.cardAmount ?? 0;
            const onlineAmount = payload.onlineAmount ?? 0;
            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }
            const extraAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });

            const ledgerPayloads = [
                { amount: cashAmount, method: PaymentMethod.CASH },
                { amount: cardAmount, method: PaymentMethod.CARD }
            ].filter((entry) => entry.amount > 0);

            const extensionResult = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id]);

                const lockedShift = (await lockShiftsForLedgerMutation(tx, [shift!.id], {
                    hotelId: room.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    requireOpenShiftIds: [shift!.id],
                })).get(shift!.id)!;

                const lockedCurrentStay = await tx.roomStay.findFirst({
                    where: {
                        id: currentStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.CHECKED_IN
                    }
                });
                if (!lockedCurrentStay) {
                    throw new SessionError('Гость уже выселен или переселён другой операцией', 409);
                }

                if (nextCheckOut <= lockedCurrentStay.scheduledCheckOut) {
                    throw new SessionError('Новая дата выезда должна быть позже текущей', 400);
                }

                const conflictingFutureStay = await tx.roomStay.findFirst({
                    where: {
                        roomId: room.id,
                        id: { not: lockedCurrentStay.id },
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: nextCheckOut },
                        scheduledCheckOut: { gt: lockedCurrentStay.scheduledCheckIn }
                    },
                    select: { id: true }
                });
                if (conflictingFutureStay) {
                    throw new SessionError('Продление пересекается со следующей бронью', 409);
                }

                const totalCashPaid = (lockedCurrentStay.cashPaid ?? 0) + cashAmount;
                const totalCardPaid = (lockedCurrentStay.cardPaid ?? 0) + cardAmount;
                const totalOnlinePaid = (lockedCurrentStay.onlinePaid ?? 0) + onlineAmount;
                const totalAmountPaid = (lockedCurrentStay.amountPaid ?? 0) + extraAmount;
                const detectedMethod = detectStayPaymentMethod({
                    cashPaid: totalCashPaid,
                    cardPaid: totalCardPaid,
                    onlinePaid: totalOnlinePaid
                });

                const nextStay = await tx.roomStay.update({
                    where: { id: lockedCurrentStay.id },
                    data: {
                        scheduledCheckOut: nextCheckOut,
                        amountPaid: totalAmountPaid,
                        paymentMethod: detectedMethod,
                        cashPaid: totalCashPaid,
                        cardPaid: totalCardPaid,
                        onlinePaid: totalOnlinePaid
                    }
                });

                for (const ledgerEntry of ledgerPayloads) {
                    await tx.cashEntry.create({
                        data: {
                            hotelId: room.hotelId,
                            shiftId: payload.shiftId,
                            managerId: lockedShift.managerId,
                            stayId: lockedCurrentStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
                            originalAmount: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalAmount : ledgerEntry.amount,
                            originalCurrency: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.originalCurrency : room.hotel.currency,
                            exchangeRate: ledgerEntry.method === PaymentMethod.CASH ? cashMoney.exchangeRate : null,
                            note: `Продление №${room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'extension',
                                stayId: lockedCurrentStay.id,
                                roomId: room.id
                            }
                        }
                    });
                }

                return {
                    updatedStay: nextStay,
                    previousCheckOut: lockedCurrentStay.scheduledCheckOut
                };
            });
            const { updatedStay, previousCheckOut } = extensionResult;

            try {
                await notifyAdminAboutStayExtension({
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    guestName: updatedStay.guestName,
                    previousCheckOut: previousCheckOut.toISOString(),
                    nextCheckOut: updatedStay.scheduledCheckOut.toISOString(),
                    extraAmount,
                    paymentDetails: {
                        cashAmount,
                        cardAmount,
                        onlineAmount,
                    },
                    timezone: room.hotel.timezone,
                    currency: room.hotel.currency,
                    managerName: session.displayName ?? null,
                });
            } catch (notificationError) {
                console.error('Failed to send Telegram extension notification', notificationError);
            }

            return NextResponse.json(updatedStay);
        }

        if (payload.intent === 'transfer') {
            if (!payload.targetRoomId) {
                return new NextResponse('Укажите комнату, куда переселить гостя', { status: 400 });
            }

            if (payload.targetRoomId === room.id) {
                return new NextResponse('Нужно выбрать другую комнату', { status: 400 });
            }

            const targetRoom = await prisma.room.findFirst({
                where: {
                    id: payload.targetRoomId,
                    hotelId: room.hotelId,
                    isActive: true,
                },
            });

            if (!targetRoom) {
                return new NextResponse('Целевая комната не найдена', { status: 404 });
            }

            if (targetRoom.currentStayId || targetRoom.status === RoomStatus.OCCUPIED) {
                return new NextResponse('Целевой номер сейчас занят гостем', { status: 400 });
            }
            if (targetRoom.status === RoomStatus.DIRTY) {
                return new NextResponse('Целевой номер свободен, но ожидает уборки', { status: 400 });
            }
            if (targetRoom.status !== RoomStatus.AVAILABLE) {
                return new NextResponse('Целевой номер сейчас недоступен', { status: 400 });
            }

            const transferLine = `Переселение: из №${room.label} в №${targetRoom.label}`;
            const transferStartedAt = new Date();

            const updatedStay = await prisma.$transaction(async (tx) => {
                await lockRoomsForStayMutation(tx, [room.id, targetRoom.id]);

                const lockedCurrentStay = await tx.roomStay.findFirst({
                    where: {
                        id: currentStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.CHECKED_IN
                    }
                });
                if (!lockedCurrentStay) {
                    throw new SessionError('Гость уже выселен или переселён другой операцией', 409);
                }

                const lockedTargetRoom = await tx.room.findFirst({
                    where: {
                        id: targetRoom.id,
                        hotelId: room.hotelId,
                        isActive: true
                    },
                    select: { status: true, currentStayId: true }
                });
                if (!lockedTargetRoom) {
                    throw new SessionError('Целевой номер больше недоступен', 409);
                }
                if (lockedTargetRoom.currentStayId || lockedTargetRoom.status === RoomStatus.OCCUPIED) {
                    throw new SessionError('Целевая комната уже занята другой операцией', 409);
                }
                if (lockedTargetRoom.status === RoomStatus.DIRTY) {
                    throw new SessionError('Целевой номер свободен, но ожидает уборки', 409);
                }
                if (lockedTargetRoom.status !== RoomStatus.AVAILABLE) {
                    throw new SessionError('Целевой номер сейчас недоступен', 409);
                }

                const conflictingStay = await tx.roomStay.findFirst({
                    where: {
                        id: { not: lockedCurrentStay.id },
                        roomId: targetRoom.id,
                        status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                        scheduledCheckIn: { lt: lockedCurrentStay.scheduledCheckOut },
                        scheduledCheckOut: { gt: transferStartedAt },
                    },
                    select: { id: true },
                });
                if (conflictingStay) {
                    throw new SessionError('Перенос пересекается с бронью в целевом номере', 409);
                }

                // Reserve the target row first. currentStayId is assigned only after
                // the source room is released because that column is globally unique.
                const reservedTarget = await tx.room.updateMany({
                    where: {
                        id: targetRoom.id,
                        hotelId: room.hotelId,
                        isActive: true,
                        status: RoomStatus.AVAILABLE,
                        currentStayId: null,
                    },
                    data: {
                        status: RoomStatus.OCCUPIED,
                    },
                });
                if (reservedTarget.count !== 1) {
                    throw new SessionError('Целевой номер уже занят другой операцией', 409);
                }

                const movedStay = await tx.roomStay.updateMany({
                    where: {
                        id: lockedCurrentStay.id,
                        roomId: room.id,
                        hotelId: room.hotelId,
                        status: StayStatus.CHECKED_IN,
                    },
                    data: {
                        roomId: targetRoom.id,
                        notes: appendTransferNote(lockedCurrentStay.notes, payload.transferNote?.trim() ? `${transferLine}. ${payload.transferNote.trim()}` : transferLine),
                    },
                });
                if (movedStay.count !== 1) {
                    throw new SessionError('Гость уже выселен или переселён другой операцией', 409);
                }

                const releasedSource = await tx.room.updateMany({
                    where: {
                        id: room.id,
                        currentStayId: lockedCurrentStay.id,
                    },
                    data: {
                        status: RoomStatus.DIRTY,
                        currentStayId: null,
                    },
                });
                if (releasedSource.count !== 1) {
                    throw new SessionError('Исходный номер уже изменён другой операцией', 409);
                }

                const occupiedTarget = await tx.room.updateMany({
                    where: {
                        id: targetRoom.id,
                        status: RoomStatus.OCCUPIED,
                        currentStayId: null,
                    },
                    data: {
                        currentStayId: lockedCurrentStay.id,
                    },
                });
                if (occupiedTarget.count !== 1) {
                    throw new SessionError('Целевой номер уже изменён другой операцией', 409);
                }

                await tx.stayTransfer.create({
                    data: {
                        stayId: lockedCurrentStay.id,
                        fromRoomId: room.id,
                        toRoomId: targetRoom.id,
                        shiftId: payload.shiftId,
                        note: payload.transferNote?.trim() || null,
                    },
                });

                return tx.roomStay.findUniqueOrThrow({
                    where: { id: lockedCurrentStay.id },
                });
            });

            try {
                await notifyAdminAboutStayTransfer({
                    hotelName: room.hotel.name,
                    guestName: updatedStay.guestName,
                    fromRoomLabel: room.label,
                    toRoomLabel: targetRoom.label,
                    currentCheckOut: updatedStay.scheduledCheckOut?.toISOString(),
                    timezone: room.hotel.timezone,
                    managerName: session.displayName ?? null,
                });
            } catch (notificationError) {
                console.error('Failed to send Telegram transfer notification', notificationError);
            }

            try {
                const roomSnapshotLines = await buildCleaningRoomSnapshotLines(room.hotelId, room.hotel.timezone);
                await notifyCleaningCrew({
                    chatId: room.hotel.cleaningChatId,
                    roomId: room.id,
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    managerName: session.displayName ?? null,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about transfer', notificationError);
            }

            return NextResponse.json(updatedStay);
        }

        const updatedStay = await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, [room.id]);

            const checkedOutStay = await tx.roomStay.updateMany({
                where: {
                    id: currentStay.id,
                    roomId: room.id,
                    hotelId: room.hotelId,
                    status: StayStatus.CHECKED_IN,
                },
                data: {
                    status: StayStatus.CHECKED_OUT,
                    actualCheckOut: new Date(),
                },
            });
            if (checkedOutStay.count !== 1) {
                throw new SessionError('Гость уже выселен или переселён другой операцией', 409);
            }

            const releasedRoom = await tx.room.updateMany({
                where: {
                    id: room.id,
                    currentStayId: currentStay.id,
                },
                data: {
                    status: RoomStatus.DIRTY,
                    currentStayId: null,
                },
            });
            if (releasedRoom.count !== 1) {
                throw new SessionError('Номер уже изменён другой операцией', 409);
            }

            return tx.roomStay.findUniqueOrThrow({
                where: { id: currentStay.id },
            });
        });

        try {
            const roomSnapshotLines = await buildCleaningRoomSnapshotLines(room.hotelId, room.hotel.timezone);
            await notifyCleaningCrewAboutCheckOut({
                chatId: room.hotel.cleaningChatId,
                roomId: room.id,
                hotelName: room.hotel.name,
                roomLabel: room.label,
                guestName: updatedStay.guestName,
                actualCheckOut: updatedStay.actualCheckOut?.toISOString(),
                timezone: room.hotel.timezone,
                managerName: session.displayName ?? null,
                roomSnapshotLines,
            });
        } catch (notificationError) {
            console.error('Failed to notify cleaning crew', notificationError);
        }

        return NextResponse.json(updatedStay);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Error && error.message === 'Для оплаты в долларах укажите курс') {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update room stay');
    }
}
