import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
    items: z.array(z.object({
        name: z.string().trim().min(1).max(100),
        monthlyAmount: z.number().int().min(0).max(2_000_000_000),
        kind: z.enum(['GENERAL', 'PAYROLL']).default('GENERAL'),
    })).max(100),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ hotelId: string }> },
) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const payload = payloadSchema.parse(await request.json());
        const country = getCountryFromRequest(request);
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true },
        });
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });

        await prisma.$transaction(async (tx) => {
            await tx.hotelPlannedCostItem.deleteMany({ where: { hotelId: hotel.id } });
            if (payload.items.length) {
                await tx.hotelPlannedCostItem.createMany({
                    data: payload.items.map((item, sortOrder) => ({
                        hotelId: hotel.id,
                        name: item.name,
                        monthlyAmount: item.monthlyAmount,
                        kind: item.kind,
                        sortOrder,
                    })),
                });
            }
        });

        return NextResponse.json({ success: true, itemCount: payload.items.length });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Проверьте месячный план', { status: 400 });
        }
        return handleApiError(error, 'Не удалось сохранить месячный план');
    }
}
