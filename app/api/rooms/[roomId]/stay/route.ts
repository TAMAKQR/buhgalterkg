import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { notifyAdminAboutCheckIn } from '@/lib/server/telegram-notify';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const staySchema = z.object({
    shiftId: z.string().cuid(),
    intent: z.enum(['checkin', 'checkout']),
    guestName: z.string().optional(),
    scheduledCheckIn: z.string().datetime().optional(),
    scheduledCheckOut: z.string().datetime().optional(),
    amountPaid: z.number().int().positive().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional()
});

export async function POST(request: NextRequest, { params }: { params: { roomId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        const payload = staySchema.parse(rest);

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

        if (payload.intent === 'checkin' && (!shift || shift.status !== ShiftStatus.OPEN || shift.hotelId !== room.hotelId)) {
            return new NextResponse('Нужна активная смена для заселения', { status: 400 });
        }

        if (payload.intent === 'checkin') {
            if (!payload.amountPaid || !payload.paymentMethod) {
                return new NextResponse('Укажите сумму и способ оплаты', { status: 400 });
            }

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
                    amountPaid: payload.amountPaid,
                    paymentMethod: payload.paymentMethod
                }
            });

            await prisma.room.update({
                where: { id: room.id },
                data: {
                    status: RoomStatus.OCCUPIED,
                    currentStayId: stay.id
                }
            });

            await prisma.cashEntry.create({
                data: {
                    hotelId: room.hotelId,
                    shiftId: payload.shiftId,
                    managerId: shift?.managerId ?? session.id,
                    entryType: LedgerEntryType.CASH_IN,
                    method: payload.paymentMethod,
                    amount: payload.amountPaid,
                    note: `Заселение №${room.label}`
                }
            });

            const scheduledCheckOutIso = stay.scheduledCheckOut ? stay.scheduledCheckOut.toISOString() : undefined;

            try {
                await notifyAdminAboutCheckIn({
                    hotelName: room.hotel.name,
                    roomLabel: room.label,
                    checkIn: stay.scheduledCheckIn.toISOString(),
                    checkOut: scheduledCheckOutIso,
                    amount: payload.amountPaid,
                    paymentMethod: payload.paymentMethod
                });
            } catch (notificationError) {
                console.error('Failed to send Telegram notification', notificationError);
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

        return NextResponse.json(updatedStay);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to update room stay', { status: 500 });
    }
}
