import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
    name: z.string().trim().min(1).max(120),
    quantityMilli: z.number().int().min(0).max(1_000_000),
    unitPrice: z.number().int().min(0).max(2_000_000_000),
    mealPlanCode: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).nullable(),
});

const payloadSchema = z.object({
    categoryId: z.string().cuid().optional(),
    name: z.string().trim().min(1).max(60),
    roomIds: z.array(z.string().cuid()).min(1).max(200).refine(
        (roomIds) => new Set(roomIds).size === roomIds.length,
        'Номера не должны повторяться',
    ),
    items: z.array(itemSchema).max(100),
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
            select: {
                id: true,
                rooms: {
                    where: { id: { in: payload.roomIds } },
                    select: { id: true },
                },
            },
        });
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });
        if (hotel.rooms.length !== payload.roomIds.length) {
            return new NextResponse('Один из номеров не найден или принадлежит другому объекту', { status: 400 });
        }

        const category = await prisma.$transaction(async (tx) => {
            const existingCategory = payload.categoryId
                ? await tx.roomCostCategory.findFirst({
                    where: { id: payload.categoryId, hotelId: hotel.id },
                    select: { id: true },
                })
                : null;
            if (payload.categoryId && !existingCategory) {
                throw new Error('Категория калькуляции не найдена');
            }
            const savedCategory = existingCategory
                ? await tx.roomCostCategory.update({
                    where: { id: existingCategory.id },
                    data: { name: payload.name },
                })
                : await tx.roomCostCategory.create({
                    data: { hotelId: hotel.id, name: payload.name },
                });

            await tx.room.updateMany({
                where: { hotelId: hotel.id, costCategoryId: savedCategory.id },
                data: { costCategoryId: null },
            });
            await tx.room.updateMany({
                where: { hotelId: hotel.id, id: { in: payload.roomIds } },
                data: { costCategoryId: savedCategory.id },
            });
            await tx.roomCostItem.deleteMany({ where: { categoryId: savedCategory.id } });
            if (payload.items.length) {
                await tx.roomCostItem.createMany({
                    data: payload.items.map((item, sortOrder) => ({
                        categoryId: savedCategory.id,
                        name: item.name,
                        quantityMilli: item.quantityMilli,
                        unitPrice: item.unitPrice,
                        mealPlanCode: item.mealPlanCode,
                        sortOrder,
                    })),
                });
            }
            return savedCategory;
        });

        return NextResponse.json({
            success: true,
            categoryId: category.id,
            updatedRooms: payload.roomIds.length,
            itemCount: payload.items.length,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Проверьте калькуляцию', { status: 400 });
        }
        return handleApiError(error, 'Не удалось сохранить категорию калькуляции');
    }
}
