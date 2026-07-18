import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCountryConfig } from '@/lib/country';
import { sanitizeExtranetNames } from '@/lib/stays';
import { getSessionUser } from '@/lib/server/session';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { parseDateOnly, parseInputValue } from '@/lib/timezone';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { LedgerEntryType, PaymentMethod, Prisma, RoomStatus, ShiftStatus } from '@prisma/client';
import { isCollectionLedgerEntry } from '@/lib/ledger';
import { hasConfiguredPin } from '@/lib/pin';
import { httpUrlSchema } from '@/lib/http-url';

export const dynamic = 'force-dynamic';

const DIRECTORY_HOTEL_LIMIT = 250;
const DIRECTORY_ASSIGNMENT_LIMIT = 2_500;
const FULL_MANAGERS_PER_HOTEL_LIMIT = 100;
const FULL_REPORT_DEFAULT_DAYS = 31;
const FULL_REPORT_MAX_DAYS = 370;
const MAX_FILTER_IDS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLLECTION_SEARCH_TERMS = ['инкассац', 'инкасац', 'inkass', 'incass', 'collection'] as const;

const collectionCandidateFilters: Prisma.CashEntryWhereInput[] = COLLECTION_SEARCH_TERMS.flatMap((term) => [
    { note: { contains: term, mode: 'insensitive' } },
    { expenseCategory: { name: { contains: term, mode: 'insensitive' } } },
]);

const hotelDirectorySelect = {
    id: true,
    name: true,
    address: true,
    country: true,
    timezone: true,
    currency: true,
} as const;

const hotelConfigurationSelect = {
    ...hotelDirectorySelect,
    usesExtranets: true,
    extranetNames: true,
    hasMealPlan: true,
    allowGroupStays: true,
    allowPostpaidStays: true,
    allowOnlinePayments: true,
    guestQrEnabled: true,
    showInGuestListing: true,
    guestDescription: true,
    guestAmenities: true,
    guestPhotoUrls: true,
    guestMapUrl: true,
    financialCycleStartDay: true,
    managerSharePct: true,
    monthlyPayrollCost: true,
    monthlyRentCost: true,
    monthlyUtilitiesCost: true,
    monthlySuppliesCost: true,
    monthlyOtherCost: true,
    notes: true,
    cleaningChatId: true,
} as const;

const cleaningChatIdSchema = z
    .string()
    .trim()
    .regex(/^-?\d+$/, { message: 'ID чата должен содержать только цифры и, при необходимости, знак -' })
    .min(5)
    .max(32);

const createHotelSchema = z.object({
    name: z.string().min(2),
    address: z.string().min(4),
    country: z.enum(['KG', 'KZ']).optional(),
    timezone: z.string().min(1).max(50).optional(),
    currency: z.string().min(1).max(10).optional(),
    usesExtranets: z.boolean().optional(),
    extranetNames: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    hasMealPlan: z.boolean().optional(),
    allowGroupStays: z.boolean().optional(),
    allowPostpaidStays: z.boolean().optional(),
    allowOnlinePayments: z.boolean().optional(),
    guestQrEnabled: z.boolean().optional(),
    showInGuestListing: z.boolean().optional(),
    guestDescription: z.string().trim().max(800).optional().nullable(),
    guestAmenities: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    guestPhotoUrls: z.array(httpUrlSchema).max(12).optional(),
    guestMapUrl: httpUrlSchema.optional().nullable(),
    financialCycleStartDay: z.number().int().min(1).max(31).optional(),
    managerSharePct: z.number().int().min(0).max(100).optional(),
    monthlyPayrollCost: z.number().int().min(0).optional(),
    monthlyRentCost: z.number().int().min(0).optional(),
    monthlyUtilitiesCost: z.number().int().min(0).optional(),
    monthlySuppliesCost: z.number().int().min(0).optional(),
    monthlyOtherCost: z.number().int().min(0).optional(),
    notes: z.string().max(500).optional(),
    cleaningChatId: cleaningChatIdSchema.optional().nullable()
});

const sanitizeUniqueTextList = (values: Array<string | null | undefined>, maxItemLength: number, maxItems: number) => {
    const unique = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmed = value?.trim();
        if (!trimmed) {
            continue;
        }

        const comparable = trimmed.toLocaleLowerCase('ru-RU');
        if (unique.has(comparable)) {
            continue;
        }

        unique.add(comparable);
        result.push(trimmed.slice(0, maxItemLength));
    }

    return result.slice(0, maxItems);
};

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const country = getCountryFromRequest(request);
        const countryConfig = getCountryConfig(country);
        const { searchParams } = new URL(request.url);

        const view = searchParams.get('view') ?? 'directory';
        if (view !== 'directory' && view !== 'configuration' && view !== 'full') {
            return new NextResponse('Unknown hotel view', { status: 400 });
        }

        const parseIds = (key: string) => Array.from(new Set(
            searchParams
                .getAll(key)
                .flatMap((value) => value.split(','))
                .map((value) => value.trim())
                .filter(Boolean)
        ));

        const hotelIds = parseIds('hotelId');
        const managerIds = parseIds('managerId');
        if (hotelIds.length > MAX_FILTER_IDS || managerIds.length > MAX_FILTER_IDS) {
            return new NextResponse(`Too many filter values (max ${MAX_FILTER_IDS})`, { status: 400 });
        }

        const hotelWhere: Prisma.HotelWhereInput = {
            country,
            ...(hotelIds.length ? { id: { in: hotelIds } } : {}),
        };

        if (view === 'configuration') {
            const configurationRows = await prisma.hotel.findMany({
                where: hotelWhere,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: DIRECTORY_HOTEL_LIMIT + 1,
                select: hotelConfigurationSelect,
            });
            const hotelsTruncated = configurationRows.length > DIRECTORY_HOTEL_LIMIT;

            return NextResponse.json(
                configurationRows.slice(0, DIRECTORY_HOTEL_LIMIT),
                {
                    headers: {
                        'X-Result-Truncated': String(hotelsTruncated),
                        'X-Directory-Hotel-Limit': String(DIRECTORY_HOTEL_LIMIT),
                    },
                }
            );
        }

        if (view === 'directory') {
            const directoryRows = await prisma.hotel.findMany({
                where: hotelWhere,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: DIRECTORY_HOTEL_LIMIT + 1,
                select: hotelDirectorySelect,
            });
            const hotelsTruncated = directoryRows.length > DIRECTORY_HOTEL_LIMIT;
            const directoryHotels = directoryRows.slice(0, DIRECTORY_HOTEL_LIMIT);
            const directoryHotelIds = directoryHotels.map((hotel) => hotel.id);
            const assignmentRows = directoryHotelIds.length
                ? await prisma.hotelAssignment.findMany({
                    where: {
                        hotelId: { in: directoryHotelIds },
                        isActive: true,
                    },
                    orderBy: [{ hotelId: 'asc' }, { createdAt: 'asc' }],
                    take: DIRECTORY_ASSIGNMENT_LIMIT + 1,
                    select: {
                        hotelId: true,
                        role: true,
                        user: {
                            select: {
                                id: true,
                                displayName: true,
                                username: true,
                            },
                        },
                    },
                })
                : [];
            const assignmentsTruncated = assignmentRows.length > DIRECTORY_ASSIGNMENT_LIMIT;
            const managerMap = new Map<string, Array<{
                id: string;
                displayName: string | null;
                username: string | null;
                role: string;
            }>>();

            for (const assignment of assignmentRows.slice(0, DIRECTORY_ASSIGNMENT_LIMIT)) {
                const managers = managerMap.get(assignment.hotelId) ?? [];
                managers.push({
                    id: assignment.user.id,
                    displayName: assignment.user.displayName,
                    username: assignment.user.username,
                    role: assignment.role,
                });
                managerMap.set(assignment.hotelId, managers);
            }

            return NextResponse.json(
                directoryHotels.map((hotel) => ({
                    ...hotel,
                    managers: managerMap.get(hotel.id) ?? [],
                })),
                {
                    headers: {
                        'X-Result-Truncated': String(hotelsTruncated || assignmentsTruncated),
                        'X-Directory-Hotel-Limit': String(DIRECTORY_HOTEL_LIMIT),
                    },
                }
            );
        }

        const parsedStartDate = parseInputValue(searchParams.get('startAt'), countryConfig.timezone)
            ?? parseDateOnly(searchParams.get('startDate'), false, countryConfig.timezone);
        const parsedEndDate = parseInputValue(searchParams.get('endAt'), countryConfig.timezone)
            ?? parseDateOnly(searchParams.get('endDate'), true, countryConfig.timezone);
        const endDate = parsedEndDate ?? new Date();
        const startDate = parsedStartDate ?? new Date(endDate.getTime() - FULL_REPORT_DEFAULT_DAYS * DAY_MS);

        if (startDate.getTime() > endDate.getTime()) {
            return new NextResponse('Start date must not be after end date', { status: 400 });
        }
        if (endDate.getTime() - startDate.getTime() > FULL_REPORT_MAX_DAYS * DAY_MS) {
            return new NextResponse(`Report range must not exceed ${FULL_REPORT_MAX_DAYS} days`, { status: 400 });
        }

        const hotelRows = await prisma.hotel.findMany({
            where: hotelWhere,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: DIRECTORY_HOTEL_LIMIT + 1,
            select: {
                ...hotelConfigurationSelect,
                _count: {
                    select: { rooms: true },
                },
                shifts: {
                    where: { status: ShiftStatus.OPEN },
                    orderBy: { openedAt: 'desc' },
                    take: 1,
                    select: {
                        openedAt: true,
                        openingCash: true,
                        number: true,
                        manager: {
                            select: { displayName: true },
                        },
                    },
                },
                assignments: {
                    where: { isActive: true },
                    orderBy: { createdAt: 'asc' },
                    take: FULL_MANAGERS_PER_HOTEL_LIMIT,
                    select: {
                        role: true,
                        pinCode: true,
                        pinHash: true,
                        shiftPayAmount: true,
                        revenueSharePct: true,
                        user: {
                            select: {
                                id: true,
                                displayName: true,
                                telegramId: true,
                                loginName: true,
                                username: true,
                            },
                        },
                    },
                },
            },
        });
        const hotelsTruncated = hotelRows.length > DIRECTORY_HOTEL_LIMIT;
        const hotels = hotelRows.slice(0, DIRECTORY_HOTEL_LIMIT);
        const scopedHotelIds = hotels.map((hotel) => hotel.id);

        const ledgerWhere: Prisma.CashEntryWhereInput = {
            hotelId: { in: scopedHotelIds },
            ...(managerIds.length ? { managerId: { in: managerIds } } : {}),
            recordedAt: {
                gte: startDate,
                lte: endDate,
            },
        };

        const [roomStatusGroups, ledgerGroups, collectionEntries, recentExpenseEntries] = await Promise.all([
            prisma.room.groupBy({
                by: ['hotelId', 'status'],
                where: { hotelId: { in: scopedHotelIds } },
                _count: { _all: true },
            }),
            prisma.cashEntry.groupBy({
                by: ['hotelId', 'entryType', 'method'],
                _sum: { amount: true },
                where: ledgerWhere
            }),
            prisma.cashEntry.findMany({
                where: {
                    ...ledgerWhere,
                    entryType: LedgerEntryType.CASH_OUT,
                    OR: collectionCandidateFilters,
                },
                select: {
                    hotelId: true,
                    amount: true,
                    method: true,
                    note: true,
                    entryType: true,
                    expenseCategory: {
                        select: { name: true },
                    },
                },
            }),
            prisma.cashEntry.findMany({
                where: {
                    ...ledgerWhere,
                    entryType: { in: [LedgerEntryType.CASH_OUT, LedgerEntryType.MANAGER_PAYOUT, LedgerEntryType.ADJUSTMENT] },
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
                    expenseCategory: {
                        select: {
                            name: true
                        }
                    },
                    manager: {
                        select: {
                            displayName: true,
                        },
                    },
                },
            })
        ]);

        const occupiedRoomMap = new Map<string, number>();
        for (const group of roomStatusGroups) {
            if (group.status === RoomStatus.OCCUPIED) {
                occupiedRoomMap.set(group.hotelId, group._count._all);
            }
        }

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

        const collectionTotalsMap = new Map<string, number>();
        for (const entry of collectionEntries) {
            if (!isCollectionLedgerEntry(entry)) {
                continue;
            }
            collectionTotalsMap.set(
                entry.hotelId,
                (collectionTotalsMap.get(entry.hotelId) ?? 0) + entry.amount
            );
            const summary = ledgerMap.get(entry.hotelId) ?? (() => {
                const fresh = defaultLedger();
                ledgerMap.set(entry.hotelId, fresh);
                return fresh;
            })();
            const bucket = summary[LedgerEntryType.CASH_OUT];
            bucket.total -= entry.amount;
            if (entry.method === PaymentMethod.CASH) {
                bucket.cash -= entry.amount;
            } else if (entry.method === PaymentMethod.CARD) {
                bucket.card -= entry.amount;
            }
        }

        const recentExpensesMap = new Map<string, Array<{
            id: string;
            amount: number;
            method: PaymentMethod;
            note: string | null;
            categoryName: string | null;
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
                    categoryName: entry.expenseCategory?.name ?? null,
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
            usesExtranets: hotel.usesExtranets,
            extranetNames: hotel.extranetNames,
            hasMealPlan: hotel.hasMealPlan,
            allowGroupStays: hotel.allowGroupStays,
            allowPostpaidStays: hotel.allowPostpaidStays,
            allowOnlinePayments: hotel.allowOnlinePayments,
            guestQrEnabled: hotel.guestQrEnabled,
            showInGuestListing: hotel.showInGuestListing,
            guestDescription: hotel.guestDescription,
            guestAmenities: hotel.guestAmenities,
            guestPhotoUrls: hotel.guestPhotoUrls,
            guestMapUrl: hotel.guestMapUrl,
            financialCycleStartDay: hotel.financialCycleStartDay,
            managerSharePct: hotel.managerSharePct,
            monthlyPayrollCost: hotel.monthlyPayrollCost,
            monthlyRentCost: hotel.monthlyRentCost,
            monthlyUtilitiesCost: hotel.monthlyUtilitiesCost,
            monthlySuppliesCost: hotel.monthlySuppliesCost,
            monthlyOtherCost: hotel.monthlyOtherCost,
            notes: hotel.notes,
            cleaningChatId: hotel.cleaningChatId,
            roomCount: hotel._count.rooms,
            occupiedRooms: occupiedRoomMap.get(hotel.id) ?? 0,
            managers: hotel.assignments.map((assignment) => ({
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                telegramId: assignment.user.telegramId,
                loginName: assignment.user.loginName,
                username: assignment.user.username,
                role: assignment.role,
                hasPin: hasConfiguredPin(assignment),
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
                    cashOutBreakdown: toBreakdown(LedgerEntryType.CASH_OUT),
                    collections: collectionTotalsMap.get(hotel.id) ?? 0
                };
            })(),
            recentExpenses: recentExpensesMap.get(hotel.id) ?? []
        }));

        return NextResponse.json(payload, {
            headers: {
                'X-Result-Truncated': String(hotelsTruncated),
                'X-Report-Start': startDate.toISOString(),
                'X-Report-End': endDate.toISOString(),
            },
        });
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

        const headerCountry = request.headers.get('x-country-code');
        const country = payload.country || (headerCountry === 'KZ' || headerCountry === 'KG'
            ? headerCountry
            : 'KG');

        const hotel = await prisma.hotel.create({
            data: {
                ...payload,
                usesExtranets: payload.usesExtranets ?? false,
                extranetNames: sanitizeExtranetNames(payload.extranetNames ?? []),
                hasMealPlan: payload.hasMealPlan ?? false,
                allowGroupStays: payload.allowGroupStays ?? true,
                allowPostpaidStays: payload.allowPostpaidStays ?? false,
                allowOnlinePayments: payload.allowOnlinePayments ?? true,
                guestQrEnabled: payload.guestQrEnabled ?? false,
                showInGuestListing: payload.showInGuestListing ?? true,
                guestDescription: payload.guestDescription || null,
                guestAmenities: sanitizeUniqueTextList(payload.guestAmenities ?? [], 60, 40),
                guestPhotoUrls: sanitizeUniqueTextList(payload.guestPhotoUrls ?? [], 500, 12),
                guestMapUrl: payload.guestMapUrl || null,
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
