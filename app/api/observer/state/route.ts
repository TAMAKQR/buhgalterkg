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

export async function GET(request: NextRequest) {
    try {
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

        const [hotel, ledgerGroups, ledgerEntries, shifts, stays, rooms] = await prisma.$transaction([
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
                select: {
                    id: true,
                    guestName: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true,
                    actualCheckIn: true,
                    actualCheckOut: true,
                    status: true,
                    amountPaid: true,
                    paymentMethod: true,
                    cashPaid: true,
                    cardPaid: true,
                    room: { select: { label: true } },
                },
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

        const occupiedCount = rooms.filter((r) => r.status === 'OCCUPIED').length;

        /* ── Daily series for line chart ── */
        const dailyConditions: string[] = [`"hotelId" = $1`];
        const dailyParams: unknown[] = [hotelId];
        let paramIndex = 2;

        if (startDate) {
            dailyConditions.push(`"recordedAt" >= $${paramIndex++}`);
            dailyParams.push(startDate);
        }
        if (endDate) {
            dailyConditions.push(`"recordedAt" <= $${paramIndex++}`);
            dailyParams.push(endDate);
        }
        if (shiftNumber) {
            dailyConditions.push(`"shiftId" IN (SELECT id FROM "Shift" WHERE "hotelId" = $1 AND number = $${paramIndex++})`);
            dailyParams.push(shiftNumber);
        }

        const tz = hotel.timezone || 'Asia/Bishkek';
        const whereClause = dailyConditions.length ? `WHERE ${dailyConditions.join(' AND ')}` : '';

        const dailyRows = await prisma.$queryRawUnsafe<
            Array<{ day: string; entry_type: string; total: bigint }>
        >(
            `SELECT TO_CHAR("recordedAt" AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day,
                    "entryType" AS entry_type,
                    SUM(amount) AS total
             FROM "CashEntry"
             ${whereClause}
             GROUP BY day, "entryType"
             ORDER BY day`,
            ...dailyParams,
        );

        const dayMap = new Map<string, { cashIn: number; cashOut: number }>();
        for (const row of dailyRows) {
            const entry = dayMap.get(row.day) ?? { cashIn: 0, cashOut: 0 };
            const amount = Number(row.total);
            if (row.entry_type === 'CASH_IN') entry.cashIn += amount;
            if (row.entry_type === 'CASH_OUT' || row.entry_type === 'MANAGER_PAYOUT') entry.cashOut += amount;
            dayMap.set(row.day, entry);
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
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT].total,
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT].total,
                net: ledgerTotals[LedgerEntryType.CASH_IN].total
                    - ledgerTotals[LedgerEntryType.CASH_OUT].total
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
            stays: stays.map((s) => ({
                id: s.id,
                guestName: s.guestName,
                room: s.room?.label ?? '—',
                scheduledCheckIn: s.scheduledCheckIn.toISOString(),
                scheduledCheckOut: s.scheduledCheckOut.toISOString(),
                actualCheckIn: s.actualCheckIn?.toISOString() ?? null,
                actualCheckOut: s.actualCheckOut?.toISOString() ?? null,
                status: s.status,
                amountPaid: s.amountPaid,
                paymentMethod: s.paymentMethod,
                cashPaid: s.cashPaid,
                cardPaid: s.cardPaid,
            })),
            ledger: ledgerEntries.map((e) => ({
                id: e.id,
                entryType: e.entryType,
                method: e.method,
                amount: e.amount,
                note: e.note,
                recordedAt: e.recordedAt.toISOString(),
                shiftNumber: e.shift?.number ?? null,
            })),
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load observer data');
    }
}
