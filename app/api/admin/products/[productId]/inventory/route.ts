import { NextRequest, NextResponse } from 'next/server';
import { ProductInventoryAdjustmentType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

const inventorySchema = z.object({
    quantity: z.number().int().refine((value) => value !== 0, { message: 'Количество не может быть 0' }),
    adjustmentType: z.nativeEnum(ProductInventoryAdjustmentType),
    costTotal: z.number().nonnegative().optional(),
    note: z.string().max(500).optional().nullable(),
    shiftId: z.string().cuid().optional().nullable()
});

const toMinor = (value?: number) => {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.round(value * 100);
};

export async function POST(request: NextRequest, { params }: { params: { productId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = inventorySchema.parse(rest);
        const product = await prisma.product.findUnique({ where: { id: params.productId } });
        if (!product) {
            return new NextResponse('Product not found', { status: 404 });
        }

        const quantityDelta = (() => {
            if (payload.adjustmentType === ProductInventoryAdjustmentType.RESTOCK) {
                if (payload.quantity <= 0) {
                    throw new Error('RESTOCK_POSITIVE');
                }
                return payload.quantity;
            }
            if (payload.adjustmentType === ProductInventoryAdjustmentType.WRITE_OFF) {
                if (payload.quantity <= 0) {
                    throw new Error('WRITE_OFF_POSITIVE');
                }
                return -payload.quantity;
            }
            return payload.quantity;
        })();

        const result = await prisma.$transaction(async (tx) => {
            const nextStock = product.stockOnHand + quantityDelta;
            if (nextStock < 0) {
                throw new Error('NEGATIVE_STOCK');
            }

            await tx.product.update({
                where: { id: product.id },
                data: { stockOnHand: nextStock }
            });

            return tx.productInventoryEntry.create({
                data: {
                    productId: product.id,
                    shiftId: payload.shiftId ?? null,
                    userId: session.id,
                    adjustmentType: payload.adjustmentType,
                    quantity: quantityDelta,
                    costTotal: toMinor(payload.costTotal),
                    note: payload.note?.trim() || null
                }
            });
        });

        return NextResponse.json({ success: true, entry: result });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Error) {
            if (error.message === 'NEGATIVE_STOCK') {
                return new NextResponse('Недостаточно товара на складе', { status: 400 });
            }
            if (error.message === 'RESTOCK_POSITIVE') {
                return new NextResponse('Для поставки необходимо положительное количество', { status: 400 });
            }
            if (error.message === 'WRITE_OFF_POSITIVE') {
                return new NextResponse('Для списания укажите положительное количество', { status: 400 });
            }
        }
        return handleApiError(error, 'Failed to record inventory entry');
    }
}
