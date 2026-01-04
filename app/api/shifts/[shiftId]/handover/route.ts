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
    pinCode: z.string().regex(/^\d{6}$/).optional(),
    handoverRecipientId: z.string().cuid().optional()
});

export async function POST(request: NextRequest, { params }: { params: { shiftId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = handoverSchema.parse(body);

        const shift = await ensureShiftOwnership(params.shiftId, session, { pinCode: payload.pinCode });

        let handoverRecipientId: string | null = null;
        if (payload.handoverRecipientId) {
            const recipientAssignment = await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: shift.hotelId,
                    userId: payload.handoverRecipientId,
                    isActive: true
                }
            });

            if (!recipientAssignment) {
                return new NextResponse('Выбранный менеджер не назначен на эту точку', { status: 400 });
            }

            handoverRecipientId = payload.handoverRecipientId;
        }

        const ledgerGroups = await prisma.cashEntry.groupBy({
            by: ['entryType'],
            where: { shiftId: shift.id },
            _sum: { amount: true }
        });

        const ledgerTotals: Record<LedgerEntryType, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }

        const computedCash =
            shift.openingCash +
            ledgerTotals[LedgerEntryType.CASH_IN] -
            ledgerTotals[LedgerEntryType.CASH_OUT] -
            ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
            ledgerTotals[LedgerEntryType.ADJUSTMENT];

        const updated = await prisma.shift.update({
            where: { id: shift.id },
            data: {
                closingCash: computedCash,
                handoverCash: computedCash,
                closingNote: payload.note,
                handoverRecipientId,
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
