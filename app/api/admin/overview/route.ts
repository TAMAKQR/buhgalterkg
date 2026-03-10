import { NextRequest, NextResponse } from "next/server";
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getCountryConfig } from "@/lib/country";
import { assertAdmin } from "@/lib/permissions";
import { getSessionUser } from "@/lib/server/session";
import { parseDateOnly, parseInputValue } from "@/lib/timezone";
import { handleApiError } from "@/lib/server/errors";
import { getCountryFromRequest } from "@/lib/server/request-country";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);
        const countryConfig = getCountryConfig(country);

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

        const startDate = parseInputValue(searchParams.get("startAt"), countryConfig.timezone)
            ?? parseDateOnly(searchParams.get("startDate"), false, countryConfig.timezone);
        const endDate = parseInputValue(searchParams.get("endAt"), countryConfig.timezone)
            ?? parseDateOnly(searchParams.get("endDate"), true, countryConfig.timezone);

        const hotelFilter: Prisma.HotelWhereInput = {
            country,
            ...(hotelIds.length ? { id: { in: hotelIds } } : {}),
        };
        const roomHotelFilter: Prisma.RoomWhereInput = {
            ...(hotelIds.length ? { hotelId: { in: hotelIds } } : {}),
            hotel: { country },
        };

        const shiftScopeWhere: Prisma.ShiftWhereInput = {
            hotel: { country },
        };
        if (hotelIds.length) {
            shiftScopeWhere.hotelId = { in: hotelIds };
        }
        if (managerIds.length) {
            shiftScopeWhere.managerId = { in: managerIds };
        }

        const ledgerWhere: Prisma.CashEntryWhereInput = {
            hotel: { country },
        };
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
            prisma.shift.count({ where: { status: ShiftStatus.OPEN, ...shiftScopeWhere } }),
            prisma.shift.findFirst({ where: { status: ShiftStatus.OPEN, ...shiftScopeWhere }, orderBy: { openedAt: "desc" }, select: { openedAt: true } }),
            prisma.cashEntry.groupBy({
                by: ["entryType", "method"],
                orderBy: { entryType: "asc" },
                _sum: { amount: true },
                where: ledgerWhere,
            }),
        ]);

        const recentExpenses = await prisma.cashEntry.findMany({
            where: {
                ...ledgerWhere,
                entryType: { in: [LedgerEntryType.CASH_OUT, LedgerEntryType.MANAGER_PAYOUT] },
            },
            orderBy: { recordedAt: "desc" },
            take: 200,
            select: {
                id: true,
                hotelId: true,
                amount: true,
                method: true,
                note: true,
                recordedAt: true,
                entryType: true,
                expenseCategory: {
                    select: {
                        name: true,
                    },
                },
                hotel: {
                    select: {
                        name: true,
                        currency: true,
                        timezone: true,
                    },
                },
                manager: {
                    select: {
                        displayName: true,
                    },
                },
            },
        });

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

        dailyConditions.push(`"hotelId" IN (SELECT "id" FROM "Hotel" WHERE "country" = $${paramIndex++})`);
        dailyParams.push(country);

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
            `SELECT TO_CHAR("recordedAt" AT TIME ZONE '${countryConfig.timezone}', 'YYYY-MM-DD') AS day,
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
            display: {
                country,
                timezone: countryConfig.timezone,
                currency: countryConfig.currency,
            },
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
            recentExpenses: recentExpenses.map((entry) => ({
                id: entry.id,
                hotelId: entry.hotelId,
                hotelName: entry.hotel.name,
                amount: entry.amount,
                method: entry.method,
                note: entry.note,
                categoryName: entry.expenseCategory?.name ?? null,
                recordedAt: entry.recordedAt,
                entryType: entry.entryType,
                managerName: entry.manager?.displayName ?? null,
                currency: entry.hotel.currency,
                timezone: entry.hotel.timezone,
            })),
        });
    } catch (error) {
        return handleApiError(error, "Failed to load overview");
    }
}
