import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ShiftStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
import { lockShiftsForLedgerMutation } from '@/lib/server/shift-lock';

const updateShiftSchema = z
    .object({
        managerId: z.string().cuid().optional(),
        openingCash: z.number().int().nonnegative().optional(),
        openingCashUsd: z.number().int().nonnegative().optional(),
        closingCash: z.number().int().nonnegative().nullable().optional(),
        closingCashUsd: z.number().int().nonnegative().nullable().optional(),
        handoverCash: z.number().int().nonnegative().nullable().optional(),
        handoverCashUsd: z.number().int().nonnegative().nullable().optional(),
        openingNote: z.string().max(500).nullable().optional(),
        closingNote: z.string().max(500).nullable().optional(),
        handoverNote: z.string().max(500).nullable().optional(),
        status: z.nativeEnum(ShiftStatus).optional(),
        openedAt: z.string().datetime().optional(),
        closedAt: z.string().datetime().nullable().optional()
    })
    .refine((values) => Object.keys(values).length > 0, {
        message: 'Нет данных для обновления'
    });

const normalizeNullableString = (value?: string | null) => {
    if (value === undefined) {
        return undefined;
    }
    return value ?? null;
};

function normalizeDate(value?: string | null): Date | undefined;
function normalizeDate(value: string | null | undefined, allowNull: true): Date | null | undefined;
function normalizeDate(value?: string | null, allowNull = false) {
    if (value === undefined) {
        return undefined;
    }
    if (!value) {
        return allowNull ? null : undefined;
    }
    return new Date(value);
}

const referencedRoomIds = (
    stays: Array<{ roomId: string }>,
    transfers: Array<{ fromRoomId: string; toRoomId: string }>,
    ledgerEntries: Array<{ stay: { roomId: string } | null }>,
) => Array.from(new Set([
    ...stays.map((stay) => stay.roomId),
    ...transfers.flatMap((transfer) => [transfer.fromRoomId, transfer.toRoomId]),
    ...ledgerEntries.flatMap((entry) => entry.stay ? [entry.stay.roomId] : []),
]));

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
    try {
        const { shiftId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateShiftSchema.parse(body);

        const shift = await prisma.shift.findFirst({
            where: { id: shiftId, hotel: { country } },
        });
        if (!shift) {
            return new NextResponse('Shift not found', { status: 404 });
        }

        const data: Prisma.ShiftUpdateInput = {};

        // Обновление менеджера смены
        if (payload.managerId) {
            const assignment = await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: shift.hotelId,
                    userId: payload.managerId,
                    isActive: true
                }
            });

            if (!assignment) {
                return new NextResponse('Менеджер не назначен на этот отель', { status: 400 });
            }

            data.manager = { connect: { id: payload.managerId } };
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'openingCash')) {
            data.openingCash = payload.openingCash as number;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'openingCashUsd')) {
            data.openingCashUsd = payload.openingCashUsd as number;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'closingCash')) {
            data.closingCash = payload.closingCash ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'closingCashUsd')) {
            data.closingCashUsd = payload.closingCashUsd ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'handoverCash')) {
            data.handoverCash = payload.handoverCash ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'handoverCashUsd')) {
            data.handoverCashUsd = payload.handoverCashUsd ?? null;
        }

        const openingNote = normalizeNullableString(payload.openingNote);
        if (openingNote !== undefined) {
            data.openingNote = openingNote;
        }

        const closingNote = normalizeNullableString(payload.closingNote);
        if (closingNote !== undefined) {
            data.closingNote = closingNote;
        }

        const handoverNote = normalizeNullableString(payload.handoverNote);
        if (handoverNote !== undefined) {
            data.handoverNote = handoverNote;
        }

        const openedAt = normalizeDate(payload.openedAt);
        if (openedAt !== undefined) {
            data.openedAt = openedAt;
        }

        let closedAt = normalizeDate(payload.closedAt, true);
        if (payload.status) {
            if (payload.status === ShiftStatus.OPEN && shift.status !== ShiftStatus.OPEN) {
                data.status = ShiftStatus.OPEN;
                data.closedAt = closedAt ?? null;
                if (!Object.prototype.hasOwnProperty.call(payload, 'closingCash')) {
                    data.closingCash = null;
                }
                if (!Object.prototype.hasOwnProperty.call(payload, 'closingCashUsd')) {
                    data.closingCashUsd = null;
                }
                if (!Object.prototype.hasOwnProperty.call(payload, 'handoverCash')) {
                    data.handoverCash = null;
                }
                if (!Object.prototype.hasOwnProperty.call(payload, 'handoverCashUsd')) {
                    data.handoverCashUsd = null;
                }
            }
            if (payload.status === ShiftStatus.CLOSED) {
                data.status = ShiftStatus.CLOSED;
                if (closedAt === undefined) {
                    closedAt = shift.closedAt ?? new Date();
                }
                data.closedAt = closedAt;
            }
        } else if (closedAt !== undefined) {
            data.closedAt = closedAt;
        }

        const updated = await prisma.$transaction(async (tx) => {
            if (payload.status === ShiftStatus.OPEN && shift.status !== ShiftStatus.OPEN) {
                const lockedHotel = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    SELECT "id"
                    FROM "Hotel"
                    WHERE "id" = ${shift.hotelId}
                    FOR UPDATE
                `);
                if (lockedHotel.length !== 1) {
                    throw new SessionError('Отель не найден', 404);
                }

                const otherActiveShift = await tx.shift.findFirst({
                    where: {
                        hotelId: shift.hotelId,
                        status: ShiftStatus.OPEN,
                        NOT: { id: shift.id }
                    },
                    select: { id: true }
                });
                if (otherActiveShift) {
                    throw new SessionError('На этой точке уже есть активная смена', 409);
                }
            }

            const result = await tx.shift.update({
                where: { id: shift.id },
                data,
                include: { manager: true }
            });

            if (payload.managerId) {
                await tx.cashEntry.updateMany({
                    where: { shiftId: shift.id },
                    data: { managerId: payload.managerId }
                });
            }

            return result;
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse('На этой точке уже есть активная смена', { status: 409 });
        }
        return handleApiError(error, 'Failed to update shift');
    }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
    try {
        const { shiftId } = await params;
        const session = await getSessionUser(_request);
        assertAdmin(session);
        const country = getCountryFromRequest(_request);

        const shift = await prisma.shift.findFirst({
            where: { id: shiftId, hotel: { country } },
            select: { id: true, hotelId: true, status: true },
        });
        if (!shift) {
            return new NextResponse('Shift not found', { status: 404 });
        }
        if (shift.status !== ShiftStatus.CLOSED) {
            return new NextResponse('Сначала закройте смену', { status: 409 });
        }

        const [candidateStays, candidateTransfers, candidateLedgerEntries] = await Promise.all([
            prisma.roomStay.findMany({
                where: { shiftId: shift.id },
                select: { roomId: true },
            }),
            prisma.stayTransfer.findMany({
                where: { shiftId: shift.id },
                select: { fromRoomId: true, toRoomId: true },
            }),
            prisma.cashEntry.findMany({
                where: { shiftId: shift.id, stayId: { not: null } },
                select: { stay: { select: { roomId: true } } },
            }),
        ]);
        const candidateRoomIds = referencedRoomIds(candidateStays, candidateTransfers, candidateLedgerEntries);
        const lockedRoomIdSet = new Set(candidateRoomIds);

        await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, candidateRoomIds);

            const lockedShift = (await lockShiftsForLedgerMutation(tx, [shift.id], {
                hotelId: shift.hotelId,
                actorId: session.id,
                actorRole: session.role,
                allowClosedForAdmin: true,
            })).get(shift.id)!;
            if (lockedShift.status !== ShiftStatus.CLOSED) {
                throw new SessionError('Смена снова открыта и не была удалена', 409);
            }

            const [currentStays, currentTransfers, currentLedgerEntries] = await Promise.all([
                tx.roomStay.findMany({
                    where: { shiftId: shift.id },
                    select: { roomId: true },
                }),
                tx.stayTransfer.findMany({
                    where: { shiftId: shift.id },
                    select: { fromRoomId: true, toRoomId: true },
                }),
                tx.cashEntry.findMany({
                    where: { shiftId: shift.id, stayId: { not: null } },
                    select: { stay: { select: { roomId: true } } },
                }),
            ]);
            const currentRoomIds = referencedRoomIds(currentStays, currentTransfers, currentLedgerEntries);
            if (currentRoomIds.some((roomId) => !lockedRoomIdSet.has(roomId))) {
                throw new SessionError('Связанные данные смены изменились. Повторите удаление', 409);
            }

            await tx.cashEntry.updateMany({
                where: { shiftId: shift.id },
                data: { shiftId: null }
            });
            await tx.roomStay.updateMany({
                where: { shiftId: shift.id },
                data: { shiftId: null }
            });
            await tx.stayTransfer.updateMany({
                where: { shiftId: shift.id },
                data: { shiftId: null }
            });
            const deletedShift = await tx.shift.deleteMany({
                where: { id: shift.id, status: ShiftStatus.CLOSED }
            });
            if (deletedShift.count !== 1) {
                throw new SessionError('Смена уже изменилась', 409);
            }
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete shift');
    }
}
