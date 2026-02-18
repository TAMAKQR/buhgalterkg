import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const createTierSchema = z.object({
    hotelId: z.string().min(1),
    threshold: z.number().int().min(1),
    bonus: z.number().int().min(0).optional(),
    bonusPct: z.number().int().min(0).max(10000).optional(),
}).refine(
    (data) => (data.bonus != null && data.bonus > 0) || (data.bonusPct != null && data.bonusPct > 0),
    { message: 'Укажите фиксированный бонус или процент' }
);

/** GET /api/admin/bonus-tiers?hotelId=... */
export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const hotelId = new URL(request.url).searchParams.get('hotelId');
        if (!hotelId) {
            return new NextResponse('hotelId required', { status: 400 });
        }

        const tiers = await prisma.bonusTier.findMany({
            where: { hotelId },
            orderBy: { threshold: 'asc' },
        });

        return NextResponse.json(tiers);
    } catch (error) {
        return handleApiError(error, 'Failed to load bonus tiers');
    }
}

/** POST /api/admin/bonus-tiers — create a new tier */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = createTierSchema.parse(body);

        const tier = await prisma.bonusTier.create({
            data: {
                hotelId: payload.hotelId,
                threshold: payload.threshold,
                bonus: payload.bonus ?? 0,
                bonusPct: payload.bonusPct ?? null,
            },
        });

        return NextResponse.json(tier, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create bonus tier');
    }
}
