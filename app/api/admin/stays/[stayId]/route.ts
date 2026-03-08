import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, PaymentMethod, RoomStatus, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { getCountryFromRequest } from '@/lib/server/request-country';

export const dynamic = 'force-dynamic';

const updateStaySchema = z
    .object({
        guestName: z.string().max(80).optional().nullable(),
        scheduledCheckIn: z.string().datetime().optional().nullable(),
        scheduledCheckOut: z.string().datetime().optional().nullable(),
        actualCheckIn: z.string().datetime().optional().nullable(),
        actualCheckOut: z.string().datetime().optional().nullable(),
        status: z.nativeEnum(StayStatus).optional(),
        amountPaid: z.number().int().min(0).optional(),
        cashPaid: z.number().int().min(0).optional(),
        cardPaid: z.number().int().min(0).optional(),
        paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
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

export async function PATCH(request: NextRequest, { params }: { params: { stayId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateStaySchema.parse(body);
        const stay = await prisma.roomStay.findFirst({
            where: {
                id: params.stayId,
                hotel: { country },
            },
            include: {
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

        const updateData: Prisma.RoomStayUpdateInput = {};

        if (payload.guestName !== undefined) {
            const trimmed = payload.guestName?.trim();
            updateData.guestName = trimmed?.length ? trimmed : null;
        }

        if (payload.notes !== undefined) {
            const trimmed = payload.notes?.trim();
            updateData.notes = trimmed?.length ? trimmed : null;
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

        const nextCash = payload.cashPaid ?? stay.cashPaid;
        const nextCard = payload.cardPaid ?? stay.cardPaid;

        if (payload.amountPaid !== undefined) {
            updateData.amountPaid = payload.amountPaid;
        } else if (payload.cashPaid !== undefined || payload.cardPaid !== undefined) {
            updateData.amountPaid = nextCash + nextCard;
        }

        if (payload.cashPaid !== undefined) {
            updateData.cashPaid = payload.cashPaid;
        }

        if (payload.cardPaid !== undefined) {
            updateData.cardPaid = payload.cardPaid;
        }

        if (payload.paymentMethod !== undefined) {
            updateData.paymentMethod = payload.paymentMethod ?? null;
        } else if (
            (payload.cashPaid !== undefined || payload.cardPaid !== undefined) &&
            (payload.cashPaid ?? nextCash) &&
            (payload.cardPaid ?? nextCard)
        ) {
            updateData.paymentMethod = null;
        }

        const updatedStay = await prisma.$transaction(async (tx) => {
            const result = await tx.roomStay.update({
                where: { id: params.stayId },
                data: updateData
            });

            if (stay.room.currentStayId === stay.id && payload.status) {
                const nextRoomData: Prisma.RoomUpdateInput | null = (() => {
                    if (payload.status === StayStatus.CHECKED_IN) {
                        return { status: RoomStatus.OCCUPIED, currentStayId: stay.id };
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

            return result;
        });

        // Отправка уведомлений горничным
        const hotel = stay.room.hotel;
        const wasCheckedIn = stay.actualCheckIn !== null;
        const wasCheckedOut = stay.actualCheckOut !== null;
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
                    guestName: updatedStay.guestName || stay.guestName,
                    checkOut: updatedStay.scheduledCheckOut?.toISOString() || stay.scheduledCheckOut?.toISOString(),
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

        return NextResponse.json({ success: true, stay: updatedStay });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update stay');
    }
}
