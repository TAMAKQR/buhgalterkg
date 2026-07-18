import { NextRequest, NextResponse } from 'next/server';
import { ShiftStatus } from '@prisma/client';
import { z } from 'zod';

import { buildShiftAnalysis } from '@/lib/ai-shift-analysis';
import { prisma } from '@/lib/db';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
    hotelId: z.string().cuid().optional()
});

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const body = await request.json().catch(() => ({}));
        const payload = requestSchema.parse(body);
        const hotelId = payload.hotelId ?? session.hotels[0]?.id;

        if (!hotelId) {
            return new NextResponse('Manager is not assigned to a hotel', { status: 400 });
        }

        assertHotelOperatorAccess(session, hotelId);

        const shift = await prisma.shift.findFirst({
            where: {
                hotelId,
                status: ShiftStatus.OPEN
            },
            orderBy: { openedAt: 'desc' },
            select: {
                id: true,
                managerId: true
            }
        });

        if (!shift) {
            return new NextResponse('Open shift not found', { status: 404 });
        }

        if (shift.managerId !== session.id) {
            return new NextResponse('Shift belongs to another manager', { status: 409 });
        }

        const analysis = await buildShiftAnalysis(shift.id, 'manager', session);
        if (!analysis) {
            return new NextResponse('Shift not found', { status: 404 });
        }

        return NextResponse.json(analysis);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to prepare manager AI assistant');
    }
}
