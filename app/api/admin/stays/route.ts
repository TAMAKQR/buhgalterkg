import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LedgerEntryType, PaymentMethod, ShiftStatus, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { normalizeMealPlan } from '@/lib/meal-plan';

export const dynamic = 'force-dynamic';

const createStaySchema = z.object({
    roomId: z.string().cuid(),
    guestName: z.string().max(80).optional().nullable(),
    guestPhone: z.string().max(40).optional().nullable(),
    companyName: z.string().max(120).optional().nullable(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    shiftId: z.string().cuid().optional().nullable(),
    totalAmount: z.number().int().positive(),
    prepaymentAmount: z.number().int().min(0).optional(),
    prepaymentMethod: z.enum(['CASH', 'CARD', 'ONLINE']).optional().nullable(),
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable()
});

const normalizeOptionalText = (value?: string | null) => {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = createStaySchema.parse(body);
        const scheduledCheckIn = new Date(payload.scheduledCheckIn);
        const scheduledCheckOut = new Date(payload.scheduledCheckOut);

        if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
            return new NextResponse('Некорректные даты брони', { status: 400 });
        }

        if (scheduledCheckOut <= scheduledCheckIn) {
            return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
        }

        const room = await prisma.room.findFirst({
            where: {
                id: payload.roomId,
                isActive: true,
                hotel: { country }
            },
            include: { hotel: true }
        });

        if (!room) {
            return new NextResponse('Номер не найден', { status: 404 });
        }

        const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
        const resolvedBookingSource = normalizedBookingSource
            ? resolveBookingSource(normalizedBookingSource, room.hotel.extranetNames)
            : null;

        if (normalizedBookingSource && (!room.hotel.usesExtranets || !resolvedBookingSource)) {
            return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
        }

        const bookingNumber = normalizeOptionalText(payload.bookingNumber);
        if (resolvedBookingSource && !bookingNumber) {
            return new NextResponse('Укажите номер бронирования', { status: 400 });
        }

        const conflictingStay = await prisma.roomStay.findFirst({
            where: {
                roomId: room.id,
                status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                scheduledCheckIn: { lt: scheduledCheckOut },
                scheduledCheckOut: { gt: scheduledCheckIn }
            },
            select: { id: true }
        });

        if (conflictingStay) {
            return new NextResponse('На эти даты у номера уже есть бронь или проживание', { status: 409 });
        }

        const prepaymentAmount = payload.prepaymentAmount ?? 0;
        const prepaymentMethod = prepaymentAmount > 0 ? payload.prepaymentMethod : null;
        if (prepaymentAmount > 0 && !prepaymentMethod) {
            return new NextResponse('Укажите способ предоплаты', { status: 400 });
        }
        if (prepaymentAmount > payload.totalAmount) {
            return new NextResponse('Предоплата не может быть больше общей суммы тарифа', { status: 400 });
        }

        const prepaymentCash = prepaymentMethod === 'CASH' ? prepaymentAmount : 0;
        const prepaymentCard = prepaymentMethod === 'CARD' ? prepaymentAmount : 0;
        const prepaymentOnline = prepaymentMethod === 'ONLINE' ? prepaymentAmount : 0;
        const prepaymentTotal = sumStayPayments({
            cashPaid: prepaymentCash,
            cardPaid: prepaymentCard,
            onlinePaid: prepaymentOnline
        });
        const ledgerPrepaymentMethod = prepaymentMethod === 'CASH'
            ? PaymentMethod.CASH
            : prepaymentMethod === 'CARD'
                ? PaymentMethod.CARD
                : null;

        const requestedShift = payload.shiftId
            ? await prisma.shift.findFirst({
                where: {
                    id: payload.shiftId,
                    hotelId: room.hotelId,
                    status: ShiftStatus.OPEN,
                    hotel: { country }
                },
                select: { id: true, managerId: true }
            })
            : null;

        if (ledgerPrepaymentMethod && !requestedShift) {
            return new NextResponse('Для наличной или безналичной предоплаты нужна активная смена', { status: 400 });
        }

        const stay = await prisma.$transaction(async (tx) => {
            const createdStay = await tx.roomStay.create({
                data: {
                    roomId: room.id,
                    hotelId: room.hotelId,
                    shiftId: requestedShift?.id ?? null,
                    guestName: normalizeOptionalText(payload.guestName),
                    guestPhone: normalizeOptionalText(payload.guestPhone),
                    companyName: normalizeOptionalText(payload.companyName),
                    bookingSource: resolvedBookingSource,
                    bookingNumber,
                    scheduledCheckIn,
                    scheduledCheckOut,
                    status: StayStatus.SCHEDULED,
                    mealPlan: normalizeMealPlan(payload.mealPlan),
                    notes: normalizeOptionalText(payload.notes),
                    amountPaid: prepaymentTotal,
                    totalAmount: payload.totalAmount,
                    paymentMethod: detectStayPaymentMethod({
                        cashPaid: prepaymentCash,
                        cardPaid: prepaymentCard,
                        onlinePaid: prepaymentOnline
                    }),
                    cashPaid: prepaymentCash,
                    cardPaid: prepaymentCard,
                    onlinePaid: prepaymentOnline
                }
            });

            if (ledgerPrepaymentMethod && requestedShift) {
                await tx.cashEntry.create({
                    data: {
                        hotelId: room.hotelId,
                        shiftId: requestedShift.id,
                        managerId: requestedShift.managerId,
                        stayId: createdStay.id,
                        entryType: LedgerEntryType.CASH_IN,
                        method: ledgerPrepaymentMethod,
                        amount: prepaymentAmount,
                        note: `Предоплата №${room.label}`,
                        meta: {
                            source: 'room_stay',
                            kind: 'booking_prepayment',
                            stayId: createdStay.id,
                            roomId: room.id
                        }
                    }
                });
            }

            return createdStay;
        });

        return NextResponse.json(stay, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create stay booking');
    }
}
