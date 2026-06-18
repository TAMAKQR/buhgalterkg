import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LedgerEntryType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { ensureShiftOwnership } from '@/lib/shifts';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const handoverSchema = z.object({
    note: z.string().optional(),
    pinCode: z.string().regex(/^\d{6}$/).optional()
});

export async function POST(request: NextRequest, { params }: { params: { shiftId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = handoverSchema.parse(body);

        const shift = await ensureShiftOwnership(params.shiftId, session, { pinCode: payload.pinCode });

        const ledgerGroups = await prisma.cashEntry.groupBy({
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
            shift.openingCash +
            ledgerTotals[LedgerEntryType.CASH_IN] -
            ledgerTotals[LedgerEntryType.CASH_OUT] -
            ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
            ledgerTotals[LedgerEntryType.ADJUSTMENT];
        const computedCashUsd =
            (shift.openingCashUsd ?? 0) +
            usdTotals[LedgerEntryType.CASH_IN] -
            usdTotals[LedgerEntryType.CASH_OUT] -
            usdTotals[LedgerEntryType.MANAGER_PAYOUT] +
            usdTotals[LedgerEntryType.ADJUSTMENT];

        const updated = await prisma.shift.update({
            where: { id: shift.id },
            data: {
                closingCash: computedCash,
                handoverCash: computedCash,
                closingCashUsd: computedCashUsd,
                handoverCashUsd: computedCashUsd,
                closingNote: payload.note,
                handoverRecipientId: null,
                status: 'CLOSED',
                closedAt: new Date()
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to handover shift');
    }
}
