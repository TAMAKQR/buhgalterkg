import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';
import { normalizeMealPlan } from '@/lib/meal-plan';

export const dynamic = 'force-dynamic';

const updateStaySchema = z
    .object({
        guestName: z.string().max(80).optional().nullable(),
        guestPhone: z.string().max(40).optional().nullable(),
        companyName: z.string().max(120).optional().nullable(),
        scheduledCheckIn: z.string().datetime().optional().nullable(),
        scheduledCheckOut: z.string().datetime().optional().nullable(),
        actualCheckIn: z.string().datetime().optional().nullable(),
        actualCheckOut: z.string().datetime().optional().nullable(),
        status: z.nativeEnum(StayStatus).optional(),
        bookingSource: z.string().max(80).optional().nullable(),
        bookingNumber: z.string().max(80).optional().nullable(),
        totalAmount: z.number().int().positive().optional(),
        amountPaid: z.number().int().min(0).optional(),
        cashPaid: z.number().int().min(0).optional(),
        cardPaid: z.number().int().min(0).optional(),
        onlinePaid: z.number().int().min(0).optional(),
        paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
        shiftId: z.string().cuid().optional().nullable(),
        mealPlan: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).max(3).optional(),
        notes: z.string().max(500).optional().nullable()
    })
    .refine((values) => Object.values(values).some((value) => value !== undefined), {
        message: 'Не переданы поля для обновления'
    });

const parseDateOrNull = (value?: string | null) => {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('INVALID_DATE');
    }
    return parsed;
};

const normalizeOptionalText = (value?: string | null) => {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
};

const getCashLedgerParts = ({
    amountPaid,
    cashPaid,
    cardPaid,
    onlinePaid,
    paymentMethod,
}: {
    amountPaid?: number | null;
    cashPaid?: number | null;
    cardPaid?: number | null;
    onlinePaid?: number | null;
    paymentMethod?: PaymentMethod | null;
}) => {
    const cash = cashPaid ?? 0;
    const card = cardPaid ?? 0;
    const online = onlinePaid ?? 0;

    if (cash > 0 || card > 0) {
        return { cash, card };
    }

    const total = amountPaid ?? 0;
    if (total <= 0 || online > 0) {
        return { cash: 0, card: 0 };
    }

    if (paymentMethod === PaymentMethod.CASH) {
        return { cash: total, card: 0 };
    }

    if (paymentMethod === PaymentMethod.CARD) {
        return { cash: 0, card: total };
    }

    return { cash: 0, card: 0 };
};

export async function PATCH(request: NextRequest, { params }: { params: { stayId: string } }) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateStaySchema.parse(body);
        const stay = await prisma.roomStay.findFirst({
            where: {
                id: params.stayId,
                hotel: { country },
            },
            include: {
                shift: {
                    select: {
                        managerId: true
                    }
                },
                room: {
                    include: {
                        hotel: true
                    }
                }
            }
        });

        if (!stay) {
            return new NextResponse('Stay not found', { status: 404 });
        }

        const stayRecord = stay as typeof stay & {
            onlinePaid: number;
            room: typeof stay.room & {
                hotel: typeof stay.room.hotel & {
                    usesExtranets: boolean;
                    extranetNames: string[];
                };
            };
        };

        const updateData = {} as Prisma.RoomStayUpdateInput & {
            onlinePaid?: number;
            bookingSource?: string | null;
            bookingNumber?: string | null;
            totalAmount?: number;
        };
        let requestedShift: { id: string; managerId: string } | null | undefined;

        if (Object.prototype.hasOwnProperty.call(payload, 'shiftId')) {
            if (payload.shiftId) {
                requestedShift = await prisma.shift.findFirst({
                    where: {
                        id: payload.shiftId,
                        hotelId: stay.hotelId,
                        hotel: { country }
                    },
                    select: {
                        id: true,
                        managerId: true
                    }
                });

                if (!requestedShift) {
                    return new NextResponse('Смена не найдена для этого отеля', { status: 400 });
                }

                updateData.shift = { connect: { id: requestedShift.id } };
            } else {
                requestedShift = null;
                updateData.shift = { disconnect: true };
            }
        }

        if (payload.guestName !== undefined) {
            updateData.guestName = normalizeOptionalText(payload.guestName);
        }

        if (payload.guestPhone !== undefined) {
            updateData.guestPhone = normalizeOptionalText(payload.guestPhone);
        }

        if (payload.companyName !== undefined) {
            updateData.companyName = normalizeOptionalText(payload.companyName);
        }

        if (payload.notes !== undefined) {
            updateData.notes = normalizeOptionalText(payload.notes);
        }

        if (payload.bookingNumber !== undefined) {
            updateData.bookingNumber = normalizeOptionalText(payload.bookingNumber);
        }

        if (payload.totalAmount !== undefined) {
            updateData.totalAmount = payload.totalAmount;
        }

        if (payload.mealPlan !== undefined) {
            updateData.mealPlan = normalizeMealPlan(payload.mealPlan);
        }

        if (payload.scheduledCheckIn !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.scheduledCheckIn);
                if (!parsed) {
                    return new NextResponse('Укажите дату заезда', { status: 400 });
                }
                updateData.scheduledCheckIn = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата заезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.scheduledCheckOut !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.scheduledCheckOut);
                if (!parsed) {
                    return new NextResponse('Укажите дату выезда', { status: 400 });
                }
                updateData.scheduledCheckOut = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата выезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.actualCheckIn !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.actualCheckIn);
                updateData.actualCheckIn = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата фактического заезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.actualCheckOut !== undefined) {
            try {
                const parsed = parseDateOrNull(payload.actualCheckOut);
                updateData.actualCheckOut = parsed;
            } catch (dateError) {
                if (dateError instanceof Error && dateError.message === 'INVALID_DATE') {
                    return new NextResponse('Некорректная дата фактического выезда', { status: 400 });
                }
                throw dateError;
            }
        }

        if (payload.status) {
            updateData.status = payload.status;
        }

        const isCancellingStay = payload.status === StayStatus.CANCELLED;
        const nextCash = payload.cashPaid ?? stayRecord.cashPaid;
        const nextCard = payload.cardPaid ?? stayRecord.cardPaid;
        const nextOnline = payload.onlinePaid ?? stayRecord.onlinePaid;
        const hasPaymentBreakdownPayload =
            payload.cashPaid !== undefined ||
            payload.cardPaid !== undefined ||
            payload.onlinePaid !== undefined;
        const nextBreakdownTotal = sumStayPayments({ cashPaid: nextCash, cardPaid: nextCard, onlinePaid: nextOnline });

        if (hasPaymentBreakdownPayload && (nextBreakdownTotal > 0 || payload.amountPaid === undefined || payload.amountPaid === 0)) {
            updateData.amountPaid = nextBreakdownTotal;
        } else if (payload.amountPaid !== undefined) {
            updateData.amountPaid = payload.amountPaid;
        }

        if (payload.cashPaid !== undefined) {
            updateData.cashPaid = payload.cashPaid;
        }

        if (payload.cardPaid !== undefined) {
            updateData.cardPaid = payload.cardPaid;
        }

        if (payload.onlinePaid !== undefined) {
            updateData.onlinePaid = payload.onlinePaid;
        }

        if (payload.bookingSource !== undefined) {
            const normalized = normalizeBookingSource(payload.bookingSource);
            if (!normalized) {
                updateData.bookingSource = null;
            } else {
                const resolved = resolveBookingSource(normalized, stayRecord.room.hotel.extranetNames);
                if (!stayRecord.room.hotel.usesExtranets || !resolved) {
                    return new NextResponse('Выбранный экстранет не настроен для этой точки', { status: 400 });
                }
                updateData.bookingSource = resolved;
            }
        }

        if (payload.paymentMethod !== undefined) {
            updateData.paymentMethod = payload.paymentMethod ?? null;
        } else if (payload.cashPaid !== undefined || payload.cardPaid !== undefined || payload.onlinePaid !== undefined) {
            updateData.paymentMethod = detectStayPaymentMethod({ cashPaid: nextCash, cardPaid: nextCard, onlinePaid: nextOnline });
        }

        if (isCancellingStay) {
            updateData.amountPaid = 0;
            updateData.cashPaid = 0;
            updateData.cardPaid = 0;
            updateData.onlinePaid = 0;
            updateData.paymentMethod = null;
        }

        const nextScheduledCheckIn = updateData.scheduledCheckIn instanceof Date ? updateData.scheduledCheckIn : stay.scheduledCheckIn;
        const nextScheduledCheckOut = updateData.scheduledCheckOut instanceof Date ? updateData.scheduledCheckOut : stay.scheduledCheckOut;
        const nextStatus = payload.status ?? stay.status;
        const nextPaymentTotal = hasPaymentBreakdownPayload
            ? nextBreakdownTotal
            : payload.amountPaid ?? stayRecord.amountPaid ?? 0;
        const nextTariffTotal = payload.totalAmount ?? stayRecord.totalAmount ?? 0;
        const nextBookingNumber = payload.bookingNumber !== undefined
            ? normalizeOptionalText(payload.bookingNumber)
            : stayRecord.bookingNumber;
        const nextBookingSource = updateData.bookingSource !== undefined
            ? updateData.bookingSource
            : stayRecord.bookingSource;

        if (payload.status === StayStatus.CHECKED_IN && stay.status !== StayStatus.CHECKED_IN && nextPaymentTotal <= 0) {
            return new NextResponse('Укажите сумму оплаты перед заселением', { status: 400 });
        }

        const shouldValidateBookingIdentity =
            nextStatus === StayStatus.SCHEDULED ||
            nextStatus === StayStatus.CHECKED_IN ||
            payload.bookingNumber !== undefined ||
            payload.totalAmount !== undefined;

        if (shouldValidateBookingIdentity && (nextStatus === StayStatus.SCHEDULED || nextStatus === StayStatus.CHECKED_IN)) {
            if (nextBookingSource && !nextBookingNumber) {
                return new NextResponse('Укажите номер бронирования', { status: 400 });
            }
            if (nextTariffTotal <= 0) {
                return new NextResponse('Укажите общую сумму тарифа', { status: 400 });
            }
            if (nextPaymentTotal > nextTariffTotal) {
                return new NextResponse('Оплата не может быть больше общей суммы тарифа', { status: 400 });
            }
        }

        if (nextScheduledCheckOut <= nextScheduledCheckIn) {
            return new NextResponse('Дата выезда должна быть позже даты заезда', { status: 400 });
        }

        if (nextStatus === StayStatus.SCHEDULED || nextStatus === StayStatus.CHECKED_IN) {
            const conflictingStay = await prisma.roomStay.findFirst({
                where: {
                    id: { not: stay.id },
                    roomId: stay.roomId,
                    hotelId: stay.hotelId,
                    status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] },
                    scheduledCheckIn: { lt: nextScheduledCheckOut },
                    scheduledCheckOut: { gt: nextScheduledCheckIn }
                },
                select: {
                    id: true,
                    guestName: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true
                }
            });

            if (conflictingStay) {
                const guest = conflictingStay.guestName?.trim() || 'другая бронь';
                return new NextResponse(`На эти даты уже есть ${guest} в этом номере`, { status: 409 });
            }
        }

        const updatedStay = await prisma.$transaction(async (tx) => {
            let result = await tx.roomStay.update({
                where: { id: params.stayId },
                data: updateData
            });

            let ledgerShiftId = result.shiftId;
            let ledgerManagerId = requestedShift?.managerId ?? (ledgerShiftId === stay.shiftId ? stay.shift?.managerId ?? null : null);
            if (!ledgerShiftId && result.status === StayStatus.CHECKED_IN) {
                const activeShift = await tx.shift.findFirst({
                    where: {
                        hotelId: stay.hotelId,
                        status: ShiftStatus.OPEN
                    },
                    orderBy: { openedAt: 'desc' },
                    select: {
                        id: true,
                        managerId: true
                    }
                });

                if (activeShift) {
                    result = await tx.roomStay.update({
                        where: { id: params.stayId },
                        data: { shiftId: activeShift.id }
                    });
                    ledgerShiftId = activeShift.id;
                    ledgerManagerId = activeShift.managerId;
                }
            }

            const shouldSyncStayLedger =
                payload.status === StayStatus.CANCELLED ||
                payload.cashPaid !== undefined ||
                payload.cardPaid !== undefined ||
                payload.onlinePaid !== undefined ||
                payload.amountPaid !== undefined ||
                payload.paymentMethod !== undefined ||
                payload.shiftId !== undefined;

            if (shouldSyncStayLedger) {
                const linkedLedgerEntries = await tx.cashEntry.findMany({
                    where: {
                        stayId: stay.id,
                        entryType: LedgerEntryType.CASH_IN
                    },
                    orderBy: { recordedAt: 'asc' },
                    select: {
                        id: true,
                        recordedAt: true
                    }
                });

                let legacyEntryIds: string[] = [];
                const legacyShiftIds = Array.from(new Set([stay.shiftId, ledgerShiftId].filter((id): id is string => Boolean(id))));
                if (linkedLedgerEntries.length === 0 && legacyShiftIds.length > 0) {
                    const legacyMetaCandidates = await tx.cashEntry.findMany({
                        where: {
                            stayId: null,
                            hotelId: stay.hotelId,
                            shiftId: { in: legacyShiftIds },
                            entryType: LedgerEntryType.CASH_IN,
                            meta: {
                                path: ['stayId'],
                                equals: stay.id
                            }
                        },
                        select: {
                            id: true
                        }
                    });

                    if (legacyMetaCandidates.length > 0) {
                        legacyEntryIds = legacyMetaCandidates.map((entry) => entry.id);
                    }

                    if (legacyEntryIds.length === 0) {
                        const stayStart = stay.actualCheckIn ?? stay.scheduledCheckIn;
                        const legacyCandidates = await tx.cashEntry.findMany({
                            where: {
                                stayId: null,
                                hotelId: stay.hotelId,
                                shiftId: { in: legacyShiftIds },
                                entryType: LedgerEntryType.CASH_IN,
                                recordedAt: {
                                    gte: new Date(stayStart.getTime() - 15 * 60 * 1000),
                                    lte: new Date()
                                },
                                OR: [
                                    { note: `Заселение №${stay.room.label}` },
                                    { note: `Продление №${stay.room.label}` }
                                ]
                            },
                            select: {
                                id: true,
                                method: true,
                                amount: true
                            }
                        });

                        const legacyTotals = legacyCandidates.reduce(
                            (totals, entry) => {
                                if (entry.method === PaymentMethod.CASH) {
                                    totals.cash += entry.amount;
                                } else if (entry.method === PaymentMethod.CARD) {
                                    totals.card += entry.amount;
                                }
                                return totals;
                            },
                            { cash: 0, card: 0 }
                        );

                        const expectedLegacyTotals = getCashLedgerParts(stayRecord);

                        if (legacyTotals.cash === expectedLegacyTotals.cash && legacyTotals.card === expectedLegacyTotals.card) {
                            legacyEntryIds = legacyCandidates.map((entry) => entry.id);
                        }
                    }
                }

                const entryIdsToDelete = [
                    ...linkedLedgerEntries.map((entry) => entry.id),
                    ...legacyEntryIds
                ];

                if (entryIdsToDelete.length > 0) {
                    await tx.cashEntry.deleteMany({
                        where: {
                            id: { in: entryIdsToDelete }
                        }
                    });
                }

                const nextLedgerParts = getCashLedgerParts(result);
                const shouldRecreateLedger =
                    result.status !== StayStatus.CANCELLED &&
                    Boolean(ledgerShiftId) &&
                    (
                        linkedLedgerEntries.length > 0 ||
                        legacyEntryIds.length > 0 ||
                        stay.status === StayStatus.SCHEDULED ||
                        payload.status === StayStatus.CHECKED_IN ||
                        nextLedgerParts.cash > 0 ||
                        nextLedgerParts.card > 0
                    );

                if (shouldRecreateLedger) {
                    const recordedAt = linkedLedgerEntries[0]?.recordedAt ?? result.actualCheckIn ?? result.scheduledCheckIn;
                    const ledgerPayloads = [
                        { amount: nextLedgerParts.cash, method: PaymentMethod.CASH },
                        { amount: nextLedgerParts.card, method: PaymentMethod.CARD }
                    ].filter((entry) => entry.amount > 0);

                    for (const ledgerEntry of ledgerPayloads) {
                        await tx.cashEntry.create({
                            data: {
                                hotelId: stay.hotelId,
                                shiftId: ledgerShiftId as string,
                                managerId: ledgerManagerId,
                                stayId: stay.id,
                                entryType: LedgerEntryType.CASH_IN,
                                method: ledgerEntry.method,
                                amount: ledgerEntry.amount,
                                note: `Заселение №${stay.room.label}`,
                                recordedAt,
                                meta: {
                                    source: 'room_stay',
                                    kind: 'admin_sync',
                                    stayId: stay.id,
                                    roomId: stay.roomId
                                }
                            }
                        });
                    }
                }
            }

            if (payload.status) {
                const nextRoomData: Prisma.RoomUpdateInput | null = (() => {
                    if (payload.status === StayStatus.CHECKED_IN) {
                        return { status: RoomStatus.OCCUPIED, currentStayId: stay.id };
                    }
                    if (stay.room.currentStayId !== stay.id) {
                        return null;
                    }
                    if (payload.status === StayStatus.CHECKED_OUT) {
                        return { status: RoomStatus.DIRTY, currentStayId: null };
                    }
                    if (payload.status === StayStatus.CANCELLED) {
                        return { status: RoomStatus.AVAILABLE, currentStayId: null };
                    }
                    if (payload.status === StayStatus.SCHEDULED) {
                        return { status: RoomStatus.AVAILABLE, currentStayId: null };
                    }
                    return null;
                })();

                if (nextRoomData) {
                    await tx.room.update({ where: { id: stay.roomId }, data: nextRoomData });
                }
            }

            return result;
        });

        // Отправка уведомлений горничным
        const hotel = stay.room.hotel;
        const wasCheckedIn = stay.actualCheckIn !== null;
        const wasCheckedOut = stay.actualCheckOut !== null;
        const nowCheckedIn = (payload.actualCheckIn !== undefined && updateData.actualCheckIn !== null) ||
            (payload.status === StayStatus.CHECKED_IN);
        const nowCheckedOut = (payload.actualCheckOut !== undefined && updateData.actualCheckOut !== null) ||
            (payload.status === StayStatus.CHECKED_OUT);
        const roomSnapshotLines = (nowCheckedIn || nowCheckedOut)
            ? await buildCleaningRoomSnapshotLines(hotel.id, hotel.timezone)
            : undefined;

        // Уведомление при заселении
        if (!wasCheckedIn && nowCheckedIn) {
            try {
                await notifyCleaningCrewAboutCheckIn({
                    chatId: hotel.cleaningChatId,
                    hotelName: hotel.name,
                    roomLabel: stay.room.label,
                    guestName: updatedStay.guestName || stay.guestName,
                    checkOut: updatedStay.scheduledCheckOut?.toISOString() || stay.scheduledCheckOut?.toISOString(),
                    timezone: hotel.timezone,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about check-in', notificationError);
            }
        }

        // Уведомление при выселении
        if (!wasCheckedOut && nowCheckedOut) {
            try {
                await notifyCleaningCrew({
                    chatId: hotel.cleaningChatId,
                    roomId: stay.roomId,
                    hotelName: hotel.name,
                    roomLabel: stay.room.label,
                    managerName: session.displayName || session.username || null,
                    roomSnapshotLines,
                });
            } catch (notificationError) {
                console.error('Failed to notify cleaning crew about check-out', notificationError);
            }
        }

        return NextResponse.json({ success: true, stay: updatedStay });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to update stay');
    }
}
