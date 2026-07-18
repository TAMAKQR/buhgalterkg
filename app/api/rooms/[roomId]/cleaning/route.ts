import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { RoomStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const cleaningSchema = z.object({
    status: z.literal(RoomStatus.AVAILABLE)
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { roomId } = await params;
        const session = await getSessionUser(request);
        const payload = cleaningSchema.parse(await request.json());

        const room = await prisma.room.findUnique({
            where: { id: roomId },
            select: {
                id: true,
                hotelId: true,
                label: true,
                status: true,
                currentStayId: true
            }
        });

        if (!room) {
            return new NextResponse('Номер не найден', { status: 404 });
        }

        assertHotelOperatorAccess(session, room.hotelId);

        if (room.currentStayId || room.status === RoomStatus.OCCUPIED) {
            return new NextResponse('Нельзя менять уборку у занятого номера', { status: 400 });
        }

        if (room.status !== RoomStatus.DIRTY) {
            return new NextResponse('Отметить убранным можно только номер в статусе уборки', { status: 400 });
        }

        const updateResult = await prisma.room.updateMany({
            where: {
                id: room.id,
                status: RoomStatus.DIRTY,
                currentStayId: null
            },
            data: { status: payload.status }
        });

        if (updateResult.count !== 1) {
            return new NextResponse('Состояние номера уже изменилось. Обновите данные', { status: 409 });
        }

        const updatedRoom = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });

        return NextResponse.json({ success: true, room: updatedRoom });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues[0]?.message ?? 'Некорректный статус уборки', { status: 400 });
        }
        return handleApiError(error, 'Failed to update room cleaning status');
    }
}
