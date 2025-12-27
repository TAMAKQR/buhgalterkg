import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod, ShiftStatus } from '@prisma/client';

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

        const shift = await prisma.shift.findFirst({
            where: { hotelId, status: ShiftStatus.OPEN },
            orderBy: { openedAt: 'desc' }
        });

        let shiftCash = shift ? shift.openingCash : null;
        let shiftPayments: { cash: number; card: number; total: number } | null = null;
        let shiftLedger: Array<{
            id: string;
            entryType: LedgerEntryType;
            method: PaymentMethod;
            amount: number;
            note: string | null;
            recordedAt: Date;
        }> = [];
        if (shift) {
            const [ledgerGroups, paymentGroups, recentLedger] = await Promise.all([
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
                    take: 10,
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

            shiftCash =
                shift.openingCash +
                ledgerTotals[LedgerEntryType.CASH_IN] -
                ledgerTotals[LedgerEntryType.CASH_OUT] -
                ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
                ledgerTotals[LedgerEntryType.ADJUSTMENT];

            shiftPayments = {
                cash: paymentTotals[PaymentMethod.CASH],
                card: paymentTotals[PaymentMethod.CARD],
                total: paymentTotals[PaymentMethod.CASH] + paymentTotals[PaymentMethod.CARD]
            };

            shiftLedger = recentLedger;
        }

        const serializedLedger = shiftLedger.map((entry) => ({
            ...entry,
            recordedAt: entry.recordedAt.toISOString()
        }));

        const response = {
            hotel: {
                id: hotel.id,
                name: hotel.name,
                address: hotel.address
            },
            shift,
            shiftCash,
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
                        paymentMethod: room.stays[0].paymentMethod
                    }
                    : null
            }))
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error(error);
        return new NextResponse('Failed to load manager state', { status: 500 });
    }
}
