import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
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
    roomId: z.string().cuid()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = createRoomsSchema.parse(rest);

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

        const result = await prisma.room.createMany({
            data: roomsToCreate,
            skipDuplicates: true
        });

        return NextResponse.json({ created: result.count, skipped: candidateLabels.length - result.count });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to create rooms', { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { initData, devOverride, manualToken, ...rest } = body ?? {};
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = deleteRoomSchema.parse(rest);

        const room = await prisma.room.findUnique({ where: { id: payload.roomId } });
        if (!room) {
            return new NextResponse('Room not found', { status: 404 });
        }

        if (room.currentStayId) {
            return new NextResponse('Нельзя удалить номер с активным гостем', { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            await tx.roomStay.deleteMany({ where: { roomId: room.id } });
            await tx.room.delete({ where: { id: room.id } });
        });

        return NextResponse.json({ success: true, roomId: room.id });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to delete room', { status: 500 });
    }
}
