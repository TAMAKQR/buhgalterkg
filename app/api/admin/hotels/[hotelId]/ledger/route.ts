import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { isCollectionLedgerEntry, isStayIncomeNote, STAY_INCOME_PREFIXES } from '@/lib/ledger';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_UNASSIGNED_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const COLLECTION_SEARCH_TERMS = ['инкассац', 'инкасац', 'inkass', 'incass', 'collection'] as const;
const querySchema = z
    .object({
        shiftId: z.string().cuid().optional(),
        unassigned: z.enum(['true']).optional(),
        cursor: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        summary: z.enum(['false']).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional()
    })
    .superRefine((value, context) => {
        if (Boolean(value.shiftId) === Boolean(value.unassigned)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Укажите shiftId или unassigned=true',
                path: ['shiftId']
            });
        }

        if (value.from && value.to && new Date(value.from).getTime() > new Date(value.to).getTime()) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Начало периода не может быть позже конца',
                path: ['from']
            });
        }

        if (value.unassigned) {
            if (!value.from || !value.to) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Для операций без смены укажите ограниченный период',
                    path: ['from']
                });
            } else if (new Date(value.to).getTime() - new Date(value.from).getTime() > MAX_UNASSIGNED_RANGE_MS) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Период не может превышать 366 дней',
                    path: ['to']
                });
            }
        }
    });

const collectionCandidateFilters: Prisma.CashEntryWhereInput[] = COLLECTION_SEARCH_TERMS.flatMap((term) => [
    { note: { contains: term, mode: 'insensitive' } },
    { expenseCategory: { name: { contains: term, mode: 'insensitive' } } }
]);

const stayIncomeFilters: Prisma.CashEntryWhereInput[] = STAY_INCOME_PREFIXES.map((prefix) => ({
    note: { contains: prefix, mode: 'insensitive' }
}));

const emptyPaymentBreakdown = () => ({ total: 0, cash: 0, card: 0 });

const ledgerEntrySelect = {
    id: true,
    entryType: true,
    method: true,
    amount: true,
    originalAmount: true,
    originalCurrency: true,
    exchangeRate: true,
    note: true,
    recordedAt: true,
    expenseCategory: { select: { id: true, name: true } },
    manager: { select: { displayName: true } },
    shift: { select: { id: true, number: true } }
} satisfies Prisma.CashEntrySelect;

type LedgerEntryRow = Prisma.CashEntryGetPayload<{ select: typeof ledgerEntrySelect }>;

const serializeLedgerEntry = (entry: LedgerEntryRow) => ({
    id: entry.id,
    entryType: entry.entryType,
    method: entry.method,
    amount: entry.amount,
    originalAmount: entry.originalAmount,
    originalCurrency: entry.originalCurrency,
    exchangeRate: entry.exchangeRate,
    note: entry.note,
    category: entry.expenseCategory,
    recordedAt: entry.recordedAt,
    managerName: entry.manager?.displayName ?? null,
    shiftId: entry.shift?.id ?? null,
    shiftNumber: entry.shift?.number ?? null
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);
        const parsedQuery = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));

        if (!parsedQuery.success) {
            return new NextResponse(parsedQuery.error.issues[0]?.message ?? 'Некорректные параметры', { status: 400 });
        }

        const query = parsedQuery.data;
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true, currency: true }
        });

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const shift = query.shiftId
            ? await prisma.shift.findFirst({
                where: { id: query.shiftId, hotelId: hotel.id },
                select: { id: true, number: true, status: true }
            })
            : null;

        if (query.shiftId && !shift) {
            return new NextResponse('Shift not found', { status: 404 });
        }

        const ledgerWhere: Prisma.CashEntryWhereInput = {
            hotelId: hotel.id,
            shiftId: shift ? shift.id : null,
            ...(query.from || query.to
                ? {
                    recordedAt: {
                        ...(query.from ? { gte: new Date(query.from) } : {}),
                        ...(query.to ? { lte: new Date(query.to) } : {})
                    }
                }
                : {})
        };

        if (query.cursor) {
            const cursorExists = await prisma.cashEntry.findFirst({
                where: { ...ledgerWhere, id: query.cursor },
                select: { id: true }
            });
            if (!cursorExists) {
                return new NextResponse('Некорректный cursor', { status: 400 });
            }
        }

        if (query.summary === 'false') {
            const pageRows = await prisma.cashEntry.findMany({
                where: ledgerWhere,
                orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
                ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
                take: query.limit + 1,
                select: ledgerEntrySelect
            });
            const hasMore = pageRows.length > query.limit;
            const visibleRows = hasMore ? pageRows.slice(0, query.limit) : pageRows;

            return NextResponse.json({
                shift,
                entries: visibleRows.map(serializeLedgerEntry),
                summary: null,
                pagination: {
                    total: null,
                    limit: query.limit,
                    hasMore,
                    nextCursor: hasMore ? visibleRows[visibleRows.length - 1]?.id ?? null : null
                }
            });
        }

        const [pageRows, total, totalGroups, stayIncomeCandidates, cashWithOriginal, cashWithoutOriginal, collectionCandidates] = await prisma.$transaction([
            prisma.cashEntry.findMany({
                where: ledgerWhere,
                orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
                ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
                take: query.limit + 1,
                select: ledgerEntrySelect
            }),
            prisma.cashEntry.count({ where: ledgerWhere }),
            prisma.cashEntry.groupBy({
                by: ['entryType', 'method'],
                orderBy: [{ entryType: 'asc' }, { method: 'asc' }],
                where: ledgerWhere,
                _sum: { amount: true }
            }),
            prisma.cashEntry.findMany({
                where: {
                    ...ledgerWhere,
                    entryType: LedgerEntryType.CASH_IN,
                    OR: stayIncomeFilters
                },
                select: {
                    method: true,
                    amount: true,
                    note: true
                }
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType', 'originalCurrency'],
                orderBy: [{ entryType: 'asc' }, { originalCurrency: 'asc' }],
                where: {
                    ...ledgerWhere,
                    method: PaymentMethod.CASH,
                    originalAmount: { not: null }
                },
                _sum: { originalAmount: true }
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType', 'originalCurrency'],
                orderBy: [{ entryType: 'asc' }, { originalCurrency: 'asc' }],
                where: {
                    ...ledgerWhere,
                    method: PaymentMethod.CASH,
                    originalAmount: null
                },
                _sum: { amount: true }
            }),
            prisma.cashEntry.findMany({
                where: {
                    ...ledgerWhere,
                    entryType: LedgerEntryType.CASH_OUT,
                    OR: collectionCandidateFilters
                },
                select: {
                    amount: true,
                    originalAmount: true,
                    originalCurrency: true,
                    entryType: true,
                    note: true,
                    expenseCategory: { select: { name: true } }
                }
            })
        ]);

        const totals = {
            cashIn: 0,
            cashOut: 0,
            payouts: 0,
            adjustments: 0
        };
        const incomeBreakdown = {
            stays: emptyPaymentBreakdown(),
            cashbox: emptyPaymentBreakdown()
        };

        for (const group of totalGroups) {
            const amount = group._sum?.amount ?? 0;
            switch (group.entryType) {
                case LedgerEntryType.CASH_IN:
                    totals.cashIn += amount;
                    incomeBreakdown.cashbox.total += amount;
                    if (group.method === PaymentMethod.CASH) incomeBreakdown.cashbox.cash += amount;
                    if (group.method === PaymentMethod.CARD) incomeBreakdown.cashbox.card += amount;
                    break;
                case LedgerEntryType.CASH_OUT:
                    totals.cashOut += amount;
                    break;
                case LedgerEntryType.MANAGER_PAYOUT:
                    totals.payouts += amount;
                    break;
                case LedgerEntryType.ADJUSTMENT:
                    totals.adjustments += amount;
                    break;
            }
        }

        for (const entry of stayIncomeCandidates) {
            if (!isStayIncomeNote(entry.note)) continue;
            const amount = entry.amount;
            incomeBreakdown.stays.total += amount;
            incomeBreakdown.cashbox.total -= amount;
            if (entry.method === PaymentMethod.CASH) {
                incomeBreakdown.stays.cash += amount;
                incomeBreakdown.cashbox.cash -= amount;
            }
            if (entry.method === PaymentMethod.CARD) {
                incomeBreakdown.stays.card += amount;
                incomeBreakdown.cashbox.card -= amount;
            }
        }

        const hotelCurrency = hotel.currency.toUpperCase();
        let cashMovement = 0;
        const applyCashMovement = (entryType: LedgerEntryType, currency: string, amount: number) => {
            if (currency.toUpperCase() !== hotelCurrency) return;
            if (entryType === LedgerEntryType.CASH_IN || entryType === LedgerEntryType.ADJUSTMENT) {
                cashMovement += amount;
            } else {
                cashMovement -= amount;
            }
        };

        for (const group of cashWithOriginal) {
            applyCashMovement(group.entryType, group.originalCurrency, group._sum?.originalAmount ?? 0);
        }
        for (const group of cashWithoutOriginal) {
            applyCashMovement(group.entryType, group.originalCurrency, group._sum?.amount ?? 0);
        }

        let collections = 0;
        const collectionOriginals = new Map<string, number>();
        for (const entry of collectionCandidates) {
            if (!isCollectionLedgerEntry(entry)) continue;
            collections += entry.amount;
            if (
                entry.originalCurrency.toUpperCase() !== hotelCurrency &&
                typeof entry.originalAmount === 'number'
            ) {
                collectionOriginals.set(
                    entry.originalCurrency,
                    (collectionOriginals.get(entry.originalCurrency) ?? 0) + entry.originalAmount
                );
            }
        }

        const hasMore = pageRows.length > query.limit;
        const visibleRows = hasMore ? pageRows.slice(0, query.limit) : pageRows;

        return NextResponse.json({
            shift,
            entries: visibleRows.map(serializeLedgerEntry),
            summary: {
                totals,
                cashMovement,
                incomeBreakdown,
                expenseOut: totals.cashOut - collections,
                collections,
                collectionOriginals: Array.from(collectionOriginals, ([currency, amount]) => ({ currency, amount }))
            },
            pagination: {
                total,
                limit: query.limit,
                hasMore,
                nextCursor: hasMore ? visibleRows[visibleRows.length - 1]?.id ?? null : null
            }
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load hotel ledger');
    }
}
