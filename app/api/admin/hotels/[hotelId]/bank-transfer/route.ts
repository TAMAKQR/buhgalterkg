import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { LedgerEntryType, PaymentMethod, Prisma, StayStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { detectStayPaymentMethod } from '@/lib/stays';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    groupRef: z.string().uuid().optional().nullable(),
    stayId: z.string().cuid().optional().nullable(),
    amount: z.number().int().positive().max(2_000_000_000),
    receivedAt: z.string().datetime(),
    bankName: z.string().trim().max(120).optional().nullable(),
    reference: z.string().trim().max(120).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
}).refine((value) => Boolean(value.groupRef) !== Boolean(value.stayId), {
    message: 'Укажите группу или одно проживание',
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const { hotelId } = await params;
        const country = getCountryFromRequest(request);
        const payload = bodySchema.parse(await request.json());
        const receivedAt = new Date(payload.receivedAt);

        const candidates = await prisma.roomStay.findMany({
            where: {
                hotelId,
                hotel: { country },
                status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] },
                ...(payload.groupRef ? { groupRef: payload.groupRef } : { id: payload.stayId! }),
            },
            select: { id: true, roomId: true },
        });
        if (!candidates.length) return new NextResponse('Постоплата не найдена', { status: 404 });

        const transferRef = randomUUID();
        const result = await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, candidates.map((stay) => stay.roomId));
            const stays = await tx.roomStay.findMany({
                where: { id: { in: candidates.map((stay) => stay.id) }, hotelId },
                select: {
                    id: true, roomId: true, totalAmount: true, amountPaid: true,
                    cashPaid: true, cardPaid: true, onlinePaid: true,
                    tariffPending: true, room: { select: { label: true } },
                },
                orderBy: [{ scheduledCheckIn: 'asc' }, { roomId: 'asc' }],
            });
            if (stays.some((stay) => stay.tariffPending || stay.totalAmount == null)) {
                throw new SessionError('Сначала укажите тариф для всех проживаний группы', 400);
            }
            const outstanding = stays.reduce((sum, stay) => sum + Math.max((stay.totalAmount ?? 0) - (stay.amountPaid ?? 0), 0), 0);
            if (outstanding <= 0) throw new SessionError('Постоплата уже погашена', 409);
            if (payload.amount > outstanding) throw new SessionError('Сумма перевода больше остатка по группе', 400);

            let remaining = payload.amount;
            const allocations: Array<{ stayId: string; roomLabel: string; amount: number }> = [];
            const entries: Prisma.CashEntryCreateManyInput[] = [];
            for (const stay of stays) {
                const due = Math.max((stay.totalAmount ?? 0) - (stay.amountPaid ?? 0), 0);
                const allocated = Math.min(due, remaining);
                if (allocated <= 0) continue;
                const nextCard = (stay.cardPaid ?? 0) + allocated;
                // Preserve legacy payments that may predate the cash/card breakdown.
                const nextAmount = (stay.amountPaid ?? 0) + allocated;
                await tx.roomStay.update({
                    where: { id: stay.id },
                    data: {
                        cardPaid: nextCard,
                        amountPaid: nextAmount,
                        paymentMethod: detectStayPaymentMethod({ cashPaid: stay.cashPaid, cardPaid: nextCard, onlinePaid: stay.onlinePaid }),
                    },
                });
                entries.push({
                    hotelId, stayId: stay.id, roomId: stay.roomId, managerId: session.id,
                    shiftId: null, entryType: LedgerEntryType.CASH_IN, method: PaymentMethod.CARD,
                    amount: allocated, recordedAt: receivedAt,
                    note: `Банковский перевод · №${stay.room.label}`,
                    meta: {
                        source: 'admin_bank_transfer', kind: 'group_postpaid_bank_transfer', transferRef,
                        groupRef: payload.groupRef ?? null, bankName: payload.bankName || null,
                        reference: payload.reference || null, note: payload.note || null, confirmedBy: session.id,
                    },
                });
                allocations.push({ stayId: stay.id, roomLabel: stay.room.label, amount: allocated });
                remaining -= allocated;
            }
            if (remaining !== 0) throw new SessionError('Не удалось распределить перевод по группе', 409);
            await tx.cashEntry.createMany({ data: entries });
            return { transferRef, amount: payload.amount, outstandingBefore: outstanding, outstandingAfter: outstanding - payload.amount, allocations };
        });

        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to confirm bank transfer');
    }
}
