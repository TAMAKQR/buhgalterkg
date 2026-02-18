import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';

import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { hashPassword } from '@/lib/password';

const createObserverSchema = z.object({
    displayName: z.string().min(1).max(100),
    loginName: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Только латиница, цифры и _'),
    password: z.string().min(6).max(100),
    hotelId: z.string().cuid(),
});


// GET /api/admin/observers — list all observers
export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const { searchParams } = new URL(request.url);
        const hotelId = searchParams.get('hotelId');

        const where: Record<string, unknown> = {
            role: UserRole.OBSERVER,
        };

        if (hotelId) {
            where.assignments = {
                some: { hotelId, isActive: true },
            };
        }

        const observers = await prisma.user.findMany({
            where,
            include: {
                assignments: {
                    where: { isActive: true },
                    include: { hotel: { select: { id: true, name: true } } },
                },
            },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(
            observers.map((obs) => ({
                id: obs.id,
                displayName: obs.displayName,
                loginName: obs.loginName,
                hotels: obs.assignments.map((a) => ({
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

        const body = await request.json();
        const { displayName, loginName, password, hotelId } = createObserverSchema.parse(body);

        // Check login name uniqueness
        const existing = await prisma.user.findUnique({ where: { loginName } });
        if (existing) {
            return new NextResponse('Логин уже занят', { status: 409 });
        }

        // Check hotel exists
        const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const loginHash = hashPassword(password);

        const observer = await prisma.user.create({
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
        return handleApiError(error, 'Failed to create observer');
    }
}
