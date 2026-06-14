import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { notifyAdminAboutCheckIn, notifyAdminAboutStayExtension, notifyAdminAboutStayTransfer, notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus, UserRole } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { formatDateKey } from '@/lib/timezone';
import { normalizeMealPlan } from '@/lib/meal-plan';

export const dynamic = 'force-dynamic';

const staySchema = z.object({
    shiftId: z.string().cuid().optional(),
    stayId: z.string().cuid().optional(),
    intent: z.enum(['book', 'checkin', 'checkout', 'extend', 'transfer', 'cancel-booking', 'adjust-payments', 'edit-stay']),
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
    cardAmount: z.number().int().nonnegative().optional(),
    onlineAmount: z.number().int().nonnegative().optional()
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

export async function POST(request: NextRequest, { params }: { params: { roomId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = staySchema.parse(body);

        const room = await prisma.room.findUnique({
            where: { id: params.roomId },
            include: { hotel: true }
        });

        if (!room) {
            return new NextResponse('Room not found', { status: 404 });
        }

        assertHotelAccess(session, room.hotelId);

        const canEditStayPayments = session.role !== UserRole.MANAGER
            ? true
            : Boolean((await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: room.hotelId,
                    userId: session.id,
                    isActive: true
                },
                select: {
                    canEditStayPayments: true
                }
            }))?.canEditStayPayments);

        const shift = payload.shiftId
            ? await prisma.shift.findUnique({ where: { id: payload.shiftId } })
            : null;

        if ((payload.intent === 'checkin' || payload.intent === 'extend' || payload.intent === 'transfer') && (!shift || shift.status !== ShiftStatus.OPEN || shift.hotelId !== room.hotelId)) {
            return new NextResponse('Нужна активная смена для операции с проживанием', { status: 400 });
        }

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

            const conflictingStay = await prisma.roomStay.findFirst({
                where: {
                    roomId: room.id,
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                    scheduledCheckIn: { lt: scheduledCheckOut },
                    scheduledCheckOut: { gt: scheduledCheckIn }
                },
                select: { id: true }
            });

            if (conflictingStay) {
                return new NextResponse('На эти даты у номера уже есть бронь или проживание', { status: 409 });
            }

            const cashAmount = payload.cashAmount ?? 0;
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

            if ((cashAmount > 0 || cardAmount > 0) && (!shift || shift.status !== ShiftStatus.OPEN || shift.hotelId !== room.hotelId)) {
                return new NextResponse('Для наличной или безналичной предоплаты нужна активная смена', { status: 400 });
            }

            const totalAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });
            const detectedMethod = detectStayPaymentMethod({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });

            if (totalAmount > totalTariffAmount) {
                return new NextResponse('Предоплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const stay = await prisma.$transaction(async (tx) => {
                const createdStay = await tx.roomStay.create({
                    data: {
                        roomId: room.id,
                        hotelId: room.hotelId,
                        shiftId: cashAmount > 0 || cardAmount > 0 ? shift?.id : null,
                        bookingSource: resolvedBookingSource,
                        bookingNumber,
                        scheduledCheckIn,
                        scheduledCheckOut,
                        status: StayStatus.SCHEDULED,
                        guestName: normalizeOptionalText(payload.guestName),
                        guestPhone: normalizeOptionalText(payload.guestPhone),
                        companyName: normalizeOptionalText(payload.companyName),
                        mealPlan: normalizeMealPlan(payload.mealPlan),
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
                            managerId: shift?.managerId ?? session.id,
                            stayId: createdStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
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
            if (!canEditStayPayments) {
                return new NextResponse('Нет права отменять операции', { status: 403 });
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

            const cancelledStay = await prisma.roomStay.update({
                where: { id: scheduledStay.id },
                data: {
                    status: StayStatus.CANCELLED,
                },
            });

            return NextResponse.json(cancelledStay);
        }

        if (payload.intent === 'edit-stay') {
            if (!canEditStayPayments) {
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

            if ((targetStay.amountPaid ?? 0) > totalTariffAmount) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const conflictingStay = await prisma.roomStay.findFirst({
                where: {
                    id: { not: targetStay.id },
                    roomId: room.id,
                    hotelId: room.hotelId,
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                    scheduledCheckIn: { lt: scheduledCheckOut },
                    scheduledCheckOut: { gt: scheduledCheckIn }
                },
                select: { id: true }
            });

            if (conflictingStay) {
                return new NextResponse('На эти даты у номера уже есть бронь или проживание', { status: 409 });
            }

            const updatedStay = await prisma.roomStay.update({
                where: { id: targetStay.id },
                data: {
                    guestName: normalizeOptionalText(payload.guestName),
                    guestPhone: normalizeOptionalText(payload.guestPhone),
                    companyName: normalizeOptionalText(payload.companyName),
                    bookingSource: resolvedBookingSource,
                    bookingNumber,
                    scheduledCheckIn,
                    scheduledCheckOut,
                    totalAmount: totalTariffAmount,
                    mealPlan: payload.mealPlan !== undefined ? normalizeMealPlan(payload.mealPlan) : targetStay.mealPlan,
                    notes: normalizeOptionalText(payload.notes)
                }
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

            const cashAmount = payload.cashAmount ?? 0;
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
                include: {
                    shift: {
                        select: {
                            id: true,
                            managerId: true
                        }
                    }
                }
            });

            if (!targetStay) {
                return new NextResponse('Проживание не найдено', { status: 404 });
            }

            if (targetStay.totalAmount != null && totalAmount > targetStay.totalAmount) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const adjustedStay = await prisma.$transaction(async (tx) => {
                const linkedLedgerEntries = await tx.cashEntry.findMany({
                    where: {
                        stayId: targetStay.id,
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

                const ledgerShiftId = linkedLedgerEntries[0]?.shiftId ?? targetStay.shiftId ?? shift?.id ?? null;
                const ledgerManagerId = linkedLedgerEntries[0]?.managerId ?? targetStay.shift?.managerId ?? shift?.managerId ?? session.id;

                if ((cashAmount > 0 || cardAmount > 0) && !ledgerShiftId) {
                    return null;
                }

                if (linkedLedgerEntries.length) {
                    await tx.cashEntry.deleteMany({
                        where: {
                            id: { in: linkedLedgerEntries.map((entry) => entry.id) }
                        }
                    });
                }

                const updatedStay = await tx.roomStay.update({
                    where: { id: targetStay.id },
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
                        shiftId: targetStay.shiftId ?? ledgerShiftId
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
                            stayId: targetStay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerEntry.method,
                            amount: ledgerEntry.amount,
                            note: `Корректировка оплаты №${room.label}`,
                            recordedAt,
                            meta: {
                                source: 'room_stay',
                                kind: 'manager_payment_adjustment',
                                stayId: targetStay.id,
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

        if (payload.intent === 'checkin') {
            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, room.hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!room.hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const cashAmount =
                payload.cashAmount ??
                (payload.paymentMethod === PaymentMethod.CASH ? payload.amountPaid ?? 0 : 0);
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
                })
                : null;

            if (payload.stayId && !scheduledStay) {
                return new NextResponse('Бронь не найдена или уже изменена', { status: 404 });
            }

            if (scheduledStay) {
                const todayKey = formatDateKey(new Date(), room.hotel.timezone);
                const checkInKey = formatDateKey(scheduledStay.scheduledCheckIn, room.hotel.timezone);
                if (checkInKey && todayKey && checkInKey > todayKey) {
                    return new NextResponse('Заселение по брони доступно только в день заезда', { status: 400 });
                }
            }

            if (scheduledStay && (room.status !== RoomStatus.AVAILABLE || room.currentStayId)) {
                return new NextResponse('Номер сейчас не свободен для заселения', { status: 409 });
            }

            if (!scheduledStay && (room.status !== RoomStatus.AVAILABLE || room.currentStayId)) {
                return new NextResponse('Номер сейчас не свободен для заселения', { status: 409 });
            }

            const nextCashAmount = (scheduledStay?.cashPaid ?? 0) + cashAmount;
            const nextCardAmount = (scheduledStay?.cardPaid ?? 0) + cardAmount;
            const nextOnlineAmount = (scheduledStay?.onlinePaid ?? 0) + onlineAmount;
            const nextTotalTariffAmount = payload.totalAmount ?? scheduledStay?.totalAmount ?? 0;
            const nextBookingSource = resolvedBookingSource ?? scheduledStay?.bookingSource ?? null;
            const nextBookingNumber = normalizeOptionalText(payload.bookingNumber) ?? scheduledStay?.bookingNumber ?? null;
            const totalAmount = sumStayPayments({
                cashPaid: nextCashAmount,
                cardPaid: nextCardAmount,
                onlinePaid: nextOnlineAmount
            });
            const detectedMethod = detectStayPaymentMethod({
                cashPaid: nextCashAmount,
                cardPaid: nextCardAmount,
                onlinePaid: nextOnlineAmount
            });

            if (totalAmount <= 0) {
                return new NextResponse('Укажите сумму оплаты (наличные, безналичные и/или на сайте)', { status: 400 });
            }

            if (nextTotalTariffAmount <= 0) {
                return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
            }

            if (nextBookingSource && !nextBookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }

            if (totalAmount > nextTotalTariffAmount) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const stay = scheduledStay
                ? await prisma.roomStay.update({
                    where: { id: scheduledStay.id },
                    data: {
                        shiftId: payload.shiftId,
                        bookingSource: resolvedBookingSource ?? scheduledStay.bookingSource,
                        bookingNumber: nextBookingNumber,
                        scheduledCheckIn: payload.scheduledCheckIn ? new Date(payload.scheduledCheckIn) : scheduledStay.scheduledCheckIn,
                        scheduledCheckOut: payload.scheduledCheckOut ? new Date(payload.scheduledCheckOut) : scheduledStay.scheduledCheckOut,
                        status: StayStatus.CHECKED_IN,
                        actualCheckIn: new Date(),
                        guestName: normalizeOptionalText(payload.guestName) ?? scheduledStay.guestName,
                        guestPhone: normalizeOptionalText(payload.guestPhone) ?? scheduledStay.guestPhone,
                        companyName: normalizeOptionalText(payload.companyName) ?? scheduledStay.companyName,
                        mealPlan: payload.mealPlan !== undefined ? normalizeMealPlan(payload.mealPlan) : scheduledStay.mealPlan,
                        notes: normalizeOptionalText(payload.notes) ?? scheduledStay.notes,
                        amountPaid: totalAmount,
                        totalAmount: nextTotalTariffAmount,
                        paymentMethod: detectedMethod,
                        cashPaid: nextCashAmount,
                        cardPaid: nextCardAmount,
                        onlinePaid: nextOnlineAmount
                    }
                })
                : await prisma.roomStay.create({
                    data: {
                        roomId: room.id,
                        shiftId: payload.shiftId,
                        hotelId: room.hotelId,
                        bookingSource: resolvedBookingSource,
                        bookingNumber: nextBookingNumber,
                        scheduledCheckIn: payload.scheduledCheckIn ? new Date(payload.scheduledCheckIn) : new Date(),
                        scheduledCheckOut: payload.scheduledCheckOut
                            ? new Date(payload.scheduledCheckOut)
                            : new Date(Date.now() + 12 * 60 * 60 * 1000),
                        status: StayStatus.CHECKED_IN,
                        actualCheckIn: new Date(),
                        guestName: normalizeOptionalText(payload.guestName),
                        guestPhone: normalizeOptionalText(payload.guestPhone),
                        companyName: normalizeOptionalText(payload.companyName),
                        mealPlan: normalizeMealPlan(payload.mealPlan),
                        notes: normalizeOptionalText(payload.notes),
                        amountPaid: totalAmount,
                        totalAmount: nextTotalTariffAmount,
                        paymentMethod: detectedMethod,
                        cashPaid: cashAmount,
                        cardPaid: cardAmount,
                        onlinePaid: onlineAmount
                    }
                });

            await prisma.room.update({
                where: { id: room.id },
                data: {
                    status: RoomStatus.OCCUPIED,
                    currentStayId: stay.id
                }
            });

            const ledgerPayloads = [
                { amount: cashAmount, method: PaymentMethod.CASH },
                { amount: cardAmount, method: PaymentMethod.CARD }
            ].filter((entry) => entry.amount > 0);

            for (const ledgerEntry of ledgerPayloads) {
                await prisma.cashEntry.create({
                    data: {
                        hotelId: room.hotelId,
                        shiftId: payload.shiftId,
                        managerId: shift?.managerId ?? session.id,
                        stayId: stay.id,
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerEntry.method,
                        amount: ledgerEntry.amount,
                        note: `Заселение №${room.label}`,
                        meta: {
                            source: 'room_stay',
                            kind: 'checkin',
                            stayId: stay.id,
                            roomId: room.id
                        }
                    }
                });
            }

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
                    bookingSource: resolvedBookingSource,
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

            const cashAmount = payload.cashAmount ?? 0;
            const cardAmount = payload.cardAmount ?? 0;
            const onlineAmount = payload.onlineAmount ?? 0;
            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }
            const totalCashPaid = (currentStay.cashPaid ?? 0) + cashAmount;
            const totalCardPaid = (currentStay.cardPaid ?? 0) + cardAmount;
            const totalOnlinePaid = (currentStay.onlinePaid ?? 0) + onlineAmount;
            const extraAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });
            const totalAmountPaid = (currentStay.amountPaid ?? 0) + extraAmount;
            const detectedMethod = detectStayPaymentMethod({ cashPaid: totalCashPaid, cardPaid: totalCardPaid, onlinePaid: totalOnlinePaid });

            const updatedStay = await prisma.roomStay.update({
                where: { id: currentStay.id },
                data: {
                    scheduledCheckOut: nextCheckOut,
                    amountPaid: totalAmountPaid,
                    paymentMethod: detectedMethod,
                    cashPaid: totalCashPaid,
                    cardPaid: totalCardPaid,
                    onlinePaid: totalOnlinePaid
                }
            });

            const ledgerPayloads = [
                { amount: cashAmount, method: PaymentMethod.CASH },
                { amount: cardAmount, method: PaymentMethod.CARD }
            ].filter((entry) => entry.amount > 0);

            for (const ledgerEntry of ledgerPayloads) {
                await prisma.cashEntry.create({
                    data: {
                        hotelId: room.hotelId,
                        shiftId: payload.shiftId,
                        managerId: shift?.managerId ?? session.id,
                        stayId: currentStay.id,
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerEntry.method,
                        amount: ledgerEntry.amount,
                        note: `Продление №${room.label}`,
                        meta: {
                            source: 'room_stay',
                            kind: 'extension',
                            stayId: currentStay.id,
                            roomId: room.id
                        }
                    }
                });
            }

            try {
                await notifyAdminAboutStayExtension({
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    guestName: updatedStay.guestName,
                    previousCheckOut: currentStay.scheduledCheckOut.toISOString(),
                    nextCheckOut: updatedStay.scheduledCheckOut.toISOString(),
                    extraAmount,
                    paymentDetails: {
                        cashAmount,
                        cardAmount,
                        onlineAmount,
                    },
                    timezone: room.hotel.timezone,
                    currency: room.hotel.currency,
                    managerName: session.displayName ?? session.username ?? null,
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

            if (targetRoom.status !== RoomStatus.AVAILABLE || targetRoom.currentStayId) {
                return new NextResponse('Целевая комната должна быть свободной', { status: 400 });
            }

            const conflictingStay = await prisma.roomStay.findFirst({
                where: {
                    roomId: targetRoom.id,
                    status: StayStatus.CHECKED_IN,
                },
                select: { id: true },
            });

            if (conflictingStay) {
                return new NextResponse('В целевой комнате уже есть активное проживание', { status: 409 });
            }

            const transferLine = `Переселение: из №${room.label} в №${targetRoom.label}`;

            const updatedStay = await prisma.$transaction(async (tx) => {
                await tx.room.update({
                    where: { id: room.id },
                    data: {
                        status: RoomStatus.DIRTY,
                        currentStayId: null,
                    },
                });

                await tx.room.update({
                    where: { id: targetRoom.id },
                    data: {
                        status: RoomStatus.OCCUPIED,
                        currentStayId: currentStay.id,
                    },
                });

                await tx.stayTransfer.create({
                    data: {
                        stayId: currentStay.id,
                        fromRoomId: room.id,
                        toRoomId: targetRoom.id,
                        shiftId: payload.shiftId,
                        note: payload.transferNote?.trim() || null,
                    },
                });

                return tx.roomStay.update({
                    where: { id: currentStay.id },
                    data: {
                        roomId: targetRoom.id,
                        notes: appendTransferNote(currentStay.notes, payload.transferNote?.trim() ? `${transferLine}. ${payload.transferNote.trim()}` : transferLine),
                    },
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
                    managerName: session.displayName ?? session.username ?? null,
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
                    managerName: session.displayName ?? session.username ?? null,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about transfer', notificationError);
            }

            return NextResponse.json(updatedStay);
        }

        const updatedStay = await prisma.roomStay.update({
            where: { id: currentStay.id },
            data: {
                status: StayStatus.CHECKED_OUT,
                actualCheckOut: new Date()
            }
        });

        await prisma.room.update({
            where: { id: room.id },
            data: {
                status: RoomStatus.DIRTY,
                currentStayId: null
            }
        });

        try {
            const roomSnapshotLines = await buildCleaningRoomSnapshotLines(room.hotelId, room.hotel.timezone);
            await notifyCleaningCrew({
                chatId: room.hotel.cleaningChatId,
                roomId: room.id,
                hotelName: room.hotel.name,
                roomLabel: room.label,
                managerName: session.displayName ?? session.username ?? null,
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
        return handleApiError(error, 'Failed to update room stay');
    }
}
