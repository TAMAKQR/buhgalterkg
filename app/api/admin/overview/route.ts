import { NextRequest, NextResponse } from "next/server";
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/permissions";
import { getSessionUser } from "@/lib/server/session";
import { parseDateOnly } from "@/lib/timezone";
import { handleApiError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const { searchParams } = new URL(request.url);

        const parseIds = (key: string) => {
            return searchParams
                .getAll(key)
                .flatMap((value) => value.split(","))
                .map((value) => value.trim())
                .filter(Boolean);
        };

        const hotelIds = parseIds("hotelId");
        const managerIds = parseIds("managerId");

        const startDate = parseDateOnly(searchParams.get("startDate"));
        const endDate = parseDateOnly(searchParams.get("endDate"), true);

        const hotelFilter: Prisma.HotelWhereInput = hotelIds.length ? { id: { in: hotelIds } } : {};
        const roomHotelFilter: Prisma.RoomWhereInput = hotelIds.length ? { hotelId: { in: hotelIds } } : {};

        const shiftWhere: Prisma.ShiftWhereInput = {};
        if (hotelIds.length) {
            shiftWhere.hotelId = { in: hotelIds };
        }
        if (managerIds.length) {
            shiftWhere.managerId = { in: managerIds };
        }
        if (startDate || endDate) {
            shiftWhere.openedAt = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }

        const ledgerWhere: Prisma.CashEntryWhereInput = {};
        if (hotelIds.length) {
            ledgerWhere.hotelId = { in: hotelIds };
        }
        if (managerIds.length) {
            ledgerWhere.managerId = { in: managerIds };
        }
        if (startDate || endDate) {
            ledgerWhere.recordedAt = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }

        const [hotelCount, totalRooms, occupiedRooms, activeShifts, lastShift, ledgerGroups] = await prisma.$transaction([
            prisma.hotel.count({ where: hotelFilter }),
            prisma.room.count({ where: roomHotelFilter }),
            prisma.room.count({ where: { status: RoomStatus.OCCUPIED, ...roomHotelFilter } }),
            prisma.shift.count({ where: { status: ShiftStatus.OPEN, ...shiftWhere } }),
            prisma.shift.findFirst({ where: shiftWhere, orderBy: { openedAt: "desc" }, select: { openedAt: true } }),
            prisma.cashEntry.groupBy({
                by: ["entryType", "method"],
                orderBy: { entryType: "asc" },
                _sum: { amount: true },
                where: ledgerWhere,
            }),
        ]);

        const createBreakdown = () => ({ total: 0, cash: 0, card: 0 });
        const ledgerTotals: Record<LedgerEntryType, { total: number; cash: number; card: number }> = {
            [LedgerEntryType.CASH_IN]: createBreakdown(),
            [LedgerEntryType.CASH_OUT]: createBreakdown(),
            [LedgerEntryType.MANAGER_PAYOUT]: createBreakdown(),
            [LedgerEntryType.ADJUSTMENT]: createBreakdown(),
        };

        for (const group of ledgerGroups) {
            const amount = group._sum?.amount ?? 0;
            const bucket = ledgerTotals[group.entryType];
            bucket.total += amount;
            if (group.method === PaymentMethod.CASH) {
                bucket.cash += amount;
            } else if (group.method === PaymentMethod.CARD) {
                bucket.card += amount;
            }
        }

        const totals = {
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
            payoutsBreakdown: {
                cash: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT].cash,
                card: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT].card,
            },
            adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT].total,
            adjustmentsBreakdown: {
                cash: ledgerTotals[LedgerEntryType.ADJUSTMENT].cash,
                card: ledgerTotals[LedgerEntryType.ADJUSTMENT].card,
            },
        };

        const occupancyRate = totalRooms > 0 ? occupiedRooms / totalRooms : 0;

        /* ── Daily series for line chart ── */
        const dailyConditions: string[] = [];
        const dailyParams: unknown[] = [];
        let paramIndex = 1;

        if (hotelIds.length) {
            dailyConditions.push(`"hotelId" IN (${hotelIds.map(() => `$${paramIndex++}`).join(", ")})`);
            dailyParams.push(...hotelIds);
        }
        if (managerIds.length) {
            dailyConditions.push(`"managerId" IN (${managerIds.map(() => `$${paramIndex++}`).join(", ")})`);
            dailyParams.push(...managerIds);
        }
        if (startDate) {
            dailyConditions.push(`"recordedAt" >= $${paramIndex++}`);
            dailyParams.push(startDate);
        }
        if (endDate) {
            dailyConditions.push(`"recordedAt" <= $${paramIndex++}`);
            dailyParams.push(endDate);
        }

        const whereClause = dailyConditions.length ? `WHERE ${dailyConditions.join(" AND ")}` : "";

        const dailyRows = await prisma.$queryRawUnsafe<
            Array<{ day: string; entry_type: string; total: bigint }>
        >(
            `SELECT TO_CHAR("recordedAt" AT TIME ZONE 'Asia/Bishkek', 'YYYY-MM-DD') AS day,
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
            if (row.entry_type === "CASH_IN") entry.cashIn += amount;
            if (row.entry_type === "CASH_OUT" || row.entry_type === "MANAGER_PAYOUT") entry.cashOut += amount;
            dayMap.set(row.day, entry);
        }

        const dailySeries = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, values]) => ({ date, ...values }));

        return NextResponse.json({
            totals: {
                ...totals,
                netCash: totals.cashIn - totals.cashOut - totals.payouts + totals.adjustments,
            },
            occupancy: {
                hotels: hotelCount,
                rooms: totalRooms,
                occupiedRooms,
                rate: occupancyRate,
            },
            shifts: {
                active: activeShifts,
                lastOpenedAt: lastShift?.openedAt ?? null,
            },
            dailySeries,
        });
    } catch (error) {
        return handleApiError(error, "Failed to load overview");
    }
}
