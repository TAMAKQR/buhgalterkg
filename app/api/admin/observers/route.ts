import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';

import { prisma } from '@/lib/db';
import { Prisma, UserRole } from '@prisma/client';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { hashPassword } from '@/lib/password';
import { getCountryFromRequest } from '@/lib/server/request-country';

const createObserverSchema = z.object({
    displayName: z.string().trim().min(1).max(100),
    loginName: z.string()
        .trim()
        .min(3)
        .max(50)
        .regex(/^[a-zA-Z0-9_]+$/, 'Только латиница, цифры и _')
        .transform((value) => value.toLowerCase()),
    password: z.string().min(6).max(100),
    hotelId: z.string().cuid(),
});


// GET /api/admin/observers — list all observers
export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const { searchParams } = new URL(request.url);
        const hotelId = searchParams.get('hotelId');

        const observers = await prisma.user.findMany({
            where: {
                role: UserRole.OBSERVER,
                assignments: {
                    some: {
                        isActive: true,
                        role: UserRole.OBSERVER,
                    },
                },
            },
            include: {
                assignments: {
                    where: {
                        isActive: true,
                        role: UserRole.OBSERVER,
                    },
                    include: { hotel: { select: { id: true, name: true, country: true } } },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                },
            },
            orderBy: { displayName: 'asc' },
        });

        const scopedObservers = observers.filter((observer) => {
            const primaryAssignment = observer.assignments[0];
            return primaryAssignment?.hotel.country === country
                && (!hotelId || primaryAssignment.hotel.id === hotelId);
        });

        return NextResponse.json(
            scopedObservers.map((obs) => ({
                id: obs.id,
                displayName: obs.displayName,
                loginName: obs.loginName,
                hotels: obs.assignments.slice(0, 1).map((a) => ({
                    id: a.hotel.id,
                    name: a.hotel.name,
                    assignmentId: a.id,
                    isActive: a.isActive,
                })),
                createdAt: obs.createdAt.toISOString(),
            }))
        );
    } catch (error) {
        return handleApiError(error, 'Failed to list observers');
    }
}

// POST /api/admin/observers — create a new observer
export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const body = await request.json();
        const { displayName, loginName, password, hotelId } = createObserverSchema.parse(body);

        const loginHash = hashPassword(password);

        const observer = await prisma.$transaction(async (tx) => {
            const hotel = await tx.hotel.findFirst({
                where: { id: hotelId, country },
                select: { id: true },
            });
            if (!hotel) {
                throw new SessionError('Отель не найден', 404);
            }

            // Lock every legacy spelling of the login before deciding whether it can be reused.
            const matchingUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "User"
                WHERE LOWER("login_name") = ${loginName}
                ORDER BY "id"
                FOR UPDATE
            `);

            if (matchingUsers.length > 0) {
                const matchingIds = matchingUsers.map((user) => user.id);
                const existingAccounts = await tx.user.findMany({
                    where: { id: { in: matchingIds } },
                    select: {
                        id: true,
                        role: true,
                        assignments: {
                            where: { isActive: true },
                            select: { id: true },
                            take: 1,
                        },
                    },
                });

                const loginIsBusy = existingAccounts.some((account) => (
                    (account.role !== UserRole.MANAGER && account.role !== UserRole.OBSERVER)
                    || account.assignments.length > 0
                ));
                if (loginIsBusy) {
                    throw new SessionError('Логин уже занят', 409);
                }

                // Keep dormant users and their audit history, but release their credentials.
                await tx.user.updateMany({
                    where: { id: { in: matchingIds } },
                    data: { loginName: null, loginHash: null },
                });
            }

            return tx.user.create({
                data: {
                    telegramId: `observer-${randomBytes(8).toString('hex')}`,
                    displayName,
                    loginName,
                    loginHash,
                    role: UserRole.OBSERVER,
                    assignments: {
                        create: {
                            hotelId,
                            role: UserRole.OBSERVER,
                            isActive: true,
                        },
                    },
                },
                include: {
                    assignments: {
                        include: { hotel: { select: { id: true, name: true } } },
                    },
                },
            });
        });

        return NextResponse.json({
            id: observer.id,
            displayName: observer.displayName,
            loginName: observer.loginName,
            hotels: observer.assignments.map((a) => ({
                id: a.hotel.id,
                name: a.hotel.name,
                assignmentId: a.id,
                isActive: a.isActive,
            })),
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues.map((i) => i.message).join(', '), { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse('Логин уже занят', { status: 409 });
        }
        return handleApiError(error, 'Failed to create observer');
    }
}
