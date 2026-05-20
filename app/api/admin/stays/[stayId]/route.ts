import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { notifyCleaningCrew, notifyCleaningCrewAboutCheckIn } from '@/lib/server/telegram-notify';
import { buildCleaningRoomSnapshotLines } from '@/lib/server/cleaning-rooms';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { detectStayPaymentMethod, normalizeBookingSource, resolveBookingSource, sumStayPayments } from '@/lib/stays';

export const dynamic = 'force-dynamic';

const updateStaySchema = z
    .object({
        guestName: z.string().max(80).optional().nullable(),
        scheduledCheckIn: z.string().datetime().optional().nullable(),
        scheduledCheckOut: z.string().datetime().optional().nullable(),
        actualCheckIn: z.string().datetime().optional().nullable(),
        actualCheckOut: z.string().datetime().optional().nullable(),
        status: z.nativeEnum(StayStatus).optional(),
        bookingSource: z.string().max(80).optional().nullable(),
        amountPaid: z.number().int().min(0).optional(),
        cashPaid: z.number().int().min(0).optional(),
        cardPaid: z.number().int().min(0).optional(),
        onlinePaid: z.number().int().min(0).optional(),
        paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
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
        };

        if (payload.guestName !== undefined) {
            const trimmed = payload.guestName?.trim();
            updateData.guestName = trimmed?.length ? trimmed : null;
        }

        if (payload.notes !== undefined) {
            const trimmed = payload.notes?.trim();
            updateData.notes = trimmed?.length ? trimmed : null;
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

        const nextCash = payload.cashPaid ?? stayRecord.cashPaid;
        const nextCard = payload.cardPaid ?? stayRecord.cardPaid;
        const nextOnline = payload.onlinePaid ?? stayRecord.onlinePaid;

        if (payload.amountPaid !== undefined) {
            updateData.amountPaid = payload.amountPaid;
        } else if (payload.cashPaid !== undefined || payload.cardPaid !== undefined || payload.onlinePaid !== undefined) {
            updateData.amountPaid = sumStayPayments({ cashPaid: nextCash, cardPaid: nextCard, onlinePaid: nextOnline });
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

        const updatedStay = await prisma.$transaction(async (tx) => {
            const result = await tx.roomStay.update({
                where: { id: params.stayId },
                data: updateData
            });

            const shouldSyncStayLedger =
                payload.status === StayStatus.CANCELLED ||
                payload.cashPaid !== undefined ||
                payload.cardPaid !== undefined ||
                payload.onlinePaid !== undefined ||
                payload.amountPaid !== undefined ||
                payload.paymentMethod !== undefined;

            if (shouldSyncStayLedger && stay.shiftId) {
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
                if (payload.status === StayStatus.CANCELLED && linkedLedgerEntries.length === 0) {
                    const stayStart = stay.actualCheckIn ?? stay.scheduledCheckIn;
                    const legacyCandidates = await tx.cashEntry.findMany({
                        where: {
                            stayId: null,
                            hotelId: stay.hotelId,
                            shiftId: stay.shiftId,
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

                    if (legacyTotals.cash === stayRecord.cashPaid && legacyTotals.card === stayRecord.cardPaid) {
                        legacyEntryIds = legacyCandidates.map((entry) => entry.id);
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

                const shouldRecreateLedger =
                    result.status !== StayStatus.CANCELLED &&
                    (linkedLedgerEntries.length > 0 || stay.status === StayStatus.SCHEDULED || payload.status === StayStatus.CHECKED_IN);

                if (shouldRecreateLedger) {
                    const recordedAt = linkedLedgerEntries[0]?.recordedAt ?? result.actualCheckIn ?? result.scheduledCheckIn;
                    const ledgerPayloads = [
                        { amount: result.cashPaid, method: PaymentMethod.CASH },
                        { amount: result.cardPaid, method: PaymentMethod.CARD }
                    ].filter((entry) => entry.amount > 0);

                    for (const ledgerEntry of ledgerPayloads) {
                        await tx.cashEntry.create({
                            data: {
                                hotelId: stay.hotelId,
                                shiftId: stay.shiftId,
                                managerId: stay.shift?.managerId ?? null,
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

            if (stay.room.currentStayId === stay.id && payload.status) {
                const nextRoomData: Prisma.RoomUpdateInput | null = (() => {
                    if (payload.status === StayStatus.CHECKED_IN) {
                        return { status: RoomStatus.OCCUPIED, currentStayId: stay.id };
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
