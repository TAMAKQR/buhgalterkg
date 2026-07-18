import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LedgerEntryType, Prisma, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { ensureShiftOwnership } from '@/lib/shifts';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { assertHotelAccess, assertOperationalRole } from '@/lib/permissions';
import { verifyPin } from '@/lib/pin';

export const dynamic = 'force-dynamic';

const handoverSchema = z.object({
    note: z.string().optional(),
    pinCode: z.string().regex(/^\d{6}$/).optional()
});

type LockedShift = {
    id: string;
    hotelId: string;
    managerId: string;
    status: ShiftStatus;
    openingCash: number;
    openingCashUsd: number;
};

type LockedManagerAssignment = {
    id: string;
    hotelId: string;
    userId: string;
    isActive: boolean;
    pinCode: string | null;
    pinHash: string | null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
    try {
        const { shiftId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertOperationalRole(session);
        const payload = handoverSchema.parse(body);

        const shift = await ensureShiftOwnership(shiftId, session, { pinCode: payload.pinCode });

        const updated = await prisma.$transaction(async (tx) => {
            const [lockedShift] = await tx.$queryRaw<LockedShift[]>(Prisma.sql`
                SELECT "id", "hotelId", "managerId", "status", "openingCash", "opening_cash_usd" AS "openingCashUsd"
                FROM "Shift"
                WHERE "id" = ${shift.id}
                FOR UPDATE
            `);
            if (!lockedShift) {
                throw new SessionError('Смена не найдена', 404);
            }

            assertHotelAccess(session, lockedShift.hotelId);
            if (lockedShift.hotelId !== shift.hotelId || lockedShift.managerId !== shift.managerId) {
                throw new SessionError('Владелец смены уже изменился. Обновите данные', 409);
            }

            if (payload.pinCode) {
                const [assignment] = await tx.$queryRaw<LockedManagerAssignment[]>(Prisma.sql`
                    SELECT
                        "id",
                        "hotelId",
                        "userId",
                        "isActive",
                        "pin_code" AS "pinCode",
                        "pin_hash" AS "pinHash"
                    FROM "HotelAssignment"
                    WHERE "hotelId" = ${lockedShift.hotelId}
                      AND "userId" = ${lockedShift.managerId}
                    FOR UPDATE
                `);
                if (!assignment || !assignment.isActive || !verifyPin(payload.pinCode, assignment)) {
                    throw new SessionError('Назначение или PIN менеджера уже изменились', 409);
                }
            } else if (session.role !== 'ADMIN' && lockedShift.managerId !== session.id) {
                throw new SessionError('Можно закрыть только свою смену', 409);
            }

            if (lockedShift.status !== ShiftStatus.OPEN) {
                throw new SessionError('Смена уже закрыта', 409);
            }

            const ledgerGroups = await tx.cashEntry.groupBy({
                by: ['entryType', 'originalCurrency'],
                where: { shiftId: shift.id, method: 'CASH' },
                _sum: { amount: true, originalAmount: true }
            });

            const ledgerTotals: Record<LedgerEntryType, number> = {
                [LedgerEntryType.CASH_IN]: 0,
                [LedgerEntryType.CASH_OUT]: 0,
                [LedgerEntryType.MANAGER_PAYOUT]: 0,
                [LedgerEntryType.ADJUSTMENT]: 0
            };
            const usdTotals: Record<LedgerEntryType, number> = {
                [LedgerEntryType.CASH_IN]: 0,
                [LedgerEntryType.CASH_OUT]: 0,
                [LedgerEntryType.MANAGER_PAYOUT]: 0,
                [LedgerEntryType.ADJUSTMENT]: 0
            };

            for (const group of ledgerGroups) {
                if (group.originalCurrency === 'USD') {
                    usdTotals[group.entryType] += group._sum?.originalAmount ?? 0;
                } else {
                    ledgerTotals[group.entryType] += group._sum?.amount ?? 0;
                }
            }

            const computedCash =
                lockedShift.openingCash +
                ledgerTotals[LedgerEntryType.CASH_IN] -
                ledgerTotals[LedgerEntryType.CASH_OUT] -
                ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
                ledgerTotals[LedgerEntryType.ADJUSTMENT];
            const computedCashUsd =
                (lockedShift.openingCashUsd ?? 0) +
                usdTotals[LedgerEntryType.CASH_IN] -
                usdTotals[LedgerEntryType.CASH_OUT] -
                usdTotals[LedgerEntryType.MANAGER_PAYOUT] +
                usdTotals[LedgerEntryType.ADJUSTMENT];

            return tx.shift.update({
                where: { id: shift.id },
                data: {
                    closingCash: computedCash,
                    handoverCash: computedCash,
                    closingCashUsd: computedCashUsd,
                    handoverCashUsd: computedCashUsd,
                    closingNote: payload.note,
                    handoverRecipientId: null,
                    status: ShiftStatus.CLOSED,
                    closedAt: new Date()
                }
            });
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to handover shift');
    }
}
