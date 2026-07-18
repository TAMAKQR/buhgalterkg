import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';

export const dynamic = 'force-dynamic';

const updateTierSchema = z.object({
    threshold: z.number().int().min(1).optional(),
    bonus: z.number().int().min(0).optional(),
    bonusPct: z.number().int().min(0).max(10000).nullable().optional(),
});

/** PATCH /api/admin/bonus-tiers/[tierId] */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tierId: string }> }) {
    try {
        const { tierId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateTierSchema.parse(body);

        const tier = await prisma.bonusTier.findFirst({ where: { id: tierId, hotel: { country } } });
        if (!tier) {
            return new NextResponse('Tier not found', { status: 404 });
        }

        const updated = await prisma.bonusTier.update({
            where: { id: tierId },
            data: {
                ...(payload.threshold != null && { threshold: payload.threshold }),
                ...(payload.bonus != null && { bonus: payload.bonus }),
                ...(typeof payload.bonusPct !== 'undefined' && { bonusPct: payload.bonusPct }),
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update bonus tier');
    }
}

/** DELETE /api/admin/bonus-tiers/[tierId] */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tierId: string }> }) {
    try {
        const { tierId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const tier = await prisma.bonusTier.findFirst({ where: { id: tierId, hotel: { country } } });
        if (!tier) {
            return new NextResponse('Tier not found', { status: 404 });
        }

        await prisma.bonusTier.delete({ where: { id: tierId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete bonus tier');
    }
}
