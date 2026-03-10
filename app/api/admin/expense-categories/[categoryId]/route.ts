import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const updateExpenseCategorySchema = z.object({
    name: z.string().trim().min(1, 'Введите название категории').max(80, 'Название слишком длинное')
});

export async function PATCH(request: NextRequest, { params }: { params: { categoryId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const country = getCountryFromRequest(request);
        const payload = updateExpenseCategorySchema.parse(body);

        const existing = await prisma.expenseCategory.findFirst({
            where: {
                id: params.categoryId,
                hotel: { country }
            },
            select: { id: true }
        });

        if (!existing) {
            return new NextResponse('Категория не найдена', { status: 404 });
        }

        const category = await prisma.expenseCategory.update({
            where: { id: existing.id },
            data: { name: payload.name }
        });

        return NextResponse.json(category);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Некорректные данные', { status: 400 });
        }
        if ((error as { code?: string } | null)?.code === 'P2002') {
            return new NextResponse('Такая категория уже существует', { status: 409 });
        }
        return handleApiError(error, 'Failed to update expense category');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { categoryId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const country = getCountryFromRequest(request);
        const existing = await prisma.expenseCategory.findFirst({
            where: {
                id: params.categoryId,
                hotel: { country }
            },
            select: { id: true }
        });

        if (!existing) {
            return new NextResponse('Категория не найдена', { status: 404 });
        }

        await prisma.expenseCategory.delete({ where: { id: existing.id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete expense category');
    }
}