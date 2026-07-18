import { NextRequest, NextResponse } from 'next/server';
import { ShiftStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';

export const dynamic = 'force-dynamic';

const clearSchema = z.object({
    hotelId: z.string().cuid()
});

const referencedRoomIds = (
    stays: Array<{ roomId: string }>,
    transfers: Array<{ fromRoomId: string; toRoomId: string }>,
    ledgerEntries: Array<{ stay: { roomId: string } | null }>,
) => Array.from(new Set([
    ...stays.map((stay) => stay.roomId),
    ...transfers.flatMap((transfer) => [transfer.fromRoomId, transfer.toRoomId]),
    ...ledgerEntries.flatMap((entry) => entry.stay ? [entry.stay.roomId] : []),
]));

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const { hotelId } = clearSchema.parse(body);

        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true },
        });
        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const closedShifts = await prisma.shift.findMany({
            where: { hotelId, status: ShiftStatus.CLOSED },
            orderBy: { id: 'asc' },
            select: { id: true }
        });

        if (!closedShifts.length) {
            return NextResponse.json({ clearedShifts: 0, clearedEntries: 0, updatedStays: 0, updatedTransfers: 0 });
        }

        const shiftIds = closedShifts.map((shift) => shift.id);
        const [candidateStays, candidateTransfers, candidateLedgerEntries] = await Promise.all([
            prisma.roomStay.findMany({
                where: { shiftId: { in: shiftIds } },
                select: { roomId: true },
            }),
            prisma.stayTransfer.findMany({
                where: { shiftId: { in: shiftIds } },
                select: { fromRoomId: true, toRoomId: true },
            }),
            prisma.cashEntry.findMany({
                where: { shiftId: { in: shiftIds }, stayId: { not: null } },
                select: { stay: { select: { roomId: true } } },
            }),
        ]);
        const candidateRoomIds = referencedRoomIds(candidateStays, candidateTransfers, candidateLedgerEntries);
        const lockedRoomIdSet = new Set(candidateRoomIds);

        const results = await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, candidateRoomIds);

            const lockedShifts = await lockShiftsForLedgerMutation(tx, shiftIds, {
                hotelId,
                actorId: session.id,
                actorRole: session.role,
                allowClosedForAdmin: true,
            });
            if (Array.from(lockedShifts.values()).some((shift) => shift.status !== ShiftStatus.CLOSED)) {
                throw new SessionError('Одна из смен снова открыта. Обновите историю', 409);
            }

            const [currentStays, currentTransfers, currentLedgerEntries] = await Promise.all([
                tx.roomStay.findMany({
                    where: { shiftId: { in: shiftIds } },
                    select: { roomId: true },
                }),
                tx.stayTransfer.findMany({
                    where: { shiftId: { in: shiftIds } },
                    select: { fromRoomId: true, toRoomId: true },
                }),
                tx.cashEntry.findMany({
                    where: { shiftId: { in: shiftIds }, stayId: { not: null } },
                    select: { stay: { select: { roomId: true } } },
                }),
            ]);
            const currentRoomIds = referencedRoomIds(currentStays, currentTransfers, currentLedgerEntries);
            if (currentRoomIds.some((roomId) => !lockedRoomIdSet.has(roomId))) {
                throw new SessionError('Связанные данные смен изменились. Повторите очистку', 409);
            }

            const deletedEntries = await tx.cashEntry.deleteMany({
                where: { shiftId: { in: shiftIds } }
            });

            const updatedStays = await tx.roomStay.updateMany({
                where: { shiftId: { in: shiftIds } },
                data: { shiftId: null }
            });

            const updatedTransfers = await tx.stayTransfer.updateMany({
                where: { shiftId: { in: shiftIds } },
                data: { shiftId: null },
            });

            const deletedShifts = await tx.shift.deleteMany({
                where: { id: { in: shiftIds }, status: ShiftStatus.CLOSED }
            });
            if (deletedShifts.count !== shiftIds.length) {
                throw new SessionError('Одна из смен уже изменилась', 409);
            }

            return {
                clearedShifts: deletedShifts.count,
                clearedEntries: deletedEntries.count,
                updatedStays: updatedStays.count,
                updatedTransfers: updatedTransfers.count,
            };
        });

        return NextResponse.json(results);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Не удалось очистить историю смен');
    }
}
