import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

type PinAssignment = {
    pinHash?: string | null;
    pinCode?: string | null;
};

type StoredPinAssignment = PinAssignment & {
    id: string;
};

const PIN_HASH_PREFIX = 'scrypt';
const PIN_HASH_SIZE = 32;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const DUMMY_PIN_HASH = 'scrypt$16384$8$1$726174652d6c696d69742d64756d6d79$fbe06f229d40cfe89058a93394795bb585f28a3ca627c2bd180dc880397f6331';

const safeEqual = (left: Buffer, right: Buffer) => left.length === right.length && timingSafeEqual(left, right);

const verifyScryptPin = (pinCode: string, stored: string) => {
    const [prefix, costValue, blockSizeValue, parallelizationValue, saltHex, expectedHex] = stored.split('$');
    if (prefix !== PIN_HASH_PREFIX || !saltHex || !expectedHex) {
        return false;
    }

    const cost = Number(costValue);
    const blockSize = Number(blockSizeValue);
    const parallelization = Number(parallelizationValue);
    if (![cost, blockSize, parallelization].every(Number.isSafeInteger)) {
        return false;
    }

    try {
        const expected = Buffer.from(expectedHex, 'hex');
        const derived = scryptSync(pinCode, Buffer.from(saltHex, 'hex'), expected.length, {
            N: cost,
            r: blockSize,
            p: parallelization,
            maxmem: 64 * 1024 * 1024
        });
        return safeEqual(derived, expected);
    } catch {
        return false;
    }
};

export const hashPin = (pinCode: string) => {
    const salt = randomBytes(16);
    const derived = scryptSync(pinCode, salt, PIN_HASH_SIZE, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 64 * 1024 * 1024
    });
    return [
        PIN_HASH_PREFIX,
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELIZATION,
        salt.toString('hex'),
        derived.toString('hex')
    ].join('$');
};

export const pinHashNeedsUpgrade = (assignment?: PinAssignment | null) => Boolean(
    assignment?.pinCode || (assignment?.pinHash && !assignment.pinHash.startsWith(`${PIN_HASH_PREFIX}$`))
);

export const upgradeLegacyPin = async (pinCode: string, assignment: StoredPinAssignment) => {
    if (!pinHashNeedsUpgrade(assignment)) {
        return false;
    }

    const data = { pinCode: null, pinHash: hashPin(pinCode) };
    try {
        if (assignment.pinCode === pinCode) {
            const result = await prisma.hotelAssignment.updateMany({
                where: { id: assignment.id, pinCode: assignment.pinCode },
                data
            });
            return result.count > 0;
        }

        const result = await prisma.hotelAssignment.updateMany({
            where: { id: assignment.id, pinHash: assignment.pinHash },
            data
        });
        return result.count > 0;
    } catch {
        // A failed background upgrade must not lock a manager out of an otherwise valid session.
        return false;
    }
};

export const verifyPin = (pinCode: string, assignment?: PinAssignment | null) => {
    if (!assignment) {
        return false;
    }

    if (assignment.pinHash) {
        if (assignment.pinHash.startsWith(`${PIN_HASH_PREFIX}$`)) {
            if (verifyScryptPin(pinCode, assignment.pinHash)) {
                return true;
            }
        } else if (verifyPassword(pinCode, assignment.pinHash)) {
            return true;
        }
    }

    return Boolean(
        assignment.pinCode
        && safeEqual(Buffer.from(assignment.pinCode), Buffer.from(pinCode))
    );
};

/**
 * Runs the same scrypt work as a normal PIN lookup without identifying a real
 * assignment. This keeps unknown-login failures from becoming a cheap timing
 * oracle and avoids exposing whether a manager login exists.
 */
export const verifyDummyPin = (pinCode: string) => verifyScryptPin(pinCode, DUMMY_PIN_HASH);

export const hasConfiguredPin = (assignment?: PinAssignment | null) => Boolean(assignment?.pinHash || assignment?.pinCode);
