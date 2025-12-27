import { ShiftStatus } from '@prisma/client';
import { prisma } from './db';
import type { SessionUser } from './types';
import { assertHotelAccess } from './permissions';

export const ensureNoActiveShift = async (hotelId: string) => {
    const activeShift = await prisma.shift.findFirst({ where: { hotelId, status: ShiftStatus.OPEN } });
    if (activeShift) {
        throw new Error('На этой точке уже есть активная смена. Завершите её перед открытием новой.');
    }
};

type ShiftOwnershipOptions = {
    pinCode?: string;
};

export const ensureShiftOwnership = async (shiftId: string, user: SessionUser, options?: ShiftOwnershipOptions) => {
    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) {
        throw new Error('Смена не найдена');
    }
    assertHotelAccess(user, shift.hotelId);
    if (options?.pinCode) {
        const assignment = await prisma.hotelAssignment.findFirst({
            where: {
                hotelId: shift.hotelId,
                userId: shift.managerId,
                pinCode: options.pinCode,
                isActive: true
            }
        });
        if (!assignment) {
            throw new Error('Неверный код менеджера');
        }
        return shift;
    }
    if (user.role !== 'ADMIN' && shift.managerId !== user.id) {
        throw new Error('Можно управлять только своей сменой');
    }
    return shift;
};
