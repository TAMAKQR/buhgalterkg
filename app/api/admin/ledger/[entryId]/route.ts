import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, sumStayPayments } from '@/lib/stays';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';

export const dynamic = 'force-dynamic';

const updateLedgerEntrySchema = z
    .object({
        shiftId: z.string().cuid().nullable().optional(),
        categoryId: z.string().cuid().nullable().optional(),
        entryType: z.nativeEnum(LedgerEntryType).optional(),
        method: z.nativeEnum(PaymentMethod).optional(),
        amount: z.number().int().positive().optional(),
        recordedAt: z.string().datetime().optional(),
        note: z.string().max(500).nullable().optional()
    })
    .refine((values) => Object.values(values).some((value) => value !== undefined), {
        message: 'Нет данных для обновления'
    });

const normalizeNote = (value?: string | null) => {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

type LockedLedgerEntry = {
    id: string;
    hotelId: string;
    shiftId: string | null;
    stayId: string | null;
    managerId: string | null;
    categoryId: string | null;
    entryType: LedgerEntryType;
    method: PaymentMethod;
    amount: number;
    recordedAt: Date;
    note: string | null;
};

const lockLedgerEntry = async (tx: Prisma.TransactionClient, entryId: string) => {
    const entries = await tx.$queryRaw<LockedLedgerEntry[]>(Prisma.sql`
        SELECT
            "id",
            "hotelId",
            "shiftId",
            "stay_id" AS "stayId",
            "managerId",
            "expense_category_id" AS "categoryId",
            "entryType",
            "method",
            "amount",
            "recordedAt",
            "note"
        FROM "CashEntry"
        WHERE "id" = ${entryId}
        FOR UPDATE
    `);

    return entries[0] ?? null;
};

const sameLedgerSnapshot = (left: LockedLedgerEntry, right: LockedLedgerEntry) => (
    left.id === right.id &&
    left.hotelId === right.hotelId &&
    left.shiftId === right.shiftId &&
    left.stayId === right.stayId &&
    left.managerId === right.managerId &&
    left.categoryId === right.categoryId &&
    left.entryType === right.entryType &&
    left.method === right.method &&
    left.amount === right.amount &&
    left.recordedAt.getTime() === right.recordedAt.getTime() &&
    left.note === right.note
);

const syncStayPaymentsFromLedger = async (
    tx: Prisma.TransactionClient,
    stayId: string,
    nextShiftId?: string | null
) => {
    const [stay, entries] = await Promise.all([
        tx.roomStay.findUnique({
            where: { id: stayId },
            select: { onlinePaid: true }
        }),
        tx.cashEntry.findMany({
            where: {
                stayId,
                entryType: LedgerEntryType.CASH_IN
            },
            select: {
                method: true,
                amount: true
            }
        })
    ]);

    if (!stay) {
        return;
    }

    const totals = entries.reduce(
        (acc, entry) => {
            if (entry.method === PaymentMethod.CASH) {
                acc.cashPaid += entry.amount;
            } else if (entry.method === PaymentMethod.CARD) {
                acc.cardPaid += entry.amount;
            }
            return acc;
        },
        { cashPaid: 0, cardPaid: 0 }
    );
    const onlinePaid = stay.onlinePaid ?? 0;

    await tx.roomStay.update({
        where: { id: stayId },
        data: {
            ...(nextShiftId !== undefined ? { shiftId: nextShiftId } : {}),
            cashPaid: totals.cashPaid,
            cardPaid: totals.cardPaid,
            amountPaid: sumStayPayments({ ...totals, onlinePaid }),
            paymentMethod: detectStayPaymentMethod({ ...totals, onlinePaid })
        }
    });
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
    try {
        const { entryId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateLedgerEntrySchema.parse(body);
        const entry = await prisma.cashEntry.findFirst({
            where: {
                id: entryId,
                hotel: { country }
            },
            include: {
                stay: { select: { id: true, roomId: true } }
            }
        });

        if (!entry) {
            return new NextResponse('Операция не найдена', { status: 404 });
        }

        if (payload.categoryId) {
            const category = await prisma.expenseCategory.findFirst({
                where: {
                    id: payload.categoryId,
                    hotelId: entry.hotelId
                },
                select: { id: true }
            });

            if (!category) {
                return new NextResponse('Категория расходов не найдена', { status: 400 });
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            if (entry.stay?.roomId) {
                await lockRoomsForStayMutation(tx, [entry.stay.roomId]);
            }

            const hasShiftUpdate = Object.prototype.hasOwnProperty.call(payload, 'shiftId');
            const nextShiftId = hasShiftUpdate ? payload.shiftId ?? null : entry.shiftId;
            const lockedShifts = await lockShiftsForLedgerMutation(
                tx,
                [entry.shiftId, nextShiftId],
                {
                    hotelId: entry.hotelId,
                    actorId: session.id,
                    actorRole: session.role,
                    // This is an explicit admin history correction. Closed shifts
                    // are allowed only while every affected shift row is locked.
                    allowClosedForAdmin: true,
                },
            );

            const lockedEntry = await lockLedgerEntry(tx, entry.id);
            if (!lockedEntry || !sameLedgerSnapshot(entry, lockedEntry)) {
                throw new SessionError('Операция уже изменилась. Обновите данные', 409);
            }

            const nextEntryType = payload.entryType ?? lockedEntry.entryType;
            if (payload.categoryId && nextEntryType !== LedgerEntryType.CASH_OUT) {
                throw new SessionError('Категорию можно указать только для расходов', 400);
            }

            const data: Prisma.CashEntryUncheckedUpdateInput = {};
            if (hasShiftUpdate) {
                data.shiftId = nextShiftId;
                data.managerId = nextShiftId ? lockedShifts.get(nextShiftId)!.managerId : null;
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'categoryId')) {
                data.categoryId = payload.categoryId ?? null;
            } else if (payload.entryType && payload.entryType !== LedgerEntryType.CASH_OUT) {
                data.categoryId = null;
            }
            if (payload.entryType) data.entryType = payload.entryType;
            if (payload.method) data.method = payload.method;
            if (payload.amount !== undefined) data.amount = payload.amount;
            if (payload.recordedAt) data.recordedAt = new Date(payload.recordedAt);

            const note = normalizeNote(payload.note);
            if (note !== undefined) data.note = note;

            const result = await tx.cashEntry.update({
                where: { id: entry.id },
                data,
                include: {
                    expenseCategory: true,
                    manager: true,
                    shift: { select: { number: true } }
                }
            });

            if (entry.stayId) {
                await syncStayPaymentsFromLedger(
                    tx,
                    entry.stayId,
                    hasShiftUpdate ? nextShiftId : undefined
                );
            }

            return result;
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update ledger entry');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
    try {
        const { entryId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const entry = await prisma.cashEntry.findFirst({
            where: {
                id: entryId,
                hotel: { country }
            },
            include: {
                stay: { select: { roomId: true } }
            }
        });

        if (!entry) {
            return new NextResponse('Операция не найдена', { status: 404 });
        }

        await prisma.$transaction(async (tx) => {
            if (entry.stay?.roomId) {
                await lockRoomsForStayMutation(tx, [entry.stay.roomId]);
            }

            await lockShiftsForLedgerMutation(tx, [entry.shiftId], {
                hotelId: entry.hotelId,
                actorId: session.id,
                actorRole: session.role,
                allowClosedForAdmin: true,
            });

            const lockedEntry = await lockLedgerEntry(tx, entry.id);
            if (!lockedEntry || !sameLedgerSnapshot(entry, lockedEntry)) {
                throw new SessionError('Операция уже изменилась. Обновите данные', 409);
            }

            await tx.cashEntry.delete({ where: { id: entry.id } });
            if (entry.stayId) {
                await syncStayPaymentsFromLedger(tx, entry.stayId);
            }
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete ledger entry');
    }
}
