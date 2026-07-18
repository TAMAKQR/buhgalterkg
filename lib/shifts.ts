import { prisma } from './db';
import type { SessionUser } from './types';
import { assertHotelAccess } from './permissions';
import { upgradeLegacyPin, verifyPin } from './pin';

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
                isActive: true
            }
        });
        if (!assignment || !verifyPin(options.pinCode, assignment)) {
            throw new Error('Неверный код менеджера');
        }
        await upgradeLegacyPin(options.pinCode, assignment);
        return shift;
    }
    if (user.role !== 'ADMIN' && shift.managerId !== user.id) {
        throw new Error('Можно управлять только своей сменой');
    }
    return shift;
};
