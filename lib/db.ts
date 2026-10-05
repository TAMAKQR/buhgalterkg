import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as { prisma?: PrismaClient };

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.PRISMA_LOG_QUERIES === 'true'
            ? ['query', 'error', 'warn']
            : ['error', 'warn']
    });

// Next.js can evaluate server modules from more than one route bundle. Keeping
// the client on globalThis makes every route in this Node process share one
// connection pool instead of allocating a new Prisma engine per bundle.
globalForPrisma.prisma = prisma;
