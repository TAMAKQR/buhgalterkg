import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';

function assertObserver(user: { role: string }) {
    if (user.role !== 'OBSERVER') {
        throw new Error('Observer access required');
    }
}

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertObserver(session);

        const hotelId = session.hotels[0]?.id;
        if (!hotelId) {
            return new NextResponse('Нет назначенного объекта', { status: 403 });
        }

        const [hotel, ledgerGroups, ledgerEntries, shifts, stays, rooms] = await prisma.$transaction([
            prisma.hotel.findUnique({
                where: { id: hotelId },
                select: {
                    id: true,
                    name: true,
                    address: true,
                    timezone: true,
                    currency: true,
                },
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType'],
                orderBy: { entryType: 'asc' },
                where: { hotelId },
                _sum: { amount: true },
            }),
            prisma.cashEntry.findMany({
                where: { hotelId },
                orderBy: { recordedAt: 'desc' },
                take: 100,
                select: {
                    id: true,
                    entryType: true,
                    method: true,
                    amount: true,
                    note: true,
                    recordedAt: true,
                    shift: { select: { number: true } },
                },
            }),
            prisma.shift.findMany({
                where: { hotelId },
                orderBy: { openedAt: 'desc' },
                take: 30,
                include: { manager: { select: { displayName: true } } },
            }),
            prisma.roomStay.findMany({
                where: { hotelId },
                orderBy: { scheduledCheckIn: 'desc' },
                take: 100,
                select: {
                    id: true,
                    guestName: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true,
                    actualCheckIn: true,
                    actualCheckOut: true,
                    status: true,
                    amountPaid: true,
                    paymentMethod: true,
                    cashPaid: true,
                    cardPaid: true,
                    room: { select: { label: true } },
                },
            }),
            prisma.room.findMany({
                where: { hotelId, isActive: true },
                orderBy: { label: 'asc' },
                select: {
                    id: true,
                    label: true,
                    status: true,
                    floor: true,
                },
            }),
        ]);

        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const ledgerTotals: Record<string, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0,
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }

        const occupiedCount = rooms.filter((r) => r.status === 'OCCUPIED').length;

        return NextResponse.json({
            hotel,
            totals: {
                cashIn: ledgerTotals[LedgerEntryType.CASH_IN],
                cashOut: ledgerTotals[LedgerEntryType.CASH_OUT],
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT],
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT],
                net: ledgerTotals[LedgerEntryType.CASH_IN]
                    - ledgerTotals[LedgerEntryType.CASH_OUT]
                    - ledgerTotals[LedgerEntryType.MANAGER_PAYOUT]
                    + ledgerTotals[LedgerEntryType.ADJUSTMENT],
            },
            occupancy: {
                total: rooms.length,
                occupied: occupiedCount,
                rate: rooms.length ? Math.round((occupiedCount / rooms.length) * 100) : 0,
            },
            rooms: rooms.map((r) => ({
                id: r.id,
                label: r.label,
                status: r.status,
                floor: r.floor,
            })),
            shifts: shifts.map((s) => ({
                id: s.id,
                number: s.number,
                status: s.status,
                manager: s.manager.displayName,
                openedAt: s.openedAt.toISOString(),
                closedAt: s.closedAt?.toISOString() ?? null,
                openingCash: s.openingCash,
                closingCash: s.closingCash,
            })),
            stays: stays.map((s) => ({
                id: s.id,
                guestName: s.guestName,
                room: s.room?.label ?? '—',
                scheduledCheckIn: s.scheduledCheckIn.toISOString(),
                scheduledCheckOut: s.scheduledCheckOut.toISOString(),
                actualCheckIn: s.actualCheckIn?.toISOString() ?? null,
                actualCheckOut: s.actualCheckOut?.toISOString() ?? null,
                status: s.status,
                amountPaid: s.amountPaid,
                paymentMethod: s.paymentMethod,
                cashPaid: s.cashPaid,
                cardPaid: s.cardPaid,
            })),
            ledger: ledgerEntries.map((e) => ({
                id: e.id,
                entryType: e.entryType,
                method: e.method,
                amount: e.amount,
                note: e.note,
                recordedAt: e.recordedAt.toISOString(),
                shiftNumber: e.shift?.number ?? null,
            })),
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load observer data');
    }
}
