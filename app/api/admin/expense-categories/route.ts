import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const createExpenseCategorySchema = z.object({
    hotelId: z.string().cuid(),
    name: z.string().trim().min(1, 'Введите название категории').max(80, 'Название слишком длинное')
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const country = getCountryFromRequest(request);
        const payload = createExpenseCategorySchema.parse(body);

        const hotel = await prisma.hotel.findFirst({
            where: {
                id: payload.hotelId,
                country
            },
            select: { id: true }
        });

        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const category = await prisma.expenseCategory.create({
            data: {
                hotelId: hotel.id,
                name: payload.name
            }
        });

        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Некорректные данные', { status: 400 });
        }
        if ((error as { code?: string } | null)?.code === 'P2002') {
            return new NextResponse('Такая категория уже существует', { status: 409 });
        }
        return handleApiError(error, 'Failed to create expense category');
    }
}