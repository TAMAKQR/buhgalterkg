import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { normalizeBookingSource, resolveBookingSource } from '@/lib/stays';

export const dynamic = 'force-dynamic';

const createStaySchema = z.object({
    roomId: z.string().cuid(),
    guestName: z.string().max(80).optional().nullable(),
    guestPhone: z.string().max(40).optional().nullable(),
    companyName: z.string().max(120).optional().nullable(),
    bookingSource: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    notes: z.string().max(500).optional().nullable()
});

const normalizeOptionalText = (value?: string | null) => {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = createStaySchema.parse(body);
        const scheduledCheckIn = new Date(payload.scheduledCheckIn);
        const scheduledCheckOut = new Date(payload.scheduledCheckOut);

        if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
            return new NextResponse('Некорректные даты брони', { status: 400 });
        }

        if (scheduledCheckOut <= scheduledCheckIn) {
            return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
        }

        const room = await prisma.room.findFirst({
            where: {
                id: payload.roomId,
                isActive: true,
                hotel: { country }
            },
            include: { hotel: true }
        });

        if (!room) {
            return new NextResponse('Номер не найден', { status: 404 });
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

        const stay = await prisma.roomStay.create({
            data: {
                roomId: room.id,
                hotelId: room.hotelId,
                guestName: normalizeOptionalText(payload.guestName),
                guestPhone: normalizeOptionalText(payload.guestPhone),
                companyName: normalizeOptionalText(payload.companyName),
                bookingSource: resolvedBookingSource,
                scheduledCheckIn,
                scheduledCheckOut,
                status: StayStatus.SCHEDULED,
                notes: normalizeOptionalText(payload.notes),
                amountPaid: 0,
                cashPaid: 0,
                cardPaid: 0,
                onlinePaid: 0
            }
        });

        return NextResponse.json(stay, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create stay booking');
    }
}
