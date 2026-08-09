import { Prisma, StayStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { parseInputValue } from '@/lib/timezone';
import { decryptIntegrationCredential } from '@/lib/server/integration-credentials';

type ExelySummary = { number: string; status: string };
type ExelyRoomStay = {
    index?: number | string;
    stayDates?: { arrivalDateTime?: string; departureDateTime?: string };
    roomType?: { id?: string; name?: string };
    guests?: Array<{ firstName?: string; lastName?: string }>;
    total?: { priceAfterTax?: number; priceBeforeTax?: number };
};
type ExelyBooking = {
    number: string;
    status: string;
    currencyCode?: string;
    source?: { type?: string; code?: string };
    customer?: { firstName?: string; lastName?: string };
    guaranteeInfo?: { totalPrepaid?: number };
    roomStays?: ExelyRoomStay[];
};

const exelyAuthUrl = () => process.env.EXELY_AUTH_URL?.trim() || 'https://connect.hopenapi.com/auth/token';
const exelyApiUrl = () => process.env.EXELY_API_URL?.trim() || 'https://connect.hopenapi.com';

export type ExelyCredentials = {
    propertyId: string;
    clientId: string;
    clientSecret: string;
};

const fetchWithTimeout = async (url: URL | string, init?: RequestInit, timeoutMs = 30_000) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    return response;
};

const getToken = async (credentials: ExelyCredentials) => {
    const response = await fetchWithTimeout(exelyAuthUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
        }),
    });
    if (!response.ok) throw new Error(`Exely OAuth: HTTP ${response.status}`);
    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) throw new Error('Exely OAuth не вернул access_token');
    return payload.access_token;
};

export const verifyExelyCredentials = async (credentials: ExelyCredentials) => {
    await getToken(credentials);
};

const sourceName = (source?: ExelyBooking['source']) => {
    if (source?.type === 'PMS') return null;
    if (source?.code === 'BGC') return 'Booking';
    if (source?.code === 'CTP') return 'Trip.com';
    if (source?.code === 'OTK') return 'Островок';
    return source?.code || source?.type || 'Exely';
};

const fullName = (...parts: Array<string | undefined>) => parts.map((part) => part?.trim()).filter(Boolean).join(' ') || null;

const categoryTokens = (category: string | null) => {
    const normalized = (category ?? '').toLocaleLowerCase();
    if (normalized.includes('superior')) return ['superior'];
    if (normalized.includes('single')) return ['single'];
    if (normalized.includes('twin')) return ['twin'];
    if (normalized.includes('double')) return ['double'];
    return normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && token !== 'standart' && token !== 'standard');
};

const roomMatchesCategory = (label: string, category: string | null) => {
    const tokens = categoryTokens(category);
    if (!tokens.length) return false;
    const normalizedLabel = label.toLocaleLowerCase();
    return tokens.every((token) => normalizedLabel.includes(token));
};

const toMinorAmount = (amount: number | undefined, bookingCurrency: string | undefined, hotelCurrency: string) => {
    if (!Number.isFinite(amount) || !bookingCurrency || bookingCurrency !== hotelCurrency) return null;
    return Math.round((amount ?? 0) * 100);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ExelySyncResult = {
    propertyId: string;
    summaries: number;
    detailsLoaded: number;
    created: number;
    updated: number;
    cancelled: number;
    unassigned: number;
    skippedPast: number;
    failed: Array<{ number: string; error: string }>;
};

export async function getExelySyncStatus(hotelId: string) {
    const [connection, total, assigned, unassigned, activeUnassigned, last] = await Promise.all([
        prisma.exelyConnection.findUnique({
            where: { hotelId },
            select: { isEnabled: true, propertyId: true, clientId: true, updatedAt: true },
        }),
        prisma.exelyReservationRoom.count({ where: { hotelId } }),
        prisma.exelyReservationRoom.count({ where: { hotelId, assignedStayId: { not: null } } }),
        prisma.exelyReservationRoom.count({ where: { hotelId, assignedStayId: null } }),
        prisma.exelyReservationRoom.count({ where: { hotelId, assignedStayId: null, bookingStatus: 'Active', scheduledCheckOut: { gt: new Date() } } }),
        prisma.exelyReservationRoom.findFirst({ where: { hotelId }, orderBy: { lastSyncedAt: 'desc' }, select: { lastSyncedAt: true } }),
    ]);
    return {
        configured: Boolean(connection),
        enabled: connection?.isEnabled ?? false,
        propertyId: connection?.propertyId ?? '',
        clientId: connection?.clientId ?? '',
        hasClientSecret: Boolean(connection),
        configuredAt: connection?.updatedAt ?? null,
        total,
        assigned,
        unassigned,
        activeUnassigned,
        lastSyncedAt: last?.lastSyncedAt ?? null,
    };
}

export async function syncExelyReservations(hotelId: string, since: Date): Promise<ExelySyncResult> {
    const hotel = await prisma.hotel.findUnique({
        where: { id: hotelId },
        select: {
            id: true,
            name: true,
            currency: true,
            timezone: true,
            rooms: { where: { isActive: true }, select: { id: true, label: true } },
            exelyConnection: {
                select: { isEnabled: true, propertyId: true, clientId: true, clientSecretEncrypted: true },
            },
        },
    });
    if (!hotel) throw new Error('Объект не найден');
    if (!hotel.exelyConnection) throw new Error('Exely не настроен для этого объекта');
    if (!hotel.exelyConnection.isEnabled) throw new Error('Подключение Exely отключено для этого объекта');

    const credentials: ExelyCredentials = {
        propertyId: hotel.exelyConnection.propertyId,
        clientId: hotel.exelyConnection.clientId,
        clientSecret: decryptIntegrationCredential(hotel.exelyConnection.clientSecretEncrypted),
    };
    const propertyId = credentials.propertyId;
    const apiUrl = exelyApiUrl();
    const token = await getToken(credentials);
    const headers = { authorization: `Bearer ${token}` };
    const summaries: ExelySummary[] = [];
    let continueToken: string | undefined;
    do {
        const url = new URL(`/api/read-reservation/v1/properties/${propertyId}/bookings`, apiUrl);
        url.searchParams.set('lastModification', since.toISOString());
        url.searchParams.set('count', '1000');
        if (continueToken) url.searchParams.set('continueToken', continueToken);
        const response = await fetchWithTimeout(url, { headers });
        if (!response.ok) throw new Error(`Exely Read Reservation: HTTP ${response.status}`);
        const page = await response.json() as { bookingSummaries?: ExelySummary[]; hasMoreData?: boolean; continueToken?: string };
        summaries.push(...(page.bookingSummaries ?? []));
        continueToken = page.hasMoreData ? page.continueToken : undefined;
    } while (continueToken);

    const result: ExelySyncResult = { propertyId, summaries: summaries.length, detailsLoaded: 0, created: 0, updated: 0, cancelled: 0, unassigned: 0, skippedPast: 0, failed: [] };
    const bookings: ExelyBooking[] = [];
    for (let offset = 0; offset < summaries.length; offset += 5) {
        await Promise.all(summaries.slice(offset, offset + 5).map(async (summary) => {
            try {
                const url = new URL(`/api/read-reservation/v1/properties/${propertyId}/bookings/${summary.number}`, apiUrl);
                const response = await fetchWithTimeout(url, { headers });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json() as { booking?: ExelyBooking };
                if (payload.booking) { bookings.push(payload.booking); result.detailsLoaded += 1; }
            } catch (error) {
                result.failed.push({ number: summary.number, error: error instanceof Error ? error.message : 'Unknown error' });
            }
        }));
        // Exely allows 200 reservation-detail requests per minute. Five requests
        // every 1.6 seconds keeps an initial import below that limit.
        if (offset + 5 < summaries.length) await delay(1_600);
    }

    const now = new Date();
    for (const booking of bookings) {
        const bookingRooms = booking.roomStays ?? [];
        for (let position = 0; position < bookingRooms.length; position += 1) {
            const externalRoom = bookingRooms[position];
            const checkIn = parseInputValue(externalRoom.stayDates?.arrivalDateTime, hotel.timezone);
            const checkOut = parseInputValue(externalRoom.stayDates?.departureDateTime, hotel.timezone);
            if (!checkIn || !checkOut || checkOut <= checkIn) {
                result.failed.push({ number: booking.number, error: `Некорректные даты room stay ${position + 1}` });
                continue;
            }
            const roomStayIndex = String(externalRoom.index ?? position + 1);
            const guest = fullName(externalRoom.guests?.[0]?.firstName, externalRoom.guests?.[0]?.lastName)
                ?? fullName(booking.customer?.firstName, booking.customer?.lastName);
            const total = externalRoom.total?.priceAfterTax ?? externalRoom.total?.priceBeforeTax;
            const external = await prisma.exelyReservationRoom.upsert({
                where: { hotelId_bookingNumber_roomStayIndex: { hotelId, bookingNumber: booking.number, roomStayIndex } },
                create: {
                    hotelId, bookingNumber: booking.number, roomStayIndex, bookingStatus: booking.status,
                    guestName: guest, source: sourceName(booking.source), roomTypeId: externalRoom.roomType?.id ?? null,
                    roomTypeName: externalRoom.roomType?.name ?? null, scheduledCheckIn: checkIn, scheduledCheckOut: checkOut,
                    currencyCode: booking.currencyCode ?? null, totalAmount: total == null ? null : new Prisma.Decimal(total),
                    prepaidAmount: booking.guaranteeInfo?.totalPrepaid == null ? null : new Prisma.Decimal(booking.guaranteeInfo.totalPrepaid),
                    lastSyncedAt: now,
                },
                update: {
                    bookingStatus: booking.status, guestName: guest, source: sourceName(booking.source),
                    roomTypeId: externalRoom.roomType?.id ?? null, roomTypeName: externalRoom.roomType?.name ?? null,
                    scheduledCheckIn: checkIn, scheduledCheckOut: checkOut, currencyCode: booking.currencyCode ?? null,
                    totalAmount: total == null ? null : new Prisma.Decimal(total),
                    prepaidAmount: booking.guaranteeInfo?.totalPrepaid == null ? null : new Prisma.Decimal(booking.guaranteeInfo.totalPrepaid),
                    lastSyncedAt: now,
                },
                include: { assignedStay: true },
            });

            if (booking.status === 'Cancelled') {
                if (external.assignedStay?.status === StayStatus.SCHEDULED) {
                    await prisma.roomStay.update({ where: { id: external.assignedStay.id }, data: { status: StayStatus.CANCELLED, cancelledAt: now, notes: `Отменено в Exely · ${booking.number}` } });
                    result.cancelled += 1;
                }
                continue;
            }

            const minorTotal = toMinorAmount(total, booking.currencyCode, hotel.currency);
            const notes = booking.currencyCode === hotel.currency
                ? `Синхронизировано из Exely · категория ${externalRoom.roomType?.name ?? 'не указана'}`
                : `Синхронизировано из Exely · ${total ?? 0} ${booking.currencyCode ?? ''} · категория ${externalRoom.roomType?.name ?? 'не указана'} · требуется пересчёт в ${hotel.currency}`;

            if (external.assignedStay) {
                if (external.assignedStay.status === StayStatus.SCHEDULED) {
                    await prisma.roomStay.update({ where: { id: external.assignedStay.id }, data: { guestName: guest, bookingSource: sourceName(booking.source), scheduledCheckIn: checkIn, scheduledCheckOut: checkOut, totalAmount: minorTotal, tariffPending: minorTotal == null, notes } });
                    result.updated += 1;
                }
                continue;
            }

            if (checkOut <= now) { result.skippedPast += 1; continue; }
            const matchingRooms = hotel.rooms.filter((room) => roomMatchesCategory(room.label, externalRoom.roomType?.name ?? null));
            let assignedRoomId: string | null = null;
            for (const room of matchingRooms) {
                const conflict = await prisma.roomStay.findFirst({
                    where: { roomId: room.id, status: { in: [StayStatus.SCHEDULED, StayStatus.CHECKED_IN] }, scheduledCheckIn: { lt: checkOut }, scheduledCheckOut: { gt: checkIn } },
                    select: { id: true },
                });
                if (!conflict) { assignedRoomId = room.id; break; }
            }
            if (!assignedRoomId) { result.unassigned += 1; continue; }

            const stay = await prisma.roomStay.create({ data: {
                hotelId, roomId: assignedRoomId, guestName: guest, bookingSource: sourceName(booking.source), bookingNumber: booking.number,
                scheduledCheckIn: checkIn, scheduledCheckOut: checkOut, status: StayStatus.SCHEDULED,
                totalAmount: minorTotal, amountPaid: 0, cashPaid: 0, cardPaid: 0, onlinePaid: 0,
                tariffPending: minorTotal == null, notes,
            } });
            await prisma.exelyReservationRoom.update({ where: { id: external.id }, data: { assignedStayId: stay.id } });
            result.created += 1;
        }
    }
    return result;
}
