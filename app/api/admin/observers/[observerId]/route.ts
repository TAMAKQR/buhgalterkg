import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { Prisma, UserRole } from '@prisma/client';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { hashPassword } from '@/lib/password';
import { getCountryFromRequest } from '@/lib/server/request-country';

const updateSchema = z.object({
    displayName: z.string().min(1).max(100).optional(),
    password: z.string().min(6).max(100).optional(),
});

// PATCH /api/admin/observers/[observerId] — update observer
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ observerId: string }> }) {
    try {
        const { observerId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const body = await request.json();
        const payload = updateSchema.parse(body);

        const observer = await prisma.user.findFirst({
            where: {
                id: observerId,
                role: UserRole.OBSERVER,
                assignments: {
                    some: {
                        isActive: true,
                        role: UserRole.OBSERVER,
                        hotel: { country },
                    },
                },
            },
        });
        if (!observer) {
            return new NextResponse('Доступ управляющего не найден', { status: 404 });
        }

        const data: Record<string, unknown> = {};
        if (payload.displayName) data.displayName = payload.displayName;
        if (payload.password) data.loginHash = hashPassword(payload.password);

        if (Object.keys(data).length === 0) {
            return new NextResponse('Нет данных для обновления', { status: 400 });
        }

        const updated = await prisma.user.update({
            where: { id: observerId },
            data,
            select: { id: true, displayName: true, loginName: true },
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.issues.map((i) => i.message).join(', '), { status: 400 });
        }
        return handleApiError(error, 'Failed to update observer');
    }
}

// DELETE /api/admin/observers/[observerId] — deactivate observer access
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ observerId: string }> }) {
    try {
        const { observerId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        await prisma.$transaction(async (tx) => {
            const lockedUsers = await tx.$queryRaw<Array<{ id: string; role: UserRole }>>(Prisma.sql`
                SELECT "id", "role"
                FROM "User"
                WHERE "id" = ${observerId}
                FOR UPDATE
            `);
            const observer = lockedUsers[0];
            if (!observer || observer.role !== UserRole.OBSERVER) {
                throw new SessionError('Доступ управляющего не найден', 404);
            }

            const scopedActiveAssignments = await tx.hotelAssignment.count({
                where: {
                    userId: observerId,
                    role: UserRole.OBSERVER,
                    isActive: true,
                    hotel: { country },
                },
            });
            if (scopedActiveAssignments === 0) {
                throw new SessionError('Доступ управляющего не найден', 404);
            }

            await tx.hotelAssignment.updateMany({
                where: {
                    userId: observerId,
                    role: UserRole.OBSERVER,
                    hotel: { country },
                },
                data: {
                    isActive: false,
                    pinCode: null,
                    pinHash: null,
                },
            });

            const activeAssignmentsCount = await tx.hotelAssignment.count({
                where: { userId: observerId, isActive: true },
            });

            if (activeAssignmentsCount === 0) {
                await tx.user.update({
                    where: { id: observerId },
                    data: { loginName: null, loginHash: null },
                });
            }
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete observer');
    }
}
