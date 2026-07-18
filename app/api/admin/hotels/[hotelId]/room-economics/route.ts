import { LedgerEntryType, StayStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { isCollectionLedgerEntry } from '@/lib/ledger';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';
import {
    addDaysToDateKey,
    allocateMinorEvenly,
    allocateMonthlyAmountByDay,
    buildStayRoomSegments,
    calculateStayPeriodAllocation,
    compareDateKeys,
    dateKeyDayDifference,
    dateKeyInTimeZone,
    isDateKey,
    inclusiveDateKeys,
    percentMargin,
    periodDayCount,
    roomAtInstant,
} from '@/lib/room-economics';
import { parseDateOnly } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

const MAX_PERIOD_DAYS = 366;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
    from: z.string().regex(dateKeyPattern),
    to: z.string().regex(dateKeyPattern),
});

type RoomEconomicsRow = {
    id: string;
    label: string;
    floor: string | null;
    isActive: boolean;
    activeDays: number;
    occupiedNights: number;
    occupiedByNight: Map<string, number>;
    hasOccupancyConflict: boolean;
    stayIds: Set<string>;
    incompleteStayIds: Set<string>;
    earnedRevenue: number;
    cashReceived: number;
    directActualCost: number;
    sharedActualCost: number;
    plannedCost: number;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);

        const parsedQuery = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
        if (!parsedQuery.success) {
            return new NextResponse('Укажите корректный период', { status: 400 });
        }

        const { from, to } = parsedQuery.data;
        if (!isDateKey(from) || !isDateKey(to)) {
            return new NextResponse('Укажите существующие календарные даты', { status: 400 });
        }
        const periodDays = compareDateKeys(from, to) <= 0 ? periodDayCount(from, to) : 0;
        if (periodDays < 1 || periodDays > MAX_PERIOD_DAYS) {
            return new NextResponse('Период должен быть от 1 до 366 дней', { status: 400 });
        }

        const country = getCountryFromRequest(request);
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: {
                id: true,
                currency: true,
                timezone: true,
                monthlyPayrollCost: true,
                monthlyRentCost: true,
                monthlyUtilitiesCost: true,
                monthlySuppliesCost: true,
                monthlyOtherCost: true,
                rooms: {
                    orderBy: [{ isActive: 'desc' }, { label: 'asc' }],
                    select: {
                        id: true,
                        label: true,
                        floor: true,
                        isActive: true,
                        activityTrackedFrom: true,
                        activityPeriods: {
                            orderBy: { activeFrom: 'asc' },
                            select: { id: true, activeFrom: true, activeTo: true },
                        },
                    },
                },
            },
        });

        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });

        const periodStart = parseDateOnly(from, false, hotel.timezone);
        const periodEndExclusive = parseDateOnly(addDaysToDateKey(to, 1), false, hotel.timezone);
        if (!periodStart || !periodEndExclusive) {
            return new NextResponse('Не удалось определить границы периода', { status: 400 });
        }

        const activeRoomIdsAt = (instant: Date) => hotel.rooms
            .filter((room) => room.activityPeriods.some((period) => (
                period.activeFrom <= instant && (!period.activeTo || instant < period.activeTo)
            )))
            .map((room) => room.id);
        const reportDays = inclusiveDateKeys(from, to).map((dateKey) => {
            const startAt = parseDateOnly(dateKey, false, hotel.timezone);
            const endAt = parseDateOnly(addDaysToDateKey(dateKey, 1), false, hotel.timezone);
            if (!startAt || !endAt) {
                throw new Error(`Не удалось определить границы дня ${dateKey}`);
            }
            const activeRoomIds = hotel.rooms
                .filter((room) => room.activityPeriods.some((period) => (
                    period.activeFrom < endAt && (!period.activeTo || period.activeTo > startAt)
                )))
                .map((room) => room.id);
            return { dateKey, activeRoomIds };
        });
        const estimatedActivityRooms = hotel.rooms.filter((room) => (
            periodStart < room.activityTrackedFrom
            && room.activityPeriods.some((period) => (
                period.id.startsWith('legacy_')
                && period.activeFrom < periodEndExclusive
                && (!period.activeTo || period.activeTo > periodStart)
            ))
        )).length;

        const [stays, ledgerEntries] = await Promise.all([
            prisma.roomStay.findMany({
                where: {
                    hotelId: hotel.id,
                    OR: [
                        {
                            status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] },
                            OR: [
                                {
                                    scheduledCheckIn: { lt: periodEndExclusive },
                                    scheduledCheckOut: { gt: periodStart },
                                },
                                {
                                    actualCheckIn: { lt: periodEndExclusive },
                                    OR: [
                                        { actualCheckOut: { gt: periodStart } },
                                        { actualCheckOut: null },
                                    ],
                                },
                            ],
                        },
                        {
                            status: StayStatus.CANCELLED,
                            cancellationPaymentAction: 'RETAIN',
                            cancelledAt: { gte: periodStart, lt: periodEndExclusive },
                        },
                    ],
                },
                select: {
                    id: true,
                    roomId: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true,
                    actualCheckIn: true,
                    actualCheckOut: true,
                    status: true,
                    totalAmount: true,
                    amountPaid: true,
                    cashPaid: true,
                    cardPaid: true,
                    onlinePaid: true,
                    tariffPending: true,
                    cancellationPaymentAction: true,
                    cancellationAmount: true,
                    cancelledAt: true,
                    transfers: {
                        orderBy: { createdAt: 'asc' },
                        select: { fromRoomId: true, toRoomId: true, createdAt: true },
                    },
                },
            }),
            prisma.cashEntry.findMany({
                where: {
                    hotelId: hotel.id,
                    recordedAt: { gte: periodStart, lt: periodEndExclusive },
                    entryType: {
                        in: [
                            LedgerEntryType.CASH_IN,
                            LedgerEntryType.CASH_OUT,
                            LedgerEntryType.MANAGER_PAYOUT,
                        ],
                    },
                },
                select: {
                    id: true,
                    roomId: true,
                    stayId: true,
                    entryType: true,
                    amount: true,
                    note: true,
                    recordedAt: true,
                    expenseCategory: { select: { id: true, name: true } },
                    stay: {
                        select: {
                            roomId: true,
                            scheduledCheckIn: true,
                            scheduledCheckOut: true,
                            actualCheckIn: true,
                            actualCheckOut: true,
                            status: true,
                            transfers: {
                                orderBy: { createdAt: 'asc' },
                                select: { fromRoomId: true, toRoomId: true, createdAt: true },
                            },
                        },
                    },
                },
            }),
        ]);

        const rows = new Map<string, RoomEconomicsRow>(hotel.rooms.map((room) => {
            return [room.id, {
                id: room.id,
                label: room.label,
                floor: room.floor,
                isActive: room.isActive,
                activeDays: reportDays.reduce(
                    (count, day) => count + (day.activeRoomIds.includes(room.id) ? 1 : 0),
                    0,
                ),
                occupiedNights: 0,
                occupiedByNight: new Map<string, number>(),
                hasOccupancyConflict: false,
                stayIds: new Set<string>(),
                incompleteStayIds: new Set<string>(),
                earnedRevenue: 0,
                cashReceived: 0,
                directActualCost: 0,
                sharedActualCost: 0,
                plannedCost: 0,
            }];
        }));
        const incompleteStayIds = new Set<string>();

        const reportNow = new Date();
        for (const stay of stays) {
            if (stay.status === StayStatus.CANCELLED) {
                const confirmedPaid = (stay.cashPaid ?? 0) + (stay.cardPaid ?? 0);
                const retained = Math.min(stay.cancellationAmount ?? confirmedPaid, confirmedPaid);
                const row = rows.get(stay.roomId);
                if (row && retained > 0) {
                    row.earnedRevenue += retained;
                    row.stayIds.add(stay.id);
                }
                continue;
            }

            const tariffIncomplete = stay.tariffPending || stay.totalAmount == null || stay.totalAmount <= 0 ||
                (stay.amountPaid ?? 0) > stay.totalAmount;
            const lastEarnedKey = stay.status === StayStatus.CHECKED_IN
                ? dateKeyInTimeZone(reportNow, hotel.timezone)
                : to;
            const earnedTo = compareDateKeys(to, lastEarnedKey) <= 0 ? to : lastEarnedKey;
            if (compareDateKeys(from, earnedTo) > 0) continue;

            const effectiveCheckIn = stay.actualCheckIn ?? stay.scheduledCheckIn;
            const naturalCheckOut = stay.actualCheckOut ?? stay.scheduledCheckOut;
            const effectiveCheckOut = stay.status === StayStatus.CHECKED_IN && naturalCheckOut < reportNow
                ? reportNow
                : naturalCheckOut;
            if (effectiveCheckOut <= effectiveCheckIn) {
                incompleteStayIds.add(stay.id);
                const row = rows.get(stay.roomId);
                row?.incompleteStayIds.add(stay.id);
                continue;
            }

            const allocation = calculateStayPeriodAllocation({
                roomId: stay.roomId,
                scheduledCheckIn: effectiveCheckIn,
                scheduledCheckOut: effectiveCheckOut,
                actualCheckIn: null,
                actualCheckOut: null,
                transfers: stay.transfers,
                totalAmount: tariffIncomplete ? null : stay.totalAmount,
                timezone: hotel.timezone,
                fromKey: from,
                toKey: earnedTo,
            });

            if (tariffIncomplete && allocation.occupiedNights > 0) incompleteStayIds.add(stay.id);
            const touchedRoomIds = new Set([
                ...Object.keys(allocation.roomAmounts),
                ...Object.keys(allocation.roomOccupiedNights),
            ]);
            for (const roomId of touchedRoomIds) {
                const row = rows.get(roomId);
                if (!row) continue;
                row.earnedRevenue += allocation.roomAmounts[roomId] ?? 0;
                for (const [nightKey, occupiedFraction] of Object.entries(allocation.roomNightOccupancy[roomId] ?? {})) {
                    const existingFraction = row.occupiedByNight.get(nightKey) ?? 0;
                    if (existingFraction + occupiedFraction > 1.000001) row.hasOccupancyConflict = true;
                    row.occupiedByNight.set(nightKey, Math.min(existingFraction + occupiedFraction, 1));
                }
                row.stayIds.add(stay.id);
                if (tariffIncomplete) row.incompleteStayIds.add(stay.id);
            }
        }

        let occupancyConflictRooms = 0;
        for (const row of rows.values()) {
            row.occupiedNights = Array.from(row.occupiedByNight.values()).reduce((sum, value) => sum + value, 0);
            if (row.hasOccupancyConflict) occupancyConflictRooms += 1;
        }

        let sharedActualCost = 0;
        const distributeSharedActualCost = (amount: number, recordedAt: Date) => {
            sharedActualCost += amount;
            const activeRoomIds = activeRoomIdsAt(recordedAt);
            if (!activeRoomIds.length) return;
            const allocation = allocateMinorEvenly(
                amount,
                activeRoomIds,
                Math.trunc(recordedAt.getTime() / 60_000),
            );
            for (const [roomId, allocatedAmount] of Object.entries(allocation)) {
                const row = rows.get(roomId);
                if (row) row.sharedActualCost += allocatedAmount;
            }
        };
        for (const entry of ledgerEntries) {
            if (entry.stay) {
                if (entry.entryType !== LedgerEntryType.CASH_IN && entry.entryType !== LedgerEntryType.CASH_OUT) continue;
                if (isCollectionLedgerEntry(entry)) continue;
                const direction = entry.entryType === LedgerEntryType.CASH_IN ? 1 : -1;
                const timelineStart = entry.stay.actualCheckIn ?? entry.stay.scheduledCheckIn;
                const naturalTimelineEnd = entry.stay.actualCheckOut ?? entry.stay.scheduledCheckOut;
                const timelineEnd = entry.stay.status === StayStatus.CHECKED_IN
                    ? new Date(Math.max(naturalTimelineEnd.getTime(), reportNow.getTime(), entry.recordedAt.getTime() + 1))
                    : new Date(Math.max(naturalTimelineEnd.getTime(), timelineStart.getTime() + 1));
                const staySegments = buildStayRoomSegments({
                    ...entry.stay,
                    scheduledCheckIn: timelineStart,
                    scheduledCheckOut: timelineEnd,
                    actualCheckIn: null,
                    actualCheckOut: null,
                });
                const firstSegment = staySegments[0];
                const lastSegment = staySegments[staySegments.length - 1];
                const roomId = roomAtInstant(staySegments, entry.recordedAt)
                    ?? (firstSegment && entry.recordedAt < firstSegment.startAt
                        ? firstSegment.roomId
                        : lastSegment?.roomId)
                    ?? entry.stay.roomId;
                const row = rows.get(roomId);
                if (row) row.cashReceived += direction * entry.amount;
                continue;
            }

            if (entry.entryType === LedgerEntryType.CASH_OUT) {
                if (isCollectionLedgerEntry(entry)) continue;
                if (entry.roomId && rows.has(entry.roomId)) {
                    rows.get(entry.roomId)!.directActualCost += entry.amount;
                } else {
                    distributeSharedActualCost(entry.amount, entry.recordedAt);
                }
            } else if (entry.entryType === LedgerEntryType.MANAGER_PAYOUT) {
                distributeSharedActualCost(entry.amount, entry.recordedAt);
            }
        }

        const monthlyPlan = hotel.monthlyPayrollCost + hotel.monthlyRentCost + hotel.monthlyUtilitiesCost +
            hotel.monthlySuppliesCost + hotel.monthlyOtherCost;
        const plannedByDay = allocateMonthlyAmountByDay(monthlyPlan, from, to);
        let plannedCost = 0;
        for (const day of reportDays) {
            const dayAmount = plannedByDay[day.dateKey] ?? 0;
            plannedCost += dayAmount;
            if (!day.activeRoomIds.length) continue;
            const allocation = allocateMinorEvenly(
                dayAmount,
                day.activeRoomIds,
                dateKeyDayDifference('1970-01-01', day.dateKey),
            );
            for (const [roomId, amount] of Object.entries(allocation)) {
                const row = rows.get(roomId);
                if (row) row.plannedCost += amount;
            }
        }

        const rawRooms = Array.from(rows.values());
        const serializedRooms = rawRooms
            .filter((row) => row.isActive || row.earnedRevenue !== 0 || row.cashReceived !== 0 ||
                row.directActualCost !== 0 || row.sharedActualCost !== 0 || row.plannedCost !== 0)
            .map((row) => {
                const actualCost = row.directActualCost + row.sharedActualCost;
                const actualProfit = row.earnedRevenue - actualCost;
                const plannedProfit = row.earnedRevenue - row.plannedCost;
                return {
                    id: row.id,
                    label: row.label,
                    floor: row.floor,
                    isActive: row.isActive,
                    activeDays: row.activeDays,
                    occupiedNights: Math.round(row.occupiedNights * 10) / 10,
                    stayCount: row.stayIds.size,
                    earnedRevenue: row.earnedRevenue,
                    cashReceived: row.cashReceived,
                    directActualCost: row.directActualCost,
                    sharedActualCost: row.sharedActualCost,
                    actualCost,
                    plannedCost: row.plannedCost,
                    actualProfit,
                    plannedProfit,
                    margin: percentMargin(actualProfit, row.earnedRevenue),
                    incompleteStays: row.incompleteStayIds.size,
                };
            });

        const earnedRevenue = rawRooms.reduce((sum, room) => sum + room.earnedRevenue, 0);
        const cashReceived = rawRooms.reduce((sum, room) => sum + room.cashReceived, 0);
        const directActualCost = rawRooms.reduce((sum, room) => sum + room.directActualCost, 0);
        const assignedActualCost = rawRooms.reduce((sum, room) => sum + room.directActualCost + room.sharedActualCost, 0);
        const assignedPlannedCost = rawRooms.reduce((sum, room) => sum + room.plannedCost, 0);
        const actualCost = directActualCost + sharedActualCost;
        const actualProfit = earnedRevenue - actualCost;
        const plannedProfit = earnedRevenue - plannedCost;
        const occupiedNights = rawRooms.reduce((sum, room) => sum + room.occupiedNights, 0);

        return NextResponse.json({
            period: { from, to, days: periodDays },
            hotel: {
                monthlyPayrollCost: hotel.monthlyPayrollCost,
                monthlyRentCost: hotel.monthlyRentCost,
                monthlyUtilitiesCost: hotel.monthlyUtilitiesCost,
                monthlySuppliesCost: hotel.monthlySuppliesCost,
                monthlyOtherCost: hotel.monthlyOtherCost,
            },
            totals: {
                earnedRevenue,
                cashReceived,
                actualCost,
                plannedCost,
                actualProfit,
                plannedProfit,
                margin: percentMargin(actualProfit, earnedRevenue),
                occupiedNights: Math.round(occupiedNights * 10) / 10,
                incompleteStays: incompleteStayIds.size,
                occupancyConflictRooms,
                estimatedActivityRooms,
                unallocatedActualCost: actualCost - assignedActualCost,
                unallocatedPlannedCost: plannedCost - assignedPlannedCost,
            },
            rooms: serializedRooms,
        });
    } catch (error) {
        return handleApiError(error, 'Failed to calculate room economics');
    }
}
