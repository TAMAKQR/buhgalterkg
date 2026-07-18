import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { parseDateOnly } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

function assertObserver(user: { role: string }) {
    if (user.role !== 'OBSERVER') {
        throw new Error('Observer access required');
    }
}

const toDateKeyInTimeZone = (date: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_CUSTOM_RANGE_DAYS = 366;

type ObserverLedgerAggregate = {
    date: string;
    entryType: LedgerEntryType;
    method: PaymentMethod;
    isCollection: boolean;
    amount: bigint;
};

const resolveTimeZone = (value?: string | null) => {
    const timeZone = value || 'Asia/Bishkek';
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone }).format();
        return timeZone;
    } catch {
        return 'Asia/Bishkek';
    }
};

const parseRangeDate = (value: string | null, endOfDay: boolean, timeZone: string) => {
    const normalized = value?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return undefined;
    }
    const parsed = parseDateOnly(normalized, endOfDay, timeZone);
    return parsed && toDateKeyInTimeZone(parsed, timeZone) === normalized ? parsed : undefined;
};

const resolveDateRange = (rawStart: string | null, rawEnd: string | null, timeZone: string) => {
    const hasStart = Boolean(rawStart?.trim());
    const hasEnd = Boolean(rawEnd?.trim());
    const requestedStart = hasStart ? parseRangeDate(rawStart, false, timeZone) : undefined;
    const requestedEnd = hasEnd ? parseRangeDate(rawEnd, true, timeZone) : undefined;

    if ((hasStart && !requestedStart) || (hasEnd && !requestedEnd)) {
        return { error: 'Некорректная дата периода' } as const;
    }

    const now = new Date();
    const todayKey = toDateKeyInTimeZone(now, timeZone);
    const todayEnd = parseDateOnly(todayKey, true, timeZone)!;

    let startDate = requestedStart;
    let endDate = requestedEnd;

    if (!startDate && !endDate) {
        endDate = todayEnd;
        const startAnchor = new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
        startDate = parseDateOnly(toDateKeyInTimeZone(startAnchor, timeZone), false, timeZone)!;
    } else if (startDate && !endDate) {
        endDate = startDate <= todayEnd
            ? todayEnd
            : parseDateOnly(toDateKeyInTimeZone(startDate, timeZone), true, timeZone)!;
    } else if (!startDate && endDate) {
        const startAnchor = new Date(endDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
        startDate = parseDateOnly(toDateKeyInTimeZone(startAnchor, timeZone), false, timeZone)!;
    }

    if (!startDate || !endDate || startDate > endDate) {
        return { error: 'Начало периода должно быть раньше окончания' } as const;
    }
    if (endDate.getTime() - startDate.getTime() > MAX_CUSTOM_RANGE_DAYS * DAY_MS) {
        return { error: `Период не может превышать ${MAX_CUSTOM_RANGE_DAYS} дней` } as const;
    }

    return { startDate, endDate } as const;
};

export async function GET(request: NextRequest) {
    try {
        type ObserverStayRecord = {
            id: string;
            guestName: string | null;
            guestPhone: string | null;
            companyName: string | null;
            scheduledCheckIn: Date;
            scheduledCheckOut: Date;
            actualCheckIn: Date | null;
            actualCheckOut: Date | null;
            status: string;
            amountPaid: number | null;
            totalAmount: number | null;
            paymentMethod: string | null;
            cashPaid: number | null;
            cardPaid: number | null;
            onlinePaid: number;
            bookingSource: string | null;
            bookingNumber: string | null;
            room?: { label: string } | null;
        };

        const session = await getSessionUser(request);
        assertObserver(session);

        const hotelId = session.hotels[0]?.id;
        if (!hotelId) {
            return new NextResponse('Нет назначенного объекта', { status: 403 });
        }

        const hotel = await prisma.hotel.findUnique({
            where: { id: hotelId },
            select: {
                id: true,
                name: true,
                address: true,
                timezone: true,
                currency: true,
            },
        });
        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        /* ── Parse and bound query params ── */
        const { searchParams } = new URL(request.url);
        const timeZone = resolveTimeZone(hotel.timezone);
        const range = resolveDateRange(
            searchParams.get('startDate'),
            searchParams.get('endDate'),
            timeZone,
        );
        if ('error' in range) {
            return new NextResponse(range.error, { status: 400 });
        }
        const { startDate, endDate } = range;

        const rawShiftNumber = searchParams.get('shiftNumber')?.trim() ?? '';
        const shiftNumber = rawShiftNumber ? Number(rawShiftNumber) : undefined;
        if (shiftNumber !== undefined && (!Number.isSafeInteger(shiftNumber) || shiftNumber <= 0)) {
            return new NextResponse('Некорректный номер смены', { status: 400 });
        }

        /* ── Build where clauses ── */
        const ledgerWhere: Prisma.CashEntryWhereInput = {
            hotelId,
            recordedAt: { gte: startDate, lte: endDate },
        };
        if (shiftNumber) {
            ledgerWhere.shift = { number: shiftNumber };
        }

        const shiftWhere: Prisma.ShiftWhereInput = {
            hotelId,
            openedAt: { gte: startDate, lte: endDate },
        };
        if (shiftNumber) {
            shiftWhere.number = shiftNumber;
        }

        const stayWhere: Prisma.RoomStayWhereInput = {
            hotelId,
            scheduledCheckIn: { gte: startDate, lte: endDate },
        };

        const staySelect = {
            id: true,
            guestName: true,
            guestPhone: true,
            companyName: true,
            scheduledCheckIn: true,
            scheduledCheckOut: true,
            actualCheckIn: true,
            actualCheckOut: true,
            status: true,
            amountPaid: true,
            totalAmount: true,
            paymentMethod: true,
            cashPaid: true,
            cardPaid: true,
            onlinePaid: true,
            bookingSource: true,
            bookingNumber: true,
            room: { select: { label: true } },
        } as const;

        const shiftJoin = shiftNumber
            ? Prisma.sql`INNER JOIN "Shift" AS "shift" ON "shift"."id" = "entry"."shiftId"`
            : Prisma.sql``;
        const shiftFilter = shiftNumber
            ? Prisma.sql`AND "shift"."number" = ${shiftNumber}`
            : Prisma.sql``;

        const [ledgerAggregates, ledgerEntries, shifts, stays, rooms, allShifts] = await prisma.$transaction([
            prisma.$queryRaw<ObserverLedgerAggregate[]>(Prisma.sql`
                SELECT
                    TO_CHAR(
                        (("entry"."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date,
                        'YYYY-MM-DD'
                    ) AS "date",
                    "entry"."entryType"::text AS "entryType",
                    "entry"."method"::text AS "method",
                    (
                        "entry"."entryType"::text = 'CASH_OUT'
                        AND (
                            COALESCE("category"."name", '') ILIKE '%инкассац%'
                            OR COALESCE("category"."name", '') ILIKE '%инкасац%'
                            OR COALESCE("category"."name", '') ILIKE '%inkass%'
                            OR COALESCE("category"."name", '') ILIKE '%incass%'
                            OR COALESCE("category"."name", '') ILIKE '%collection%'
                            OR COALESCE("entry"."note", '') ILIKE '%инкассац%'
                            OR COALESCE("entry"."note", '') ILIKE '%инкасац%'
                            OR COALESCE("entry"."note", '') ILIKE '%inkass%'
                            OR COALESCE("entry"."note", '') ILIKE '%incass%'
                            OR COALESCE("entry"."note", '') ILIKE '%collection%'
                        )
                    ) AS "isCollection",
                    SUM("entry"."amount")::bigint AS "amount"
                FROM "CashEntry" AS "entry"
                LEFT JOIN "ExpenseCategory" AS "category"
                    ON "category"."id" = "entry"."expense_category_id"
                ${shiftJoin}
                WHERE "entry"."hotelId" = ${hotelId}
                    AND "entry"."recordedAt" >= ${startDate}
                    AND "entry"."recordedAt" <= ${endDate}
                    ${shiftFilter}
                GROUP BY 1, 2, 3, 4
                ORDER BY 1 ASC
            `),
            prisma.cashEntry.findMany({
                where: ledgerWhere,
                orderBy: { recordedAt: 'desc' },
                take: 200,
                select: {
                    id: true,
                    entryType: true,
                    method: true,
                    amount: true,
                    note: true,
                    recordedAt: true,
                    expenseCategory: { select: { name: true } },
                    shift: { select: { number: true } },
                },
            }),
            prisma.shift.findMany({
                where: shiftWhere,
                orderBy: { openedAt: 'desc' },
                take: 50,
                include: { manager: { select: { displayName: true } } },
            }),
            prisma.roomStay.findMany({
                where: stayWhere,
                orderBy: { scheduledCheckIn: 'desc' },
                take: 200,
                select: staySelect as never,
            }),
            prisma.room.findMany({
                where: { hotelId, isActive: true },
                orderBy: { label: 'asc' },
                select: {
                    id: true,
                    label: true,
                    status: true,
                    floor: true,
                },
            }),
            prisma.shift.findMany({
                where: { hotelId },
                orderBy: { number: 'desc' },
                take: 50,
                select: { number: true, status: true, openedAt: true },
            }),
        ]);

        const stayRecords = stays as ObserverStayRecord[];

        /* ── Aggregate totals with payment breakdown ── */
        const createBreakdown = () => ({ total: 0, cash: 0, card: 0 });
        const ledgerTotals: Record<string, { total: number; cash: number; card: number }> = {
            [LedgerEntryType.CASH_IN]: createBreakdown(),
            [LedgerEntryType.CASH_OUT]: createBreakdown(),
            [LedgerEntryType.MANAGER_PAYOUT]: createBreakdown(),
            [LedgerEntryType.ADJUSTMENT]: createBreakdown(),
        };

        const collectionTotals = createBreakdown();
        const dayMap = new Map<string, { cashIn: number; cashOut: number; collections: number }>();
        for (const row of ledgerAggregates) {
            const amount = Number(row.amount);
            const day = dayMap.get(row.date) ?? { cashIn: 0, cashOut: 0, collections: 0 };

            if (row.isCollection) {
                collectionTotals.total += amount;
                if (row.method === PaymentMethod.CASH) collectionTotals.cash += amount;
                else if (row.method === PaymentMethod.CARD) collectionTotals.card += amount;
                day.collections += amount;
            } else {
                const bucket = ledgerTotals[row.entryType];
                if (bucket) {
                    bucket.total += amount;
                    if (row.method === PaymentMethod.CASH) bucket.cash += amount;
                    else if (row.method === PaymentMethod.CARD) bucket.card += amount;
                }

                if (row.entryType === LedgerEntryType.CASH_IN) {
                    day.cashIn += amount;
                } else if (
                    row.entryType === LedgerEntryType.CASH_OUT
                    || row.entryType === LedgerEntryType.MANAGER_PAYOUT
                ) {
                    day.cashOut += amount;
                }
            }
            dayMap.set(row.date, day);
        }

        const occupiedCount = rooms.filter((r) => r.status === 'OCCUPIED').length;

        const dailySeries = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, values]) => ({ date, ...values }));

        return NextResponse.json({
            hotel,
            totals: {
                cashIn: ledgerTotals[LedgerEntryType.CASH_IN].total,
                cashInBreakdown: {
                    cash: ledgerTotals[LedgerEntryType.CASH_IN].cash,
                    card: ledgerTotals[LedgerEntryType.CASH_IN].card,
                },
                cashOut: ledgerTotals[LedgerEntryType.CASH_OUT].total,
                cashOutBreakdown: {
                    cash: ledgerTotals[LedgerEntryType.CASH_OUT].cash,
                    card: ledgerTotals[LedgerEntryType.CASH_OUT].card,
                },
                collections: collectionTotals.total,
                collectionsBreakdown: {
                    cash: collectionTotals.cash,
                    card: collectionTotals.card,
                },
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT].total,
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT].total,
                net: ledgerTotals[LedgerEntryType.CASH_IN].total
                    - ledgerTotals[LedgerEntryType.CASH_OUT].total
                    - collectionTotals.total
                    - ledgerTotals[LedgerEntryType.MANAGER_PAYOUT].total
                    + ledgerTotals[LedgerEntryType.ADJUSTMENT].total,
            },
            dailySeries,
            shiftNumbers: allShifts.map((s) => ({
                number: s.number,
                status: s.status,
                openedAt: s.openedAt.toISOString(),
            })),
            occupancy: {
                total: rooms.length,
                occupied: occupiedCount,
                rate: rooms.length ? Math.round((occupiedCount / rooms.length) * 100) : 0,
            },
            rooms: rooms.map((r) => ({
                id: r.id,
                label: r.label,
                status: r.status,
                floor: r.floor,
            })),
            shifts: shifts.map((s) => ({
                id: s.id,
                number: s.number,
                status: s.status,
                manager: s.manager.displayName,
                openedAt: s.openedAt.toISOString(),
                closedAt: s.closedAt?.toISOString() ?? null,
                openingCash: s.openingCash,
                closingCash: s.closingCash,
            })),
            stays: stayRecords.map((s) => ({
                id: s.id,
                guestName: s.guestName,
                guestPhone: s.guestPhone,
                companyName: s.companyName,
                room: s.room?.label ?? '—',
                scheduledCheckIn: s.scheduledCheckIn.toISOString(),
                scheduledCheckOut: s.scheduledCheckOut.toISOString(),
                actualCheckIn: s.actualCheckIn?.toISOString() ?? null,
                actualCheckOut: s.actualCheckOut?.toISOString() ?? null,
                status: s.status,
                amountPaid: s.amountPaid,
                totalAmount: s.totalAmount,
                paymentMethod: s.paymentMethod,
                cashPaid: s.cashPaid,
                cardPaid: s.cardPaid,
                onlinePaid: s.onlinePaid,
                bookingSource: s.bookingSource,
                bookingNumber: s.bookingNumber,
            })),
            ledger: ledgerEntries.map((e) => ({
                id: e.id,
                entryType: e.entryType,
                method: e.method,
                amount: e.amount,
                note: e.note,
                categoryName: e.expenseCategory?.name ?? null,
                recordedAt: e.recordedAt.toISOString(),
                shiftNumber: e.shift?.number ?? null,
            })),
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load observer data');
    }
}
