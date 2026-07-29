import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const searchSchema = z.object({
    hotelId: z.string().cuid(),
    bookingNumber: z.string().trim().min(3).max(50),
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const query = searchSchema.parse({
            hotelId: request.nextUrl.searchParams.get('hotelId'),
            bookingNumber: request.nextUrl.searchParams.get('bookingNumber'),
        });

        assertHotelOperatorAccess(session, query.hotelId);

        const stays = await prisma.roomStay.findMany({
            where: {
                hotelId: query.hotelId,
                bookingNumber: { contains: query.bookingNumber, mode: 'insensitive' },
            },
            orderBy: [{ scheduledCheckIn: 'desc' }, { createdAt: 'desc' }],
            take: 20,
            select: {
                id: true,
                guestName: true,
                guestPhone: true,
                companyName: true,
                scheduledCheckIn: true,
                scheduledCheckOut: true,
                status: true,
                amountPaid: true,
                totalAmount: true,
                paymentMethod: true,
                cashPaid: true,
                cardPaid: true,
                onlinePaid: true,
                tariffPending: true,
                groupRef: true,
                bookingSource: true,
                bookingNumber: true,
                mealPlan: true,
                notes: true,
                room: { select: { id: true, label: true, floor: true } },
            },
        });

        return NextResponse.json({ stays });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse('Введите минимум 3 символа номера брони', { status: 400 });
        }
        return handleApiError(error, 'Не удалось найти бронирование');
    }
}
