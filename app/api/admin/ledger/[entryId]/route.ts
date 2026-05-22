import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, sumStayPayments } from '@/lib/stays';

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

export async function PATCH(request: NextRequest, { params }: { params: { entryId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateLedgerEntrySchema.parse(body);
        const entry = await prisma.cashEntry.findFirst({
            where: {
                id: params.entryId,
                hotel: { country }
            },
            include: {
                shift: { select: { id: true, managerId: true } },
                stay: { select: { id: true } }
            }
        });

        if (!entry) {
            return new NextResponse('Операция не найдена', { status: 404 });
        }

        const nextEntryType = payload.entryType ?? entry.entryType;
        if (payload.categoryId && nextEntryType !== LedgerEntryType.CASH_OUT) {
            return new NextResponse('Категорию можно указать только для расходов', { status: 400 });
        }

        let nextShiftManagerId: string | null | undefined;
        const data: Prisma.CashEntryUpdateInput = {};

        if (Object.prototype.hasOwnProperty.call(payload, 'shiftId')) {
            if (payload.shiftId) {
                const shift = await prisma.shift.findFirst({
                    where: {
                        id: payload.shiftId,
                        hotelId: entry.hotelId,
                        hotel: { country }
                    },
                    select: {
                        id: true,
                        managerId: true
                    }
                });

                if (!shift) {
                    return new NextResponse('Смена не найдена для этого отеля', { status: 400 });
                }

                data.shift = { connect: { id: shift.id } };
                nextShiftManagerId = shift.managerId;
            } else {
                data.shift = { disconnect: true };
                nextShiftManagerId = null;
            }
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'categoryId')) {
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

                data.expenseCategory = { connect: { id: category.id } };
            } else {
                data.expenseCategory = { disconnect: true };
            }
        } else if (payload.entryType && payload.entryType !== LedgerEntryType.CASH_OUT) {
            data.expenseCategory = { disconnect: true };
        }

        if (payload.entryType) {
            data.entryType = payload.entryType;
        }
        if (payload.method) {
            data.method = payload.method;
        }
        if (payload.amount !== undefined) {
            data.amount = payload.amount;
        }
        if (payload.recordedAt) {
            data.recordedAt = new Date(payload.recordedAt);
        }

        const note = normalizeNote(payload.note);
        if (note !== undefined) {
            data.note = note;
        }

        if (nextShiftManagerId !== undefined) {
            data.manager = nextShiftManagerId
                ? { connect: { id: nextShiftManagerId } }
                : { disconnect: true };
        }

        const updated = await prisma.$transaction(async (tx) => {
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
                    Object.prototype.hasOwnProperty.call(payload, 'shiftId') ? payload.shiftId ?? null : undefined
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

export async function DELETE(request: NextRequest, { params }: { params: { entryId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const entry = await prisma.cashEntry.findFirst({
            where: {
                id: params.entryId,
                hotel: { country }
            },
            select: { id: true, stayId: true }
        });

        if (!entry) {
            return new NextResponse('Операция не найдена', { status: 404 });
        }

        await prisma.$transaction(async (tx) => {
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
