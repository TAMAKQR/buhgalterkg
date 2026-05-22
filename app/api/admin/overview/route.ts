import { NextRequest, NextResponse } from "next/server";
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getCountryConfig } from "@/lib/country";
import { assertAdmin } from "@/lib/permissions";
import { getSessionUser } from "@/lib/server/session";
import { parseDateOnly, parseInputValue } from "@/lib/timezone";
import { handleApiError } from "@/lib/server/errors";
import { getCountryFromRequest } from "@/lib/server/request-country";
import { isCollectionLedgerEntry } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const getTodayParts = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

    return {
        year: Number(pick("year")),
        month: Number(pick("month")),
        day: Number(pick("day")),
    };
};

const getDaysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const shiftMonth = (year: number, month: number, delta: number) => {
    const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
    };
};

const toDateKey = ({ year, month, day }: { year: number; month: number; day: number }) => (
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

const toDateKeyInTimeZone = (date: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

const toUtcDate = ({ year, month, day }: { year: number; month: number; day: number }) => (
    new Date(Date.UTC(year, month - 1, day))
);

const countInclusiveDays = (
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
) => {
    const diff = toUtcDate(end).getTime() - toUtcDate(start).getTime();
    return Math.floor(diff / 86_400_000) + 1;
};

const cycleRangeFormatter = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
});

const formatCycleRange = (
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
) => `${cycleRangeFormatter.format(toUtcDate(start))} - ${cycleRangeFormatter.format(toUtcDate(end))}`;

const getFinancialCycleWindow = (timeZone: string, cycleStartDay: number) => {
    const today = getTodayParts(timeZone);
    const normalizedCycleStartDay = Math.min(Math.max(cycleStartDay || 1, 1), 31);
    const currentMonthStartDay = Math.min(normalizedCycleStartDay, getDaysInMonth(today.year, today.month));
    const startMonth = today.day >= currentMonthStartDay
        ? { year: today.year, month: today.month }
        : shiftMonth(today.year, today.month, -1);
    const nextMonth = shiftMonth(startMonth.year, startMonth.month, 1);
    const start = {
        year: startMonth.year,
        month: startMonth.month,
        day: Math.min(normalizedCycleStartDay, getDaysInMonth(startMonth.year, startMonth.month)),
    };
    const nextStart = {
        year: nextMonth.year,
        month: nextMonth.month,
        day: Math.min(normalizedCycleStartDay, getDaysInMonth(nextMonth.year, nextMonth.month)),
    };
    const endDate = new Date(toUtcDate(nextStart).getTime() - 86_400_000);
    const end = {
        year: endDate.getUTCFullYear(),
        month: endDate.getUTCMonth() + 1,
        day: endDate.getUTCDate(),
    };
    const totalDays = countInclusiveDays(start, end);
    const elapsedDays = countInclusiveDays(start, today);

    return {
        start,
        end,
        label: formatCycleRange(start, end),
        cycleStartDay: normalizedCycleStartDay,
        totalDays,
        elapsedDays,
        remainingDays: Math.max(totalDays - elapsedDays, 0),
    };
};

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

        const [hotelCount, totalRooms, occupiedRooms, activeShifts, lastShift, ledgerGroups, collectionEntries, targetHotels] = await prisma.$transaction([
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
                    expenseCategory: {
                        select: { name: true },
                    },
                },
            }),
            prisma.hotel.findMany({
                where: hotelFilter,
                select: {
                    id: true,
                    timezone: true,
                    financialCycleStartDay: true,
                    monthlyPayrollCost: true,
                    monthlyRentCost: true,
                    monthlyUtilitiesCost: true,
                    monthlySuppliesCost: true,
                    monthlyOtherCost: true,
                },
            }),
        ]);

        const cycleSummaries = targetHotels.map((hotel) => {
            const timeZone = hotel.timezone || countryConfig.timezone;
            return {
                hotel,
                timeZone,
                window: getFinancialCycleWindow(timeZone, hotel.financialCycleStartDay ?? 1),
            };
        });

        const cycleRevenueResults = cycleSummaries.length
            ? await prisma.$transaction(
                cycleSummaries.map(({ hotel, timeZone, window }) => prisma.roomStay.aggregate({
                    where: {
                        hotelId: hotel.id,
                        status: { in: ["CHECKED_IN", "CHECKED_OUT"] },
                        OR: [
                            {
                                actualCheckIn: {
                                    gte: parseDateOnly(toDateKey(window.start), false, timeZone),
                                    lte: parseDateOnly(toDateKey(window.end), true, timeZone),
                                },
                            },
                            {
                                actualCheckIn: null,
                                scheduledCheckIn: {
                                    gte: parseDateOnly(toDateKey(window.start), false, timeZone),
                                    lte: parseDateOnly(toDateKey(window.end), true, timeZone),
                                },
                            },
                        ],
                    },
                    _sum: { amountPaid: true },
                }))
            )
            : [];

        const recentExpenses = await prisma.cashEntry.findMany({
            where: {
                ...ledgerWhere,
                entryType: { in: [LedgerEntryType.CASH_OUT, LedgerEntryType.MANAGER_PAYOUT, LedgerEntryType.ADJUSTMENT] },
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
        const collectionTotals = createBreakdown();

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
            collections: collectionTotals.total,
            collectionsBreakdown: {
                cash: collectionTotals.cash,
                card: collectionTotals.card,
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
        const monthlyCostPlan = targetHotels.reduce(
            (totals, hotel) => {
                totals.payroll += hotel.monthlyPayrollCost ?? 0;
                totals.rent += hotel.monthlyRentCost ?? 0;
                totals.utilities += hotel.monthlyUtilitiesCost ?? 0;
                totals.supplies += hotel.monthlySuppliesCost ?? 0;
                totals.other += hotel.monthlyOtherCost ?? 0;
                return totals;
            },
            { payroll: 0, rent: 0, utilities: 0, supplies: 0, other: 0 }
        );
        const monthlyRequiredRevenue =
            monthlyCostPlan.payroll +
            monthlyCostPlan.rent +
            monthlyCostPlan.utilities +
            monthlyCostPlan.supplies +
            monthlyCostPlan.other;
        const cycleMetrics = cycleSummaries.map(({ hotel, window }, index) => {
            const revenue = cycleRevenueResults[index]?._sum.amountPaid ?? 0;
            const requiredRevenue =
                (hotel.monthlyPayrollCost ?? 0) +
                (hotel.monthlyRentCost ?? 0) +
                (hotel.monthlyUtilitiesCost ?? 0) +
                (hotel.monthlySuppliesCost ?? 0) +
                (hotel.monthlyOtherCost ?? 0);
            const remainingRevenue = Math.max(requiredRevenue - revenue, 0);
            const currentAverage = window.elapsedDays > 0 ? Math.round(revenue / window.elapsedDays) : 0;
            const requiredAverage = remainingRevenue > 0 && window.remainingDays > 0
                ? Math.ceil(remainingRevenue / window.remainingDays)
                : 0;

            return {
                label: window.label,
                cycleStartDay: window.cycleStartDay,
                totalDays: window.totalDays,
                elapsedDays: window.elapsedDays,
                remainingDays: window.remainingDays,
                revenue,
                currentAverage,
                requiredAverage,
                projectedRevenue: currentAverage * window.totalDays,
            };
        });
        const periodLabels = Array.from(new Set(cycleMetrics.map((item) => item.label)));
        const cycleDays = Array.from(new Set(cycleMetrics.map((item) => item.cycleStartDay)));
        const sharedTimeline = cycleMetrics.length > 0 && periodLabels.length === 1;
        const monthRevenue = cycleMetrics.reduce((sum, item) => sum + item.revenue, 0);
        const remainingToTarget = Math.max(monthlyRequiredRevenue - monthRevenue, 0);
        const coveredPct = monthlyRequiredRevenue > 0 ? Math.min(monthRevenue / monthlyRequiredRevenue, 1) : 0;
        const currentDailyAverage = cycleMetrics.reduce((sum, item) => sum + item.currentAverage, 0);
        const requiredDailyAverage = cycleMetrics.reduce((sum, item) => sum + item.requiredAverage, 0);
        const projectedRevenue = cycleMetrics.reduce((sum, item) => sum + item.projectedRevenue, 0);
        const elapsedDays = sharedTimeline ? cycleMetrics[0]?.elapsedDays ?? null : null;
        const totalDays = sharedTimeline ? cycleMetrics[0]?.totalDays ?? null : null;
        const remainingDays = sharedTimeline ? cycleMetrics[0]?.remainingDays ?? null : null;
        const periodLabel = cycleMetrics.length === 0
            ? "текущий расчетный период"
            : sharedTimeline
                ? periodLabels[0]
                : "текущие расчетные периоды по каждому объекту";

        /* ── Daily series for line chart ── */
        const dailyEntries = await prisma.cashEntry.findMany({
            where: ledgerWhere,
            select: {
                entryType: true,
                amount: true,
                method: true,
                note: true,
                recordedAt: true,
                expenseCategory: {
                    select: { name: true },
                },
            },
            orderBy: { recordedAt: "asc" },
        });

        const dayMap = new Map<string, { cashIn: number; cashOut: number; collections: number }>();
        for (const row of dailyEntries) {
            const day = toDateKeyInTimeZone(row.recordedAt, countryConfig.timezone);
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

        return NextResponse.json({
            display: {
                country,
                timezone: countryConfig.timezone,
                currency: countryConfig.currency,
            },
            totals: {
                ...totals,
                netCash: totals.cashIn - totals.cashOut - totals.collections - totals.payouts + totals.adjustments,
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
            businessTarget: {
                hotelsInScope: targetHotels.length,
                periodLabel,
                cycleStartDay: cycleDays.length === 1 ? cycleDays[0] : null,
                mixedCycleDays: cycleDays.length > 1 || !sharedTimeline,
                costs: monthlyCostPlan,
                monthlyRequiredRevenue,
                monthRevenue,
                remainingToTarget,
                coveredPct,
                elapsedDays,
                totalDays,
                remainingDays,
                currentDailyAverage,
                requiredDailyAverage,
                projectedRevenue,
                onTrack: monthlyRequiredRevenue > 0 ? projectedRevenue >= monthlyRequiredRevenue : false,
            },
            dailySeries,
            recentExpenses: recentExpenses
                .map((entry) => ({
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
