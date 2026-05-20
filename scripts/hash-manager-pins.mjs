import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

const hashPin = (pinCode) => {
    const salt = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(salt + pinCode).digest('hex');
    return `${salt}:${hash}`;
};

try {
    const assignments = await prisma.hotelAssignment.findMany({
        where: {
            isActive: true,
            pinCode: { not: null },
            pinHash: null
        },
        select: {
            id: true,
            pinCode: true,
            user: {
                select: {
                    displayName: true
                }
            },
            hotel: {
                select: {
                    name: true
                }
            }
        }
    });

    await prisma.$transaction(
        assignments.map((assignment) =>
            prisma.hotelAssignment.update({
                where: { id: assignment.id },
                data: {
                    pinHash: hashPin(assignment.pinCode ?? ''),
                    pinCode: null
                }
            })
        )
    );

    console.table(
        assignments.map((assignment) => ({
            manager: assignment.user.displayName,
            hotel: assignment.hotel.name,
            updated: true
        }))
    );
    console.log(`Hashed ${assignments.length} manager PIN(s).`);
} finally {
    await prisma.$disconnect();
}
