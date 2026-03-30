import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { notifyAdminAboutCheckIn, notifyAdminAboutStayExtension, notifyAdminAboutStayTransfer, notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';

export const dynamic = 'force-dynamic';

const staySchema = z.object({
    shiftId: z.string().cuid(),
    intent: z.enum(['checkin', 'checkout', 'extend', 'transfer']),
    guestName: z.string().optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    targetRoomId: z.string().cuid().optional(),
    transferNote: z.string().trim().max(300).optional().nullable(),
    scheduledCheckIn: z.string().datetime().optional(),
    scheduledCheckOut: z.string().datetime().optional(),
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

        const shift = payload.shiftId
            ? await prisma.shift.findUnique({ where: { id: payload.shiftId } })
            : null;

        if ((payload.intent === 'checkin' || payload.intent === 'extend' || payload.intent === 'transfer') && (!shift || shift.status !== ShiftStatus.OPEN || shift.hotelId !== room.hotelId)) {
            return new NextResponse('Нужна активная смена для операции с проживанием', { status: 400 });
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

            if (!cashAmount && !cardAmount && !onlineAmount) {
                return new NextResponse('Укажите сумму оплаты (наличные, безналичные и/или на сайте)', { status: 400 });
            }

            if (cashAmount < 0 || cardAmount < 0 || onlineAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            const totalAmount = sumStayPayments({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });
            const detectedMethod = detectStayPaymentMethod({ cashPaid: cashAmount, cardPaid: cardAmount, onlinePaid: onlineAmount });

            const stay = await prisma.roomStay.create({
                data: {
                    roomId: room.id,
                    shiftId: payload.shiftId,
                    hotelId: room.hotelId,
                    bookingSource: resolvedBookingSource,
                    scheduledCheckIn: payload.scheduledCheckIn ? new Date(payload.scheduledCheckIn) : new Date(),
                    scheduledCheckOut: payload.scheduledCheckOut
                        ? new Date(payload.scheduledCheckOut)
                        : new Date(Date.now() + 12 * 60 * 60 * 1000),
                    status: StayStatus.CHECKED_IN,
                    actualCheckIn: new Date(),
                    guestName: payload.guestName,
                    amountPaid: totalAmount,
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
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerEntry.method,
                        amount: ledgerEntry.amount,
                        note: `Заселение №${room.label}`
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
                        cashAmount,
                        cardAmount,
                        onlineAmount
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

        const currentStay = await prisma.roomStay.findFirst({
            where: { roomId: room.id, status: StayStatus.CHECKED_IN },
            orderBy: { scheduledCheckIn: 'desc' }
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
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerEntry.method,
                        amount: ledgerEntry.amount,
                        note: `Продление №${room.label}`
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
