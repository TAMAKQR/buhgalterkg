import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { Prisma, UserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';
const assignmentSchema = z.object({
    hotelId: z.string().cuid(),
    telegramId: z.string().min(3).max(32),
    displayName: z.string().min(2).max(64),
    username: z.string().min(3).max(32).optional(),
    pinCode: z.string().regex(/^\d{6}$/)
});

const updateAssignmentSchema = z
    .object({
        assignmentId: z.string().cuid(),
        displayName: z.string().min(2).max(64).optional(),
        username: z.string().min(3).max(32).optional(),
        pinCode: z.string().regex(/^\d{6}$/).optional()
    })
    .refine((values) => values.displayName || values.username || values.pinCode, {
        message: 'Нет данных для обновления'
    });

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = assignmentSchema.parse(rest);

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const user = await prisma.user.upsert({
            where: { telegramId: payload.telegramId },
            update: {
                displayName: payload.displayName,
                username: payload.username,
                role: UserRole.MANAGER
            },
            create: {
                telegramId: payload.telegramId,
                displayName: payload.displayName,
                username: payload.username,
                role: UserRole.MANAGER
            }
        });

        const assignment = await prisma.hotelAssignment.upsert({
            where: {
                hotelId_userId: {
                    hotelId: payload.hotelId,
                    userId: user.id
                }
            },
            update: {
                isActive: true,
                role: UserRole.MANAGER,
                pinCode: payload.pinCode
            },
            create: {
                hotelId: payload.hotelId,
                userId: user.id,
                role: UserRole.MANAGER,
                pinCode: payload.pinCode
            }
        });

        return NextResponse.json({
            assignmentId: assignment.id,
            manager: {
                id: user.id,
                displayName: user.displayName,
                telegramId: user.telegramId,
                username: user.username,
                pinCode: payload.pinCode
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to assign manager', { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = updateAssignmentSchema.parse(rest);

        const assignment = await prisma.hotelAssignment.findUnique({
            where: { id: payload.assignmentId },
            include: { user: true }
        });

        if (!assignment) {
            return new NextResponse('Assignment not found', { status: 404 });
        }

        const userUpdates: { displayName?: string; username?: string | null } = {};
        const assignmentUpdates: { pinCode?: string } = {};

        if (payload.displayName) {
            userUpdates.displayName = payload.displayName;
        }
        if (payload.username) {
            userUpdates.username = payload.username;
        }
        if (payload.pinCode) {
            assignmentUpdates.pinCode = payload.pinCode;
        }

        const operations: Prisma.PrismaPromise<unknown>[] = [];

        if (Object.keys(userUpdates).length) {
            operations.push(
                prisma.user.update({
                    where: { id: assignment.userId },
                    data: userUpdates
                })
            );
        }

        if (Object.keys(assignmentUpdates).length) {
            operations.push(
                prisma.hotelAssignment.update({
                    where: { id: assignment.id },
                    data: assignmentUpdates
                })
            );
        }

        if (operations.length) {
            await prisma.$transaction(operations);
        }

        const updated = await prisma.hotelAssignment.findUnique({
            where: { id: assignment.id },
            include: { user: true }
        });

        if (!updated) {
            return new NextResponse('Assignment not found', { status: 404 });
        }

        return NextResponse.json({
            assignmentId: updated.id,
            manager: {
                id: updated.user.id,
                displayName: updated.user.displayName,
                telegramId: updated.user.telegramId,
                username: updated.user.username,
                pinCode: updated.pinCode
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to update manager assignment', { status: 500 });
    }
}
