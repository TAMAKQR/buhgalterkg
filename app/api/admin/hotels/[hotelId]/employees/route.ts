import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const payTypeSchema = z.enum(['MONTHLY', 'SHIFT', 'ROOM', 'PERCENT', 'OTHER']);
const employeeFields = {
    fullName: z.string().trim().min(2).max(100),
    position: z.string().trim().min(2).max(80),
    payType: payTypeSchema,
    payAmount: z.number().int().min(0).max(2_000_000_000),
    turnoverThreshold: z.number().int().positive().max(2_000_000_000).nullable().optional(),
    highPayAmount: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
};
const createSchema = z.object(employeeFields);
const updateSchema = z.object({
    id: z.string().cuid(),
    ...Object.fromEntries(Object.entries(employeeFields).map(([key, value]) => [key, value.optional()])),
    isActive: z.boolean().optional(),
});
const archiveSchema = z.object({ id: z.string().cuid() });

const findHotel = (hotelId: string, country: string) => prisma.hotel.findFirst({
    where: { id: hotelId, country },
    select: { id: true },
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const payload = createSchema.parse(await request.json());
        const hotel = await findHotel(hotelId, getCountryFromRequest(request));
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });
        const employee = await prisma.hotelEmployee.create({
            data: { hotelId, ...payload, hiredAt: new Date() },
        });
        return NextResponse.json({ employee }, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) return new NextResponse(error.issues[0]?.message ?? 'Проверьте сотрудника', { status: 400 });
        return handleApiError(error, 'Не удалось добавить сотрудника');
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const payload = updateSchema.parse(await request.json());
        const hotel = await findHotel(hotelId, getCountryFromRequest(request));
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });
        const existing = await prisma.hotelEmployee.findFirst({ where: { id: payload.id, hotelId }, select: { id: true } });
        if (!existing) return new NextResponse('Сотрудник не найден', { status: 404 });
        const { id, isActive, ...fields } = payload;
        const employee = await prisma.hotelEmployee.update({
            where: { id },
            data: {
                ...fields,
                ...(isActive !== undefined ? {
                    isActive,
                    dismissedAt: isActive ? null : new Date(),
                    ...(isActive ? { hiredAt: new Date() } : {}),
                } : {}),
            },
        });
        return NextResponse.json({ employee });
    } catch (error) {
        if (error instanceof z.ZodError) return new NextResponse(error.issues[0]?.message ?? 'Проверьте сотрудника', { status: 400 });
        return handleApiError(error, 'Не удалось изменить сотрудника');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const payload = archiveSchema.parse(await request.json());
        const hotel = await findHotel(hotelId, getCountryFromRequest(request));
        if (!hotel) return new NextResponse('Объект не найден', { status: 404 });
        const result = await prisma.hotelEmployee.updateMany({
            where: { id: payload.id, hotelId },
            data: { isActive: false, dismissedAt: new Date() },
        });
        if (!result.count) return new NextResponse('Сотрудник не найден', { status: 404 });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof z.ZodError) return new NextResponse(error.issues[0]?.message ?? 'Проверьте сотрудника', { status: 400 });
        return handleApiError(error, 'Не удалось изменить статус сотрудника');
    }
}
