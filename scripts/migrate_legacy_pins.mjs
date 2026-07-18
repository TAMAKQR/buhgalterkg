import { randomBytes, scryptSync } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const PIN_HASH_PREFIX = 'scrypt';
const PIN_HASH_SIZE = 32;
const PIN_SCRYPT_COST = 16_384;
const PIN_SCRYPT_BLOCK_SIZE = 8;
const PIN_SCRYPT_PARALLELIZATION = 1;
const BATCH_SIZE = 50;

const prisma = new PrismaClient();

const hashPin = (pinCode) => {
    const salt = randomBytes(16);
    const derived = scryptSync(pinCode, salt, PIN_HASH_SIZE, {
        N: PIN_SCRYPT_COST,
        r: PIN_SCRYPT_BLOCK_SIZE,
        p: PIN_SCRYPT_PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
    });

    return [
        PIN_HASH_PREFIX,
        PIN_SCRYPT_COST,
        PIN_SCRYPT_BLOCK_SIZE,
        PIN_SCRYPT_PARALLELIZATION,
        salt.toString('hex'),
        derived.toString('hex'),
    ].join('$');
};

let migrated = 0;

try {
    while (true) {
        const assignments = await prisma.hotelAssignment.findMany({
            where: { pinCode: { not: null } },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            select: { id: true, pinCode: true },
        });

        if (assignments.length === 0) {
            break;
        }

        const invalidAssignment = assignments.find(
            (assignment) => !assignment.pinCode || !/^\d{6}$/.test(assignment.pinCode)
        );
        if (invalidAssignment) {
            throw new Error(`Assignment ${invalidAssignment.id} contains an invalid legacy PIN`);
        }

        const updates = assignments.map((assignment) => prisma.hotelAssignment.updateMany({
            where: { id: assignment.id, pinCode: assignment.pinCode },
            data: {
                pinCode: null,
                pinHash: hashPin(assignment.pinCode),
            },
        }));
        const results = await prisma.$transaction(updates);
        migrated += results.reduce((total, result) => total + result.count, 0);
    }

    console.log(`Legacy manager PIN migration complete: ${migrated} assignment(s) upgraded.`);
} finally {
    await prisma.$disconnect();
}
