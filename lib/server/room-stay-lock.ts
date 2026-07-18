import { Prisma } from '@prisma/client';
import { SessionError } from '@/lib/server/errors';

/**
 * Serializes mutations that can change an active stay interval for a room.
 *
 * PostgreSQL takes these row locks in the deterministic id order below. Once a
 * waiter acquires the lock, its following conflict query sees the transaction
 * that released it under READ COMMITTED isolation.
 */
export const lockRoomsForStayMutation = async (
    tx: Prisma.TransactionClient,
    roomIds: string[],
) => {
    const uniqueRoomIds = Array.from(new Set(roomIds)).sort();
    if (uniqueRoomIds.length === 0) {
        return;
    }

    const lockedRooms = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "Room"
        WHERE "id" IN (${Prisma.join(uniqueRoomIds)})
        ORDER BY "id"
        FOR UPDATE
    `);

    if (lockedRooms.length !== uniqueRoomIds.length) {
        throw new SessionError('Один из номеров больше не доступен', 409);
    }
};
