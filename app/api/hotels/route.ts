import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const cleaningChatIdSchema = z
    .string()
    .trim()
    .regex(/^-?\d+$/, { message: 'ID чата должен содержать только цифры и, при необходимости, знак -' })
    .min(5)
    .max(32);

const createHotelSchema = z.object({
    name: z.string().min(2),
    address: z.string().min(4),
    country: z.string().length(2).optional(),
    timezone: z.string().min(1).max(50).optional(),
    currency: z.string().min(1).max(10).optional(),
    managerSharePct: z.number().int().min(0).max(100).optional(),
    notes: z.string().max(500).optional(),
    cleaningChatId: cleaningChatIdSchema.optional().nullable()
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        // Получаем страну из middleware заголовка
        const headerCountry = request.headers.get('x-country-code');
        const country = headerCountry === 'KZ' || headerCountry === 'KG'
            ? headerCountry
            : 'KG';

        const [hotels, ledgerGroups, recentExpenseEntries] = await Promise.all([
            prisma.hotel.findMany({
                where: { country },
                include: {
                    rooms: true,
                    shifts: {
                        where: { status: ShiftStatus.OPEN },
                        orderBy: { openedAt: 'desc' },
                        take: 1,
                        include: {
                            manager: true
                        }
                    },
                    assignments: {
                        where: { isActive: true },
                        include: { user: true }
                    }
                }
            }),
            prisma.cashEntry.groupBy({
                by: ['hotelId', 'entryType', 'method'],
                _sum: { amount: true },
                where: {
                    hotel: { country }
                }
            }),
            prisma.cashEntry.findMany({
                where: {
                    hotel: { country },
                    entryType: { in: [LedgerEntryType.CASH_OUT, LedgerEntryType.MANAGER_PAYOUT] },
                },
                orderBy: { recordedAt: 'desc' },
                take: 120,
                select: {
                    id: true,
                    hotelId: true,
                    amount: true,
                    method: true,
                    note: true,
                    recordedAt: true,
                    entryType: true,
                    manager: {
                        select: {
                            displayName: true,
                        },
                    },
                },
            })
        ]);

        const createBreakdown = () => ({ total: 0, cash: 0, card: 0 });
        const defaultLedger = () => ({
            [LedgerEntryType.CASH_IN]: createBreakdown(),
            [LedgerEntryType.CASH_OUT]: createBreakdown(),
            [LedgerEntryType.MANAGER_PAYOUT]: createBreakdown(),
            [LedgerEntryType.ADJUSTMENT]: createBreakdown()
        });

        const ledgerMap = new Map<string, Record<LedgerEntryType, { total: number; cash: number; card: number }>>();

        for (const group of ledgerGroups) {
            const summary = ledgerMap.get(group.hotelId) ?? (() => {
                const fresh = defaultLedger();
                ledgerMap.set(group.hotelId, fresh);
                return fresh;
            })();
            const bucket = summary[group.entryType];
            const amount = group._sum?.amount ?? 0;
            bucket.total += amount;
            if (group.method === PaymentMethod.CASH) {
                bucket.cash += amount;
            } else if (group.method === PaymentMethod.CARD) {
                bucket.card += amount;
            }
        }

        const recentExpensesMap = new Map<string, Array<{
            id: string;
            amount: number;
            method: PaymentMethod;
            note: string | null;
            recordedAt: Date;
            entryType: LedgerEntryType;
            managerName: string | null;
        }>>();

        for (const entry of recentExpenseEntries) {
            const bucket = recentExpensesMap.get(entry.hotelId) ?? [];
            if (bucket.length < 3) {
                bucket.push({
                    id: entry.id,
                    amount: entry.amount,
                    method: entry.method,
                    note: entry.note,
                    recordedAt: entry.recordedAt,
                    entryType: entry.entryType,
                    managerName: entry.manager?.displayName ?? null,
                });
            }
            recentExpensesMap.set(entry.hotelId, bucket);
        }

        const payload = hotels.map((hotel) => ({
            id: hotel.id,
            name: hotel.name,
            address: hotel.address,
            country: hotel.country,
            timezone: hotel.timezone,
            currency: hotel.currency,
            managerSharePct: hotel.managerSharePct,
            notes: hotel.notes,
            cleaningChatId: hotel.cleaningChatId,
            roomCount: hotel.rooms.length,
            occupiedRooms: hotel.rooms.filter((room) => room.status === RoomStatus.OCCUPIED).length,
            managers: hotel.assignments.map((assignment) => ({
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                telegramId: assignment.user.telegramId,
                username: assignment.user.username,
                role: assignment.role,
                pinCode: assignment.pinCode,
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct
            })),
            activeShift: hotel.shifts[0]
                ? {
                    manager: hotel.shifts[0].manager.displayName,
                    openedAt: hotel.shifts[0].openedAt,
                    openingCash: hotel.shifts[0].openingCash,
                    number: hotel.shifts[0].number
                }
                : null,
            ledger: (() => {
                const summary = ledgerMap.get(hotel.id) ?? defaultLedger();
                const toBreakdown = (type: LedgerEntryType) => ({
                    cash: summary[type].cash,
                    card: summary[type].card
                });
                return {
                    cashIn: summary[LedgerEntryType.CASH_IN].total,
                    cashInBreakdown: toBreakdown(LedgerEntryType.CASH_IN),
                    cashOut: summary[LedgerEntryType.CASH_OUT].total,
                    cashOutBreakdown: toBreakdown(LedgerEntryType.CASH_OUT)
                };
            })(),
            recentExpenses: recentExpensesMap.get(hotel.id) ?? []
        }));

        return NextResponse.json(payload);
    } catch (error) {
        return handleApiError(error, 'Failed to load hotels');
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);

        const payload = createHotelSchema.parse(body);

        // Получаем страну из middleware заголовка, если не указана явно
        const headerCountry = request.headers.get('x-country-code');
        const country = payload.country || (headerCountry === 'KZ' || headerCountry === 'KG'
            ? headerCountry
            : 'KG');

        const hotel = await prisma.hotel.create({
            data: {
                ...payload,
                country
            }
        });

        return NextResponse.json(hotel, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create hotel');
    }
}
