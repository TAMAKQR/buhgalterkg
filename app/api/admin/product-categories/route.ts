import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const createCategorySchema = z.object({
    hotelId: z.string().cuid(),
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional().nullable()
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const hotelId = request.nextUrl.searchParams.get('hotelId');
        if (!hotelId) {
            return new NextResponse('hotelId обязателен', { status: 400 });
        }

        const categories = await prisma.productCategory.findMany({
            where: { hotelId },
            include: { _count: { select: { products: true } } },
            orderBy: { name: 'asc' }
        });

        return NextResponse.json(
            categories.map((category) => ({
                id: category.id,
                hotelId: category.hotelId,
                name: category.name,
                description: category.description,
                productCount: category._count.products,
                createdAt: category.createdAt,
                updatedAt: category.updatedAt
            }))
        );
    } catch (error) {
        return handleApiError(error, 'Failed to load product categories');
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = createCategorySchema.parse(rest);

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId }, select: { id: true } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const category = await prisma.productCategory.create({
            data: {
                hotelId: payload.hotelId,
                name: payload.name.trim(),
                description: payload.description?.trim() || null
            }
        });

        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create product category');
    }
}
