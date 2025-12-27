import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { ensureShiftOwnership } from '@/lib/shifts';

export const dynamic = 'force-dynamic';

const handoverSchema = z.object({
    handoverCash: z.number().int().nonnegative(),
    closingCash: z.number().int().nonnegative(),
    note: z.string().optional(),
    pinCode: z.string().regex(/^\d{6}$/).optional()
});

export async function POST(request: NextRequest, { params }: { params: { shiftId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        const payload = handoverSchema.parse(rest);

        const shift = await ensureShiftOwnership(params.shiftId, session, { pinCode: payload.pinCode });

        const updated = await prisma.shift.update({
            where: { id: shift.id },
            data: {
                closingCash: payload.closingCash,
                handoverCash: payload.handoverCash,
                closingNote: payload.note,
                status: 'CLOSED',
                closedAt: new Date()
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to handover shift', { status: 500 });
    }
}
