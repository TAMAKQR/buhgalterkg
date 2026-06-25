import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const hotels = await prisma.hotel.findMany({
            where: { guestQrEnabled: true },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                address: true,
                city: true,
                country: true
            }
        });

        return NextResponse.json({
            hotels: hotels.map((hotel) => ({
                id: hotel.id,
                name: hotel.name,
                address: hotel.address,
                city: hotel.city,
                country: hotel.country
            }))
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load guest hotels');
    }
}
