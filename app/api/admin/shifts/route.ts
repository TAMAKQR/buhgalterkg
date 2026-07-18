import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ShiftStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { parseInputValue } from '@/lib/timezone';
import { getCountryConfig } from '@/lib/country';

export const dynamic = 'force-dynamic';

const createShiftSchema = z.object({
    hotelId: z.string().cuid(),
    managerId: z.string().cuid(),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable().optional(),
    openingCash: z.number().int().nonnegative(),
    openingCashUsd: z.number().int().nonnegative().optional(),
    closingCash: z.number().int().nonnegative().nullable().optional(),
    closingCashUsd: z.number().int().nonnegative().nullable().optional(),
    handoverCash: z.number().int().nonnegative().nullable().optional(),
    handoverCashUsd: z.number().int().nonnegative().nullable().optional(),
    openingNote: z.string().max(500).nullable().optional(),
    closingNote: z.string().max(500).nullable().optional(),
    handoverNote: z.string().max(500).nullable().optional(),
    status: z.nativeEnum(ShiftStatus).default(ShiftStatus.CLOSED)
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);
        const countryConfig = getCountryConfig(country);
        const params = request.nextUrl.searchParams;
        const hotelIds = params.getAll('hotelId').flatMap((value) => value.split(',')).filter(Boolean);
        const managerIds = params.getAll('managerId').flatMap((value) => value.split(',')).filter(Boolean);
        const start = params.get('startDate');
        const end = params.get('endDate');
        const startAt = start ? parseInputValue(`${start}T00:00`, countryConfig.timezone) : null;
        const endAt = end ? parseInputValue(`${end}T23:59`, countryConfig.timezone) : null;

        const shifts = await prisma.shift.findMany({
            where: {
                hotel: { country },
                ...(hotelIds.length ? { hotelId: { in: hotelIds } } : {}),
                ...(managerIds.length ? { managerId: { in: managerIds } } : {}),
                ...(startAt || endAt ? { openedAt: { ...(startAt ? { gte: startAt } : {}), ...(endAt ? { lte: endAt } : {}) } } : {}),
            },
            orderBy: { openedAt: 'desc' },
            take: 250,
            select: {
                id: true,
                number: true,
                status: true,
                openedAt: true,
                closedAt: true,
                hotel: { select: { id: true, name: true } },
                manager: { select: { id: true, displayName: true } },
            },
        });

        return NextResponse.json({ shifts });
    } catch (error) {
        return handleApiError(error, 'Failed to load shifts');
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = createShiftSchema.parse(body);

        // Проверяем, что отель существует
        const hotel = await prisma.hotel.findUnique({
            where: { id: payload.hotelId }
        });

        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }
        if (hotel.country !== country) {
            return new NextResponse('Нет доступа к отелю другой страны', { status: 403 });
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

        const shift = await prisma.$transaction(async (tx) => {
            const lockedHotel = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "Hotel"
                WHERE "id" = ${payload.hotelId}
                FOR UPDATE
            `);
            if (lockedHotel.length !== 1) {
                throw new SessionError('Отель не найден', 404);
            }

            if (payload.status === ShiftStatus.OPEN) {
                const existingOpenShift = await tx.shift.findFirst({
                    where: { hotelId: payload.hotelId, status: ShiftStatus.OPEN },
                    select: { id: true }
                });
                if (existingOpenShift) {
                    throw new SessionError('На этом отеле уже есть открытая смена', 409);
                }
            }

            const lastShift = await tx.shift.findFirst({
                where: { hotelId: payload.hotelId },
                orderBy: { number: 'desc' },
                select: { number: true }
            });

            return tx.shift.create({
                data: {
                    hotelId: payload.hotelId,
                    managerId: payload.managerId,
                    number: (lastShift?.number ?? 0) + 1,
                    openedAt: new Date(payload.openedAt),
                    closedAt: payload.closedAt ? new Date(payload.closedAt) : null,
                    openingCash: payload.openingCash,
                    openingCashUsd: payload.openingCashUsd ?? 0,
                    closingCash: payload.closingCash ?? null,
                    closingCashUsd: payload.closingCashUsd ?? null,
                    handoverCash: payload.handoverCash ?? null,
                    handoverCashUsd: payload.handoverCashUsd ?? null,
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
        });

        return NextResponse.json(shift, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse('На этом отеле уже есть открытая смена', { status: 409 });
        }
        return handleApiError(error, 'Failed to create shift');
    }
}
