import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { Prisma, UserRole } from '@prisma/client';
import { hashPin, verifyPin } from '@/lib/pin';

export const dynamic = 'force-dynamic';
const MANUAL_TELEGRAM_PREFIX = 'manual-';
const PIN_CONFLICT_MESSAGE = 'Этот PIN уже используется другим менеджером';
const PIN_SPLIT_MESSAGE = 'PIN назначен нескольким людям. Обновите существующие назначения';
const LOGIN_CONFLICT_MESSAGE = 'Этот логин уже используется другим пользователем';
const loginNameSchema = z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'Логин может содержать только латиницу, цифры и _');
const assignmentSchema = z.object({
    hotelId: z.string().cuid(),
    displayName: z.string().min(2).max(64),
    loginName: loginNameSchema,
    username: z.string().min(3).max(32).optional(),
    pinCode: z.string().regex(/^[\d]{6}$/),
    telegramId: z.string().min(3).max(32).optional(),
    shiftPayAmount: z.number().int().nonnegative().optional(),
    revenueSharePct: z.number().int().min(0).max(100).optional()
});

const updateAssignmentSchema = z
    .object({
        assignmentId: z.string().cuid(),
        displayName: z.string().min(2).max(64).optional(),
        loginName: loginNameSchema.optional(),
        username: z.string().min(3).max(32).optional(),
        pinCode: z.string().regex(/^[\d]{6}$/).optional(),
        shiftPayAmount: z.number().int().nonnegative().optional(),
        revenueSharePct: z.number().int().min(0).max(100).optional()
    })
    .refine(
        (values) =>
            values.displayName !== undefined ||
            values.loginName !== undefined ||
            values.username !== undefined ||
            values.pinCode !== undefined ||
            values.shiftPayAmount !== undefined ||
            values.revenueSharePct !== undefined,
        {
            message: 'Нет данных для обновления'
        }
    );

const deleteAssignmentSchema = z.object({
    assignmentId: z.string().cuid()
});

const normalizeLoginName = (value: string) => value.trim().toLowerCase();

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = assignmentSchema.parse(body);
        const managerName = payload.displayName.trim();
        const normalizedLoginName = normalizeLoginName(payload.loginName);
        const normalizedUsername = payload.username?.trim();
        const normalizedTelegramId = payload.telegramId?.trim();

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        let user;
        const loginOwner = await prisma.user.findUnique({
            where: { loginName: normalizedLoginName },
            select: { id: true, telegramId: true }
        });

        if (normalizedTelegramId) {
            if (loginOwner && loginOwner.telegramId !== normalizedTelegramId) {
                return new NextResponse(LOGIN_CONFLICT_MESSAGE, { status: 409 });
            }

            const upsertUpdate: Prisma.UserUpdateInput = {
                displayName: managerName,
                loginName: normalizedLoginName,
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
                    loginName: normalizedLoginName,
                    username: normalizedUsername ?? null,
                    role: UserRole.MANAGER
                }
            });
        } else {
            const pinAssignments = await prisma.hotelAssignment.findMany({
                where: { isActive: true },
                include: { user: true }
            });
            const matchingPinAssignments = pinAssignments.filter((assignment) => verifyPin(payload.pinCode, assignment));
            const uniqueUsers = new Set(matchingPinAssignments.map((assignment) => assignment.userId));
            if (uniqueUsers.size > 1) {
                return new NextResponse(PIN_SPLIT_MESSAGE, { status: 409 });
            }

            const activeOwner = matchingPinAssignments[0]?.user;
            if (loginOwner && (!activeOwner || loginOwner.id !== activeOwner.id)) {
                return new NextResponse(LOGIN_CONFLICT_MESSAGE, { status: 409 });
            }

            if (activeOwner) {
                const userUpdates: Prisma.UserUpdateInput = {
                    displayName: managerName,
                    loginName: normalizedLoginName
                };
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
                        loginName: normalizedLoginName,
                        username: normalizedUsername ?? null,
                        role: UserRole.MANAGER
                    }
                });
            }
        }

        const otherActiveAssignments = await prisma.hotelAssignment.findMany({
            where: {
                isActive: true,
                NOT: {
                    userId: user.id
                }
            },
            select: { id: true, pinCode: true, pinHash: true }
        });

        if (otherActiveAssignments.some((assignment) => verifyPin(payload.pinCode, assignment))) {
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
                pinCode: payload.pinCode,
                pinHash: hashPin(payload.pinCode),
                shiftPayAmount: payload.shiftPayAmount ?? null,
                revenueSharePct: payload.revenueSharePct ?? null
            },
            create: {
                hotelId: payload.hotelId,
                userId: user.id,
                role: UserRole.MANAGER,
                pinCode: payload.pinCode,
                pinHash: hashPin(payload.pinCode),
                shiftPayAmount: payload.shiftPayAmount ?? null,
                revenueSharePct: payload.revenueSharePct ?? null
            }
        });

        return NextResponse.json({
            assignmentId: assignment.id,
            manager: {
                id: user.id,
                displayName: user.displayName,
                telegramId: user.telegramId,
                loginName: user.loginName,
                username: user.username,
                pinCode: assignment.pinCode,
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to assign manager');
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = updateAssignmentSchema.parse(body);

        const assignment = await prisma.hotelAssignment.findUnique({
            where: { id: payload.assignmentId },
            include: { user: true }
        });

        if (!assignment) {
            return new NextResponse('Assignment not found', { status: 404 });
        }

        const userUpdates: { displayName?: string; loginName?: string; username?: string | null } = {};

        if (payload.displayName) {
            userUpdates.displayName = payload.displayName.trim();
        }
        if (payload.loginName) {
            const normalizedLoginName = normalizeLoginName(payload.loginName);
            const loginConflict = await prisma.user.findFirst({
                where: {
                    loginName: normalizedLoginName,
                    NOT: { id: assignment.userId }
                },
                select: { id: true }
            });

            if (loginConflict) {
                return new NextResponse(LOGIN_CONFLICT_MESSAGE, { status: 409 });
            }

            userUpdates.loginName = normalizedLoginName;
        }
        if (payload.username) {
            userUpdates.username = payload.username.trim();
        }

        const operations: Prisma.PrismaPromise<unknown>[] = [];
        const assignmentUpdates: Prisma.HotelAssignmentUpdateInput = {};

        if (Object.keys(userUpdates).length) {
            operations.push(
                prisma.user.update({
                    where: { id: assignment.userId },
                    data: userUpdates
                })
            );
        }

        if (payload.pinCode) {
            const activeAssignments = await prisma.hotelAssignment.findMany({
                where: {
                    isActive: true,
                    NOT: { userId: assignment.userId }
                },
                select: { id: true, pinCode: true, pinHash: true }
            });
            const pinConflict = activeAssignments.some((candidate) => verifyPin(payload.pinCode as string, candidate));

            if (pinConflict) {
                return new NextResponse(PIN_CONFLICT_MESSAGE, { status: 409 });
            }

            operations.push(
                prisma.hotelAssignment.updateMany({
                    where: { userId: assignment.userId },
                    data: {
                        pinCode: payload.pinCode,
                        pinHash: hashPin(payload.pinCode)
                    }
                })
            );
        }

        if (payload.shiftPayAmount !== undefined) {
            assignmentUpdates.shiftPayAmount = payload.shiftPayAmount;
        }

        if (payload.revenueSharePct !== undefined) {
            assignmentUpdates.revenueSharePct = payload.revenueSharePct;
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
                loginName: updated.user.loginName,
                username: updated.user.username,
                pinCode: updated.pinCode,
                shiftPayAmount: updated.shiftPayAmount,
                revenueSharePct: updated.revenueSharePct
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update manager assignment');
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = deleteAssignmentSchema.parse(body);

        const assignment = await prisma.hotelAssignment.findUnique({ where: { id: payload.assignmentId } });
        if (!assignment) {
            return new NextResponse('Assignment not found', { status: 404 });
        }

        await prisma.hotelAssignment.update({
            where: { id: assignment.id },
            data: {
                isActive: false,
                pinCode: null,
                pinHash: null
            }
        });

        return NextResponse.json({ success: true, assignmentId: assignment.id });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to remove manager');
    }
}
