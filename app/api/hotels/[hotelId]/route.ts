import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, ShiftStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const updateHotelSchema = z
    .object({
        name: z.string().min(2).optional(),
        address: z.string().min(4).optional(),
        managerSharePct: z.number().int().min(0).max(100).optional(),
        notes: z.string().max(500).optional()
    })
    .refine((values) => Object.keys(values).length > 0, {
        message: 'Не переданы поля для обновления'
    });

export async function GET(_request: NextRequest, { params }: { params: { hotelId: string } }) {
    try {
        const session = await getSessionUser(_request);
        assertAdmin(session);

        const [hotel, ledgerGroups, ledgerEntries] = await prisma.$transaction([
            prisma.hotel.findUnique({
                where: { id: params.hotelId },
                include: {
                    rooms: {
                        orderBy: { label: 'asc' },
                        include: {
                            stays: {
                                orderBy: { scheduledCheckIn: 'desc' },
                                take: 20
                            }
                        }
                    },
                    shifts: {
                        orderBy: { openedAt: 'desc' },
                        take: 20,
                        include: { manager: true }
                    },
                    assignments: {
                        where: { isActive: true },
                        include: { user: true }
                    }
                }
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType'],
                orderBy: { entryType: 'asc' },
                where: { hotelId: params.hotelId },
                _sum: { amount: true }
            }),
            prisma.cashEntry.findMany({
                where: { hotelId: params.hotelId },
                orderBy: { recordedAt: 'desc' },
                take: 50,
                include: {
                    manager: true,
                    shift: { select: { number: true } }
                }
            })
        ]);

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const ledgerTotals: Record<LedgerEntryType, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }

        const activeShiftRecord = hotel.shifts.find((shift) => shift.status === ShiftStatus.OPEN);

        const shiftHistory = hotel.shifts
            .filter((shift) => shift.status === ShiftStatus.CLOSED)
            .map((shift) => ({
                id: shift.id,
                number: shift.number,
                manager: shift.manager.displayName,
                openedAt: shift.openedAt,
                closedAt: shift.closedAt,
                openingCash: shift.openingCash,
                closingCash: shift.closingCash,
                handoverCash: shift.handoverCash,
                openingNote: shift.openingNote,
                closingNote: shift.closingNote,
                handoverNote: shift.handoverNote,
                status: shift.status
            }));

        const payload = {
            id: hotel.id,
            name: hotel.name,
            address: hotel.address,
            managerSharePct: hotel.managerSharePct,
            notes: hotel.notes,
            roomCount: hotel.rooms.length,
            occupiedRooms: hotel.rooms.filter((room) => room.status !== 'AVAILABLE').length,
            rooms: hotel.rooms.map((room) => {
                const stayHistory = room.stays.map((stay) => ({
                    id: stay.id,
                    guestName: stay.guestName,
                    status: stay.status,
                    scheduledCheckIn: stay.scheduledCheckIn,
                    scheduledCheckOut: stay.scheduledCheckOut,
                    actualCheckIn: stay.actualCheckIn,
                    actualCheckOut: stay.actualCheckOut,
                    amountPaid: stay.amountPaid,
                    paymentMethod: stay.paymentMethod,
                    cashPaid: stay.cashPaid,
                    cardPaid: stay.cardPaid,
                    notes: stay.notes
                }));
                const latestStay = stayHistory[0] ?? null;

                return {
                    id: room.id,
                    label: room.label,
                    floor: room.floor,
                    status: room.status,
                    isActive: room.isActive,
                    notes: room.notes,
                    stay: latestStay,
                    stays: stayHistory
                };
            }),
            managers: hotel.assignments.map((assignment) => ({
                assignmentId: assignment.id,
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                telegramId: assignment.user.telegramId,
                username: assignment.user.username,
                pinCode: assignment.pinCode
            })),
            activeShift: activeShiftRecord
                ? {
                    id: activeShiftRecord.id,
                    manager: activeShiftRecord.manager.displayName,
                    openedAt: activeShiftRecord.openedAt,
                    openingCash: activeShiftRecord.openingCash,
                    closingCash: activeShiftRecord.closingCash,
                    handoverCash: activeShiftRecord.handoverCash,
                    openingNote: activeShiftRecord.openingNote,
                    closingNote: activeShiftRecord.closingNote,
                    handoverNote: activeShiftRecord.handoverNote,
                    number: activeShiftRecord.number,
                    status: activeShiftRecord.status
                }
                : null,
            shiftHistory,
            transactions: ledgerEntries.map((entry) => ({
                id: entry.id,
                entryType: entry.entryType,
                method: entry.method,
                amount: entry.amount,
                note: entry.note,
                recordedAt: entry.recordedAt,
                managerName: entry.manager?.displayName ?? null,
                shiftNumber: entry.shift?.number ?? null
            })),
            financials: {
                cashIn: ledgerTotals[LedgerEntryType.CASH_IN],
                cashOut: ledgerTotals[LedgerEntryType.CASH_OUT],
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT],
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT],
                netCash:
                    ledgerTotals[LedgerEntryType.CASH_IN] -
                    ledgerTotals[LedgerEntryType.CASH_OUT] -
                    ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
                    ledgerTotals[LedgerEntryType.ADJUSTMENT]
            }
        };

        return NextResponse.json(payload);
    } catch (error) {
        return handleApiError(error, 'Failed to load hotel details');
    }
}

export async function PATCH(request: NextRequest, { params }: { params: { hotelId: string } }) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = updateHotelSchema.parse(rest);

        const hotel = await prisma.hotel.update({
            where: { id: params.hotelId },
            data: payload
        });

        return NextResponse.json(hotel);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if ((error as { code?: string } | null)?.code === 'P2025') {
            return new NextResponse('Hotel not found', { status: 404 });
        }
        return handleApiError(error, 'Failed to update hotel');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { hotelId: string } }) {
    try {
        const body = await request.json().catch(() => ({}));
        const { initData, devOverride, manualToken } = body ?? {};
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const deleted = await prisma.$transaction(async (tx) => {
            await tx.room.updateMany({ where: { hotelId: params.hotelId }, data: { currentStayId: null } });
            await tx.cashEntry.deleteMany({ where: { hotelId: params.hotelId } });
            await tx.roomStay.deleteMany({ where: { hotelId: params.hotelId } });
            await tx.shift.deleteMany({ where: { hotelId: params.hotelId } });
            await tx.room.deleteMany({ where: { hotelId: params.hotelId } });
            await tx.hotelAssignment.deleteMany({ where: { hotelId: params.hotelId } });

            return tx.hotel.delete({ where: { id: params.hotelId } });
        });

        return NextResponse.json({ success: true, id: deleted.id });
    } catch (error) {
        if ((error as { code?: string } | null)?.code === 'P2025') {
            return new NextResponse('Hotel not found', { status: 404 });
        }
        return handleApiError(error, 'Failed to delete hotel');
    }
}
