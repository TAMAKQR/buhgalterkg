import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus, UserRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertHotelAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { normalizeMealPlan } from '@/lib/meal-plan';

export const dynamic = 'force-dynamic';

const groupCheckInSchema = z.object({
    action: z.literal('group-checkin'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(80),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: z.number().int().positive(),
    totalAmount: z.number().int().positive(),
    paymentMode: z.enum(['CASH', 'CARD', 'PENDING_TRANSFER']),
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const groupBookingSchema = z.object({
    action: z.literal('group-booking'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(80),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: z.number().int().positive(),
    totalAmount: z.number().int().min(0),
    paymentMode: z.enum(['CASH', 'CARD', 'PENDING_TRANSFER']),
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const confirmTransferSchema = z.object({
    action: z.literal('confirm-transfer'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    stayIds: z.array(z.string().cuid()).min(1).max(120),
});

const editGroupSchema = z.object({
    action: z.literal('edit-group'),
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid(),
    groupRef: z.string().uuid(),
    roomIds: z.array(z.string().cuid()).min(1).max(80),
    guestName: z.string().max(120).optional().nullable(),
    guestCount: z.number().int().positive().max(500).optional(),
    bookingSource: z.string().max(80).optional().nullable(),
    bookingNumber: z.string().max(80).optional().nullable(),
    scheduledCheckIn: z.string().datetime(),
    scheduledCheckOut: z.string().datetime(),
    tariffAmount: z.number().int().positive(),
    totalAmount: z.number().int().min(0),
    paymentMode: z.enum(['CASH', 'CARD', 'PENDING_TRANSFER']),
    mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
    notes: z.string().max(500).optional().nullable(),
});

const groupStaySchema = z.discriminatedUnion('action', [groupCheckInSchema, groupBookingSchema, confirmTransferSchema, editGroupSchema]);

const normalizeOptionalText = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

const splitAmount = (total: number, count: number) => {
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const payload = groupStaySchema.parse(await request.json());

        assertHotelAccess(session, payload.hotelId);

        const shift = await prisma.shift.findFirst({
            where: {
                id: payload.shiftId,
                hotelId: payload.hotelId,
                status: ShiftStatus.OPEN,
            },
        });

        if (!shift) {
            return new NextResponse('Нужна активная смена для групповой операции', { status: 400 });
        }

        const canEditStayPayments = session.role !== UserRole.MANAGER
            ? true
            : Boolean((await prisma.hotelAssignment.findFirst({
                where: {
                    hotelId: payload.hotelId,
                    userId: session.id,
                    isActive: true
                },
                select: {
                    canEditStayPayments: true
                }
            }))?.canEditStayPayments);

        if (payload.action === 'confirm-transfer') {
            if (!canEditStayPayments) {
                return new NextResponse('Нет права редактировать суммы', { status: 403 });
            }

            const stays = await prisma.roomStay.findMany({
                where: {
                    id: { in: payload.stayIds },
                    hotelId: payload.hotelId,
                    status: StayStatus.CHECKED_IN,
                    onlinePaid: { gt: 0 },
                },
                include: { room: true },
            });

            if (stays.length !== payload.stayIds.length) {
                return new NextResponse('Не все ожидающие переводы найдены', { status: 400 });
            }

            const confirmationRef = randomUUID();

            const updated = await prisma.$transaction(async (tx) => {
                const result = [];

                for (const stay of stays) {
                    const confirmedAmount = stay.onlinePaid ?? 0;
                    const nextCash = stay.cashPaid ?? 0;
                    const nextCard = (stay.cardPaid ?? 0) + confirmedAmount;
                    const nextOnline = 0;
                    const nextAmount = sumStayPayments({ cashPaid: nextCash, cardPaid: nextCard, onlinePaid: nextOnline });

                    const updatedStay = await tx.roomStay.update({
                        where: { id: stay.id },
                        data: {
                            amountPaid: nextAmount,
                            cashPaid: nextCash,
                            cardPaid: nextCard,
                            onlinePaid: nextOnline,
                            paymentMethod: detectStayPaymentMethod({
                                cashPaid: nextCash,
                                cardPaid: nextCard,
                                onlinePaid: nextOnline,
                            }),
                        },
                    });

                    await tx.cashEntry.create({
                        data: {
                            hotelId: payload.hotelId,
                            shiftId: payload.shiftId,
                            managerId: shift.managerId ?? session.id,
                            stayId: stay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: PaymentMethod.CARD,
                            amount: confirmedAmount,
                            note: `Подтверждение перевода №${stay.room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: 'confirm_pending_transfer',
                                confirmationRef,
                                stayId: stay.id,
                                roomId: stay.roomId,
                            },
                        },
                    });

                    result.push(updatedStay);
                }

                return result;
            });

            return NextResponse.json({ success: true, stays: updated });
        }

        const scheduledCheckIn = new Date(payload.scheduledCheckIn);
        const scheduledCheckOut = new Date(payload.scheduledCheckOut);

        if (Number.isNaN(scheduledCheckIn.getTime()) || Number.isNaN(scheduledCheckOut.getTime())) {
            return new NextResponse('Некорректные даты заезда', { status: 400 });
        }

        if (scheduledCheckOut <= scheduledCheckIn) {
            return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
        }

        const uniqueRoomIds = Array.from(new Set(payload.roomIds));
        if (uniqueRoomIds.length !== payload.roomIds.length) {
            return new NextResponse('В списке номеров есть повторы', { status: 400 });
        }

        const rooms = await prisma.room.findMany({
            where: {
                id: { in: uniqueRoomIds },
                hotelId: payload.hotelId,
                isActive: true,
            },
            orderBy: { label: 'asc' },
        });

        if (rooms.length !== uniqueRoomIds.length) {
            return new NextResponse('Не все номера найдены', { status: 400 });
        }

        if (payload.action === 'edit-group') {
            if (!canEditStayPayments) {
                return new NextResponse('Нет права редактировать групповую бронь', { status: 403 });
            }

            const hotel = await prisma.hotel.findUnique({
                where: { id: payload.hotelId },
                select: {
                    usesExtranets: true,
                    extranetNames: true,
                },
            });

            if (!hotel) {
                return new NextResponse('Точка не найдена', { status: 404 });
            }

            const groupStays = await prisma.roomStay.findMany({
                where: {
                    hotelId: payload.hotelId,
                    groupRef: payload.groupRef,
                    status: StayStatus.SCHEDULED,
                },
                include: { room: true },
                orderBy: { scheduledCheckIn: 'asc' },
            });

            if (groupStays.length < 2) {
                return new NextResponse('Групповая бронь не найдена', { status: 404 });
            }

            const currentRoomIds = new Set(groupStays.map((stay) => stay.roomId));
            if (uniqueRoomIds.length !== groupStays.length || uniqueRoomIds.some((roomId) => !currentRoomIds.has(roomId))) {
                return new NextResponse('Изменение состава номеров группы пока недоступно. Создайте новую группу или отмените лишние брони отдельно.', { status: 400 });
            }

            const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
            const resolvedBookingSource = normalizedBookingSource
                ? resolveBookingSource(normalizedBookingSource, hotel.extranetNames)
                : null;

            if (normalizedBookingSource && (!hotel.usesExtranets || !resolvedBookingSource)) {
                return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
            }

            const bookingNumber = normalizeOptionalText(payload.bookingNumber);
            if (resolvedBookingSource && !bookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }

            if (payload.totalAmount > payload.tariffAmount) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }

            const conflictingStay = await prisma.roomStay.findFirst({
                where: {
                    id: { notIn: groupStays.map((stay) => stay.id) },
                    roomId: { in: uniqueRoomIds },
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                    scheduledCheckIn: { lt: scheduledCheckOut },
                    scheduledCheckOut: { gt: scheduledCheckIn },
                },
                include: { room: true },
            });

            if (conflictingStay) {
                return new NextResponse(`На эти даты уже есть бронь или проживание в №${conflictingStay.room.label}`, { status: 409 });
            }

            const portions = splitAmount(payload.totalAmount, groupStays.length);
            const tariffPortions = splitAmount(payload.tariffAmount, groupStays.length);
            const guestName = normalizeOptionalText(payload.guestName) ?? 'Групповая бронь';
            const baseNote = [
                payload.guestCount ? `${payload.guestCount} чел.` : null,
                normalizeOptionalText(payload.notes),
                `Группа ${payload.groupRef.slice(0, 8)}`,
            ].filter(Boolean).join(' · ');

            const updated = await prisma.$transaction(async (tx) => {
                const result = [];

                for (const [index, stay] of groupStays.entries()) {
                    const portion = portions[index] ?? 0;
                    const tariffPortion = tariffPortions[index] ?? 0;
                    const cashPaid = payload.paymentMode === 'CASH' ? portion : 0;
                    const cardPaid = payload.paymentMode === 'CARD' ? portion : 0;
                    const onlinePaid = payload.paymentMode === 'PENDING_TRANSFER' ? portion : 0;

                    await tx.cashEntry.deleteMany({
                        where: {
                            stayId: stay.id,
                            entryType: LedgerEntryType.CASH_IN,
                        },
                    });

                    const updatedStay = await tx.roomStay.update({
                        where: { id: stay.id },
                        data: {
                            guestName,
                            bookingSource: resolvedBookingSource,
                            bookingNumber,
                            scheduledCheckIn,
                            scheduledCheckOut,
                            mealPlan: normalizeMealPlan(payload.mealPlan),
                            notes: baseNote,
                            amountPaid: portion,
                            totalAmount: tariffPortion,
                            paymentMethod: detectStayPaymentMethod({ cashPaid, cardPaid, onlinePaid }),
                            cashPaid,
                            cardPaid,
                            onlinePaid,
                        },
                    });

                    const ledgerMethod =
                        payload.paymentMode === 'CASH'
                            ? PaymentMethod.CASH
                            : payload.paymentMode === 'CARD'
                                ? PaymentMethod.CARD
                                : null;

                    if (ledgerMethod && portion > 0) {
                        await tx.cashEntry.create({
                            data: {
                                hotelId: payload.hotelId,
                                shiftId: payload.shiftId,
                                managerId: shift.managerId ?? session.id,
                                stayId: stay.id,
                                entryType: LedgerEntryType.CASH_IN,
                                method: ledgerMethod,
                                amount: portion,
                                note: `Предоплата группы №${stay.room.label}`,
                                meta: {
                                    source: 'room_stay',
                                    kind: 'group_booking_prepayment',
                                    groupRef: payload.groupRef,
                                    guestCount: payload.guestCount ?? null,
                                    roomId: stay.roomId,
                                    stayId: stay.id,
                                },
                            },
                        });
                    }

                    result.push(updatedStay);
                }

                return result;
            });

            return NextResponse.json({ success: true, groupRef: payload.groupRef, stays: updated });
        }

        const isGroupBooking = payload.action === 'group-booking';
        const unavailableRoom = !isGroupBooking
            ? rooms.find((room) => room.status !== RoomStatus.AVAILABLE || room.currentStayId)
            : null;
        if (unavailableRoom) {
            return new NextResponse(`Номер №${unavailableRoom.label} сейчас не свободен`, { status: 409 });
        }

        const conflictingStay = await prisma.roomStay.findFirst({
            where: {
                roomId: { in: uniqueRoomIds },
                status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                scheduledCheckIn: { lt: scheduledCheckOut },
                scheduledCheckOut: { gt: scheduledCheckIn },
            },
            include: { room: true },
        });

        if (conflictingStay) {
            return new NextResponse(`На эти даты уже есть бронь или проживание в №${conflictingStay.room.label}`, { status: 409 });
        }

        const hotel = await prisma.hotel.findUnique({
            where: { id: payload.hotelId },
            select: {
                usesExtranets: true,
                extranetNames: true,
            },
        });

        if (!hotel) {
            return new NextResponse('Точка не найдена', { status: 404 });
        }

        const normalizedBookingSource = normalizeBookingSource(payload.bookingSource);
        const resolvedBookingSource = normalizedBookingSource
            ? resolveBookingSource(normalizedBookingSource, hotel.extranetNames)
            : null;

        if (normalizedBookingSource && (!hotel.usesExtranets || !resolvedBookingSource)) {
            return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
        }

        const bookingNumber = normalizeOptionalText(payload.bookingNumber);
        if (resolvedBookingSource && !bookingNumber) {
            return new NextResponse('Укажите номер бронирования', { status: 400 });
        }

        if (payload.totalAmount > payload.tariffAmount) {
            return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
        }

        const groupRef = randomUUID();
        const portions = splitAmount(payload.totalAmount, rooms.length);
        const tariffPortions = splitAmount(payload.tariffAmount, rooms.length);
        const guestName = normalizeOptionalText(payload.guestName) ?? (isGroupBooking ? 'Групповая бронь' : 'Групповой заезд');
        const baseNote = [
            payload.guestCount ? `${payload.guestCount} чел.` : null,
            normalizeOptionalText(payload.notes),
            `Группа ${groupRef.slice(0, 8)}`,
        ].filter(Boolean).join(' · ');

        const stays = await prisma.$transaction(async (tx) => {
            const created = [];

            for (const [index, room] of rooms.entries()) {
                const portion = portions[index] ?? 0;
                const tariffPortion = tariffPortions[index] ?? 0;
                const cashPaid = payload.paymentMode === 'CASH' ? portion : 0;
                const cardPaid = payload.paymentMode === 'CARD' ? portion : 0;
                const onlinePaid = payload.paymentMode === 'PENDING_TRANSFER' ? portion : 0;

                const stay = await tx.roomStay.create({
                    data: {
                        roomId: room.id,
                        hotelId: payload.hotelId,
                        shiftId: payload.shiftId,
                        scheduledCheckIn,
                        scheduledCheckOut,
                        actualCheckIn: isGroupBooking ? null : new Date(),
                        status: isGroupBooking ? StayStatus.SCHEDULED : StayStatus.CHECKED_IN,
                        guestName,
                        bookingSource: resolvedBookingSource,
                        bookingNumber,
                        groupRef,
                        mealPlan: normalizeMealPlan(payload.mealPlan),
                        notes: baseNote,
                        amountPaid: portion,
                        totalAmount: tariffPortion,
                        paymentMethod: detectStayPaymentMethod({ cashPaid, cardPaid, onlinePaid }),
                        cashPaid,
                        cardPaid,
                        onlinePaid,
                    },
                });

                if (!isGroupBooking) {
                    await tx.room.update({
                        where: { id: room.id },
                        data: {
                            status: RoomStatus.OCCUPIED,
                            currentStayId: stay.id,
                        },
                    });
                }

                const ledgerMethod =
                    payload.paymentMode === 'CASH'
                        ? PaymentMethod.CASH
                        : payload.paymentMode === 'CARD'
                            ? PaymentMethod.CARD
                            : null;

                if (ledgerMethod && portion > 0) {
                    await tx.cashEntry.create({
                        data: {
                            hotelId: payload.hotelId,
                            shiftId: payload.shiftId,
                            managerId: shift.managerId ?? session.id,
                            stayId: stay.id,
                            entryType: LedgerEntryType.CASH_IN,
                            method: ledgerMethod,
                            amount: portion,
                            note: isGroupBooking ? `Предоплата группы №${room.label}` : `Групповой заезд №${room.label}`,
                            meta: {
                                source: 'room_stay',
                                kind: isGroupBooking ? 'group_booking_prepayment' : 'group_checkin',
                                groupRef,
                                guestCount: payload.guestCount ?? null,
                                roomId: room.id,
                                stayId: stay.id,
                            },
                        },
                    });
                }

                created.push(stay);
            }

            return created;
        });

        return NextResponse.json({ success: true, groupRef, stays });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to process group stay');
    }
}
