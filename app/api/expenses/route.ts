import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const expenseSchema = z.object({
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid().optional(),
    amount: z.number().int().positive(),
    method: z.nativeEnum(PaymentMethod),
    entryType: z.nativeEnum(LedgerEntryType),
    note: z.string().optional()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = expenseSchema.parse(body);

        assertHotelAccess(session, payload.hotelId);

        let managerId = session.id;
        if (payload.shiftId) {
            const shift = await prisma.shift.findUnique({ where: { id: payload.shiftId } });
            if (!shift || shift.hotelId !== payload.hotelId) {
                return new NextResponse('Смена не найдена или принадлежит другой точке', { status: 400 });
            }
            managerId = shift.managerId;
        }

        const entry = await prisma.cashEntry.create({
            data: {
                hotelId: payload.hotelId,
                shiftId: payload.shiftId,
                managerId,
                recordedAt: new Date(),
                amount: payload.amount,
                method: payload.method,
                entryType: payload.entryType,
                note: payload.note,
                // cashDelta can be derived later from payment method
            }
        });

        return NextResponse.json(entry, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to record expense');
    }
}
