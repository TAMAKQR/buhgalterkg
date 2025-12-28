import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { Prisma, UserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';
const MANUAL_TELEGRAM_PREFIX = 'manual-';
const PIN_CONFLICT_MESSAGE = 'Этот PIN уже используется другим менеджером';
const PIN_SPLIT_MESSAGE = 'PIN назначен нескольким людям. Обновите существующие назначения';
const assignmentSchema = z.object({
    hotelId: z.string().cuid(),
    displayName: z.string().min(2).max(64),
    username: z.string().min(3).max(32).optional(),
    pinCode: z.string().regex(/^[\d]{6}$/),
    telegramId: z.string().min(3).max(32).optional()
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

const deleteAssignmentSchema = z.object({
    assignmentId: z.string().cuid()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = assignmentSchema.parse(rest);
        const managerName = payload.displayName.trim();
        const normalizedUsername = payload.username?.trim();
        const normalizedTelegramId = payload.telegramId?.trim();

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        let user;
        if (normalizedTelegramId) {
            const upsertUpdate: Prisma.UserUpdateInput = {
                displayName: managerName,
                role: UserRole.MANAGER
            };
            if (normalizedUsername !== undefined) {
                upsertUpdate.username = normalizedUsername;
            }

            user = await prisma.user.upsert({
                where: { telegramId: normalizedTelegramId },
                update: upsertUpdate,
                create: {
                    telegramId: normalizedTelegramId,
                    displayName: managerName,
                    username: normalizedUsername ?? null,
                    role: UserRole.MANAGER
                }
            });
        } else {
            const pinAssignments = await prisma.hotelAssignment.findMany({
                where: { pinCode: payload.pinCode, isActive: true },
                include: { user: true }
            });
            const uniqueUsers = new Set(pinAssignments.map((assignment) => assignment.userId));
            if (uniqueUsers.size > 1) {
                return new NextResponse(PIN_SPLIT_MESSAGE, { status: 409 });
            }

            const activeOwner = pinAssignments[0]?.user;
            if (activeOwner) {
                const userUpdates: Prisma.UserUpdateInput = { displayName: managerName };
                if (normalizedUsername !== undefined) {
                    userUpdates.username = normalizedUsername;
                }
                user = await prisma.user.update({
                    where: { id: activeOwner.id },
                    data: userUpdates
                });
            } else {
                user = await prisma.user.create({
                    data: {
                        telegramId: `${MANUAL_TELEGRAM_PREFIX}${randomUUID()}`,
                        displayName: managerName,
                        username: normalizedUsername ?? null,
                        role: UserRole.MANAGER
                    }
                });
            }
        }

        const pinConflict = await prisma.hotelAssignment.findFirst({
            where: {
                pinCode: payload.pinCode,
                isActive: true,
                NOT: {
                    userId: user.id
                }
            },
            select: { id: true }
        });

        if (pinConflict) {
            return new NextResponse(PIN_CONFLICT_MESSAGE, { status: 409 });
        }

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

        if (payload.displayName) {
            userUpdates.displayName = payload.displayName.trim();
        }
        if (payload.username) {
            userUpdates.username = payload.username.trim();
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

        if (payload.pinCode) {
            const pinConflict = await prisma.hotelAssignment.findFirst({
                where: {
                    pinCode: payload.pinCode,
                    isActive: true,
                    NOT: { userId: assignment.userId }
                },
                select: { id: true }
            });

            if (pinConflict) {
                return new NextResponse(PIN_CONFLICT_MESSAGE, { status: 409 });
            }

            operations.push(
                prisma.hotelAssignment.updateMany({
                    where: { userId: assignment.userId },
                    data: { pinCode: payload.pinCode }
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

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { initData, devOverride, manualToken, ...rest } = body ?? {};
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = deleteAssignmentSchema.parse(rest);

        const assignment = await prisma.hotelAssignment.findUnique({ where: { id: payload.assignmentId } });
        if (!assignment) {
            return new NextResponse('Assignment not found', { status: 404 });
        }

        await prisma.hotelAssignment.update({
            where: { id: assignment.id },
            data: {
                isActive: false,
                pinCode: null
            }
        });

        return NextResponse.json({ success: true, assignmentId: assignment.id });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse('Failed to remove manager', { status: 500 });
    }
}
