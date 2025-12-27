import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { ensureNoActiveShift } from '@/lib/shifts';

export const dynamic = 'force-dynamic';

const openShiftSchema = z.object({
    hotelId: z.string().cuid(),
    openingCash: z.number().int().nonnegative(),
    note: z.string().optional(),
    action: z.literal('open'),
    pinCode: z.string().regex(/^\d{6}$/).optional()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        const payload = openShiftSchema.parse(rest);

        assertHotelAccess(session, payload.hotelId);
        await ensureNoActiveShift(payload.hotelId);

        if (session.role !== 'MANAGER' && !payload.pinCode) {
            return new NextResponse('Введите код менеджера для открытия смены', { status: 400 });
        }

        let managerId = session.id;
        if (payload.pinCode) {
            const assignment = await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: payload.hotelId,
                    pinCode: payload.pinCode,
                    isActive: true
                },
                include: { user: true }
            });

            if (!assignment) {
                return new NextResponse('Неверный код менеджера', { status: 401 });
            }

            managerId = assignment.userId;
        }

        const shift = await prisma.$transaction(async (tx) => {
            const nextNumberResult = await tx.shift.aggregate({
                where: { hotelId: payload.hotelId },
                _max: { number: true }
            });

            const nextNumber = (nextNumberResult._max.number ?? 0) + 1;

            return tx.shift.create({
                data: {
                    hotelId: payload.hotelId,
                    managerId,
                    openingCash: payload.openingCash,
                    openingNote: payload.note,
                    number: nextNumber
                }
            });
        });

        return NextResponse.json(shift, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if ((error as { code?: string } | null)?.code === 'P2002') {
            return new NextResponse('Не удалось открыть смену, попробуйте ещё раз', { status: 409 });
        }
        console.error(error);
        return new NextResponse('Failed to open shift', { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const hotelId = request.nextUrl.searchParams.get('hotelId');

        const shifts = await prisma.shift.findMany({
            where: {
                hotelId: hotelId ?? undefined,
                managerId: session.role === 'MANAGER' ? session.id : undefined
            },
            orderBy: { openedAt: 'desc' },
            take: 20,
            include: { hotel: true, manager: true }
        });

        return NextResponse.json(shifts);
    } catch (error) {
        console.error(error);
        return new NextResponse('Failed to load shifts', { status: 500 });
    }
}
