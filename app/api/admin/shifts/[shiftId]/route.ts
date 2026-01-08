import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ShiftStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';

const updateShiftSchema = z
    .object({
        managerId: z.string().cuid().optional(),
        openingCash: z.number().int().nonnegative().optional(),
        closingCash: z.number().int().nonnegative().nullable().optional(),
        handoverCash: z.number().int().nonnegative().nullable().optional(),
        openingNote: z.string().max(500).nullable().optional(),
        closingNote: z.string().max(500).nullable().optional(),
        handoverNote: z.string().max(500).nullable().optional(),
        status: z.nativeEnum(ShiftStatus).optional(),
        openedAt: z.string().datetime().optional(),
        closedAt: z.string().datetime().nullable().optional()
    })
    .refine((values) => Object.keys(values).length > 0, {
        message: 'Нет данных для обновления'
    });

const normalizeNullableString = (value?: string | null) => {
    if (value === undefined) {
        return undefined;
    }
    return value ?? null;
};

function normalizeDate(value?: string | null): Date | undefined;
function normalizeDate(value: string | null | undefined, allowNull: true): Date | null | undefined;
function normalizeDate(value?: string | null, allowNull = false) {
    if (value === undefined) {
        return undefined;
    }
    if (!value) {
        return allowNull ? null : undefined;
    }
    return new Date(value);
}

export async function PATCH(request: NextRequest, { params }: { params: { shiftId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = updateShiftSchema.parse(body);

        const shift = await prisma.shift.findUnique({ where: { id: params.shiftId } });
        if (!shift) {
            return new NextResponse('Shift not found', { status: 404 });
        }

        const data: Prisma.ShiftUpdateInput = {};

        // Обновление менеджера смены
        if (payload.managerId) {
            const assignment = await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: shift.hotelId,
                    userId: payload.managerId,
                    isActive: true
                }
            });

            if (!assignment) {
                return new NextResponse('Менеджер не назначен на этот отель', { status: 400 });
            }

            data.manager = { connect: { id: payload.managerId } };
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'openingCash')) {
            data.openingCash = payload.openingCash as number;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'closingCash')) {
            data.closingCash = payload.closingCash ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'handoverCash')) {
            data.handoverCash = payload.handoverCash ?? null;
        }

        const openingNote = normalizeNullableString(payload.openingNote);
        if (openingNote !== undefined) {
            data.openingNote = openingNote;
        }

        const closingNote = normalizeNullableString(payload.closingNote);
        if (closingNote !== undefined) {
            data.closingNote = closingNote;
        }

        const handoverNote = normalizeNullableString(payload.handoverNote);
        if (handoverNote !== undefined) {
            data.handoverNote = handoverNote;
        }

        const openedAt = normalizeDate(payload.openedAt);
        if (openedAt !== undefined) {
            data.openedAt = openedAt;
        }

        let closedAt = normalizeDate(payload.closedAt, true);
        if (payload.status) {
            if (payload.status === ShiftStatus.OPEN && shift.status !== ShiftStatus.OPEN) {
                const otherActiveShift = await prisma.shift.findFirst({
                    where: {
                        hotelId: shift.hotelId,
                        status: ShiftStatus.OPEN,
                        NOT: { id: shift.id }
                    },
                    select: { id: true }
                });
                if (otherActiveShift) {
                    return new NextResponse('На этой точке уже есть активная смена', { status: 409 });
                }
                data.status = ShiftStatus.OPEN;
                data.closedAt = closedAt ?? null;
                if (!Object.prototype.hasOwnProperty.call(payload, 'closingCash')) {
                    data.closingCash = null;
                }
                if (!Object.prototype.hasOwnProperty.call(payload, 'handoverCash')) {
                    data.handoverCash = null;
                }
            }
            if (payload.status === ShiftStatus.CLOSED) {
                data.status = ShiftStatus.CLOSED;
                if (closedAt === undefined) {
                    closedAt = shift.closedAt ?? new Date();
                }
                data.closedAt = closedAt;
            }
        } else if (closedAt !== undefined) {
            data.closedAt = closedAt;
        }

        const updated = await prisma.shift.update({
            where: { id: shift.id },
            data,
            include: { manager: true }
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update shift');
    }
}
