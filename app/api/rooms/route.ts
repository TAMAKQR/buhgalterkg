import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, RoomStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { lockRoomsForStayMutation } from '@/lib/server/room-stay-lock';
export const dynamic = 'force-dynamic';

const createRoomsSchema = z.object({
    hotelId: z.string().cuid(),
    rooms: z
        .array(
            z.object({
                label: z.string().min(1).max(32),
                floor: z.string().max(32).optional(),
                notes: z.string().max(200).optional()
            })
        )
        .min(1)
});

const deleteRoomSchema = z.object({
    roomId: z.string().cuid(),
    mode: z.enum(['archive', 'delete']).default('archive'),
});

const updateRoomSchema = z
    .object({
        roomId: z.string().cuid(),
        label: z.string().min(1).max(32).optional(),
        floor: z.string().max(32).nullable().optional(),
        notes: z.string().max(200).nullable().optional(),
        status: z.nativeEnum(RoomStatus).optional(),
        isActive: z.boolean().optional()
    })
    .refine((values) => {
        return (
            typeof values.label !== 'undefined' ||
            typeof values.floor !== 'undefined' ||
            typeof values.notes !== 'undefined' ||
            typeof values.status !== 'undefined' ||
            typeof values.isActive === 'boolean'
        );
    }, 'Не переданы поля для обновления');

const archiveRoom = (roomId: string, extraData: Prisma.RoomUpdateInput = {}) =>
    prisma.$transaction(async (tx) => {
        await lockRoomsForStayMutation(tx, [roomId]);
        const lockedRoom = await tx.room.findUnique({
            where: { id: roomId },
            select: {
                id: true,
                currentStayId: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                archivedAt: true,
            },
        });
        if (!lockedRoom) {
            throw new SessionError('Номер не найден', 404);
        }
        if (lockedRoom.currentStayId) {
            throw new SessionError('Нельзя архивировать номер с активным гостем', 409);
        }

        const requestedAt = new Date();
        const futureBooking = await tx.roomStay.findFirst({
            where: {
                roomId,
                status: 'SCHEDULED',
                scheduledCheckOut: { gt: requestedAt },
            },
            select: { id: true },
        });
        if (futureBooking) {
            throw new SessionError('Сначала перенесите или отмените будущие брони этого номера', 409);
        }

        let archivedAt = lockedRoom.archivedAt ?? requestedAt;
        if (lockedRoom.isActive) {
            const [openPeriod, latestClosedPeriod] = await Promise.all([
                tx.roomActivityPeriod.findFirst({
                    where: { roomId, activeTo: null },
                    orderBy: { activeFrom: 'desc' },
                    select: { id: true, activeFrom: true },
                }),
                tx.roomActivityPeriod.findFirst({
                    where: { roomId, activeTo: { not: null } },
                    orderBy: { activeTo: 'desc' },
                    select: { activeTo: true },
                }),
            ]);

            if (openPeriod) {
                archivedAt = new Date(Math.max(requestedAt.getTime(), openPeriod.activeFrom.getTime() + 1));
                await tx.roomActivityPeriod.update({
                    where: { id: openPeriod.id },
                    data: { activeTo: archivedAt },
                });
            } else {
                const fallbackStartMs = Math.max(
                    lockedRoom.createdAt.getTime(),
                    lockedRoom.updatedAt.getTime(),
                    latestClosedPeriod?.activeTo?.getTime() ?? Number.NEGATIVE_INFINITY,
                );
                const fallbackStart = new Date(fallbackStartMs);
                archivedAt = new Date(Math.max(requestedAt.getTime(), fallbackStartMs + 1));
                await tx.roomActivityPeriod.create({
                    data: { roomId, activeFrom: fallbackStart, activeTo: archivedAt },
                });
            }
        }

        return tx.room.update({
            where: { id: roomId },
            data: {
                ...extraData,
                isActive: false,
                status: RoomStatus.HOLD,
                archivedAt,
            },
        });
    });

const reactivateRoom = (roomId: string, extraData: Prisma.RoomUpdateInput = {}) =>
    prisma.$transaction(async (tx) => {
        await lockRoomsForStayMutation(tx, [roomId]);
        const lockedRoom = await tx.room.findUnique({
            where: { id: roomId },
            select: { id: true, isActive: true, status: true, archivedAt: true },
        });
        if (!lockedRoom) {
            throw new SessionError('Номер не найден', 404);
        }

        if (!lockedRoom.isActive) {
            const latestClosedPeriod = await tx.roomActivityPeriod.findFirst({
                where: { roomId, activeTo: { not: null } },
                orderBy: { activeTo: 'desc' },
                select: { activeTo: true },
            });
            const activeFrom = new Date(Math.max(
                Date.now(),
                lockedRoom.archivedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
                latestClosedPeriod?.activeTo?.getTime() ?? Number.NEGATIVE_INFINITY,
            ));
            await tx.roomActivityPeriod.create({
                data: { roomId, activeFrom },
            });
        }

        const hasExplicitStatus = Object.prototype.hasOwnProperty.call(extraData, 'status');
        return tx.room.update({
            where: { id: roomId },
            data: {
                ...extraData,
                isActive: true,
                archivedAt: null,
                ...(!lockedRoom.isActive && !hasExplicitStatus && lockedRoom.status === RoomStatus.HOLD
                    ? { status: RoomStatus.AVAILABLE }
                    : {}),
            },
        });
    });

const updateRoomDetails = (
    roomId: string,
    extraData: Prisma.RoomUpdateInput,
    changesStatus: boolean,
) => prisma.$transaction(async (tx) => {
    await lockRoomsForStayMutation(tx, [roomId]);
    const lockedRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: { id: true, isActive: true },
    });
    if (!lockedRoom) {
        throw new SessionError('Номер не найден', 404);
    }
    if (changesStatus && !lockedRoom.isActive) {
        throw new SessionError('Сначала восстановите номер из архива', 409);
    }
    return tx.room.update({ where: { id: roomId }, data: extraData });
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = createRoomsSchema.parse(body);

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const normalizedRooms = payload.rooms
            .map((room) => ({
                label: room.label.trim(),
                floor: room.floor?.trim(),
                notes: room.notes?.trim()
            }))
            .filter((room) => room.label.length > 0);

        if (!normalizedRooms.length) {
            return new NextResponse('No valid room labels provided', { status: 400 });
        }

        const uniqueRooms = new Map<string, (typeof normalizedRooms)[number]>();
        normalizedRooms.forEach((room) => {
            if (!uniqueRooms.has(room.label)) {
                uniqueRooms.set(room.label, room);
            }
        });

        const candidateLabels = Array.from(uniqueRooms.keys());

        const existingRooms = await prisma.room.findMany({
            where: { hotelId: payload.hotelId, label: { in: candidateLabels } },
            select: { label: true }
        });
        const existingLabels = new Set(existingRooms.map((room) => room.label));

        const roomsToCreate = candidateLabels
            .filter((label) => !existingLabels.has(label))
            .map((label) => uniqueRooms.get(label)!)
            .map((room) => ({
                hotelId: payload.hotelId,
                label: room.label,
                floor: room.floor ?? null,
                notes: room.notes ?? null
            }));

        if (!roomsToCreate.length) {
            return NextResponse.json({ created: 0, skipped: candidateLabels.length });
        }

        const result = await prisma.$transaction(async (tx) => {
            const created = await tx.room.createMany({
                data: roomsToCreate,
                skipDuplicates: true,
            });
            const roomsMissingActivity = await tx.room.findMany({
                where: {
                    hotelId: payload.hotelId,
                    label: { in: candidateLabels },
                    isActive: true,
                    activityPeriods: { none: {} },
                },
                select: { id: true, createdAt: true },
            });
            if (roomsMissingActivity.length) {
                await tx.roomActivityPeriod.createMany({
                    data: roomsMissingActivity.map((room) => ({
                        roomId: room.id,
                        activeFrom: room.createdAt,
                    })),
                    skipDuplicates: true,
                });
            }
            return created;
        });

        return NextResponse.json({ created: result.count, skipped: candidateLabels.length - result.count });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create rooms');
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = deleteRoomSchema.parse(body);

        if (payload.mode === 'archive') {
            await archiveRoom(payload.roomId);
            return NextResponse.json({ success: true, archived: true, roomId: payload.roomId });
        }

        await prisma.$transaction(async (tx) => {
            await lockRoomsForStayMutation(tx, [payload.roomId]);
            const room = await tx.room.findUnique({
                where: { id: payload.roomId },
                select: {
                    id: true,
                    currentStayId: true,
                    _count: {
                        select: {
                            stays: true,
                            transfersFrom: true,
                            transfersTo: true,
                            ledgerEntries: true,
                        },
                    },
                },
            });
            if (!room) {
                throw new SessionError('Номер не найден', 404);
            }
            if (room.currentStayId) {
                throw new SessionError('Нельзя удалить номер с активным гостем', 409);
            }
            if (room._count.stays > 0) {
                throw new SessionError(
                    'У номера есть брони или история проживания. Архивируйте номер, чтобы сохранить данные.',
                    409,
                );
            }
            if (room._count.ledgerEntries > 0 || room._count.transfersFrom > 0 || room._count.transfersTo > 0) {
                throw new SessionError(
                    'У номера есть финансовые операции или история переводов. Его можно только архивировать.',
                    409,
                );
            }

            await tx.room.delete({ where: { id: room.id } });
        });

        return NextResponse.json({ success: true, deleted: true, roomId: payload.roomId });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to remove room');
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = updateRoomSchema.parse(body);

        const room = await prisma.room.findUnique({ where: { id: payload.roomId } });
        if (!room) {
            return new NextResponse('Room not found', { status: 404 });
        }

        const updateData: Prisma.RoomUpdateInput = {};

        if (typeof payload.label !== 'undefined') {
            const trimmedLabel = payload.label.trim();
            if (!trimmedLabel) {
                return new NextResponse('Укажите номер', { status: 400 });
            }

            const duplicate = await prisma.room.findFirst({
                where: {
                    hotelId: room.hotelId,
                    label: trimmedLabel,
                    NOT: { id: room.id }
                },
                select: { id: true }
            });

            if (duplicate) {
                return new NextResponse('Номер с таким названием уже существует', { status: 409 });
            }

            updateData.label = trimmedLabel;
        }

        if (typeof payload.floor !== 'undefined') {
            const normalizedFloor = payload.floor?.trim();
            updateData.floor = normalizedFloor?.length ? normalizedFloor : null;
        }

        if (typeof payload.notes !== 'undefined') {
            const normalizedNotes = payload.notes?.trim();
            updateData.notes = normalizedNotes?.length ? normalizedNotes : null;
        }

        if (payload.status) {
            updateData.status = payload.status;
        }

        if (typeof payload.isActive === 'boolean') {
            updateData.isActive = payload.isActive;
        }

        if (!Object.keys(updateData).length) {
            return new NextResponse('Не переданы поля для обновления', { status: 400 });
        }

        const updatedRoom = payload.isActive === false
            ? await archiveRoom(payload.roomId, updateData)
            : payload.isActive === true
                ? await reactivateRoom(payload.roomId, updateData)
            : await updateRoomDetails(payload.roomId, updateData, Boolean(payload.status));

        return NextResponse.json({ success: true, room: updatedRoom });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse('Номер с таким названием уже существует', { status: 409 });
        }
        return handleApiError(error, 'Failed to update room');
    }
}
