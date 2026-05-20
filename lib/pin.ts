import { hashPassword, verifyPassword } from '@/lib/password';

type PinAssignment = {
    pinHash?: string | null;
    pinCode?: string | null;
};

export const hashPin = (pinCode: string) => hashPassword(pinCode);

export const verifyPin = (pinCode: string, assignment?: PinAssignment | null) => {
    if (!assignment) {
        return false;
    }

    if (assignment.pinHash && verifyPassword(pinCode, assignment.pinHash)) {
        return true;
    }

    return Boolean(assignment.pinCode && assignment.pinCode === pinCode);
};

export const hasConfiguredPin = (assignment?: PinAssignment | null) => Boolean(assignment?.pinHash || assignment?.pinCode);
