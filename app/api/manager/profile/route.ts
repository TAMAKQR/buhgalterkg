import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { calculateBonusFromTiers } from '@/lib/bonus';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const hotelId = request.nextUrl.searchParams.get('hotelId') ?? session.hotels[0]?.id;

        if (!hotelId) {
            return new NextResponse('Manager is not assigned to a hotel', { status: 400 });
        }

        assertHotelAccess(session, hotelId);

        const [assignment, shifts, bonusTiers] = await Promise.all([
            prisma.hotelAssignment.findFirst({
                where: { hotelId, userId: session.id, isActive: true },
                select: { shiftPayAmount: true, revenueSharePct: true, createdAt: true, pinCode: true, pinHash: true }
            }),
            prisma.shift.findMany({
                where: { hotelId, managerId: session.id },
                orderBy: { openedAt: 'desc' },
                take: 25
            }),
            prisma.bonusTier.findMany({
                where: { hotelId },
                orderBy: { threshold: 'asc' }
            })
        ]);

        const shiftIds = shifts.map((shift) => shift.id);
        const ledgerGroups = shiftIds.length
            ? await prisma.cashEntry.groupBy({
                by: ['shiftId', 'entryType'],
                where: { shiftId: { in: shiftIds } },
                _sum: { amount: true }
            })
            : [];

        const stayRevenueGroups = shiftIds.length
            ? await prisma.roomStay.groupBy({
                by: ['shiftId'],
                where: { shiftId: { in: shiftIds }, hotelId },
                _sum: { amountPaid: true, onlinePaid: true }
            })
            : [];

        const ledgerTotals = new Map<string, { cashIn: number; payouts: number }>();
        for (const shiftId of shiftIds) {
            ledgerTotals.set(shiftId, { cashIn: 0, payouts: 0 });
        }

        const stayRevenueMap = new Map<string, number>();
        for (const group of stayRevenueGroups) {
            if (group.shiftId) {
                const online = group._sum.onlinePaid ?? 0;
                stayRevenueMap.set(group.shiftId, Math.max((group._sum.amountPaid ?? 0) - online, 0));
            }
        }

        for (const group of ledgerGroups) {
            if (!group.shiftId) {
                continue;
            }
            const bucket = ledgerTotals.get(group.shiftId) ?? { cashIn: 0, payouts: 0 };
            if (group.entryType === LedgerEntryType.CASH_IN) {
                bucket.cashIn += group._sum?.amount ?? 0;
            }
            if (group.entryType === LedgerEntryType.MANAGER_PAYOUT) {
                bucket.payouts += group._sum?.amount ?? 0;
            }
            ledgerTotals.set(group.shiftId, bucket);
        }

        const shiftHistory = shifts.map((shift) => {
            const ledger = ledgerTotals.get(shift.id) ?? { cashIn: 0, payouts: 0 };
            const shiftBonus = calculateBonusFromTiers(stayRevenueMap.get(shift.id) ?? 0, bonusTiers);
            const payout = calculateManagerPayout({
                shiftPayAmount: assignment?.shiftPayAmount,
                revenueSharePct: assignment?.revenueSharePct,
                bonusAmount: shiftBonus?.computed ?? 0,
                cashIn: ledger.cashIn,
                payouts: ledger.payouts,
            });

            return {
                id: shift.id,
                number: shift.number,
                status: shift.status,
                openedAt: shift.openedAt,
                closedAt: shift.closedAt,
                openingCash: shift.openingCash,
                closingCash: shift.closingCash,
                handoverCash: shift.handoverCash,
                notes: {
                    opening: shift.openingNote,
                    closing: shift.closingNote,
                    handover: shift.handoverNote
                },
                payout: {
                    expected: payout.expected,
                    paid: payout.paid,
                    pending: payout.pending
                }
            };
        });

        return NextResponse.json({
            manager: {
                id: session.id,
                displayName: session.displayName,
                username: session.username
            },
            assignment: assignment
                ? {
                    shiftPayAmount: assignment.shiftPayAmount,
                    revenueSharePct: assignment.revenueSharePct,
                    createdAt: assignment.createdAt,
                    pinCode: assignment.pinCode
                }
                : null,
            shifts: shiftHistory
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load manager profile');
    }
}
