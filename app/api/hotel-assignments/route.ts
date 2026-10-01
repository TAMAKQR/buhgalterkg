import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { Prisma, UserRole } from '@prisma/client';
import { hasConfiguredPin, hashPin, verifyPin } from '@/lib/pin';

export const dynamic = 'force-dynamic';
const INTERNAL_USER_PREFIX = 'manager-';
const PIN_CONFLICT_MESSAGE = 'Этот PIN уже используется другим менеджером';
const PIN_SPLIT_MESSAGE = 'PIN назначен нескольким людям. Обновите существующие назначения';
const LOGIN_CONFLICT_MESSAGE = 'Этот логин уже используется другим пользователем';
const ACCESS_RETRY_MESSAGE = 'Доступ сейчас изменяется. Повторите попытку';
const MANAGER_ACCESS_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;
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
    pinCode: z.string().regex(/^[\d]{6}$/),
    shiftPayAmount: z.number().int().nonnegative().optional(),
    revenueSharePct: z.number().int().min(0).max(100).optional(),
    canEditBookings: z.boolean().optional(),
    canEditStayPayments: z.boolean().optional(),
    canCancelBookings: z.boolean().optional()
});

const updateAssignmentSchema = z
    .object({
        assignmentId: z.string().cuid(),
        displayName: z.string().min(2).max(64).optional(),
        loginName: loginNameSchema.optional(),
        pinCode: z.string().regex(/^[\d]{6}$/).optional(),
        shiftPayAmount: z.number().int().nonnegative().optional(),
        revenueSharePct: z.number().int().min(0).max(100).optional(),
        canEditBookings: z.boolean().optional(),
        canEditStayPayments: z.boolean().optional(),
        canCancelBookings: z.boolean().optional()
    })
    .refine(
        (values) =>
            values.displayName !== undefined ||
            values.loginName !== undefined ||
            values.pinCode !== undefined ||
            values.shiftPayAmount !== undefined ||
            values.revenueSharePct !== undefined ||
            values.canEditBookings !== undefined ||
            values.canEditStayPayments !== undefined ||
            values.canCancelBookings !== undefined,
        {
            message: 'Нет данных для обновления'
        }
    );

const deleteAssignmentSchema = z.object({
    assignmentId: z.string().cuid()
});

const normalizeLoginName = (value: string) => value.trim().toLowerCase();

const lockManagerAccessMutations = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
        WITH manager_access_lock AS (
            SELECT pg_advisory_xact_lock(1213480276, 1296126535)
        )
        SELECT 1 AS "locked"
        FROM manager_access_lock
    `);
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = assignmentSchema.parse(body);
        const managerName = payload.displayName.trim();
        const normalizedLoginName = normalizeLoginName(payload.loginName);

        const { user, assignment } = await prisma.$transaction(async (tx) => {
            await lockManagerAccessMutations(tx);

            const hotel = await tx.hotel.findUnique({
                where: { id: payload.hotelId },
                select: { id: true }
            });
            if (!hotel) {
                throw new SessionError('Hotel not found', 404);
            }

            const loginOwners = await tx.user.findMany({
                where: {
                    loginName: { equals: normalizedLoginName, mode: 'insensitive' }
                },
                select: {
                    id: true,
                    role: true,
                    assignments: {
                        where: { isActive: true },
                        select: { id: true },
                        take: 1
                    }
                }
            });

            const pinAssignments = await tx.hotelAssignment.findMany({
                where: {
                    isActive: true,
                    role: UserRole.MANAGER,
                    user: { role: UserRole.MANAGER }
                },
                include: { user: true }
            });
            const matchingPinAssignments = pinAssignments.filter((candidate) => verifyPin(payload.pinCode, candidate));
            const uniqueUsers = new Set(matchingPinAssignments.map((candidate) => candidate.userId));
            if (uniqueUsers.size > 1) {
                throw new SessionError(PIN_SPLIT_MESSAGE, 409);
            }

            const activeOwner = matchingPinAssignments[0]?.user;
            const loginIsBusy = loginOwners.some((loginOwner) => (
                loginOwner.id !== activeOwner?.id
                && (
                    (loginOwner.role !== UserRole.MANAGER && loginOwner.role !== UserRole.OBSERVER)
                    || loginOwner.assignments.length > 0
                )
            ));
            if (loginIsBusy) {
                throw new SessionError(LOGIN_CONFLICT_MESSAGE, 409);
            }

            const dormantLoginOwnerIds = loginOwners
                .filter((loginOwner) => loginOwner.id !== activeOwner?.id)
                .map((loginOwner) => loginOwner.id);
            if (dormantLoginOwnerIds.length > 0) {
                await tx.user.updateMany({
                    where: { id: { in: dormantLoginOwnerIds } },
                    data: { loginName: null, loginHash: null }
                });
            }

            const manager = activeOwner
                ? await tx.user.update({
                    where: { id: activeOwner.id },
                    data: {
                        displayName: managerName,
                        loginName: normalizedLoginName
                    }
                })
                : await tx.user.create({
                    data: {
                        telegramId: `${INTERNAL_USER_PREFIX}${randomUUID()}`,
                        displayName: managerName,
                        loginName: normalizedLoginName,
                        role: UserRole.MANAGER
                    }
                });

            const otherActiveAssignments = pinAssignments.filter((candidate) => candidate.userId !== manager.id);
            if (otherActiveAssignments.some((candidate) => verifyPin(payload.pinCode, candidate))) {
                throw new SessionError(PIN_CONFLICT_MESSAGE, 409);
            }

            const newPinHash = hashPin(payload.pinCode);
            const managerAssignment = await tx.hotelAssignment.upsert({
                where: {
                    hotelId_userId: {
                        hotelId: payload.hotelId,
                        userId: manager.id
                    }
                },
                update: {
                    isActive: true,
                    role: UserRole.MANAGER,
                    pinCode: null,
                    pinHash: newPinHash,
                    shiftPayAmount: payload.shiftPayAmount ?? null,
                    revenueSharePct: payload.revenueSharePct ?? null,
                    canEditBookings: payload.canEditBookings ?? false,
                    canEditStayPayments: payload.canEditStayPayments ?? false,
                    canCancelBookings: payload.canCancelBookings ?? false
                },
                create: {
                    hotelId: payload.hotelId,
                    userId: manager.id,
                    role: UserRole.MANAGER,
                    pinCode: null,
                    pinHash: newPinHash,
                    shiftPayAmount: payload.shiftPayAmount ?? null,
                    revenueSharePct: payload.revenueSharePct ?? null,
                    canEditBookings: payload.canEditBookings ?? false,
                    canEditStayPayments: payload.canEditStayPayments ?? false,
                    canCancelBookings: payload.canCancelBookings ?? false
                }
            });

            return { user: manager, assignment: managerAssignment };
        }, MANAGER_ACCESS_TRANSACTION_OPTIONS);

        return NextResponse.json({
            assignmentId: assignment.id,
            manager: {
                id: user.id,
                displayName: user.displayName,
                loginName: user.loginName,
                hasPin: hasConfiguredPin(assignment),
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct,
                canEditBookings: assignment.canEditBookings,
                canEditStayPayments: assignment.canEditStayPayments,
                canCancelBookings: assignment.canCancelBookings
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse(LOGIN_CONFLICT_MESSAGE, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2028', 'P2034'].includes(error.code)) {
            return new NextResponse(ACCESS_RETRY_MESSAGE, { status: 409 });
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

        const updated = await prisma.$transaction(async (tx) => {
            await lockManagerAccessMutations(tx);

            const assignment = await tx.hotelAssignment.findUnique({
                where: { id: payload.assignmentId },
                include: { user: true }
            });
            if (!assignment || assignment.role !== UserRole.MANAGER || assignment.user.role !== UserRole.MANAGER) {
                throw new SessionError('Assignment not found', 404);
            }

            const userUpdates: { displayName?: string; loginName?: string } = {};
            if (payload.displayName) {
                userUpdates.displayName = payload.displayName.trim();
            }
            if (payload.loginName) {
                const normalizedLoginName = normalizeLoginName(payload.loginName);
                const loginOwners = await tx.user.findMany({
                    where: {
                        loginName: { equals: normalizedLoginName, mode: 'insensitive' },
                        NOT: { id: assignment.userId }
                    },
                    select: {
                        id: true,
                        role: true,
                        assignments: {
                            where: { isActive: true },
                            select: { id: true },
                            take: 1
                        }
                    }
                });
                const loginIsBusy = loginOwners.some((loginOwner) => (
                    (loginOwner.role !== UserRole.MANAGER && loginOwner.role !== UserRole.OBSERVER)
                    || loginOwner.assignments.length > 0
                ));
                if (loginIsBusy) {
                    throw new SessionError(LOGIN_CONFLICT_MESSAGE, 409);
                }
                if (loginOwners.length > 0) {
                    await tx.user.updateMany({
                        where: { id: { in: loginOwners.map((loginOwner) => loginOwner.id) } },
                        data: { loginName: null, loginHash: null }
                    });
                }
                userUpdates.loginName = normalizedLoginName;
            }

            if (Object.keys(userUpdates).length > 0) {
                await tx.user.update({
                    where: { id: assignment.userId },
                    data: userUpdates
                });
            }

            if (payload.pinCode) {
                const activeAssignments = await tx.hotelAssignment.findMany({
                    where: {
                        isActive: true,
                        role: UserRole.MANAGER,
                        user: { role: UserRole.MANAGER },
                        NOT: { userId: assignment.userId }
                    },
                    select: { id: true, pinCode: true, pinHash: true }
                });
                const pinConflict = activeAssignments.some((candidate) => verifyPin(payload.pinCode as string, candidate));
                if (pinConflict) {
                    throw new SessionError(PIN_CONFLICT_MESSAGE, 409);
                }

                await tx.hotelAssignment.updateMany({
                    where: {
                        userId: assignment.userId,
                        role: UserRole.MANAGER,
                        user: { role: UserRole.MANAGER }
                    },
                    data: {
                        pinCode: null,
                        pinHash: hashPin(payload.pinCode)
                    }
                });
            }

            const assignmentUpdates: Prisma.HotelAssignmentUpdateInput = {};
            if (payload.shiftPayAmount !== undefined) {
                assignmentUpdates.shiftPayAmount = payload.shiftPayAmount;
            }
            if (payload.revenueSharePct !== undefined) {
                assignmentUpdates.revenueSharePct = payload.revenueSharePct;
            }
            if (payload.canEditStayPayments !== undefined) {
                assignmentUpdates.canEditStayPayments = payload.canEditStayPayments;
            }
            if (payload.canEditBookings !== undefined) {
                assignmentUpdates.canEditBookings = payload.canEditBookings;
            }
            if (payload.canCancelBookings !== undefined) {
                assignmentUpdates.canCancelBookings = payload.canCancelBookings;
            }
            if (Object.keys(assignmentUpdates).length > 0) {
                await tx.hotelAssignment.update({
                    where: { id: assignment.id },
                    data: assignmentUpdates
                });
            }

            const result = await tx.hotelAssignment.findUnique({
                where: { id: assignment.id },
                include: { user: true }
            });
            if (!result) {
                throw new SessionError('Assignment not found', 404);
            }
            return result;
        }, MANAGER_ACCESS_TRANSACTION_OPTIONS);

        return NextResponse.json({
            assignmentId: updated.id,
            manager: {
                id: updated.user.id,
                displayName: updated.user.displayName,
                loginName: updated.user.loginName,
                hasPin: hasConfiguredPin(updated),
                shiftPayAmount: updated.shiftPayAmount,
                revenueSharePct: updated.revenueSharePct,
                canEditBookings: updated.canEditBookings,
                canEditStayPayments: updated.canEditStayPayments,
                canCancelBookings: updated.canCancelBookings
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new NextResponse(LOGIN_CONFLICT_MESSAGE, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2028', 'P2034'].includes(error.code)) {
            return new NextResponse(ACCESS_RETRY_MESSAGE, { status: 409 });
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

        await prisma.$transaction(async (tx) => {
            await lockManagerAccessMutations(tx);

            const assignment = await tx.hotelAssignment.findUnique({
                where: { id: payload.assignmentId },
                select: {
                    id: true,
                    userId: true,
                    role: true,
                    user: { select: { role: true } }
                }
            });
            if (!assignment || assignment.role !== UserRole.MANAGER || assignment.user.role !== UserRole.MANAGER) {
                throw new SessionError('Assignment not found', 404);
            }

            const lockedUsers = await tx.$queryRaw<Array<{ id: string; role: UserRole }>>(Prisma.sql`
                SELECT "id", "role"
                FROM "User"
                WHERE "id" = ${assignment.userId}
                FOR UPDATE
            `);
            if (lockedUsers[0]?.role !== UserRole.MANAGER) {
                throw new SessionError('Assignment not found', 404);
            }

            await tx.hotelAssignment.update({
                where: { id: assignment.id },
                data: {
                    isActive: false,
                    pinCode: null,
                    pinHash: null
                }
            });

            const activeAssignmentsCount = await tx.hotelAssignment.count({
                where: { userId: assignment.userId, isActive: true }
            });

            if (activeAssignmentsCount === 0) {
                await tx.user.update({
                    where: { id: assignment.userId },
                    data: { loginName: null, loginHash: null }
                });
            }
        }, {
            ...MANAGER_ACCESS_TRANSACTION_OPTIONS,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });

        return NextResponse.json({ success: true, assignmentId: payload.assignmentId });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2028', 'P2034'].includes(error.code)) {
            return new NextResponse(ACCESS_RETRY_MESSAGE, { status: 409 });
        }
        return handleApiError(error, 'Failed to remove manager');
    }
}
