import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

const updateProductSchema = z
    .object({
        categoryId: z.string().cuid().optional().nullable(),
        name: z.string().min(2).max(160).optional(),
        sku: z.string().max(64).optional().nullable(),
        description: z.string().max(500).optional().nullable(),
        costPrice: z.number().nonnegative().optional(),
        sellPrice: z.number().nonnegative().optional(),
        unit: z.string().max(32).optional().nullable(),
        reorderThreshold: z.number().int().nonnegative().optional().nullable(),
        isActive: z.boolean().optional()
    })
    .refine((values) => Object.values(values).some((value) => value !== undefined), {
        message: 'Нет данных для обновления'
    });

const toMinor = (value?: number) => {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.round(value * 100);
};

export async function PATCH(request: NextRequest, { params }: { params: { productId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = updateProductSchema.parse(rest);
        const product = await prisma.product.findUnique({ where: { id: params.productId } });
        if (!product) {
            return new NextResponse('Product not found', { status: 404 });
        }

        if (payload.categoryId) {
            const category = await prisma.productCategory.findFirst({
                where: { id: payload.categoryId, hotelId: product.hotelId },
                select: { id: true }
            });
            if (!category) {
                return new NextResponse('Категория не найдена в этом отеле', { status: 404 });
            }
        }

        const updated = await prisma.product.update({
            where: { id: params.productId },
            data: {
                ...(payload.categoryId !== undefined ? { categoryId: payload.categoryId ?? null } : {}),
                ...(payload.name ? { name: payload.name.trim() } : {}),
                ...(payload.sku !== undefined ? { sku: payload.sku?.trim() || null } : {}),
                ...(payload.description !== undefined ? { description: payload.description?.trim() || null } : {}),
                ...(payload.unit !== undefined ? { unit: payload.unit?.trim() || null } : {}),
                ...(payload.costPrice !== undefined ? { costPrice: toMinor(payload.costPrice) ?? 0 } : {}),
                ...(payload.sellPrice !== undefined ? { sellPrice: toMinor(payload.sellPrice) ?? 0 } : {}),
                ...(payload.reorderThreshold !== undefined ? { reorderThreshold: payload.reorderThreshold ?? null } : {}),
                ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {})
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update product');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { productId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const product = await prisma.product.findUnique({ where: { id: params.productId } });
        if (!product) {
            return new NextResponse('Product not found', { status: 404 });
        }

        await prisma.product.delete({ where: { id: params.productId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete product');
    }
}
