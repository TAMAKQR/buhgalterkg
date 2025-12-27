import { NextRequest, NextResponse } from "next/server";
import { LedgerEntryType, Prisma, RoomStatus, ShiftStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertAdmin } from "@/lib/permissions";
import { getSessionUser } from "@/lib/server/session";

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

        const parseDateValue = (value: string | null, endOfDay = false) => {
            if (!value) {
                return undefined;
            }
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return undefined;
            }
            if (endOfDay) {
                date.setUTCHours(23, 59, 59, 999);
            } else {
                date.setUTCHours(0, 0, 0, 0);
            }
            return date;
        };

        const startDate = parseDateValue(searchParams.get("startDate")) ?? undefined;
        const endDate = parseDateValue(searchParams.get("endDate"), true) ?? undefined;

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
            prisma.room.count({ where: { status: { not: RoomStatus.AVAILABLE }, ...roomHotelFilter } }),
            prisma.shift.count({ where: { status: ShiftStatus.OPEN, ...shiftWhere } }),
            prisma.shift.findFirst({ where: shiftWhere, orderBy: { openedAt: "desc" }, select: { openedAt: true } }),
            prisma.cashEntry.groupBy({
                by: ["entryType"],
                orderBy: { entryType: "asc" },
                _sum: { amount: true },
                where: ledgerWhere,
            }),
        ]);

        const ledgerTotals: Record<LedgerEntryType, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0,
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }

        const totals = {
            cashIn: ledgerTotals[LedgerEntryType.CASH_IN],
            cashOut: ledgerTotals[LedgerEntryType.CASH_OUT],
            payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT],
            adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT],
        };

        const occupancyRate = totalRooms > 0 ? occupiedRooms / totalRooms : 0;

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
        });
    } catch (error) {
        console.error(error);
        return new NextResponse("Failed to load overview", { status: 500 });
    }
}
