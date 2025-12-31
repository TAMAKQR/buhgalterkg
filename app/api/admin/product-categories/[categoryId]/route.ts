import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

const updateCategorySchema = z
    .object({
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(500).optional().nullable()
    })
    .refine((values) => Object.values(values).some((value) => value !== undefined), {
        message: 'Нет данных для обновления'
    });

export async function PATCH(request: NextRequest, { params }: { params: { categoryId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = updateCategorySchema.parse(rest);

        const category = await prisma.productCategory.findUnique({ where: { id: params.categoryId } });
        if (!category) {
            return new NextResponse('Категория не найдена', { status: 404 });
        }

        const updated = await prisma.productCategory.update({
            where: { id: params.categoryId },
            data: {
                ...(payload.name ? { name: payload.name.trim() } : {}),
                ...(payload.description !== undefined
                    ? { description: payload.description?.trim() || null }
                    : {})
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update product category');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { categoryId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const category = await prisma.productCategory.findUnique({
            where: { id: params.categoryId },
            include: { _count: { select: { products: true } } }
        });

        if (!category) {
            return new NextResponse('Категория не найдена', { status: 404 });
        }

        if (category._count.products > 0) {
            return new NextResponse('Нельзя удалить категорию с товарами', { status: 409 });
        }

        await prisma.productCategory.delete({ where: { id: params.categoryId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete product category');
    }
}
