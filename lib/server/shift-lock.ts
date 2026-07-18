import { Prisma, ShiftStatus, UserRole } from '@prisma/client';
import { SessionError } from '@/lib/server/errors';

export type LockedLedgerShift = {
    id: string;
    hotelId: string;
    managerId: string;
    status: ShiftStatus;
};

type ShiftLockOptions = {
    hotelId: string;
    actorId: string;
    actorRole: UserRole;
    requireOpenShiftIds?: string[];
    allowClosedForAdmin?: boolean;
};

/**
 * Serializes ledger mutations with shift handover.
 *
 * Call this only after every room lock needed by the transaction. Shift rows
 * are always locked in id order so group/history corrections cannot deadlock
 * each other when their ledger entries span more than one shift.
 */
export const lockShiftsForLedgerMutation = async (
    tx: Prisma.TransactionClient,
    shiftIds: Array<string | null | undefined>,
    options: ShiftLockOptions,
) => {
    const uniqueShiftIds = Array.from(
        new Set(shiftIds.filter((shiftId): shiftId is string => Boolean(shiftId))),
    ).sort();

    const lockedById = new Map<string, LockedLedgerShift>();
    if (uniqueShiftIds.length === 0) {
        return lockedById;
    }

    const lockedShifts = await tx.$queryRaw<LockedLedgerShift[]>(Prisma.sql`
        SELECT "id", "hotelId", "managerId", "status"
        FROM "Shift"
        WHERE "id" IN (${Prisma.join(uniqueShiftIds)})
        ORDER BY "id"
        FOR UPDATE
    `);

    if (lockedShifts.length !== uniqueShiftIds.length) {
        throw new SessionError('Одна из смен больше не существует', 409);
    }

    const requiredOpenIds = new Set(options.requireOpenShiftIds ?? []);

    for (const lockedShift of lockedShifts) {
        if (lockedShift.hotelId !== options.hotelId) {
            throw new SessionError('Смена принадлежит другому объекту', 403);
        }

        if (options.actorRole === UserRole.MANAGER && lockedShift.managerId !== options.actorId) {
            throw new SessionError('Можно изменять кассу только своей смены', 403);
        }

        const mayEditClosedHistory =
            options.allowClosedForAdmin === true &&
            options.actorRole === UserRole.ADMIN &&
            !requiredOpenIds.has(lockedShift.id);

        if (lockedShift.status !== ShiftStatus.OPEN && !mayEditClosedHistory) {
            throw new SessionError('Смена уже закрыта. Обновите данные и повторите операцию', 409);
        }

        lockedById.set(lockedShift.id, lockedShift);
    }

    return lockedById;
};
