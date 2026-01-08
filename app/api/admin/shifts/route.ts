import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ShiftStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const createShiftSchema = z.object({
    hotelId: z.string().cuid(),
    managerId: z.string().cuid(),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable().optional(),
    openingCash: z.number().int().nonnegative(),
    closingCash: z.number().int().nonnegative().nullable().optional(),
    handoverCash: z.number().int().nonnegative().nullable().optional(),
    openingNote: z.string().max(500).nullable().optional(),
    closingNote: z.string().max(500).nullable().optional(),
    handoverNote: z.string().max(500).nullable().optional(),
    status: z.nativeEnum(ShiftStatus).default(ShiftStatus.CLOSED)
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = createShiftSchema.parse(body);

        // Проверяем, что отель существует
        const hotel = await prisma.hotel.findUnique({
            where: { id: payload.hotelId }
        });

        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        // Проверяем, что менеджер существует и имеет доступ к отелю
        const assignment = await prisma.hotelAssignment.findFirst({
            where: {
                hotelId: payload.hotelId,
                userId: payload.managerId,
                isActive: true
            }
        });

        if (!assignment) {
            return new NextResponse('Менеджер не назначен на этот отель', { status: 400 });
        }

        // Если смена открыта, проверяем что нет других открытых смен
        if (payload.status === ShiftStatus.OPEN) {
            const existingOpenShift = await prisma.shift.findFirst({
                where: {
                    hotelId: payload.hotelId,
                    status: ShiftStatus.OPEN
                }
            });

            if (existingOpenShift) {
                return new NextResponse('На этом отеле уже есть открытая смена', { status: 409 });
            }
        }

        // Получаем последний номер смены для этого отеля
        const lastShift = await prisma.shift.findFirst({
            where: { hotelId: payload.hotelId },
            orderBy: { number: 'desc' },
            select: { number: true }
        });

        const nextNumber = (lastShift?.number ?? 0) + 1;

        // Создаём смену
        const shift = await prisma.shift.create({
            data: {
                hotelId: payload.hotelId,
                managerId: payload.managerId,
                number: nextNumber,
                openedAt: new Date(payload.openedAt),
                closedAt: payload.closedAt ? new Date(payload.closedAt) : null,
                openingCash: payload.openingCash,
                closingCash: payload.closingCash ?? null,
                handoverCash: payload.handoverCash ?? null,
                openingNote: payload.openingNote ?? null,
                closingNote: payload.closingNote ?? null,
                handoverNote: payload.handoverNote ?? null,
                status: payload.status
            },
            include: {
                manager: true,
                hotel: true
            }
        });

        return NextResponse.json(shift, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create shift');
    }
}
