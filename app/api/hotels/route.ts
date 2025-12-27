import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { ShiftStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const createHotelSchema = z.object({
    name: z.string().min(2),
    address: z.string().min(4),
    managerSharePct: z.number().int().min(0).max(100).optional(),
    notes: z.string().max(500).optional()
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const hotels = await prisma.hotel.findMany({
            include: {
                rooms: true,
                shifts: {
                    where: { status: ShiftStatus.OPEN },
                    orderBy: { openedAt: 'desc' },
                    take: 1,
                    include: {
                        manager: true
                    }
                },
                assignments: {
                    where: { isActive: true },
                    include: { user: true }
                }
            }
        });

        const payload = hotels.map((hotel) => ({
            id: hotel.id,
            name: hotel.name,
            address: hotel.address,
            managerSharePct: hotel.managerSharePct,
            notes: hotel.notes,
            roomCount: hotel.rooms.length,
            occupiedRooms: hotel.rooms.filter((room) => room.status !== 'AVAILABLE').length,
            managers: hotel.assignments.map((assignment) => ({
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                telegramId: assignment.user.telegramId,
                username: assignment.user.username,
                role: assignment.role,
                pinCode: assignment.pinCode
            })),
            activeShift: hotel.shifts[0]
                ? {
                    manager: hotel.shifts[0].manager.displayName,
                    openedAt: hotel.shifts[0].openedAt,
                    openingCash: hotel.shifts[0].openingCash,
                    number: hotel.shifts[0].number
                }
                : null
        }));

        return NextResponse.json(payload);
    } catch (error) {
        console.error(error);
        return new NextResponse('Failed to load hotels', { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = createHotelSchema.parse(rest);

        const hotel = await prisma.hotel.create({ data: payload });

        return NextResponse.json(hotel, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to create hotel', { status: 500 });
    }
}
