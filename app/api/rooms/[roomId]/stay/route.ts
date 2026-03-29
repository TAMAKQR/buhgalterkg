import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { notifyAdminAboutCheckIn, notifyAdminAboutStayExtension, notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const staySchema = z.object({
    shiftId: z.string().cuid(),
    intent: z.enum(['checkin', 'checkout', 'extend']),
    guestName: z.string().optional(),
    scheduledCheckIn: z.string().datetime().optional(),
    scheduledCheckOut: z.string().datetime().optional(),
    amountPaid: z.number().int().positive().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    cashAmount: z.number().int().nonnegative().optional(),
    cardAmount: z.number().int().nonnegative().optional()
});

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

        if ((payload.intent === 'checkin' || payload.intent === 'extend') && (!shift || shift.status !== ShiftStatus.OPEN || shift.hotelId !== room.hotelId)) {
            return new NextResponse('Нужна активная смена для операции с проживанием', { status: 400 });
        }

        if (payload.intent === 'checkin') {
            const cashAmount =
                payload.cashAmount ??
                (payload.paymentMethod === PaymentMethod.CASH ? payload.amountPaid ?? 0 : 0);
            const cardAmount =
                payload.cardAmount ??
                (payload.paymentMethod === PaymentMethod.CARD ? payload.amountPaid ?? 0 : 0);

            if (!cashAmount && !cardAmount) {
                return new NextResponse('Укажите сумму оплаты (наличные и/или безналичные)', { status: 400 });
            }

            if (cashAmount < 0 || cardAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            const totalAmount = cashAmount + cardAmount;
            const detectedMethod =
                cashAmount && cardAmount
                    ? null
                    : cashAmount
                        ? PaymentMethod.CASH
                        : PaymentMethod.CARD;

            const stay = await prisma.roomStay.create({
                data: {
                    roomId: room.id,
                    shiftId: payload.shiftId,
                    hotelId: room.hotelId,
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
                    cardPaid: cardAmount
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
                        cardAmount
                    },
                    timezone: room.hotel.timezone,
                    currency: room.hotel.currency,
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
            if (cashAmount < 0 || cardAmount < 0) {
                return new NextResponse('Сумма не может быть отрицательной', { status: 400 });
            }

            const totalCashPaid = (currentStay.cashPaid ?? 0) + cashAmount;
            const totalCardPaid = (currentStay.cardPaid ?? 0) + cardAmount;
            const extraAmount = cashAmount + cardAmount;
            const totalAmountPaid = (currentStay.amountPaid ?? 0) + extraAmount;
            const detectedMethod =
                totalCashPaid && totalCardPaid
                    ? null
                    : totalCashPaid
                        ? PaymentMethod.CASH
                        : totalCardPaid
                            ? PaymentMethod.CARD
                            : currentStay.paymentMethod;

            const updatedStay = await prisma.roomStay.update({
                where: { id: currentStay.id },
                data: {
                    scheduledCheckOut: nextCheckOut,
                    amountPaid: totalAmountPaid,
                    paymentMethod: detectedMethod,
                    cashPaid: totalCashPaid,
                    cardPaid: totalCardPaid
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
