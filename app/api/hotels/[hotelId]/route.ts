import { NextRequest, NextResponse } from 'next/server';
import { LedgerEntryType, Prisma, RoomStatus, ShiftStatus, StayStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { sanitizeExtranetNames } from '@/lib/stays';
import { isCollectionLedgerEntry } from '@/lib/ledger';
import { hasConfiguredPin } from '@/lib/pin';
import { httpUrlSchema } from '@/lib/http-url';

export const dynamic = 'force-dynamic';

const SHIFT_HISTORY_LIMIT = 180;
const DEFAULT_BOARD_PAST_DAYS = 1;
const DEFAULT_BOARD_FUTURE_DAYS = 30;
const MAX_BOARD_RANGE_DAYS = 62;
const DEFAULT_DETAIL_PAGE_SIZE = 50;
const MAX_DETAIL_PAGE_SIZE = 100;
const PREPAID_BOOKING_PREVIEW_LIMIT = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLLECTION_SEARCH_TERMS = ['инкассац', 'инкасац', 'inkass', 'incass', 'collection'] as const;

const collectionCandidateFilters: Prisma.CashEntryWhereInput[] = COLLECTION_SEARCH_TERMS.flatMap((term) => [
    { note: { contains: term, mode: 'insensitive' } },
    { expenseCategory: { name: { contains: term, mode: 'insensitive' } } }
]);

const stayShiftSelect = {
    id: true,
    number: true,
    status: true,
    openedAt: true,
    closedAt: true,
    manager: {
        select: {
            displayName: true
        }
    }
} as const;

const roomStayScalarSelect = {
    id: true,
    roomId: true,
    shiftId: true,
    guestName: true,
    guestPhone: true,
    companyName: true,
    bookingSource: true,
    bookingNumber: true,
    scheduledCheckIn: true,
    scheduledCheckOut: true,
    actualCheckIn: true,
    actualCheckOut: true,
    status: true,
    notes: true,
    amountPaid: true,
    totalAmount: true,
    paymentMethod: true,
    cashPaid: true,
    cardPaid: true,
    onlinePaid: true,
    tariffPending: true,
    mealPlan: true,
    cancellationPaymentAction: true,
    cancellationAmount: true,
    cancelledAt: true
} as const;

const roomStaySummarySelect = {
    ...roomStayScalarSelect,
    shift: {
        select: stayShiftSelect
    }
} as const;

const roomStayWithTransfersSelect = {
    ...roomStaySummarySelect,
    transfers: {
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            createdAt: true,
            note: true,
            fromRoom: { select: { label: true } },
            toRoom: { select: { label: true } },
        }
    }
} as const;

const roomStayDetailSelect = {
    ...roomStayWithTransfersSelect,
    ledgerEntries: {
        orderBy: { recordedAt: 'asc' },
        select: {
            id: true,
            entryType: true,
            method: true,
            amount: true,
            originalAmount: true,
            originalCurrency: true,
            exchangeRate: true,
            note: true,
            recordedAt: true,
            shift: { select: { number: true } },
            manager: { select: { displayName: true } }
        }
    }
} as const;

const pendingStaySelect = {
    ...roomStaySummarySelect,
    createdAt: true,
    room: { select: { id: true, label: true, floor: true } },
} as const;

const hotelDetailSelect = {
    id: true,
    name: true,
    address: true,
    timezone: true,
    currency: true,
    financialCycleStartDay: true,
    managerSharePct: true,
    cleaningChatId: true,
    notes: true,
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
    expenseCategories: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true }
    },
    employees: {
        orderBy: { fullName: 'asc' },
        select: {
            id: true,
            fullName: true,
            position: true,
            payType: true,
            payAmount: true,
            isActive: true,
            hiredAt: true,
            dismissedAt: true,
            notes: true,
        },
    },
    rooms: {
        orderBy: { label: 'asc' },
        select: {
            id: true,
            label: true,
            floor: true,
            status: true,
            isActive: true,
            notes: true,
            currentStay: {
                select: roomStaySummarySelect
            }
        }
    },
    shifts: {
        orderBy: { openedAt: 'desc' },
        take: SHIFT_HISTORY_LIMIT,
        select: {
            id: true,
            managerId: true,
            status: true,
            openedAt: true,
            closedAt: true,
            openingCash: true,
            closingCash: true,
            handoverCash: true,
            openingNote: true,
            closingNote: true,
            handoverNote: true,
            number: true,
            manager: { select: { displayName: true } }
        }
    },
    assignments: {
        where: { isActive: true },
        select: {
            id: true,
            userId: true,
            pinCode: true,
            pinHash: true,
            shiftPayAmount: true,
            revenueSharePct: true,
            canEditBookings: true,
            canEditStayPayments: true,
            canCancelBookings: true,
            user: {
                select: {
                    id: true,
                    displayName: true,
                    loginName: true
                }
            }
        }
    }
} as const;

type HotelDetailRecord = Prisma.HotelGetPayload<{ select: typeof hotelDetailSelect }>;
type StaySummaryRecord = Prisma.RoomStayGetPayload<{ select: typeof roomStaySummarySelect }>;
type StayWithTransfersRecord = Prisma.RoomStayGetPayload<{ select: typeof roomStayWithTransfersSelect }>;
type StayDetailRecord = Prisma.RoomStayGetPayload<{ select: typeof roomStayDetailSelect }>;
type PendingStayRecord = Prisma.RoomStayGetPayload<{ select: typeof pendingStaySelect }>;

const serializeStay = (stay: StaySummaryRecord | StayWithTransfersRecord | StayDetailRecord) => ({
    id: stay.id,
    guestName: stay.guestName,
    guestPhone: stay.guestPhone,
    companyName: stay.companyName,
    status: stay.status,
    scheduledCheckIn: stay.scheduledCheckIn,
    scheduledCheckOut: stay.scheduledCheckOut,
    actualCheckIn: stay.actualCheckIn,
    actualCheckOut: stay.actualCheckOut,
    amountPaid: stay.amountPaid,
    totalAmount: stay.totalAmount,
    paymentMethod: stay.paymentMethod,
    cashPaid: stay.cashPaid,
    cardPaid: stay.cardPaid,
    onlinePaid: stay.onlinePaid,
    tariffPending: stay.tariffPending,
    bookingSource: stay.bookingSource,
    bookingNumber: stay.bookingNumber,
    cancellationPaymentAction: stay.cancellationPaymentAction,
    cancellationAmount: stay.cancellationAmount,
    cancelledAt: stay.cancelledAt,
    mealPlan: stay.mealPlan,
    shiftId: stay.shift?.id ?? null,
    shiftNumber: stay.shift?.number ?? null,
    shiftStatus: stay.shift?.status ?? null,
    shiftOpenedAt: stay.shift?.openedAt ?? null,
    shiftClosedAt: stay.shift?.closedAt ?? null,
    shiftManagerName: stay.shift?.manager.displayName ?? null,
    ...('transfers' in stay
        ? {
            transfers: stay.transfers.map((transfer) => ({
                id: transfer.id,
                createdAt: transfer.createdAt,
                note: transfer.note,
                fromRoomLabel: transfer.fromRoom.label,
                toRoomLabel: transfer.toRoom.label,
            })),
        }
        : {}),
    ...('ledgerEntries' in stay
        ? {
            ledgerEntries: stay.ledgerEntries.map((entry) => ({
                id: entry.id,
                entryType: entry.entryType,
                method: entry.method,
                amount: entry.amount,
                originalAmount: entry.originalAmount,
                originalCurrency: entry.originalCurrency,
                exchangeRate: entry.exchangeRate,
                note: entry.note,
                recordedAt: entry.recordedAt,
                shiftNumber: entry.shift?.number ?? null,
                managerName: entry.manager?.displayName ?? null,
            })),
        }
        : {}),
    notes: stay.notes,
});

const serializePendingStay = (stay: PendingStayRecord) => ({
    ...serializeStay(stay),
    roomId: stay.roomId,
    roomLabel: stay.room.label,
    roomFloor: stay.room.floor,
});

const detailQuerySchema = z.object({
    view: z.enum(['core', 'stay', 'history', 'pending']).default('core'),
    stayId: z.string().cuid().optional(),
    kind: z.enum(['online', 'postpaid']).optional(),
    cursor: z.string().cuid().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_DETAIL_PAGE_SIZE).default(DEFAULT_DETAIL_PAGE_SIZE),
    search: z.string().trim().max(100).optional(),
    status: z.nativeEnum(StayStatus).optional(),
    boardStartAt: z.string().datetime().optional(),
    boardEndAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
    if (value.view === 'stay' && !value.stayId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['stayId'], message: 'stayId is required' });
    }
    if (value.view === 'pending' && !value.kind) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: 'kind is required' });
    }
    if (Boolean(value.boardStartAt) !== Boolean(value.boardEndAt)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['boardStartAt'], message: 'Both board dates are required' });
    }
});

const cleaningChatIdSchema = z
    .string()
    .trim()
    .regex(/^-?\d+$/, { message: 'ID чата должен содержать только цифры и, при необходимости, знак -' })
    .min(5)
    .max(32);

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

const updateHotelSchema = z
    .object({
        name: z.string().min(2).optional(),
        address: z.string().min(4).optional(),
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
    })
    .refine((values) => Object.keys(values).length > 0, {
        message: 'Не переданы поля для обновления'
    });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(_request);
        assertAdmin(session);
        const country = getCountryFromRequest(_request);
        const parsedQuery = detailQuerySchema.safeParse(Object.fromEntries(_request.nextUrl.searchParams.entries()));

        if (!parsedQuery.success) {
            return new NextResponse(parsedQuery.error.issues[0]?.message ?? 'Invalid query', { status: 400 });
        }

        const query = parsedQuery.data;

        if (query.view === 'stay') {
            const stay = await prisma.roomStay.findFirst({
                where: {
                    id: query.stayId,
                    hotelId,
                    hotel: { country },
                },
                select: roomStayDetailSelect,
            });

            if (!stay) {
                return new NextResponse('Stay not found', { status: 404 });
            }

            return NextResponse.json({ stay: serializeStay(stay) });
        }

        if (query.view === 'history') {
            const bookingNumberSearch = query.search
                ?.replace(/^(?:бронь|бронирование|booking)\s*/i, '')
                .replace(/^[№#]\s*/, '')
                .trim();
            const historyStatuses = query.status
                ? [query.status]
                : [StayStatus.SCHEDULED, StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT, StayStatus.CANCELLED];
            const historyWhere: Prisma.RoomStayWhereInput = {
                hotelId,
                hotel: { country },
                status: { in: historyStatuses },
                ...(query.search
                    ? {
                        OR: [
                            { guestName: { contains: query.search, mode: 'insensitive' } },
                            { guestPhone: { contains: query.search, mode: 'insensitive' } },
                            { companyName: { contains: query.search, mode: 'insensitive' } },
                            { bookingSource: { contains: query.search, mode: 'insensitive' } },
                            ...(bookingNumberSearch
                                ? [{ bookingNumber: { contains: bookingNumberSearch, mode: 'insensitive' as const } }]
                                : []),
                            { notes: { contains: query.search, mode: 'insensitive' } },
                            { room: { label: { contains: query.search, mode: 'insensitive' } } },
                        ],
                    }
                    : {}),
            };
            const [historyRows, total] = await prisma.$transaction([
                prisma.roomStay.findMany({
                    where: historyWhere,
                    orderBy: [{ scheduledCheckIn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                    take: query.limit + 1,
                    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
                    select: roomStayWithTransfersSelect,
                }),
                prisma.roomStay.count({ where: historyWhere }),
            ]);
            const hasMore = historyRows.length > query.limit;
            const pageRows = historyRows.slice(0, query.limit);

            return NextResponse.json({
                stays: pageRows.map((stay) => ({
                    roomId: stay.roomId,
                    stay: serializeStay(stay),
                })),
                pagination: {
                    total,
                    limit: query.limit,
                    hasMore,
                    nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
                },
            });
        }

        if (query.view === 'pending') {
            const pendingWhere: Prisma.RoomStayWhereInput = query.kind === 'online'
                ? {
                    hotelId,
                    hotel: { country },
                    onlinePaid: { gt: 0 },
                }
                : {
                    hotelId,
                    hotel: { country },
                    status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] },
                    OR: [
                        { tariffPending: true },
                        {
                            AND: [
                                { totalAmount: { gt: 0 } },
                                {
                                    OR: [
                                        { amountPaid: null },
                                        { amountPaid: { lt: prisma.roomStay.fields.totalAmount } },
                                    ],
                                },
                            ],
                        },
                    ],
                };
            const [pendingRows, total] = await prisma.$transaction([
                prisma.roomStay.findMany({
                    where: pendingWhere,
                    orderBy: [{ scheduledCheckIn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                    take: query.limit + 1,
                    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
                    select: pendingStaySelect,
                }),
                prisma.roomStay.count({ where: pendingWhere }),
            ]);
            const hasMore = pendingRows.length > query.limit;
            const pageRows = pendingRows.slice(0, query.limit);

            return NextResponse.json({
                stays: pageRows.map((stay) => ({
                    ...serializePendingStay(stay),
                    ...(query.kind === 'postpaid'
                        ? { pendingPostpaidAmount: Math.max((stay.totalAmount ?? 0) - (stay.amountPaid ?? 0), 0) }
                        : {}),
                })),
                pagination: {
                    total,
                    limit: query.limit,
                    hasMore,
                    nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
                },
            });
        }

        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: hotelDetailSelect
        });

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const hotelRecord: HotelDetailRecord = hotel;
        const visibleShiftIds = hotelRecord.shifts.map((shift) => shift.id);
        const now = new Date();
        const boardStart = query.boardStartAt
            ? new Date(query.boardStartAt)
            : new Date(now.getTime() - DEFAULT_BOARD_PAST_DAYS * DAY_MS);
        const boardEnd = query.boardEndAt
            ? new Date(query.boardEndAt)
            : new Date(now.getTime() + DEFAULT_BOARD_FUTURE_DAYS * DAY_MS);

        if (boardStart.getTime() >= boardEnd.getTime()) {
            return new NextResponse('Invalid board range', { status: 400 });
        }
        if (boardEnd.getTime() - boardStart.getTime() > MAX_BOARD_RANGE_DAYS * DAY_MS) {
            return new NextResponse(`Board range must not exceed ${MAX_BOARD_RANGE_DAYS} days`, { status: 400 });
        }

        const [operationalRoomStays, ledgerGroups, collectionEntries, shiftLedgerGroups, bonusTiers, stayRevenueByShift, pendingOnlineGroups, postpaidCandidateStays, prepaidBookingAggregate, prepaidBookingPreview] = await prisma.$transaction([
            prisma.roomStay.findMany({
                where: {
                    hotelId,
                    OR: [
                        { status: StayStatus.CHECKED_IN },
                        {
                            status: StayStatus.SCHEDULED,
                            scheduledCheckIn: { lt: boardEnd },
                            scheduledCheckOut: { gt: boardStart },
                        },
                    ],
                },
                orderBy: [{ scheduledCheckIn: 'asc' }, { createdAt: 'asc' }],
                select: roomStaySummarySelect,
            }),
            prisma.cashEntry.groupBy({
                by: ['entryType'],
                orderBy: { entryType: 'asc' },
                where: { hotelId },
                _sum: { amount: true }
            }),
            prisma.cashEntry.findMany({
                where: {
                    hotelId,
                    entryType: LedgerEntryType.CASH_OUT,
                    OR: collectionCandidateFilters
                },
                select: {
                    amount: true,
                    method: true,
                    note: true,
                    entryType: true,
                    expenseCategory: { select: { name: true } },
                },
            }),
            prisma.cashEntry.groupBy({
                by: ['shiftId', 'entryType'],
                orderBy: [
                    { shiftId: 'asc' },
                    { entryType: 'asc' }
                ],
                where: { hotelId, shiftId: { in: visibleShiftIds } },
                _sum: { amount: true }
            }),
            prisma.bonusTier.findMany({
                where: { hotelId },
                orderBy: { threshold: 'asc' },
                select: { id: true, threshold: true, bonus: true, bonusPct: true }
            }),
            prisma.roomStay.groupBy({
                by: ['shiftId'],
                orderBy: { shiftId: 'asc' },
                where: {
                    hotelId,
                    shiftId: { in: visibleShiftIds },
                    status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] }
                },
                _sum: { amountPaid: true, onlinePaid: true }
            }),
            prisma.roomStay.groupBy({
                by: ['shiftId'],
                orderBy: { shiftId: 'asc' },
                where: {
                    hotelId,
                    onlinePaid: { gt: 0 }
                },
                _sum: { onlinePaid: true },
            }),
            prisma.roomStay.findMany({
                where: {
                    hotelId,
                    status: { in: [StayStatus.CHECKED_IN, StayStatus.CHECKED_OUT] },
                    OR: [
                        { tariffPending: true },
                        {
                            AND: [
                                { totalAmount: { gt: 0 } },
                                {
                                    OR: [
                                        { amountPaid: null },
                                        { amountPaid: { lt: prisma.roomStay.fields.totalAmount } }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                select: {
                    shiftId: true,
                    totalAmount: true,
                    amountPaid: true,
                    tariffPending: true,
                },
            }),
            prisma.roomStay.aggregate({
                where: {
                    hotelId,
                    status: StayStatus.SCHEDULED,
                    amountPaid: { gt: 0 },
                },
                _sum: { amountPaid: true },
                _count: { _all: true },
            }),
            prisma.roomStay.findMany({
                where: {
                    hotelId,
                    status: StayStatus.SCHEDULED,
                    amountPaid: { gt: 0 },
                },
                orderBy: [{ scheduledCheckIn: 'asc' }, { createdAt: 'asc' }],
                take: PREPAID_BOOKING_PREVIEW_LIMIT,
                select: pendingStaySelect,
            }),
        ]);

        const roomStays = new Map<string, StaySummaryRecord[]>();
        for (const stay of operationalRoomStays) {
            const stays = roomStays.get(stay.roomId) ?? [];
            stays.push(stay);
            roomStays.set(stay.roomId, stays);
        }

        const ledgerTotals: Record<LedgerEntryType, number> = {
            [LedgerEntryType.CASH_IN]: 0,
            [LedgerEntryType.CASH_OUT]: 0,
            [LedgerEntryType.MANAGER_PAYOUT]: 0,
            [LedgerEntryType.ADJUSTMENT]: 0
        };

        for (const group of ledgerGroups) {
            ledgerTotals[group.entryType] = group._sum?.amount ?? 0;
        }
        const collectionsTotal = collectionEntries.reduce(
            (total, entry) => total + (isCollectionLedgerEntry(entry) ? entry.amount : 0),
            0
        );
        ledgerTotals[LedgerEntryType.CASH_OUT] -= collectionsTotal;

        const shiftLedgerTotals = new Map<
            string,
            { cashIn: number; payouts: number }
        >();

        for (const group of shiftLedgerGroups) {
            if (!group.shiftId) {
                continue;
            }
            const bucket = shiftLedgerTotals.get(group.shiftId) ?? { cashIn: 0, payouts: 0 };
            switch (group.entryType) {
                case LedgerEntryType.CASH_IN:
                    bucket.cashIn += group._sum?.amount ?? 0;
                    break;
                case LedgerEntryType.MANAGER_PAYOUT:
                    bucket.payouts += group._sum?.amount ?? 0;
                    break;
                default:
                    break;
            }
            shiftLedgerTotals.set(group.shiftId, bucket);
        }

        const assignmentComp = new Map<
            string,
            { shiftPayAmount: number | null | undefined; revenueSharePct: number | null | undefined }
        >();

        for (const assignment of hotelRecord.assignments) {
            assignmentComp.set(assignment.userId, {
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct
            });
        }

        const computePayout = (shiftId: string, managerId: string, bonusAmount?: number | null) => {
            const comp = assignmentComp.get(managerId);
            if (!comp) {
                return null;
            }
            const ledger = shiftLedgerTotals.get(shiftId) ?? { cashIn: 0, payouts: 0 };
            return calculateManagerPayout({
                shiftPayAmount: comp.shiftPayAmount,
                revenueSharePct: comp.revenueSharePct,
                bonusAmount: bonusAmount ?? 0,
                cashIn: ledger.cashIn,
                payouts: ledger.payouts ?? 0,
            });
        };

        const shiftStayRevenue = new Map<string, number>();
        const shiftPendingOnline = new Map<string, number>();
        for (const group of stayRevenueByShift) {
            if (group.shiftId) {
                const online = group._sum?.onlinePaid ?? 0;
                shiftStayRevenue.set(group.shiftId, Math.max((group._sum?.amountPaid ?? 0) - online, 0));
                shiftPendingOnline.set(group.shiftId, online);
            }
        }

        const computeShiftBonus = (shiftId: string) => {
            const revenue = shiftStayRevenue.get(shiftId) ?? 0;
            return calculateBonusFromTiers(revenue, bonusTiers);
        };

        const pendingOnlineTotal = pendingOnlineGroups.reduce(
            (total, group) => total + (group._sum?.onlinePaid ?? 0),
            0
        );
        const pendingPostpaidStays = postpaidCandidateStays
            .map((stay) => ({
                ...stay,
                pendingPostpaidAmount: Math.max((stay.totalAmount ?? 0) - (stay.amountPaid ?? 0), 0)
            }))
            .filter((stay) => stay.tariffPending || stay.pendingPostpaidAmount > 0);
        const pendingPostpaidTotal = pendingPostpaidStays.reduce((total, stay) => total + stay.pendingPostpaidAmount, 0);
        const tariffPendingCount = pendingPostpaidStays.filter((stay) => stay.tariffPending).length;
        const shiftPendingPostpaid = new Map<string, number>();
        const shiftTariffPending = new Map<string, number>();

        for (const stay of pendingPostpaidStays) {
            if (!stay.shiftId) {
                continue;
            }
            shiftPendingPostpaid.set(stay.shiftId, (shiftPendingPostpaid.get(stay.shiftId) ?? 0) + stay.pendingPostpaidAmount);
            if (stay.tariffPending) {
                shiftTariffPending.set(stay.shiftId, (shiftTariffPending.get(stay.shiftId) ?? 0) + 1);
            }
        }

        const activeShiftRecord = hotelRecord.shifts.find((shift) => shift.status === ShiftStatus.OPEN);
        const activeShiftBonus = activeShiftRecord ? computeShiftBonus(activeShiftRecord.id) : null;
        const activeShiftPayout = activeShiftRecord ? computePayout(activeShiftRecord.id, activeShiftRecord.managerId, activeShiftBonus?.computed ?? 0) : null;

        const shiftHistory = hotelRecord.shifts
            .filter((shift) => shift.status === ShiftStatus.CLOSED)
            .map((shift) => {
                const shiftBonus = computeShiftBonus(shift.id);
                const payout = computePayout(shift.id, shift.managerId, shiftBonus?.computed ?? 0);
                return {
                    id: shift.id,
                    number: shift.number,
                    managerId: shift.managerId,
                    manager: shift.manager.displayName,
                    openedAt: shift.openedAt,
                    closedAt: shift.closedAt,
                    openingCash: shift.openingCash,
                    closingCash: shift.closingCash,
                    handoverCash: shift.handoverCash,
                    openingNote: shift.openingNote,
                    closingNote: shift.closingNote,
                    handoverNote: shift.handoverNote,
                    status: shift.status,
                    expectedPayout: payout?.expected ?? null,
                    paidPayout: payout?.paid ?? null,
                    pendingPayout: payout?.pending ?? null,
                    bonus: shiftBonus?.computed ?? null,
                    pendingOnline: shiftPendingOnline.get(shift.id) ?? 0,
                    pendingPostpaid: shiftPendingPostpaid.get(shift.id) ?? 0,
                    tariffPendingCount: shiftTariffPending.get(shift.id) ?? 0
                };
            });

        const payload = {
            id: hotelRecord.id,
            name: hotelRecord.name,
            address: hotelRecord.address,
            timezone: hotelRecord.timezone,
            currency: hotelRecord.currency,
            usesExtranets: hotelRecord.usesExtranets,
            extranetNames: hotelRecord.extranetNames,
            hasMealPlan: hotelRecord.hasMealPlan,
            allowGroupStays: hotelRecord.allowGroupStays,
            allowPostpaidStays: hotelRecord.allowPostpaidStays,
            allowOnlinePayments: hotelRecord.allowOnlinePayments,
            guestQrEnabled: hotelRecord.guestQrEnabled,
            showInGuestListing: hotelRecord.showInGuestListing,
            guestDescription: hotelRecord.guestDescription,
            guestAmenities: hotelRecord.guestAmenities,
            guestPhotoUrls: hotelRecord.guestPhotoUrls,
            guestMapUrl: hotelRecord.guestMapUrl,
            financialCycleStartDay: hotelRecord.financialCycleStartDay,
            managerSharePct: hotelRecord.managerSharePct,
            cleaningChatId: hotelRecord.cleaningChatId,
            notes: hotelRecord.notes,
            roomCount: hotelRecord.rooms.length,
            occupiedRooms: hotelRecord.rooms.filter((room) => room.status === RoomStatus.OCCUPIED).length,
            rooms: hotelRecord.rooms.map((room) => {
                const currentStay = room.currentStay ? serializeStay(room.currentStay) : null;
                const selectedStays = roomStays.get(room.id) ?? [];
                const uniqueStays = new Map<string, StaySummaryRecord>();
                for (const stay of [...(room.currentStay ? [room.currentStay] : []), ...selectedStays]) {
                    if (!uniqueStays.has(stay.id)) {
                        uniqueStays.set(stay.id, stay);
                    }
                }
                const stayHistory = Array.from(uniqueStays.values()).map((stay) => serializeStay(stay));
                const checkedInStay = stayHistory.find((stay) => stay.status === StayStatus.CHECKED_IN) ?? null;
                const scheduledStay = stayHistory.find((stay) => stay.status === StayStatus.SCHEDULED) ?? null;
                const historyStay = stayHistory.find((stay) => stay.status !== StayStatus.CHECKED_IN) ?? stayHistory[0] ?? null;
                const latestStay = currentStay ?? (room.status === RoomStatus.OCCUPIED ? checkedInStay : null) ?? scheduledStay ?? historyStay;

                return {
                    id: room.id,
                    label: room.label,
                    floor: room.floor,
                    status: room.status,
                    isActive: room.isActive,
                    notes: room.notes,
                    stay: latestStay,
                    stays: stayHistory
                };
            }),
            managers: hotelRecord.assignments.map((assignment) => ({
                assignmentId: assignment.id,
                id: assignment.user.id,
                displayName: assignment.user.displayName,
                loginName: assignment.user.loginName,
                hasPin: hasConfiguredPin(assignment),
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct,
                canEditBookings: assignment.canEditBookings,
                canEditStayPayments: assignment.canEditStayPayments,
                canCancelBookings: assignment.canCancelBookings
            })),
            employees: hotelRecord.employees,
            activeShift: activeShiftRecord
                ? {
                    id: activeShiftRecord.id,
                    managerId: activeShiftRecord.managerId,
                    manager: activeShiftRecord.manager.displayName,
                    openedAt: activeShiftRecord.openedAt,
                    openingCash: activeShiftRecord.openingCash,
                    closingCash: activeShiftRecord.closingCash,
                    handoverCash: activeShiftRecord.handoverCash,
                    openingNote: activeShiftRecord.openingNote,
                    closingNote: activeShiftRecord.closingNote,
                    handoverNote: activeShiftRecord.handoverNote,
                    number: activeShiftRecord.number,
                    status: activeShiftRecord.status,
                    expectedPayout: activeShiftPayout?.expected ?? null,
                    paidPayout: activeShiftPayout?.paid ?? null,
                    pendingPayout: activeShiftPayout?.pending ?? null,
                    bonus: activeShiftBonus?.computed ?? null,
                    pendingOnline: shiftPendingOnline.get(activeShiftRecord.id) ?? 0,
                    pendingPostpaid: shiftPendingPostpaid.get(activeShiftRecord.id) ?? 0,
                    tariffPendingCount: shiftTariffPending.get(activeShiftRecord.id) ?? 0
                }
                : null,
            shiftHistory,
            prepaidBookings: {
                count: prepaidBookingAggregate._count._all,
                total: prepaidBookingAggregate._sum.amountPaid ?? 0,
                items: prepaidBookingPreview.map(serializePendingStay),
            },
            expenseCategories: hotelRecord.expenseCategories.map((category) => ({
                id: category.id,
                name: category.name
            })),
            bonusTiers: bonusTiers.map((t) => ({
                id: t.id,
                threshold: t.threshold,
                bonus: t.bonus,
                bonusPct: t.bonusPct
            })),
            financials: {
                cashIn: ledgerTotals[LedgerEntryType.CASH_IN],
                cashOut: ledgerTotals[LedgerEntryType.CASH_OUT],
                collections: collectionsTotal,
                payouts: ledgerTotals[LedgerEntryType.MANAGER_PAYOUT],
                adjustments: ledgerTotals[LedgerEntryType.ADJUSTMENT],
                pendingOnline: pendingOnlineTotal,
                pendingPostpaid: pendingPostpaidTotal,
                tariffPendingCount,
                netCash:
                    ledgerTotals[LedgerEntryType.CASH_IN] -
                    ledgerTotals[LedgerEntryType.CASH_OUT] -
                    collectionsTotal -
                    ledgerTotals[LedgerEntryType.MANAGER_PAYOUT] +
                    ledgerTotals[LedgerEntryType.ADJUSTMENT]
            }
        };

        return NextResponse.json(payload);
    } catch (error) {
        return handleApiError(error, 'Failed to load hotel details');
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const body = await request.json();
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = updateHotelSchema.parse(body);
        const updatePayload = {
            ...payload,
            ...(payload.guestDescription !== undefined ? { guestDescription: payload.guestDescription || null } : {}),
            ...(payload.guestAmenities !== undefined ? { guestAmenities: sanitizeUniqueTextList(payload.guestAmenities, 60, 40) } : {}),
            ...(payload.guestPhotoUrls !== undefined ? { guestPhotoUrls: sanitizeUniqueTextList(payload.guestPhotoUrls, 500, 12) } : {}),
            ...(payload.guestMapUrl !== undefined ? { guestMapUrl: payload.guestMapUrl || null } : {})
        };

        const targetHotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true },
        });
        if (!targetHotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const hotel = await prisma.hotel.update({
            where: { id: hotelId },
            data: {
                ...updatePayload,
                extranetNames: payload.extranetNames ? sanitizeExtranetNames(payload.extranetNames) : undefined
            } as Prisma.HotelUpdateInput
        });

        return NextResponse.json(hotel);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if ((error as { code?: string } | null)?.code === 'P2025') {
            return new NextResponse('Hotel not found', { status: 404 });
        }
        return handleApiError(error, 'Failed to update hotel');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const targetHotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true },
        });
        if (!targetHotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const deleted = await prisma.$transaction(async (tx) => {
            await tx.room.updateMany({ where: { hotelId }, data: { currentStayId: null } });
            await tx.cashEntry.deleteMany({ where: { hotelId } });
            await tx.roomStay.deleteMany({ where: { hotelId } });
            await tx.shift.deleteMany({ where: { hotelId } });
            await tx.room.deleteMany({ where: { hotelId } });
            await tx.hotelAssignment.deleteMany({ where: { hotelId } });

            return tx.hotel.delete({ where: { id: hotelId } });
        });

        return NextResponse.json({ success: true, id: deleted.id });
    } catch (error) {
        if ((error as { code?: string } | null)?.code === 'P2025') {
            return new NextResponse('Hotel not found', { status: 404 });
        }
        return handleApiError(error, 'Failed to delete hotel');
    }
}
