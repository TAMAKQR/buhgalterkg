import { NextRequest, NextResponse } from "next/server";
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus, StayStatus } from "@prisma/client";

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

const clampPositive = (value: number) => Math.max(value, 0);

const scorePart = (value: number, max: number) => (max > 0 ? clampPositive(value) / max : 0);

const overlapNights = (start: Date, end: Date, rangeStart: Date, rangeEnd: Date) => {
    const from = Math.max(start.getTime(), rangeStart.getTime());
    const to = Math.min(end.getTime(), rangeEnd.getTime());
    if (to <= from) {
        return 0;
    }
    return Math.max(1, Math.ceil((to - from) / 86_400_000));
};

const EXPENSE_PAGE_SIZE = 50;
const EXPENSE_PAGE_SIZE_MAX = 100;
const expenseEntryTypes = [
    LedgerEntryType.CASH_OUT,
    LedgerEntryType.MANAGER_PAYOUT,
    LedgerEntryType.ADJUSTMENT,
] as const;
const expenseEntrySelect = {
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
} satisfies Prisma.CashEntrySelect;

type ExpenseEntryRecord = Prisma.CashEntryGetPayload<{ select: typeof expenseEntrySelect }>;

const serializeExpenseEntry = (entry: ExpenseEntryRecord) => ({
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
});

const parseBoundedInteger = (value: string | null, fallback: number, max: number) => {
    if (value == null || value.trim() === "") return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
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
        const shiftIds = parseIds("shiftId");

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
        if (shiftIds.length) {
            shiftScopeWhere.id = { in: shiftIds };
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
        if (shiftIds.length) {
            ledgerWhere.shiftId = { in: shiftIds };
        }
        if (startDate || endDate) {
            ledgerWhere.recordedAt = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            };
        }

        const expenseWhere: Prisma.CashEntryWhereInput = {
            ...ledgerWhere,
            entryType: { in: [...expenseEntryTypes] },
        };

        if (searchParams.get("view") === "expenses") {
            const offset = parseBoundedInteger(searchParams.get("expenseOffset"), 0, 1_000_000);
            const limit = Math.max(1, parseBoundedInteger(searchParams.get("expenseLimit"), EXPENSE_PAGE_SIZE, EXPENSE_PAGE_SIZE_MAX));
            const [entries, total] = await prisma.$transaction([
                prisma.cashEntry.findMany({
                    where: expenseWhere,
                    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
                    skip: offset,
                    take: limit,
                    select: expenseEntrySelect,
                }),
                prisma.cashEntry.count({ where: expenseWhere }),
            ]);
            const loadedThrough = offset + entries.length;

            return NextResponse.json({
                recentExpenses: entries.map(serializeExpenseEntry),
                recentExpensesMeta: {
                    total,
                    offset,
                    returned: entries.length,
                    limit,
                    hasMore: loadedThrough < total,
                    truncated: loadedThrough < total,
                },
            });
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
                    name: true,
                    currency: true,
                    timezone: true,
                    financialCycleStartDay: true,
                    plannedCostItems: { select: { name: true, monthlyAmount: true, kind: true } },
                    employees: {
                        where: { isActive: true },
                        select: { payType: true, payAmount: true },
                    },
                    _count: {
                        select: { rooms: true },
                    },
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

        const rankingRangeEnd = endDate ?? new Date();
        const rankingRangeStart = startDate ?? new Date(rankingRangeEnd.getTime() - 29 * 86_400_000);
        const rankingDayCount = Math.max(1, Math.ceil((rankingRangeEnd.getTime() - rankingRangeStart.getTime()) / 86_400_000));

        const stayRankingWhere: Prisma.RoomStayWhereInput = {
            hotel: { country },
            status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] },
            scheduledCheckOut: { gt: rankingRangeStart },
            scheduledCheckIn: { lt: rankingRangeEnd },
        };
        if (hotelIds.length) {
            stayRankingWhere.hotelId = { in: hotelIds };
        }
        if (managerIds.length) {
            stayRankingWhere.shift = { managerId: { in: managerIds } };
        }
        if (shiftIds.length) {
            stayRankingWhere.shiftId = { in: shiftIds };
        }

        const shiftRankingWhere: Prisma.ShiftWhereInput = {
            ...shiftScopeWhere,
            openedAt: {
                gte: rankingRangeStart,
                lte: rankingRangeEnd,
            },
        };

        const [recentExpenses, recentExpensesTotal, rankingLedgerEntries, rankingStays, rankingShifts] = await prisma.$transaction([
            prisma.cashEntry.findMany({
                where: expenseWhere,
                orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
                take: EXPENSE_PAGE_SIZE,
                select: expenseEntrySelect,
            }),
            prisma.cashEntry.count({ where: expenseWhere }),
            prisma.cashEntry.findMany({
                where: ledgerWhere,
                select: {
                    hotelId: true,
                    managerId: true,
                    shiftId: true,
                    entryType: true,
                    amount: true,
                    note: true,
                    expenseCategory: {
                        select: { name: true },
                    },
                    hotel: {
                        select: {
                            id: true,
                            name: true,
                            currency: true,
                        },
                    },
                    manager: {
                        select: {
                            id: true,
                            displayName: true,
                        },
                    },
                    shift: {
                        select: {
                            id: true,
                            number: true,
                            openedAt: true,
                            status: true,
                        },
                    },
                },
            }),
            prisma.roomStay.findMany({
                where: stayRankingWhere,
                select: {
                    id: true,
                    hotelId: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true,
                    hotel: {
                        select: {
                            id: true,
                            name: true,
                            currency: true,
                        },
                    },
                    shift: {
                        select: {
                            id: true,
                            number: true,
                            managerId: true,
                            manager: {
                                select: {
                                    id: true,
                                    displayName: true,
                                },
                            },
                        },
                    },
                },
            }),
            prisma.shift.findMany({
                where: shiftRankingWhere,
                select: {
                    id: true,
                    number: true,
                    openedAt: true,
                    status: true,
                    hotelId: true,
                    managerId: true,
                    hotel: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    manager: {
                        select: {
                            id: true,
                            displayName: true,
                        },
                    },
                },
            }),
        ]);

        /*
         * Ranking score:
         * hotels: revenue 35%, net 25%, revenue/room 20%, occupied room-nights 15%, expense control 5%.
         * managers: revenue 35%, net 25%, revenue/shift 20%, average stay activity 10%, expense control 10%.
         */
        const hotelRankBuckets = new Map<string, {
            id: string;
            name: string;
            currency: string;
            rooms: number;
            revenue: number;
            expenses: number;
            payouts: number;
            collections: number;
            adjustments: number;
            stays: number;
            roomNights: number;
            shifts: number;
        }>();
        const managerRankBuckets = new Map<string, {
            id: string;
            name: string;
            revenue: number;
            expenses: number;
            payouts: number;
            collections: number;
            adjustments: number;
            stays: number;
            roomNights: number;
            shifts: number;
            hotels: Set<string>;
        }>();
        const managerHotelRankBuckets = new Map<string, {
            id: string;
            hotelId: string;
            hotelName: string;
            managerId: string;
            managerName: string;
            revenue: number;
            expenses: number;
            payouts: number;
            collections: number;
            adjustments: number;
            stays: number;
            roomNights: number;
            shifts: number;
        }>();

        const ensureHotelBucket = (hotel: { id: string; name: string; currency?: string | null }) => {
            const existing = hotelRankBuckets.get(hotel.id);
            if (existing) {
                return existing;
            }
            const targetHotel = targetHotels.find((item) => item.id === hotel.id);
            const created = {
                id: hotel.id,
                name: hotel.name,
                currency: hotel.currency ?? countryConfig.currency,
                rooms: targetHotel?._count.rooms ?? 0,
                revenue: 0,
                expenses: 0,
                payouts: 0,
                collections: 0,
                adjustments: 0,
                stays: 0,
                roomNights: 0,
                shifts: 0,
            };
            hotelRankBuckets.set(hotel.id, created);
            return created;
        };

        const ensureManagerBucket = (manager: { id: string; displayName: string }) => {
            const existing = managerRankBuckets.get(manager.id);
            if (existing) {
                return existing;
            }
            const created = {
                id: manager.id,
                name: manager.displayName,
                revenue: 0,
                expenses: 0,
                payouts: 0,
                collections: 0,
                adjustments: 0,
                stays: 0,
                roomNights: 0,
                shifts: 0,
                hotels: new Set<string>(),
            };
            managerRankBuckets.set(manager.id, created);
            return created;
        };

        const ensureManagerHotelBucket = (
            hotel: { id: string; name: string },
            manager: { id: string; displayName: string }
        ) => {
            const key = `${hotel.id}:${manager.id}`;
            const existing = managerHotelRankBuckets.get(key);
            if (existing) {
                return existing;
            }
            const created = {
                id: key,
                hotelId: hotel.id,
                hotelName: hotel.name,
                managerId: manager.id,
                managerName: manager.displayName,
                revenue: 0,
                expenses: 0,
                payouts: 0,
                collections: 0,
                adjustments: 0,
                stays: 0,
                roomNights: 0,
                shifts: 0,
            };
            managerHotelRankBuckets.set(key, created);
            return created;
        };

        const applyRankingAmount = (
            bucket: { revenue: number; expenses: number; payouts: number; collections: number; adjustments: number },
            entry: (typeof rankingLedgerEntries)[number]
        ) => {
            if (entry.entryType === LedgerEntryType.CASH_IN) {
                bucket.revenue += entry.amount;
            } else if (isCollectionLedgerEntry(entry)) {
                bucket.collections += entry.amount;
            } else if (entry.entryType === LedgerEntryType.CASH_OUT) {
                bucket.expenses += entry.amount;
            } else if (entry.entryType === LedgerEntryType.MANAGER_PAYOUT) {
                bucket.payouts += entry.amount;
            } else if (entry.entryType === LedgerEntryType.ADJUSTMENT) {
                bucket.adjustments += entry.amount;
            }
        };

        for (const hotel of targetHotels) {
            ensureHotelBucket({ id: hotel.id, name: hotel.name, currency: hotel.currency });
        }

        for (const entry of rankingLedgerEntries) {
            const hotelBucket = ensureHotelBucket(entry.hotel);
            const managerBucket = entry.managerId && entry.manager ? ensureManagerBucket(entry.manager) : null;
            const managerHotelBucket = entry.managerId && entry.manager ? ensureManagerHotelBucket(entry.hotel, entry.manager) : null;
            if (managerBucket) {
                managerBucket.hotels.add(entry.hotel.name);
            }

            applyRankingAmount(hotelBucket, entry);
            if (managerBucket) {
                applyRankingAmount(managerBucket, entry);
            }
            if (managerHotelBucket) {
                applyRankingAmount(managerHotelBucket, entry);
            }
        }

        for (const stay of rankingStays) {
            const nights = overlapNights(stay.scheduledCheckIn, stay.scheduledCheckOut, rankingRangeStart, rankingRangeEnd);
            const hotelBucket = ensureHotelBucket(stay.hotel);
            hotelBucket.stays += 1;
            hotelBucket.roomNights += nights;

            if (stay.shift?.managerId && stay.shift.manager) {
                const managerBucket = ensureManagerBucket(stay.shift.manager);
                const managerHotelBucket = ensureManagerHotelBucket(stay.hotel, stay.shift.manager);
                managerBucket.hotels.add(stay.hotel.name);
                managerBucket.stays += 1;
                managerBucket.roomNights += nights;
                managerHotelBucket.stays += 1;
                managerHotelBucket.roomNights += nights;
            }
        }

        for (const shift of rankingShifts) {
            const hotelBucket = hotelRankBuckets.get(shift.hotelId);
            if (hotelBucket) {
                hotelBucket.shifts += 1;
            }
            const managerBucket = ensureManagerBucket(shift.manager);
            const managerHotelBucket = ensureManagerHotelBucket(shift.hotel, shift.manager);
            managerBucket.hotels.add(shift.hotel.name);
            managerBucket.shifts += 1;
            managerHotelBucket.shifts += 1;
        }

        const rankingManagerIds = Array.from(managerRankBuckets.keys());
        const activeRankingAssignments = rankingManagerIds.length
            ? await prisma.hotelAssignment.findMany({
                where: {
                    userId: { in: rankingManagerIds },
                    isActive: true,
                    hotel: { country },
                },
                select: { userId: true, hotelId: true },
            })
            : [];
        const activeRankingManagerIds = new Set(activeRankingAssignments.map((assignment) => assignment.userId));
        const activeRankingManagerHotelKeys = new Set(
            activeRankingAssignments.map((assignment) => `${assignment.hotelId}:${assignment.userId}`)
        );

        const hotelBuckets = Array.from(hotelRankBuckets.values()).map((item) => {
            const net = item.revenue - item.expenses - item.payouts + item.adjustments;
            const expenseTotal = item.expenses + item.payouts;
            const possibleRoomNights = item.rooms * rankingDayCount;
            return {
                ...item,
                net,
                expenseTotal,
                revenuePerRoom: item.rooms > 0 ? Math.round(item.revenue / item.rooms) : item.revenue,
                averageStayRevenue: item.stays > 0 ? Math.round(item.revenue / item.stays) : 0,
                occupancyRate: possibleRoomNights > 0 ? Math.min(item.roomNights / possibleRoomNights, 1) : 0,
                expenseRatio: item.revenue > 0 ? expenseTotal / item.revenue : 0,
            };
        });
        const managerBuckets = Array.from(managerRankBuckets.values()).map((item) => {
            const net = item.revenue - item.expenses - item.payouts + item.adjustments;
            const expenseTotal = item.expenses + item.payouts;
            return {
                ...item,
                net,
                expenseTotal,
                revenuePerShift: item.shifts > 0 ? Math.round(item.revenue / item.shifts) : item.revenue,
                averageStayRevenue: item.stays > 0 ? Math.round(item.revenue / item.stays) : 0,
                expenseRatio: item.revenue > 0 ? expenseTotal / item.revenue : 0,
            };
        });

        const hotelMax = {
            revenue: Math.max(...hotelBuckets.map((item) => item.revenue), 0),
            net: Math.max(...hotelBuckets.map((item) => clampPositive(item.net)), 0),
            revenuePerRoom: Math.max(...hotelBuckets.map((item) => item.revenuePerRoom), 0),
        };
        const managerMax = {
            revenue: Math.max(...managerBuckets.map((item) => item.revenue), 0),
            net: Math.max(...managerBuckets.map((item) => clampPositive(item.net)), 0),
            revenuePerShift: Math.max(...managerBuckets.map((item) => item.revenuePerShift), 0),
            averageStayRevenue: Math.max(...managerBuckets.map((item) => item.averageStayRevenue), 0),
        };

        const hotelLeaders = hotelBuckets
            .map((item) => {
                const expenseControl = item.revenue > 0 ? Math.max(0, 1 - item.expenseRatio) : 0;
                const score = Math.round(
                    scorePart(item.revenue, hotelMax.revenue) * 35 +
                    scorePart(item.net, hotelMax.net) * 25 +
                    scorePart(item.revenuePerRoom, hotelMax.revenuePerRoom) * 20 +
                    item.occupancyRate * 15 +
                    expenseControl * 5
                );

                return {
                    id: item.id,
                    name: item.name,
                    currency: item.currency,
                    score,
                    revenue: item.revenue,
                    net: item.net,
                    expenses: item.expenseTotal,
                    rooms: item.rooms,
                    shifts: item.shifts,
                    stays: item.stays,
                    roomNights: item.roomNights,
                    revenuePerRoom: item.revenuePerRoom,
                    averageStayRevenue: item.averageStayRevenue,
                    occupancyRate: item.occupancyRate,
                    expenseRatio: item.expenseRatio,
                };
            })
            .sort((first, second) => second.score - first.score || second.revenue - first.revenue)
            .slice(0, 8);

        const managerLeaders = managerBuckets
            .map((item) => {
                const expenseControl = item.revenue > 0 ? Math.max(0, 1 - item.expenseRatio) : 0;
                const score = Math.round(
                    scorePart(item.revenue, managerMax.revenue) * 35 +
                    scorePart(item.net, managerMax.net) * 25 +
                    scorePart(item.revenuePerShift, managerMax.revenuePerShift) * 20 +
                    scorePart(item.averageStayRevenue, managerMax.averageStayRevenue) * 10 +
                    expenseControl * 10
                );

                return {
                    id: item.id,
                    name: item.name,
                    score,
                    revenue: item.revenue,
                    net: item.net,
                    expenses: item.expenseTotal,
                    shifts: item.shifts,
                    stays: item.stays,
                    roomNights: item.roomNights,
                    revenuePerShift: item.revenuePerShift,
                    averageStayRevenue: item.averageStayRevenue,
                    expenseRatio: item.expenseRatio,
                    hotels: Array.from(item.hotels).slice(0, 4),
                    isActive: activeRankingManagerIds.has(item.id),
                };
            })
            .sort((first, second) => second.score - first.score || second.revenue - first.revenue)
            .slice(0, 8);

        const managerHotelBuckets = Array.from(managerHotelRankBuckets.values()).map((item) => {
            const net = item.revenue - item.expenses - item.payouts + item.adjustments;
            const expenseTotal = item.expenses + item.payouts;
            return {
                ...item,
                net,
                expenseTotal,
                revenuePerShift: item.shifts > 0 ? Math.round(item.revenue / item.shifts) : item.revenue,
                averageStayRevenue: item.stays > 0 ? Math.round(item.revenue / item.stays) : 0,
                expenseRatio: item.revenue > 0 ? expenseTotal / item.revenue : 0,
            };
        });
        const managerHotelGroups = Array.from(
            managerHotelBuckets.reduce((groups, item) => {
                const list = groups.get(item.hotelId) ?? [];
                list.push(item);
                groups.set(item.hotelId, list);
                return groups;
            }, new Map<string, typeof managerHotelBuckets>())
        )
            .map(([hotelId, items]) => {
                const localMax = {
                    revenue: Math.max(...items.map((item) => item.revenue), 0),
                    net: Math.max(...items.map((item) => clampPositive(item.net)), 0),
                    revenuePerShift: Math.max(...items.map((item) => item.revenuePerShift), 0),
                    averageStayRevenue: Math.max(...items.map((item) => item.averageStayRevenue), 0),
                };
                const managers = items
                    .map((item) => {
                        const expenseControl = item.revenue > 0 ? Math.max(0, 1 - item.expenseRatio) : 0;
                        const score = Math.round(
                            scorePart(item.revenue, localMax.revenue) * 35 +
                            scorePart(item.net, localMax.net) * 25 +
                            scorePart(item.revenuePerShift, localMax.revenuePerShift) * 20 +
                            scorePart(item.averageStayRevenue, localMax.averageStayRevenue) * 10 +
                            expenseControl * 10
                        );

                        return {
                            id: item.managerId,
                            name: item.managerName,
                            score,
                            revenue: item.revenue,
                            net: item.net,
                            expenses: item.expenseTotal,
                            shifts: item.shifts,
                            stays: item.stays,
                            roomNights: item.roomNights,
                            revenuePerShift: item.revenuePerShift,
                            averageStayRevenue: item.averageStayRevenue,
                            expenseRatio: item.expenseRatio,
                            hotels: [item.hotelName],
                            isActive: activeRankingManagerHotelKeys.has(`${item.hotelId}:${item.managerId}`),
                        };
                    })
                    .sort((first, second) => second.score - first.score || second.revenue - first.revenue)
                    .slice(0, 4);

                return {
                    hotelId,
                    hotelName: items[0]?.hotelName ?? "Объект",
                    managers,
                };
            })
            .filter((group) => group.managers.length > 0)
            .sort((first, second) => {
                const firstScore = first.managers[0]?.score ?? 0;
                const secondScore = second.managers[0]?.score ?? 0;
                return secondScore - firstScore || first.hotelName.localeCompare(second.hotelName, "ru");
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
                const employeePayroll = hotel.employees
                    .filter((employee) => employee.payType === 'MONTHLY')
                    .reduce((sum, employee) => sum + employee.payAmount, 0);
                totals.payroll += employeePayroll;
                totals.other += hotel.plannedCostItems
                    .filter((item) => employeePayroll === 0 || item.kind !== 'PAYROLL')
                    .reduce((sum, item) => sum + item.monthlyAmount, 0);
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
            const employeePayroll = hotel.employees
                    .filter((employee) => employee.payType === 'MONTHLY')
                    .reduce((sum, employee) => sum + employee.payAmount, 0);
            const requiredRevenue =
                hotel.plannedCostItems
                    .filter((item) => employeePayroll === 0 || item.kind !== 'PAYROLL')
                    .reduce((sum, item) => sum + item.monthlyAmount, 0) +
                employeePayroll;
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
        const projectedNetProfit = projectedRevenue - monthlyRequiredRevenue;
        const uncalculatedEmployeeCount = targetHotels.reduce(
            (sum, hotel) => sum + hotel.employees.filter((employee) => employee.payType !== 'MONTHLY').length,
            0
        );
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

        const shiftBreakdownMap = new Map<string, {
            id: string;
            number: number;
            openedAt: Date;
            status: ShiftStatus;
            hotelId: string;
            hotelName: string;
            managerName: string;
            cashIn: number;
            cashOut: number;
            collections: number;
            payouts: number;
            adjustments: number;
            stays: number;
        }>();

        if (shiftIds.length > 0) {
            for (const shift of rankingShifts) {
                shiftBreakdownMap.set(shift.id, {
                    id: shift.id,
                    number: shift.number,
                    openedAt: shift.openedAt,
                    status: shift.status,
                    hotelId: shift.hotelId,
                    hotelName: shift.hotel.name,
                    managerName: shift.manager.displayName,
                    cashIn: 0,
                    cashOut: 0,
                    collections: 0,
                    payouts: 0,
                    adjustments: 0,
                    stays: 0,
                });
            }
            for (const entry of rankingLedgerEntries) {
                if (!entry.shiftId || !entry.shift) continue;
                const bucket = shiftBreakdownMap.get(entry.shiftId) ?? {
                    id: entry.shiftId,
                    number: entry.shift.number,
                    openedAt: entry.shift.openedAt,
                    status: entry.shift.status,
                    hotelId: entry.hotelId,
                    hotelName: entry.hotel.name,
                    managerName: entry.manager?.displayName ?? "Менеджер",
                    cashIn: 0,
                    cashOut: 0,
                    collections: 0,
                    payouts: 0,
                    adjustments: 0,
                    stays: 0,
                };
                if (entry.entryType === LedgerEntryType.CASH_IN) bucket.cashIn += entry.amount;
                else if (isCollectionLedgerEntry(entry)) bucket.collections += entry.amount;
                else if (entry.entryType === LedgerEntryType.CASH_OUT) bucket.cashOut += entry.amount;
                else if (entry.entryType === LedgerEntryType.MANAGER_PAYOUT) bucket.payouts += entry.amount;
                else if (entry.entryType === LedgerEntryType.ADJUSTMENT) bucket.adjustments += entry.amount;
                shiftBreakdownMap.set(entry.shiftId, bucket);
            }
            for (const stay of rankingStays) {
                if (!stay.shift?.id) continue;
                const bucket = shiftBreakdownMap.get(stay.shift.id);
                if (bucket) bucket.stays += 1;
            }
        }
        const shiftBreakdowns = Array.from(shiftBreakdownMap.values())
            .map((item) => ({ ...item, net: item.cashIn - item.cashOut - item.collections - item.payouts + item.adjustments }))
            .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());

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
                projectedNetProfit,
                uncalculatedEmployeeCount,
                onTrack: monthlyRequiredRevenue > 0 ? projectedRevenue >= monthlyRequiredRevenue : false,
            },
            dailySeries,
            breakdowns: shiftIds.length > 0 ? { shifts: shiftBreakdowns } : undefined,
            rankings: {
                period: {
                    startAt: rankingRangeStart,
                    endAt: rankingRangeEnd,
                    days: rankingDayCount,
                },
                hotels: hotelLeaders,
                managers: managerLeaders,
                managersByHotel: managerHotelGroups,
            },
            recentExpenses: recentExpenses.map(serializeExpenseEntry),
            recentExpensesMeta: {
                total: recentExpensesTotal,
                offset: 0,
                returned: recentExpenses.length,
                limit: EXPENSE_PAGE_SIZE,
                hasMore: recentExpenses.length < recentExpensesTotal,
                truncated: recentExpenses.length < recentExpensesTotal,
            },
        });
    } catch (error) {
        return handleApiError(error, "Failed to load overview");
    }
}
