import { NextRequest, NextResponse } from 'next/server';
import { ShiftStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const clearSchema = z.object({
    hotelId: z.string().cuid()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const session = await getSessionUser(request);
        assertAdmin(session);

        const { hotelId } = clearSchema.parse(body);

        const closedShifts = await prisma.shift.findMany({
            where: { hotelId, status: ShiftStatus.CLOSED },
            select: { id: true }
        });

        if (!closedShifts.length) {
            return NextResponse.json({ clearedShifts: 0, clearedEntries: 0, updatedStays: 0 });
        }

        const shiftIds = closedShifts.map((shift) => shift.id);

        const results = await prisma.$transaction(async (tx) => {
            const updatedStays = await tx.roomStay.updateMany({
                where: { shiftId: { in: shiftIds } },
                data: { shiftId: null }
            });

            const deletedEntries = await tx.cashEntry.deleteMany({
                where: { shiftId: { in: shiftIds } }
            });

            const deletedShifts = await tx.shift.deleteMany({
                where: { id: { in: shiftIds } }
            });

            return {
                clearedShifts: deletedShifts.count,
                clearedEntries: deletedEntries.count,
                updatedStays: updatedStays.count
            };
        });

        return NextResponse.json(results);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Не удалось очистить историю смен');
    }
}
