import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { parseDateOnly } from '@/lib/timezone';
import { isCollectionLedgerEntry } from '@/lib/ledger';

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

        /* ── Parse query params ── */
        const { searchParams } = new URL(request.url);
        const startDate = parseDateOnly(searchParams.get('startDate'));
        const endDate = parseDateOnly(searchParams.get('endDate'), true);
        const shiftNumber = searchParams.get('shiftNumber')
            ? Number(searchParams.get('shiftNumber'))
            : undefined;

        /* ── Build where clauses ── */
        const ledgerWhere: Prisma.CashEntryWhereInput = { hotelId };
        if (startDate || endDate) {
            ledgerWhere.recordedAt = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }
        if (shiftNumber) {
            ledgerWhere.shift = { number: shiftNumber };
        }

        const shiftWhere: Prisma.ShiftWhereInput = { hotelId };
        if (startDate || endDate) {
            shiftWhere.openedAt = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }
        if (shiftNumber) {
            shiftWhere.number = shiftNumber;
        }

        const stayWhere: Prisma.RoomStayWhereInput = { hotelId };
        if (startDate || endDate) {
            stayWhere.scheduledCheckIn = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }

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

        const [hotel, ledgerGroups, collectionEntries, ledgerEntries, shifts, stays, rooms] = await prisma.$transaction([
            prisma.hotel.findUnique({
                where: { id: hotelId },
                select: {
                    id: true,
                    name: true,
                    address: true,
                    timezone: true,
                    currency: true,
                },
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType', 'method'],
                orderBy: { entryType: 'asc' },
                where: ledgerWhere,
                _sum: { amount: true },
            }),
            prisma.cashEntry.findMany({
                where: {
                    ...ledgerWhere,
                    entryType: LedgerEntryType.CASH_OUT,
                },
                select: {
                    amount: true,
                    method: true,
                    note: true,
                    entryType: true,
                    expenseCategory: { select: { name: true } },
                },
            }),
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
        ]);

        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const stayRecords = stays as ObserverStayRecord[];

        /* ── Aggregate totals with payment breakdown ── */
        const createBreakdown = () => ({ total: 0, cash: 0, card: 0 });
        const ledgerTotals: Record<string, { total: number; cash: number; card: number }> = {
            [LedgerEntryType.CASH_IN]: createBreakdown(),
            [LedgerEntryType.CASH_OUT]: createBreakdown(),
            [LedgerEntryType.MANAGER_PAYOUT]: createBreakdown(),
            [LedgerEntryType.ADJUSTMENT]: createBreakdown(),
        };

        for (const group of ledgerGroups) {
            const amount = group._sum?.amount ?? 0;
            const bucket = ledgerTotals[group.entryType];
            bucket.total += amount;
            if (group.method === PaymentMethod.CASH) bucket.cash += amount;
            else if (group.method === PaymentMethod.CARD) bucket.card += amount;
        }
        const collectionTotals = createBreakdown();
        for (const entry of collectionEntries) {
            if (!isCollectionLedgerEntry(entry)) {
                continue;
            }
            const bucket = ledgerTotals[LedgerEntryType.CASH_OUT];
            bucket.total -= entry.amount;
            collectionTotals.total += entry.amount;
            if (entry.method === PaymentMethod.CASH) {
                bucket.cash -= entry.amount;
                collectionTotals.cash += entry.amount;
            } else if (entry.method === PaymentMethod.CARD) {
                bucket.card -= entry.amount;
                collectionTotals.card += entry.amount;
            }
        }

        const occupiedCount = rooms.filter((r) => r.status === 'OCCUPIED').length;

        /* ── Daily series for line chart ── */
        const tz = hotel.timezone || 'Asia/Almaty';
        const dailyEntries = await prisma.cashEntry.findMany({
            where: ledgerWhere,
            orderBy: { recordedAt: 'asc' },
            select: {
                entryType: true,
                amount: true,
                method: true,
                note: true,
                recordedAt: true,
                expenseCategory: { select: { name: true } },
            },
        });

        const dayMap = new Map<string, { cashIn: number; cashOut: number; collections: number }>();
        for (const row of dailyEntries) {
            const day = toDateKeyInTimeZone(row.recordedAt, tz);
            const entry = dayMap.get(day) ?? { cashIn: 0, cashOut: 0, collections: 0 };
            if (row.entryType === LedgerEntryType.CASH_IN) {
                entry.cashIn += row.amount;
            } else if (isCollectionLedgerEntry(row)) {
                entry.collections += row.amount;
            } else if (row.entryType === LedgerEntryType.CASH_OUT || row.entryType === LedgerEntryType.MANAGER_PAYOUT) {
                entry.cashOut += row.amount;
            }
            dayMap.set(day, entry);
        }

        const dailySeries = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, values]) => ({ date, ...values }));

        /* ── Shift numbers list for filter dropdown ── */
        const allShifts = await prisma.shift.findMany({
            where: { hotelId },
            orderBy: { number: 'desc' },
            take: 50,
            select: { number: true, status: true, openedAt: true },
        });

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
