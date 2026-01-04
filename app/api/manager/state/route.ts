import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod, ShiftStatus, UserRole } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

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
                rooms: {
                    include: {
                        stays: {
                            where: { status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
                            orderBy: { scheduledCheckIn: 'desc' },
                            take: 1
                        }
                    },
                    orderBy: { label: 'asc' }
                }
            }
        });

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const [assignment, managerAssignments, categories, products] = await Promise.all([
            prisma.hotelAssignment.findFirst({
                where: { hotelId, userId: session.id, isActive: true },
                select: { shiftPayAmount: true, revenueSharePct: true }
            }),
            prisma.hotelAssignment.findMany({
                where: { hotelId, isActive: true, role: UserRole.MANAGER },
                include: {
                    user: {
                        select: {
                            id: true,
                            displayName: true,
                            username: true
                        }
                    }
                }
            }),
            prisma.productCategory.findMany({
                where: { hotelId },
                include: {
                    _count: { select: { products: true } }
                },
                orderBy: { name: 'asc' }
            }),
            prisma.product.findMany({
                where: { hotelId, isActive: true },
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                },
                orderBy: [{ name: 'asc' }]
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
                    where: { shiftId: shift.id, entryType: LedgerEntryType.CASH_IN },
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

            shiftLedger = ledgerEntries;
            shiftExpenses = ledgerEntries.reduce(
                (totals, entry) => {
                    if (
                        entry.entryType === LedgerEntryType.CASH_OUT ||
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

        const payoutSummary = (() => {
            if (!assignment || !shift) {
                return null;
            }
            const fixed = assignment.shiftPayAmount ?? 0;
            const sharePct = assignment.revenueSharePct ?? 0;
            const turnover = shiftPayments?.total ?? 0;
            const shareComponent = sharePct ? Math.round((turnover * sharePct) / 100) : 0;
            const expected = fixed + shareComponent;
            const paid = managerPayoutTotals?.[LedgerEntryType.MANAGER_PAYOUT] ?? 0;
            const pending = expected > paid ? expected - paid : 0;
            return { expected, paid, pending };
        })();

        const handoverManagers = managerAssignments
            .map((assignment) => assignment.user)
            .filter((user): user is NonNullable<typeof user> => Boolean(user?.id))
            .sort((first, second) =>
                first.displayName.localeCompare(second.displayName, 'ru', {
                    sensitivity: 'base'
                })
            )
            .map((user) => ({
                id: user.id,
                displayName: user.displayName,
                username: user.username
            }));

        const inventoryProducts = products.map((product) => ({
            id: product.id,
            name: product.name,
            unit: product.unit,
            stockOnHand: product.stockOnHand,
            sellPrice: product.sellPrice,
            costPrice: product.costPrice,
            categoryId: product.category?.id ?? null,
            categoryName: product.category?.name ?? null,
            reorderThreshold: product.reorderThreshold,
            isActive: product.isActive
        }));

        const inventorySummary = inventoryProducts.reduce(
            (acc, product) => {
                acc.totalUnits += product.stockOnHand;
                acc.stockValue += product.costPrice * product.stockOnHand;
                acc.potentialRevenue += product.sellPrice * product.stockOnHand;
                if (
                    typeof product.reorderThreshold === 'number' &&
                    product.reorderThreshold > 0 &&
                    product.stockOnHand <= product.reorderThreshold
                ) {
                    acc.lowStock += 1;
                }
                return acc;
            },
            {
                totalUnits: 0,
                stockValue: 0,
                potentialRevenue: 0,
                lowStock: 0
            }
        );

        const response = {
            hotel: {
                id: hotel.id,
                name: hotel.name,
                address: hotel.address
            },
            shift,
            shiftCash,
            shiftBalances,
            shiftExpenses,
            shiftPayments,
            shiftLedger: serializedLedger,
            rooms: hotel.rooms.map((room) => ({
                id: room.id,
                label: room.label,
                status: room.status,
                stay: room.stays[0]
                    ? {
                        id: room.stays[0].id,
                        guestName: room.stays[0].guestName,
                        scheduledCheckIn: room.stays[0].scheduledCheckIn,
                        scheduledCheckOut: room.stays[0].scheduledCheckOut,
                        status: room.stays[0].status,
                        amountPaid: room.stays[0].amountPaid,
                        paymentMethod: room.stays[0].paymentMethod,
                        cashPaid: room.stays[0].cashPaid,
                        cardPaid: room.stays[0].cardPaid
                    }
                    : null
            })),
            compensation: assignment
                ? {
                    shiftPayAmount: assignment.shiftPayAmount,
                    revenueSharePct: assignment.revenueSharePct,
                    expectedPayout: payoutSummary?.expected ?? null,
                    paidPayout: payoutSummary?.paid ?? null,
                    pendingPayout: payoutSummary?.pending ?? null
                }
                : null,
            handoverManagers,
            inventory: {
                categories: categories.map((category) => ({
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    productCount: category._count.products
                })),
                products: inventoryProducts,
                summary: {
                    totalProducts: inventoryProducts.length,
                    totalUnits: inventorySummary.totalUnits,
                    stockValue: inventorySummary.stockValue,
                    potentialRevenue: inventorySummary.potentialRevenue,
                    lowStock: inventorySummary.lowStock
                }
            }
        };

        return NextResponse.json(response);
    } catch (error) {
        return handleApiError(error, 'Failed to load manager state');
    }
}
