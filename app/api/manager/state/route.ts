import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { isCollectionLedgerEntry, isStayIncomeNote } from '@/lib/ledger';
import { addToCurrencyMap, normalizeCurrencyCode } from '@/lib/currency';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const hotelId = request.nextUrl.searchParams.get('hotelId') ?? session.hotels[0]?.id;

        if (!hotelId) {
            return new NextResponse('Manager is not assigned to a hotel', { status: 400 });
        }

        assertHotelOperatorAccess(session, hotelId);

        const activeBookingCutoff = new Date();
        const requestedBoardOffset = Number(request.nextUrl.searchParams.get('boardOffset') ?? '0');
        const boardOffsetDays = Number.isSafeInteger(requestedBoardOffset)
            ? Math.min(Math.max(requestedBoardOffset, -366), 366)
            : 0;
        // The client board displays 14 hotel days. One guard day on each side
        // keeps timezone/DST boundaries safe without loading every future stay.
        const boardRangeStart = new Date(activeBookingCutoff.getTime() + (boardOffsetDays - 1) * 86_400_000);
        const boardRangeEnd = new Date(activeBookingCutoff.getTime() + (boardOffsetDays + 15) * 86_400_000);

        const [nearestScheduledRows, hotel, assignment, bonusTiers, shift] = await Promise.all([
            prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT DISTINCT ON ("roomId") "id"
                FROM "RoomStay"
                WHERE "hotelId" = ${hotelId}
                  AND "status" = CAST(${StayStatus.SCHEDULED} AS "StayStatus")
                  AND "scheduledCheckOut" >= ${activeBookingCutoff}
                ORDER BY "roomId", "scheduledCheckIn" ASC, "createdAt" ASC
            `),
            prisma.hotel.findUnique({
                where: { id: hotelId },
                select: {
                    id: true,
                    name: true,
                    address: true,
                    timezone: true,
                    currency: true,
                    usesExtranets: true,
                    extranetNames: true,
                    hasMealPlan: true,
                    allowGroupStays: true,
                    allowPostpaidStays: true,
                    allowOnlinePayments: true,
                    guestQrEnabled: true,
                    expenseCategories: {
                        orderBy: { name: 'asc' },
                        select: { id: true, name: true }
                    },
                    employees: {
                        where: { isActive: true, payType: 'SHIFT' },
                        orderBy: { fullName: 'asc' },
                        select: {
                            id: true,
                            fullName: true,
                            position: true,
                            payAmount: true,
                            turnoverThreshold: true,
                            highPayAmount: true
                        }
                    },
                    rooms: {
                        orderBy: { label: 'asc' },
                        select: {
                            id: true,
                            label: true,
                            floor: true,
                            status: true,
                            currentStayId: true
                        }
                    }
                }
            }),
            prisma.hotelAssignment.findFirst({
                where: { hotelId, userId: session.id, isActive: true },
                select: {
                    shiftPayAmount: true,
                    revenueSharePct: true,
                    canEditBookings: true,
                    canEditStayPayments: true,
                    canCancelBookings: true
                }
            }),
            prisma.bonusTier.findMany({
                where: { hotelId },
                orderBy: { threshold: 'asc' }
            }),
            prisma.shift.findFirst({
                where: { hotelId, status: ShiftStatus.OPEN },
                orderBy: { openedAt: 'desc' }
            })
        ]);

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        if (shift && shift.managerId !== session.id) {
            return new NextResponse('Смена уже ведётся другим менеджером. Дождитесь закрытия.', { status: 409 });
        }

        const nearestScheduledIds = nearestScheduledRows.map((row) => row.id);
        const activeStays = await prisma.roomStay.findMany({
            where: {
                hotelId,
                OR: [
                    { status: StayStatus.CHECKED_IN },
                    {
                        status: StayStatus.SCHEDULED,
                        scheduledCheckIn: { lt: boardRangeEnd },
                        scheduledCheckOut: { gt: boardRangeStart }
                    },
                    ...(nearestScheduledIds.length ? [{ id: { in: nearestScheduledIds } }] : [])
                ]
            },
            orderBy: [
                { roomId: 'asc' },
                { scheduledCheckIn: 'asc' }
            ],
            select: {
                id: true,
                roomId: true,
                guestName: true,
                guestPhone: true,
                companyName: true,
                scheduledCheckIn: true,
                scheduledCheckOut: true,
                status: true,
                amountPaid: true,
                totalAmount: true,
                paymentMethod: true,
                cashPaid: true,
                cardPaid: true,
                onlinePaid: true,
                tariffPending: true,
                groupRef: true,
                bookingSource: true,
                bookingNumber: true,
                mealPlan: true,
                notes: true
            }
        });
        const staysByRoom = new Map<string, typeof activeStays>();
        for (const stay of activeStays) {
            const roomStays = staysByRoom.get(stay.roomId) ?? [];
            roomStays.push(stay);
            staysByRoom.set(stay.roomId, roomStays);
        }

        let shiftCash = shift ? shift.openingCash : null;
        let shiftPayments: { cash: number; card: number; total: number } | null = null;
        let shiftExpenses: { total: number; cash: number; card: number } | null = null;
        let shiftBalances: { cash: number; card: number; total: number } | null = null;
        let shiftCashByCurrency: Array<{ currency: string; amount: number }> | null = null;
        let managerPayoutTotals: Record<LedgerEntryType, number> | null = null;
        let shiftStayRevenue = 0;
        let shiftLedgerTruncated = false;
        let shiftLedger: Array<{
            id: string;
            entryType: LedgerEntryType;
            method: PaymentMethod;
            amount: number;
            originalAmount: number | null;
            originalCurrency: string;
            exchangeRate: number | null;
            note: string | null;
            category: {
                id: string;
                name: string;
            } | null;
            recordedAt: Date;
        }> = [];
        if (shift) {
            // Keep the UI ledger bounded. Most shifts need one query; only a
            // shift with more than 100 operations gets a second lightweight
            // pass so all financial totals remain exact.
            const ledgerWindow = await prisma.cashEntry.findMany({
                where: { shiftId: shift.id },
                orderBy: { recordedAt: 'desc' },
                take: 101,
                select: {
                    id: true,
                    entryType: true,
                    method: true,
                    amount: true,
                    originalAmount: true,
                    originalCurrency: true,
                    exchangeRate: true,
                    note: true,
                    expenseCategory: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    recordedAt: true
                }
            });
            shiftLedgerTruncated = ledgerWindow.length > 100;
            const ledgerEntries = ledgerWindow.slice(0, 100);
            const summaryEntries = shiftLedgerTruncated
                ? await prisma.cashEntry.findMany({
                    where: { shiftId: shift.id },
                    select: {
                        entryType: true,
                        method: true,
                        amount: true,
                        originalAmount: true,
                        originalCurrency: true,
                        note: true,
                        expenseCategory: {
                            select: { name: true }
                        }
                    }
                })
                : ledgerEntries;

            const ledgerTotals: Record<LedgerEntryType, number> = {
                [LedgerEntryType.CASH_IN]: 0,
                [LedgerEntryType.CASH_OUT]: 0,
                [LedgerEntryType.MANAGER_PAYOUT]: 0,
                [LedgerEntryType.ADJUSTMENT]: 0
            };
            const paymentTotals: Record<PaymentMethod, number> = {
                [PaymentMethod.CASH]: 0,
                [PaymentMethod.CARD]: 0
            };
            const hotelCurrency = normalizeCurrencyCode(hotel.currency, 'KGS');
            const physicalCashBalances: Record<string, number> = {
                [hotelCurrency]: shift.openingCash,
                USD: shift.openingCashUsd ?? 0
            };
            const expenseTotals = { total: 0, cash: 0, card: 0 };
            let cardBalance = 0;
            for (const entry of summaryEntries) {
                ledgerTotals[entry.entryType] += entry.amount;
                if (
                    entry.entryType === LedgerEntryType.CASH_IN ||
                    entry.entryType === LedgerEntryType.ADJUSTMENT
                ) {
                    paymentTotals[entry.method] += entry.amount;
                }
                if (
                    (entry.entryType === LedgerEntryType.CASH_OUT && !isCollectionLedgerEntry(entry)) ||
                    entry.entryType === LedgerEntryType.MANAGER_PAYOUT
                ) {
                    expenseTotals.total += entry.amount;
                    if (entry.method === PaymentMethod.CASH) expenseTotals.cash += entry.amount;
                    else if (entry.method === PaymentMethod.CARD) expenseTotals.card += entry.amount;
                }
                if (entry.entryType === LedgerEntryType.CASH_IN && isStayIncomeNote(entry.note)) {
                    shiftStayRevenue += entry.amount;
                }

                const signedAmount = (() => {
                    switch (entry.entryType) {
                        case LedgerEntryType.CASH_IN:
                        case LedgerEntryType.ADJUSTMENT:
                            return entry.amount;
                        case LedgerEntryType.CASH_OUT:
                        case LedgerEntryType.MANAGER_PAYOUT:
                            return -entry.amount;
                        default:
                            return 0;
                    }
                })();

                if (entry.method === PaymentMethod.CARD) {
                    cardBalance += signedAmount;
                    continue;
                }

                const originalAmount = entry.originalAmount ?? entry.amount;
                const signedOriginalAmount = signedAmount >= 0 ? originalAmount : -originalAmount;
                addToCurrencyMap(physicalCashBalances, entry.originalCurrency, signedOriginalAmount);
            }

            shiftPayments = {
                cash: paymentTotals[PaymentMethod.CASH],
                card: paymentTotals[PaymentMethod.CARD],
                total: paymentTotals[PaymentMethod.CASH] + paymentTotals[PaymentMethod.CARD]
            };
            shiftExpenses = expenseTotals;
            managerPayoutTotals = ledgerTotals;
            shiftLedger = ledgerEntries.map((entry) => ({
                id: entry.id,
                entryType: entry.entryType,
                method: entry.method,
                amount: entry.amount,
                originalAmount: entry.originalAmount,
                originalCurrency: entry.originalCurrency,
                exchangeRate: entry.exchangeRate,
                note: entry.note,
                category: entry.expenseCategory
                    ? {
                        id: entry.expenseCategory.id,
                        name: entry.expenseCategory.name
                    }
                    : null,
                recordedAt: entry.recordedAt
            }));

            const cashBalance = physicalCashBalances[hotelCurrency] ?? 0;
            shiftCash = cashBalance;
            shiftBalances = {
                cash: cashBalance,
                card: cardBalance,
                total: cashBalance + cardBalance
            };
            shiftCashByCurrency = Object.entries(physicalCashBalances)
                .filter(([, amount]) => amount !== 0)
                .map(([currency, amount]) => ({ currency, amount }));
        }

        const serializedLedger = shiftLedger.map((entry) => ({
            ...entry,
            recordedAt: entry.recordedAt.toISOString()
        }));

        const shiftBonus = shift && shiftStayRevenue > 0
            ? calculateBonusFromTiers(shiftStayRevenue, bonusTiers)
            : null;

        const payoutSummary = (() => {
            if (!assignment || !shift) {
                return null;
            }
            return calculateManagerPayout({
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct,
                bonusAmount: shiftBonus?.computed ?? 0,
                cashIn: shiftPayments?.total ?? 0,
                payouts: managerPayoutTotals?.[LedgerEntryType.MANAGER_PAYOUT] ?? 0,
            });
        })();

        const response = {
            hotel: {
                id: hotel.id,
                name: hotel.name,
                address: hotel.address,
                timezone: hotel.timezone,
                currency: hotel.currency,
                usesExtranets: hotel.usesExtranets,
                extranetNames: hotel.extranetNames,
                hasMealPlan: hotel.hasMealPlan,
                allowGroupStays: hotel.allowGroupStays,
                allowPostpaidStays: hotel.allowPostpaidStays,
                allowOnlinePayments: hotel.allowOnlinePayments,
                guestQrEnabled: hotel.guestQrEnabled
            },
            expenseCategories: hotel.expenseCategories.map((category) => ({
                id: category.id,
                name: category.name
            })),
            employees: hotel.employees,
            shift,
            shiftCash,
            shiftBalances,
            shiftCashByCurrency,
            shiftExpenses,
            shiftPayments,
            shiftStayRevenue,
            shiftLedger: serializedLedger,
            shiftLedgerTruncated,
            rooms: hotel.rooms.map((room) => {
                const roomStays = staysByRoom.get(room.id) ?? [];
                const linkedStay = room.currentStayId
                    ? roomStays.find((stay) => stay.id === room.currentStayId)
                    : null;
                const checkedInStay = roomStays.find((stay) => stay.status === StayStatus.CHECKED_IN) ?? null;
                const scheduledStay = roomStays.find((stay) => stay.status === StayStatus.SCHEDULED) ?? null;
                const primaryStay = (room.status === RoomStatus.OCCUPIED ? linkedStay ?? checkedInStay : null) ?? scheduledStay ?? roomStays[0] ?? null;
                const serializeStay = (stay: typeof activeStays[number]) => ({
                    id: stay.id,
                    guestName: stay.guestName,
                    guestPhone: stay.guestPhone,
                    companyName: stay.companyName,
                    scheduledCheckIn: stay.scheduledCheckIn,
                    scheduledCheckOut: stay.scheduledCheckOut,
                    status: stay.status,
                    amountPaid: stay.amountPaid,
                    totalAmount: stay.totalAmount,
                    paymentMethod: stay.paymentMethod,
                    cashPaid: stay.cashPaid,
                    cardPaid: stay.cardPaid,
                    onlinePaid: stay.onlinePaid,
                    tariffPending: stay.tariffPending,
                    groupRef: stay.groupRef,
                    bookingSource: stay.bookingSource,
                    bookingNumber: stay.bookingNumber,
                    mealPlan: stay.mealPlan,
                    notes: stay.notes
                });

                return {
                    id: room.id,
                    label: room.label,
                    floor: room.floor,
                    status: room.status,
                    stay: primaryStay
                    ? {
                        ...serializeStay(primaryStay)
                    }
                    : null,
                    // `stay` is deliberately not repeated in `stays`; the
                    // client combines both fields when it needs the board list.
                    stays: roomStays
                        .filter((stay) => stay.id !== primaryStay?.id)
                        .map(serializeStay)
                };
            }),
            compensation: assignment
                ? {
                    shiftPayAmount: assignment.shiftPayAmount,
                    revenueSharePct: assignment.revenueSharePct,
                    canEditBookings: assignment.canEditBookings,
                    canEditStayPayments: assignment.canEditStayPayments,
                    canCancelBookings: assignment.canCancelBookings,
                    expectedPayout: payoutSummary?.expected ?? null,
                    paidPayout: payoutSummary?.paid ?? null,
                    pendingPayout: payoutSummary?.pending ?? null,
                    bonus: shiftBonus?.computed ?? null,
                    bonusThreshold: shiftBonus?.threshold ?? null
                }
                : null
        };

        return NextResponse.json(response);
    } catch (error) {
        return handleApiError(error, 'Failed to load manager state');
    }
}
