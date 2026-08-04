import { RoomStatus, StayStatus } from '@prisma/client';

import { prisma } from '@/lib/db';

type RoomWithLatestStay = {
    label: string;
    floor: string | null;
    status: RoomStatus;
    stays: Array<{
        status: StayStatus;
        scheduledCheckIn: Date;
        scheduledCheckOut: Date;
    }>;
};

const toParts = (value: Date, timezone?: string) =>
    new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone || 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(value);

const sameDayInTimezone = (left: Date, right: Date, timezone?: string) => {
    const pick = (parts: Intl.DateTimeFormatPart[], key: 'year' | 'month' | 'day') =>
        parts.find((part) => part.type === key)?.value;

    const leftParts = toParts(left, timezone);
    const rightParts = toParts(right, timezone);

    return (
        pick(leftParts, 'year') === pick(rightParts, 'year') &&
        pick(leftParts, 'month') === pick(rightParts, 'month') &&
        pick(leftParts, 'day') === pick(rightParts, 'day')
    );
};

const formatDateTime = (value: Date, timezone?: string, includeDate = false) =>
    new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone || 'Asia/Almaty',
        ...(includeDate
            ? { day: '2-digit' as const, month: '2-digit' as const }
            : {}),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(value);

const buildRoomStatusLabel = (room: RoomWithLatestStay, timezone?: string) => {
    const latestStay = room.stays.find((stay) => stay.status === StayStatus.CHECKED_IN) ?? room.stays[0];

    if (latestStay?.status === StayStatus.CHECKED_IN) {
        const now = new Date();
        const includeDate = !sameDayInTimezone(now, latestStay.scheduledCheckOut, timezone);
        return `занят(а) до ${formatDateTime(latestStay.scheduledCheckOut, timezone, includeDate)}`;
    }

    if (latestStay?.status === StayStatus.SCHEDULED) {
        const now = new Date();
        const includeDate = !sameDayInTimezone(now, latestStay.scheduledCheckIn, timezone);
        return `заезд ${formatDateTime(latestStay.scheduledCheckIn, timezone, includeDate)}`;
    }

    switch (room.status) {
        case RoomStatus.AVAILABLE:
            return 'свободно';
        case RoomStatus.DIRTY:
            return 'нужна уборка';
        case RoomStatus.HOLD:
            return 'бронь';
        case RoomStatus.OCCUPIED:
            return 'занят(а)';
        default:
            return 'статус уточняется';
    }
};

export const buildCleaningRoomSnapshotLines = async (hotelId: string, timezone?: string) => {
    const rooms = await prisma.room.findMany({
        where: { hotelId, isActive: true },
        select: {
            label: true,
            floor: true,
            status: true,
            stays: {
                where: { status: { in: [StayStatus.CHECKED_IN, StayStatus.SCHEDULED] } },
                orderBy: { scheduledCheckIn: 'asc' },
                select: {
                    status: true,
                    scheduledCheckIn: true,
                    scheduledCheckOut: true,
                },
            },
        },
        orderBy: { label: 'asc' },
    });

    const sorted = [...rooms].sort((first, second) =>
        first.label.localeCompare(second.label, 'ru', { numeric: true, sensitivity: 'base' })
    );

    const grouped = new Map<string, typeof sorted>();
    for (const room of sorted) {
        const floor = room.floor?.trim() || 'Общий список';
        const current = grouped.get(floor) ?? [];
        current.push(room);
        grouped.set(floor, current);
    }

    const occupiedRooms = sorted
        .map((room) => ({
            room,
            stay: room.stays.find((stay) => stay.status === StayStatus.CHECKED_IN),
        }))
        .filter((entry): entry is typeof entry & { stay: NonNullable<typeof entry.stay> } => Boolean(entry.stay))
        .sort((first, second) => first.stay.scheduledCheckOut.getTime() - second.stay.scheduledCheckOut.getTime());

    const lines: string[] = ['🕐 Плановые выезды по порядку'];

    if (occupiedRooms.length) {
        const now = new Date();
        for (const { room, stay } of occupiedRooms) {
            const overdue = stay.scheduledCheckOut.getTime() < now.getTime() ? ' · просрочен' : '';
            lines.push(`№${room.label} — ${formatDateTime(stay.scheduledCheckOut, timezone, true)}${overdue}`);
        }
    } else {
        lines.push('Сейчас заселённых номеров нет.');
    }

    lines.push('', '📋 Общий список комнат');

    for (const [floor, floorRooms] of grouped) {
        lines.push(`${floor}:`);
        for (const room of floorRooms) {
            lines.push(`${room.label} — ${buildRoomStatusLabel(room, timezone)}`);
        }
    }

    return lines;
};
