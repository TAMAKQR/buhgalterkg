import { createHash } from 'node:crypto';

import { LedgerEntryType, PaymentMethod, Prisma, type CashEntry } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { allocateMinorEvenly } from '@/lib/room-economics';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const MAX_SELECTED_ROOMS = 200;

const payloadSchema = z.object({
    roomIds: z.array(z.string().cuid())
        .min(1, 'Выберите хотя бы один номер')
        .max(MAX_SELECTED_ROOMS, `За один раз можно выбрать не более ${MAX_SELECTED_ROOMS} номеров`)
        .refine((roomIds) => new Set(roomIds).size === roomIds.length, 'Номера не должны повторяться'),
    allocationMode: z.enum(['SPLIT_TOTAL', 'PER_ROOM']),
    categoryId: z.string().cuid().optional(),
    amount: z.number().int().positive().max(2_000_000_000),
    method: z.nativeEnum(PaymentMethod),
    recordedAt: z.string().datetime(),
    note: z.string().max(1_000).optional(),
});

const idempotencyKeySchema = z.string()
    .min(16)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

class RoomExpenseError extends Error {
    constructor(message: string, readonly status: 400 | 409) {
        super(message);
        this.name = 'RoomExpenseError';
    }
}

type ExpectedEntry = {
    clientOperationId: string;
    roomId: string;
    amount: number;
};

type CommonEntryFields = {
    hotelId: string;
    categoryId: string | null;
    method: PaymentMethod;
    note: string | null;
    recordedAt: Date;
    currency: string;
};

const normalizeNote = (value?: string | null) => value?.trim() || null;

const childOperationId = (baseKey: string, roomId: string) => (
    `room-expense:${createHash('sha256').update(`${baseKey}:${roomId}`).digest('hex')}`
);

const assertBatchMatches = (
    entries: CashEntry[],
    expectedEntries: ExpectedEntry[],
    common: CommonEntryFields,
) => {
    if (entries.length !== expectedEntries.length) {
        throw new RoomExpenseError('Ключ операции уже использован для других данных', 409);
    }

    const entriesByOperation = new Map(entries.map((entry) => [entry.clientOperationId, entry]));
    for (const expected of expectedEntries) {
        const entry = entriesByOperation.get(expected.clientOperationId);
        const matches = Boolean(entry)
            && entry!.hotelId === common.hotelId
            && entry!.shiftId === null
            && entry!.managerId === null
            && entry!.categoryId === common.categoryId
            && entry!.roomId === expected.roomId
            && entry!.entryType === LedgerEntryType.CASH_OUT
            && entry!.method === common.method
            && entry!.amount === expected.amount
            && (entry!.originalAmount ?? entry!.amount) === expected.amount
            && entry!.originalCurrency === common.currency
            && entry!.exchangeRate === null
            && normalizeNote(entry!.note) === common.note
            && entry!.recordedAt.getTime() === common.recordedAt.getTime();

        if (!matches) {
            throw new RoomExpenseError('Ключ операции уже использован для других данных', 409);
        }
    }
};

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ hotelId: string }> },
) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = payloadSchema.parse(await request.json());
        const idempotencyKey = idempotencyKeySchema.parse(request.headers.get('idempotency-key')?.trim());
        const recordedAt = new Date(payload.recordedAt);
        if (recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
            return new NextResponse('Фактический расход нельзя записать будущей датой', { status: 400 });
        }

        const country = getCountryFromRequest(request);
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true, currency: true },
        });
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });

        let categoryId: string | null = null;
        if (payload.categoryId) {
            const category = await prisma.expenseCategory.findFirst({
                where: { id: payload.categoryId, hotelId: hotel.id },
                select: { id: true },
            });
            if (!category) return new NextResponse('Категория расходов не найдена', { status: 400 });
            categoryId = category.id;
        }

        const roomIds = [...payload.roomIds].sort();
        if (payload.allocationMode === 'SPLIT_TOTAL' && payload.amount < roomIds.length) {
            return new NextResponse('Общая сумма слишком мала для распределения между выбранными номерами', { status: 400 });
        }

        const amountsByRoom = payload.allocationMode === 'SPLIT_TOTAL'
            ? allocateMinorEvenly(payload.amount, roomIds)
            : Object.fromEntries(roomIds.map((roomId) => [roomId, payload.amount]));
        const batchTotalAmount = Object.values(amountsByRoom).reduce((sum, amount) => sum + amount, 0);
        if (!Number.isSafeInteger(batchTotalAmount)) {
            return new NextResponse('Итоговая сумма слишком большая', { status: 400 });
        }

        const expectedEntries = roomIds.map((roomId, index) => ({
            roomId,
            amount: amountsByRoom[roomId],
            clientOperationId: index === 0 ? idempotencyKey : childOperationId(idempotencyKey, roomId),
        }));
        const operationIds = expectedEntries.map((entry) => entry.clientOperationId);
        const common: CommonEntryFields = {
            hotelId: hotel.id,
            categoryId,
            method: payload.method,
            note: normalizeNote(payload.note),
            recordedAt,
            currency: hotel.currency,
        };

        const runTransaction = async () => prisma.$transaction(async (tx) => {
            const lockedRooms = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "Room"
                WHERE "hotelId" = ${hotel.id}
                  AND "id" IN (${Prisma.join(roomIds)})
                  AND "isActive" = true
                ORDER BY "id"
                FOR UPDATE
            `);
            if (lockedRooms.length !== roomIds.length) {
                throw new RoomExpenseError('Один из номеров не найден, выключен или принадлежит другому объекту', 400);
            }

            const existingEntries = await tx.cashEntry.findMany({
                where: { clientOperationId: { in: operationIds } },
            });
            if (existingEntries.length > 0) {
                assertBatchMatches(existingEntries, expectedEntries, common);
                return { entries: existingEntries, replay: true as const };
            }

            await tx.cashEntry.createMany({
                data: expectedEntries.map((entry) => ({
                    hotelId: hotel.id,
                    roomId: entry.roomId,
                    categoryId,
                    shiftId: null,
                    managerId: null,
                    clientOperationId: entry.clientOperationId,
                    recordedAt,
                    amount: entry.amount,
                    originalAmount: entry.amount,
                    originalCurrency: hotel.currency,
                    exchangeRate: null,
                    method: payload.method,
                    entryType: LedgerEntryType.CASH_OUT,
                    note: common.note,
                    meta: {
                        source: 'ROOM_ECONOMICS_BULK',
                        allocationMode: payload.allocationMode,
                        roomCount: roomIds.length,
                        batchTotalAmount,
                    },
                })),
            });

            const createdEntries = await tx.cashEntry.findMany({
                where: { clientOperationId: { in: operationIds } },
                orderBy: { roomId: 'asc' },
            });
            assertBatchMatches(createdEntries, expectedEntries, common);
            return { entries: createdEntries, replay: false as const };
        });

        try {
            const result = await runTransaction();
            return NextResponse.json({
                entries: result.entries,
                roomCount: roomIds.length,
                totalAmount: batchTotalAmount,
            }, result.replay
                ? { headers: { 'X-Idempotent-Replay': 'true' } }
                : { status: 201 });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const replayEntries = await prisma.cashEntry.findMany({
                    where: { clientOperationId: { in: operationIds } },
                });
                assertBatchMatches(replayEntries, expectedEntries, common);
                return NextResponse.json({
                    entries: replayEntries,
                    roomCount: roomIds.length,
                    totalAmount: batchTotalAmount,
                }, { headers: { 'X-Idempotent-Replay': 'true' } });
            }
            throw error;
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Проверьте данные расхода', { status: 400 });
        }
        if (error instanceof RoomExpenseError) {
            return new NextResponse(error.message, { status: error.status });
        }
        return handleApiError(error, 'Не удалось распределить расход по номерам');
    }
}
