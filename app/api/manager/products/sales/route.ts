import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
    LedgerEntryType,
    PaymentMethod,
    ProductSaleType,
    ShiftStatus,
    StayStatus
} from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const saleSchema = z.object({
    shiftId: z.string().cuid(),
    productId: z.string().cuid(),
    quantity: z.number().int().positive(),
    paymentMethod: z.nativeEnum(PaymentMethod),
    saleType: z.nativeEnum(ProductSaleType),
    roomStayId: z.string().cuid().optional().nullable(),
    note: z.string().max(200).optional().nullable()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = saleSchema.parse(body);

        const shift = await prisma.shift.findUnique({ where: { id: payload.shiftId } });
        if (!shift || shift.status !== ShiftStatus.OPEN) {
            return new NextResponse('Активная смена не найдена', { status: 400 });
        }

        assertHotelAccess(session, shift.hotelId);

        if (shift.managerId !== session.id) {
            return new NextResponse('Смену ведёт другой менеджер', { status: 403 });
        }

        const product = await prisma.product.findUnique({
            where: { id: payload.productId },
            select: {
                id: true,
                hotelId: true,
                name: true,
                sellPrice: true,
                stockOnHand: true,
                isActive: true
            }
        });

        if (!product || product.hotelId !== shift.hotelId) {
            return new NextResponse('Товар не найден в этой точке', { status: 404 });
        }

        if (!product.isActive) {
            return new NextResponse('Товар отключён', { status: 400 });
        }

        if (product.stockOnHand < payload.quantity) {
            return new NextResponse('Недостаточно остатка на складе', { status: 400 });
        }

        let roomStayId: string | null = null;
        if (payload.saleType === ProductSaleType.ROOM && !payload.roomStayId) {
            return new NextResponse('Укажите текущего гостя', { status: 400 });
        }

        if (payload.roomStayId) {
            const stay = await prisma.roomStay.findUnique({ where: { id: payload.roomStayId } });
            if (!stay || stay.hotelId !== shift.hotelId) {
                return new NextResponse('Гость не найден в этой точке', { status: 404 });
            }
            if (stay.status !== StayStatus.CHECKED_IN) {
                return new NextResponse('Гость уже выбыл', { status: 400 });
            }
            roomStayId = stay.id;
        }

        const totalAmount = product.sellPrice * payload.quantity;

        const saleRecord = await prisma.$transaction(async (tx) => {
            const createdSale = await tx.productSale.create({
                data: {
                    hotelId: shift.hotelId,
                    shiftId: shift.id,
                    productId: product.id,
                    roomStayId,
                    saleType: payload.saleType,
                    quantity: payload.quantity,
                    unitPrice: product.sellPrice,
                    totalAmount,
                    paymentMethod: payload.paymentMethod,
                    note: payload.note?.trim() || null,
                    soldById: session.id
                }
            });

            const updated = await tx.product.updateMany({
                where: { id: product.id, stockOnHand: { gte: payload.quantity } },
                data: { stockOnHand: { decrement: payload.quantity } }
            });

            if (updated.count === 0) {
                throw new Error('INSUFFICIENT_STOCK');
            }

            await tx.cashEntry.create({
                data: {
                    hotelId: shift.hotelId,
                    shiftId: shift.id,
                    managerId: session.id,
                    entryType: LedgerEntryType.CASH_IN,
                    method: payload.paymentMethod,
                    amount: totalAmount,
                    note: `Продажа ${product.name}`
                }
            });

            return createdSale;
        });

        return NextResponse.json(saleRecord, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') {
            return new NextResponse('Остаток изменился. Обновите список товаров.', { status: 409 });
        }
        return handleApiError(error, 'Failed to create product sale');
    }
}
