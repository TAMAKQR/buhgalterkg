import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { isCollectionLedgerEntry } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

const isStayIncomeNote = (note: string | null) => {
    const normalized = note?.trim().toLocaleLowerCase('ru-RU') ?? '';
    return normalized.startsWith('заселение') || normalized.startsWith('продление');
};

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const hotelId = request.nextUrl.searchParams.get('hotelId') ?? session.hotels[0]?.id;

        if (!hotelId) {
            return new NextResponse('Manager is not assigned to a hotel', { status: 400 });
        }

        assertHotelAccess(session, hotelId);

        const hotel = await prisma.hotel.findUnique({
            where: { id: hotelId },
            include: {
                expenseCategories: {
                    orderBy: { name: 'asc' }
                },
                rooms: {
                    include: {
                        stays: {
                            where: { status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
                            orderBy: { scheduledCheckIn: 'asc' },
                            take: 40
                        }
                    },
                    orderBy: { label: 'asc' }
                }
            }
        });

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const [assignment, bonusTiers] = await Promise.all([
            prisma.hotelAssignment.findFirst({
                where: { hotelId, userId: session.id, isActive: true },
                select: { shiftPayAmount: true, revenueSharePct: true, canEditStayPayments: true }
            }),
            prisma.bonusTier.findMany({
                where: { hotelId },
                orderBy: { threshold: 'asc' }
            })
        ]);

        const shift = await prisma.shift.findFirst({
            where: { hotelId, status: ShiftStatus.OPEN },
            orderBy: { openedAt: 'desc' }
        });

        if (shift && shift.managerId !== session.id) {
            return new NextResponse('Смена уже ведётся другим менеджером. Дождитесь закрытия.', { status: 409 });
        }

        let shiftCash = shift ? shift.openingCash : null;
        let shiftPayments: { cash: number; card: number; total: number } | null = null;
        let shiftExpenses: { total: number; cash: number; card: number } | null = null;
        let shiftBalances: { cash: number; card: number; total: number } | null = null;
        let managerPayoutTotals: Record<LedgerEntryType, number> | null = null;
        let shiftLedger: Array<{
            id: string;
            entryType: LedgerEntryType;
            method: PaymentMethod;
            amount: number;
            note: string | null;
            category: {
                id: string;
                name: string;
            } | null;
            recordedAt: Date;
        }> = [];
        if (shift) {
            const [ledgerGroups, paymentGroups, ledgerEntries] = await Promise.all([
                prisma.cashEntry.groupBy({
                    by: ['entryType'],
                    where: { shiftId: shift.id },
                    _sum: { amount: true }
                }),
                prisma.cashEntry.groupBy({
                    by: ['method'],
                    where: {
                        shiftId: shift.id,
                        entryType: { in: [LedgerEntryType.CASH_IN, LedgerEntryType.ADJUSTMENT] }
                    },
                    _sum: { amount: true }
                }),
                prisma.cashEntry.findMany({
                    where: { shiftId: shift.id },
                    orderBy: { recordedAt: 'desc' },
                    select: {
                        id: true,
                        entryType: true,
                        method: true,
                        amount: true,
                        note: true,
                        expenseCategory: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        recordedAt: true
                    }
                })
            ]);

            const ledgerTotals: Record<LedgerEntryType, number> = {
                [LedgerEntryType.CASH_IN]: 0,
                [LedgerEntryType.CASH_OUT]: 0,
                [LedgerEntryType.MANAGER_PAYOUT]: 0,
                [LedgerEntryType.ADJUSTMENT]: 0
            };

            for (const group of ledgerGroups) {
                ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
            }

            const paymentTotals: Record<PaymentMethod, number> = {
                [PaymentMethod.CASH]: 0,
                [PaymentMethod.CARD]: 0
            };

            for (const group of paymentGroups) {
                paymentTotals[group.method] = group._sum?.amount ?? 0;
            }

            shiftPayments = {
                cash: paymentTotals[PaymentMethod.CASH],
                card: paymentTotals[PaymentMethod.CARD],
                total: paymentTotals[PaymentMethod.CASH] + paymentTotals[PaymentMethod.CARD]
            };

            shiftLedger = ledgerEntries.map((entry) => ({
                id: entry.id,
                entryType: entry.entryType,
                method: entry.method,
                amount: entry.amount,
                note: entry.note,
                category: entry.expenseCategory
                    ? {
                        id: entry.expenseCategory.id,
                        name: entry.expenseCategory.name
                    }
                    : null,
                recordedAt: entry.recordedAt
            }));
            shiftExpenses = ledgerEntries.reduce(
                (totals, entry) => {
                    if (
                        (entry.entryType === LedgerEntryType.CASH_OUT && !isCollectionLedgerEntry(entry)) ||
                        entry.entryType === LedgerEntryType.MANAGER_PAYOUT
                    ) {
                        totals.total += entry.amount;
                        if (entry.method === PaymentMethod.CASH) {
                            totals.cash += entry.amount;
                        } else if (entry.method === PaymentMethod.CARD) {
                            totals.card += entry.amount;
                        }
                    }
                    return totals;
                },
                { total: 0, cash: 0, card: 0 }
            );
            managerPayoutTotals = ledgerTotals;

            const balances = ledgerEntries.reduce(
                (acc, entry) => {
                    const signedAmount = (() => {
                        switch (entry.entryType) {
                            case LedgerEntryType.CASH_IN:
                                return entry.amount;
                            case LedgerEntryType.ADJUSTMENT:
                                return entry.amount;
                            case LedgerEntryType.CASH_OUT:
                            case LedgerEntryType.MANAGER_PAYOUT:
                                return -entry.amount;
                            default:
                                return 0;
                        }
                    })();

                    if (entry.method === PaymentMethod.CASH) {
                        acc.cash += signedAmount;
                    } else if (entry.method === PaymentMethod.CARD) {
                        acc.card += signedAmount;
                    }

                    return acc;
                },
                { cash: shift.openingCash, card: 0 }
            );

            shiftCash = balances.cash;
            shiftBalances = {
                cash: balances.cash,
                card: balances.card,
                total: balances.cash + balances.card
            };
        }

        const serializedLedger = shiftLedger.map((entry) => ({
            ...entry,
            recordedAt: entry.recordedAt.toISOString()
        }));

        const shiftStayRevenue = shiftLedger.reduce((total, entry) => {
            if (entry.entryType !== LedgerEntryType.CASH_IN) {
                return total;
            }

            return isStayIncomeNote(entry.note) ? total + entry.amount : total;
        }, 0);

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
                extranetNames: hotel.extranetNames
            },
            expenseCategories: hotel.expenseCategories.map((category) => ({
                id: category.id,
                name: category.name
            })),
            shift,
            shiftCash,
            shiftBalances,
            shiftExpenses,
            shiftPayments,
            shiftStayRevenue,
            shiftLedger: serializedLedger,
            rooms: hotel.rooms.map((room) => {
                const linkedStay = room.currentStayId
                    ? room.stays.find((stay) => stay.id === room.currentStayId)
                    : null;
                const checkedInStay = room.stays.find((stay) => stay.status === StayStatus.CHECKED_IN) ?? null;
                const scheduledStay = room.stays.find((stay) => stay.status === StayStatus.SCHEDULED) ?? null;
                const primaryStay = (room.status === RoomStatus.OCCUPIED ? linkedStay ?? checkedInStay : null) ?? scheduledStay ?? room.stays[0] ?? null;
                const serializeStay = (stay: typeof room.stays[number]) => ({
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
                    stays: room.stays.map(serializeStay)
                };
            }),
            compensation: assignment
                ? {
                    shiftPayAmount: assignment.shiftPayAmount,
                    revenueSharePct: assignment.revenueSharePct,
                    canEditStayPayments: assignment.canEditStayPayments,
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
