import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { hashPassword } from '@/lib/password';

const updateSchema = z.object({
    displayName: z.string().min(1).max(100).optional(),
    password: z.string().min(6).max(100).optional(),
});

// PATCH /api/admin/observers/[observerId] — update observer
export async function PATCH(request: NextRequest, { params }: { params: { observerId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const body = await request.json();
        const payload = updateSchema.parse(body);

        const observer = await prisma.user.findUnique({ where: { id: params.observerId } });
        if (!observer || observer.role !== 'OBSERVER') {
            return new NextResponse('Наблюдатель не найден', { status: 404 });
        }

        const data: Record<string, unknown> = {};
        if (payload.displayName) data.displayName = payload.displayName;
        if (payload.password) data.loginHash = hashPassword(payload.password);

        if (Object.keys(data).length === 0) {
            return new NextResponse('Нет данных для обновления', { status: 400 });
        }

        const updated = await prisma.user.update({
            where: { id: params.observerId },
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

// DELETE /api/admin/observers/[observerId] — delete observer
export async function DELETE(request: NextRequest, { params }: { params: { observerId: string } }) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const observer = await prisma.user.findUnique({ where: { id: params.observerId } });
        if (!observer || observer.role !== 'OBSERVER') {
            return new NextResponse('Наблюдатель не найден', { status: 404 });
        }

        // Delete assignments first, then user
        await prisma.$transaction([
            prisma.hotelAssignment.deleteMany({ where: { userId: params.observerId } }),
            prisma.user.delete({ where: { id: params.observerId } }),
        ]);

        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete observer');
    }
}
