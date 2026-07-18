import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_HASH_SIZE = 32;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
// A fixed, deliberately unusable credential keeps unknown-user checks close to
// the cost of verifying a real observer password without storing a secret.
const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$6f627365727665722d64756d6d792121$6855f48b058bef628543ac9e998deb7f8a8804b822f2c2c9f92ce55d7115b7e7';

const safeEqual = (left: Buffer, right: Buffer) => (
    left.length === right.length && timingSafeEqual(left, right)
);

const verifyScryptPassword = (password: string, stored: string) => {
    const [prefix, costValue, blockSizeValue, parallelizationValue, saltHex, expectedHex] = stored.split('$');
    if (
        prefix !== PASSWORD_HASH_PREFIX
        || Number(costValue) !== SCRYPT_COST
        || Number(blockSizeValue) !== SCRYPT_BLOCK_SIZE
        || Number(parallelizationValue) !== SCRYPT_PARALLELIZATION
        || !/^[a-f0-9]{32}$/i.test(saltHex ?? '')
        || !/^[a-f0-9]{64}$/i.test(expectedHex ?? '')
    ) {
        return false;
    }

    try {
        const expected = Buffer.from(expectedHex, 'hex');
        const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
            N: SCRYPT_COST,
            r: SCRYPT_BLOCK_SIZE,
            p: SCRYPT_PARALLELIZATION,
            maxmem: SCRYPT_MAX_MEMORY,
        });
        return safeEqual(derived, expected);
    } catch {
        return false;
    }
};

const verifyLegacySha256Password = (password: string, stored: string) => {
    const [salt, expectedHex, ...rest] = stored.split(':');
    if (
        rest.length > 0
        || !/^[a-f0-9]{32}$/i.test(salt ?? '')
        || !/^[a-f0-9]{64}$/i.test(expectedHex ?? '')
    ) {
        return false;
    }

    const derived = createHash('sha256').update(salt + password).digest();
    return safeEqual(derived, Buffer.from(expectedHex, 'hex'));
};

export function hashPassword(password: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, PASSWORD_HASH_SIZE, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
    });

    return [
        PASSWORD_HASH_PREFIX,
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELIZATION,
        salt.toString('hex'),
        derived.toString('hex'),
    ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
    if (stored.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
        return verifyScryptPassword(password, stored);
    }

    return verifyLegacySha256Password(password, stored);
}

export const verifyDummyPassword = (password: string): boolean => (
    verifyScryptPassword(password, DUMMY_PASSWORD_HASH)
);

export const passwordHashNeedsUpgrade = (stored: string) => (
    !stored.startsWith(`${PASSWORD_HASH_PREFIX}$`)
);
