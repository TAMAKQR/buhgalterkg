import { NextRequest, NextResponse } from 'next/server';
import { ExpenseCategory, HotelAssignment, LedgerEntryType, Prisma, Room, RoomStay, RoomStatus, Shift, ShiftStatus, StayStatus, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { sanitizeExtranetNames } from '@/lib/stays';
import { isCollectionLedgerEntry } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

const hotelDetailInclude = {
    expenseCategories: {
        orderBy: { name: 'asc' }
    },
    rooms: {
        orderBy: { label: 'asc' },
        include: {
            stays: {
                orderBy: { scheduledCheckIn: 'desc' },
                take: 20,
                include: {
                    transfers: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            fromRoom: { select: { label: true } },
                            toRoom: { select: { label: true } },
                        }
                    },
                    ledgerEntries: {
                        orderBy: { recordedAt: 'asc' },
                        select: {
                            id: true,
                            entryType: true,
                            method: true,
                            amount: true,
                            note: true,
                            recordedAt: true,
                            shift: { select: { number: true } },
                            manager: { select: { displayName: true } }
                        }
                    },
                    shift: {
                        select: {
                            id: true,
                            number: true,
                            status: true,
                            openedAt: true,
                            closedAt: true,
                            manager: {
                                select: {
                                    displayName: true
                                }
                            }
                        }
                    }
                }
            } as never
        }
    },
    shifts: {
        orderBy: { openedAt: 'desc' },
        include: { manager: true }
    },
    assignments: {
        where: { isActive: true },
        include: { user: true }
    }
} as const;

type HotelDetailRecord = {
    id: string;
    name: string;
    address: string;
    timezone: string;
    currency: string;
    financialCycleStartDay: number;
    managerSharePct: number | null;
    cleaningChatId: string | null;
    notes: string | null;
    usesExtranets: boolean;
    extranetNames: string[];
    expenseCategories: ExpenseCategory[];
    assignments: Array<HotelAssignment & { user: User }>;
    shifts: Array<Shift & { manager: User }>;
    rooms: Array<
        Room & {
            stays: Array<
                RoomStay & {
                    transfers: Array<{
                        id: string;
                        createdAt: Date;
                        note: string | null;
                        fromRoom: { label: string };
                        toRoom: { label: string };
                    }>;
                }
            >;
        }
    >;
};

type HotelStayRecord = RoomStay & {
    onlinePaid: number;
    bookingSource: string | null;
    transfers: Array<{
        id: string;
        createdAt: Date;
        note: string | null;
        fromRoom: { label: string };
        toRoom: { label: string };
    }>;
    ledgerEntries: Array<{
        id: string;
        entryType: LedgerEntryType;
        method: 'CASH' | 'CARD';
        amount: number;
        note: string | null;
        recordedAt: Date;
        shift: { number: number } | null;
        manager: { displayName: string } | null;
    }>;
    shift: {
        id: string;
        number: number;
        status: ShiftStatus;
        openedAt: Date;
        closedAt: Date | null;
        manager: { displayName: string };
    } | null;
};

const cleaningChatIdSchema = z
    .string()
    .trim()
    .regex(/^-?\d+$/, { message: 'ID чата должен содержать только цифры и, при необходимости, знак -' })
    .min(5)
    .max(32);

const updateHotelSchema = z
    .object({
        name: z.string().min(2).optional(),
        address: z.string().min(4).optional(),
        country: z.string().length(2).optional(),
        timezone: z.string().min(1).max(50).optional(),
        currency: z.string().min(1).max(10).optional(),
        usesExtranets: z.boolean().optional(),
        extranetNames: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
        financialCycleStartDay: z.number().int().min(1).max(31).optional(),
        managerSharePct: z.number().int().min(0).max(100).optional(),
        monthlyPayrollCost: z.number().int().min(0).optional(),
        monthlyRentCost: z.number().int().min(0).optional(),
        monthlyUtilitiesCost: z.number().int().min(0).optional(),
        monthlySuppliesCost: z.number().int().min(0).optional(),
        monthlyOtherCost: z.number().int().min(0).optional(),
        notes: z.string().max(500).optional(),
        cleaningChatId: cleaningChatIdSchema.optional().nullable()
    })
    .refine((values) => Object.keys(values).length > 0, {
        message: 'Не переданы поля для обновления'
    });

export async function GET(_request: NextRequest, { params }: { params: { hotelId: string } }) {
    try {
        const session = await getSessionUser(_request);
        assertAdmin(session);
        const country = getCountryFromRequest(_request);

        const [hotel, ledgerGroups, collectionEntries, ledgerEntries, shiftLedgerGroups, bonusTiers, stayRevenueByShift] = await prisma.$transaction([
            prisma.hotel.findFirst({
                where: { id: params.hotelId, country },
                include: hotelDetailInclude
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType'],
                orderBy: { entryType: 'asc' },
                where: { hotelId: params.hotelId },
                _sum: { amount: true }
            }),
            prisma.cashEntry.findMany({
                where: {
                    hotelId: params.hotelId,
                    entryType: LedgerEntryType.CASH_OUT,
                },
                select: {
                    amount: true,
                    method: true,
                    note: true,
                    entryType: true,
                    expenseCategory: { select: { name: true } },
                },
            }),
            prisma.cashEntry.findMany({
                where: { hotelId: params.hotelId },
                orderBy: { recordedAt: 'desc' },
                include: {
                    expenseCategory: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    manager: true,
                    shift: { select: { number: true } }
                }
            }),
            prisma.cashEntry.groupBy({
                by: ['shiftId', 'entryType'],
                orderBy: [
                    { shiftId: 'asc' },
                    { entryType: 'asc' }
                ],
                where: { hotelId: params.hotelId, shiftId: { not: null } },
                _sum: { amount: true }
            }),
            prisma.bonusTier.findMany({
                where: { hotelId: params.hotelId },
                orderBy: { threshold: 'asc' }
            }),
            prisma.roomStay.groupBy({
                by: ['shiftId'],
                orderBy: { shiftId: 'asc' },
                where: {
                    hotelId: params.hotelId,
                    shiftId: { not: null },
                    status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] }
                },
                _sum: { amountPaid: true }
            })
        ]);

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const hotelRecord = hotel as unknown as HotelDetailRecord;

        const ledgerTotals: Record<LedgerEntryType, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }
        const collectionsTotal = collectionEntries.reduce(
            (total, entry) => total + (isCollectionLedgerEntry(entry) ? entry.amount : 0),
            0
        );
        ledgerTotals[LedgerEntryType.CASH_OUT] -= collectionsTotal;

        const shiftLedgerTotals = new Map<
            string,
            { cashIn: number; payouts: number }
        >();

        for (const group of shiftLedgerGroups) {
            if (!group.shiftId) {
                continue;
            }
            const bucket = shiftLedgerTotals.get(group.shiftId) ?? { cashIn: 0, payouts: 0 };
            switch (group.entryType) {
                case LedgerEntryType.CASH_IN:
                    bucket.cashIn += group._sum?.amount ?? 0;
                    break;
                case LedgerEntryType.MANAGER_PAYOUT:
                    bucket.payouts += group._sum?.amount ?? 0;
                    break;
                default:
                    break;
            }
            shiftLedgerTotals.set(group.shiftId, bucket);
        }

        const assignmentComp = new Map<
            string,
            { shiftPayAmount: number | null | undefined; revenueSharePct: number | null | undefined }
        >();

        for (const assignment of hotelRecord.assignments) {
            assignmentComp.set(assignment.userId, {
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct
            });
        }

        const computePayout = (shiftId: string, managerId: string, bonusAmount?: number | null) => {
            const comp = assignmentComp.get(managerId);
            if (!comp) {
                return null;
            }
            const ledger = shiftLedgerTotals.get(shiftId) ?? { cashIn: 0, payouts: 0 };
            return calculateManagerPayout({
                shiftPayAmount: comp.shiftPayAmount,
                revenueSharePct: comp.revenueSharePct,
                bonusAmount: bonusAmount ?? 0,
                cashIn: ledger.cashIn,
                payouts: ledger.payouts ?? 0,
            });
        };

        const shiftStayRevenue = new Map<string, number>();
        for (const group of stayRevenueByShift) {
            if (group.shiftId) {
                shiftStayRevenue.set(group.shiftId, group._sum?.amountPaid ?? 0);
            }
        }

        const computeShiftBonus = (shiftId: string) => {
            const revenue = shiftStayRevenue.get(shiftId) ?? 0;
            return calculateBonusFromTiers(revenue, bonusTiers);
        };

        const activeShiftRecord = hotelRecord.shifts.find((shift) => shift.status === ShiftStatus.OPEN);
        const activeShiftBonus = activeShiftRecord ? computeShiftBonus(activeShiftRecord.id) : null;
        const activeShiftPayout = activeShiftRecord ? computePayout(activeShiftRecord.id, activeShiftRecord.managerId, activeShiftBonus?.computed ?? 0) : null;

        const shiftHistory = hotelRecord.shifts
            .filter((shift) => shift.status === ShiftStatus.CLOSED)
            .map((shift) => {
                const shiftBonus = computeShiftBonus(shift.id);
                const payout = computePayout(shift.id, shift.managerId, shiftBonus?.computed ?? 0);
                return {
                    id: shift.id,
                    number: shift.number,
                    managerId: shift.managerId,
                    manager: shift.manager.displayName,
                    openedAt: shift.openedAt,
                    closedAt: shift.closedAt,
                    openingCash: shift.openingCash,
                    closingCash: shift.closingCash,
                    handoverCash: shift.handoverCash,
                    openingNote: shift.openingNote,
                    closingNote: shift.closingNote,
                    handoverNote: shift.handoverNote,
                    status: shift.status,
                    expectedPayout: payout?.expected ?? null,
                    paidPayout: payout?.paid ?? null,
                    pendingPayout: payout?.pending ?? null,
                    bonus: shiftBonus?.computed ?? null
                };
            });

        const payload = {
            id: hotelRecord.id,
            name: hotelRecord.name,
            address: hotelRecord.address,
            timezone: hotelRecord.timezone,
            currency: hotelRecord.currency,
            usesExtranets: hotelRecord.usesExtranets,
            extranetNames: hotelRecord.extranetNames,
            financialCycleStartDay: hotelRecord.financialCycleStartDay,
            managerSharePct: hotelRecord.managerSharePct,
            cleaningChatId: hotelRecord.cleaningChatId,
            notes: hotelRecord.notes,
            roomCount: hotelRecord.rooms.length,
            occupiedRooms: hotelRecord.rooms.filter((room) => room.status === RoomStatus.OCCUPIED).length,
            rooms: hotelRecord.rooms.map((room) => {
                const stayHistory = room.stays.map((stay) => {
                    const stayRecord = stay as HotelStayRecord;
                    return {
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
                        onlinePaid: stayRecord.onlinePaid,
                        bookingSource: stayRecord.bookingSource,
                        shiftId: stayRecord.shift?.id ?? null,
                        shiftNumber: stayRecord.shift?.number ?? null,
                        shiftStatus: stayRecord.shift?.status ?? null,
                        shiftOpenedAt: stayRecord.shift?.openedAt ?? null,
                        shiftClosedAt: stayRecord.shift?.closedAt ?? null,
                        shiftManagerName: stayRecord.shift?.manager.displayName ?? null,
                        transfers: stayRecord.transfers.map((transfer) => ({
                            id: transfer.id,
                            createdAt: transfer.createdAt,
                            note: transfer.note,
                            fromRoomLabel: transfer.fromRoom.label,
                            toRoomLabel: transfer.toRoom.label,
                        })),
                        ledgerEntries: stayRecord.ledgerEntries.map((entry) => ({
                            id: entry.id,
                            entryType: entry.entryType,
                            method: entry.method,
                            amount: entry.amount,
                            note: entry.note,
                            recordedAt: entry.recordedAt,
                            shiftNumber: entry.shift?.number ?? null,
                            managerName: entry.manager?.displayName ?? null
                        })),
                        notes: stay.notes
                    };
                });
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
            managers: hotelRecord.assignments.map((assignment) => ({
                assignmentId: assignment.id,
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                telegramId: assignment.user.telegramId,
                loginName: assignment.user.loginName,
                username: assignment.user.username,
                pinCode: assignment.pinCode,
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct
            })),
            activeShift: activeShiftRecord
                ? {
                    id: activeShiftRecord.id,
                    managerId: activeShiftRecord.managerId,
                    manager: activeShiftRecord.manager.displayName,
                    openedAt: activeShiftRecord.openedAt,
                    openingCash: activeShiftRecord.openingCash,
                    closingCash: activeShiftRecord.closingCash,
                    handoverCash: activeShiftRecord.handoverCash,
                    openingNote: activeShiftRecord.openingNote,
                    closingNote: activeShiftRecord.closingNote,
                    handoverNote: activeShiftRecord.handoverNote,
                    number: activeShiftRecord.number,
                    status: activeShiftRecord.status,
                    expectedPayout: activeShiftPayout?.expected ?? null,
                    paidPayout: activeShiftPayout?.paid ?? null,
                    pendingPayout: activeShiftPayout?.pending ?? null,
                    bonus: activeShiftBonus?.computed ?? null
                }
                : null,
            shiftHistory,
            transactions: ledgerEntries.map((entry) => ({
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
                recordedAt: entry.recordedAt,
                managerName: entry.manager?.displayName ?? null,
                shiftNumber: entry.shift?.number ?? null
            })),
            expenseCategories: hotelRecord.expenseCategories.map((category) => ({
                id: category.id,
                name: category.name
            })),
            bonusTiers: bonusTiers.map((t) => ({
                id: t.id,
                threshold: t.threshold,
                bonus: t.bonus,
                bonusPct: t.bonusPct
            })),
            financials: {
                cashIn: ledgerTotals[LedgerEntryType.CASH_IN],
                cashOut: ledgerTotals[LedgerEntryType.CASH_OUT],
                collections: collectionsTotal,
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT],
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT],
                netCash:
                    ledgerTotals[LedgerEntryType.CASH_IN] -
                    ledgerTotals[LedgerEntryType.CASH_OUT] -
                    collectionsTotal -
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
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateHotelSchema.parse(body);

        const targetHotel = await prisma.hotel.findFirst({
            where: { id: params.hotelId, country },
            select: { id: true },
        });
        if (!targetHotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const hotel = await prisma.hotel.update({
            where: { id: params.hotelId },
            data: {
                ...payload,
                extranetNames: payload.extranetNames ? sanitizeExtranetNames(payload.extranetNames) : undefined
            } as Prisma.HotelUpdateInput
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
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const targetHotel = await prisma.hotel.findFirst({
            where: { id: params.hotelId, country },
            select: { id: true },
        });
        if (!targetHotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

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
