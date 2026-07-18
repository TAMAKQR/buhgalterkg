export type DateKey = `${number}-${number}-${number}`;

export type DateLike = Date | string | number;

export interface WeightedAllocationInput {
    key: string;
    /** A non-negative safe integer. Durations in milliseconds are supported. */
    weight: number;
}

export interface StayTransferTiming {
    fromRoomId: string;
    toRoomId: string;
    createdAt: DateLike;
}

export interface StayRoomTiming {
    /** The room currently (or finally) attached to the stay. */
    roomId: string;
    scheduledCheckIn: DateLike;
    scheduledCheckOut: DateLike;
    actualCheckIn?: DateLike | null;
    actualCheckOut?: DateLike | null;
    transfers?: readonly StayTransferTiming[];
}

export interface StayRoomSegment {
    roomId: string;
    /** Inclusive segment boundary. */
    startAt: Date;
    /** Exclusive segment boundary. */
    endAt: Date;
}

export interface BuildStayRoomSegmentsOptions {
    /**
     * `effective` uses actual timestamps when present. `scheduled` is useful for
     * allocating a contractual tariff across every booked night.
     */
    bounds?: 'effective' | 'scheduled';
}

export interface StayPeriodAllocationInput extends StayRoomTiming {
    /** Full tariff for the stay in minor units. Null means that the tariff is unknown. */
    totalAmount?: number | null;
    timezone: string;
    /** Inclusive local date key. */
    fromKey: string;
    /** Inclusive local date key. */
    toKey: string;
}

export interface StayPeriodAllocation {
    /** Tariff minor units attributed to each room during the requested period. */
    roomAmounts: Record<string, number>;
    /** Fractional room-nights attributed by occupied duration; values sum to occupiedNights. */
    roomOccupiedNights: Record<string, number>;
    /** Occupied fraction per local night, used to union overlapping legacy stays safely. */
    roomNightOccupancy: Record<string, Record<string, number>>;
    /** Number of local calendar nights from this stay that fall in the period. */
    occupiedNights: number;
    /** Total tariff minor units represented by roomAmounts. */
    periodAmount: number;
    /** Total local calendar nights across the whole stay. */
    totalNightCount: number;
    /** True when no usable tariff was supplied. Occupancy is still returned. */
    incomplete: boolean;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface DateKeyParts {
    year: number;
    month: number;
    day: number;
}

type LocalDateTimeParts = DateKeyParts & {
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const assertSafeInteger = (value: number, name: string) => {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError(`${name} must be a safe integer`);
    }
};

const assertNonEmptyKey = (value: string, name: string) => {
    if (!value) {
        throw new RangeError(`${name} must not be empty`);
    }
};

const toValidDate = (value: DateLike, name: string) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError(`${name} must be a valid date`);
    }
    return date;
};

const partsToUtcDate = ({ year, month, day }: DateKeyParts) => new Date(Date.UTC(year, month - 1, day));

const formatDateKeyParts = ({ year, month, day }: DateKeyParts): DateKey => (
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateKey
);

export const parseDateKey = (value: string): DateKeyParts => {
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) {
        throw new RangeError(`Invalid date key: ${value}`);
    }

    const parts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
    };
    const date = partsToUtcDate(parts);

    if (
        date.getUTCFullYear() !== parts.year ||
        date.getUTCMonth() + 1 !== parts.month ||
        date.getUTCDate() !== parts.day
    ) {
        throw new RangeError(`Invalid date key: ${value}`);
    }

    return parts;
};

export const isDateKey = (value: string): value is DateKey => {
    try {
        parseDateKey(value);
        return true;
    } catch {
        return false;
    }
};

export const compareDateKeys = (left: string, right: string) => {
    parseDateKey(left);
    parseDateKey(right);
    return compareStrings(left, right);
};

export const addDaysToDateKey = (value: string, days: number): DateKey => {
    assertSafeInteger(days, 'days');
    const date = partsToUtcDate(parseDateKey(value));
    date.setUTCDate(date.getUTCDate() + days);
    return formatDateKeyParts({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    });
};

export const dateKeyDayDifference = (fromKey: string, toKey: string) => {
    const from = partsToUtcDate(parseDateKey(fromKey)).getTime();
    const to = partsToUtcDate(parseDateKey(toKey)).getTime();
    return Math.trunc((to - from) / DAY_MS);
};

/** Returns all local date keys in the closed interval [fromKey, toKey]. */
export const inclusiveDateKeys = (fromKey: string, toKey: string): DateKey[] => {
    const difference = dateKeyDayDifference(fromKey, toKey);
    if (difference < 0) {
        throw new RangeError('fromKey must not be after toKey');
    }
    return Array.from({ length: difference + 1 }, (_, index) => addDaysToDateKey(fromKey, index));
};

/** Number of local calendar days in the closed interval [fromKey, toKey]. */
export const periodDayCount = (fromKey: string, toKey: string) => {
    const difference = dateKeyDayDifference(fromKey, toKey);
    if (difference < 0) {
        throw new RangeError('fromKey must not be after toKey');
    }
    return difference + 1;
};

export const daysInDateKeyMonth = (value: string) => {
    const { year, month } = parseDateKey(value);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return a;
};

/** Rounds a rational number to the nearest integer, with halves away from zero. */
const roundRational = (numerator: bigint, denominator: bigint) => {
    if (denominator <= 0n) {
        throw new RangeError('denominator must be positive');
    }
    const sign = numerator < 0n ? -1n : 1n;
    const absolute = numerator < 0n ? -numerator : numerator;
    let quotient = absolute / denominator;
    const remainder = absolute % denominator;
    if (remainder * 2n >= denominator) {
        quotient += 1n;
    }
    return quotient * sign;
};

const bigintToSafeNumber = (value: bigint, name: string) => {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)) {
        throw new RangeError(`${name} exceeds the safe integer range`);
    }
    return numberValue;
};

/**
 * Prorates the same monthly amount over an inclusive local-date interval.
 * Each covered month contributes monthlyMinor * coveredDays / daysInMonth;
 * the combined rational result is rounded only once.
 * @deprecated For additive financial reports, sum `allocateMonthlyAmountByDay` instead.
 */
export const prorateMonthlyAmount = (monthlyMinor: number, fromKey: string, toKey: string) => {
    assertSafeInteger(monthlyMinor, 'monthlyMinor');
    const coveredByMonth = new Map<string, { coveredDays: number; daysInMonth: number }>();

    for (const dateKey of inclusiveDateKeys(fromKey, toKey)) {
        const monthKey = dateKey.slice(0, 7);
        const bucket = coveredByMonth.get(monthKey) ?? {
            coveredDays: 0,
            daysInMonth: daysInDateKeyMonth(dateKey),
        };
        bucket.coveredDays += 1;
        coveredByMonth.set(monthKey, bucket);
    }

    let numerator = 0n;
    let denominator = 1n;
    const monthlyAmount = BigInt(monthlyMinor);

    for (const { coveredDays, daysInMonth } of coveredByMonth.values()) {
        const nextDenominator = BigInt(daysInMonth);
        numerator = numerator * nextDenominator + monthlyAmount * BigInt(coveredDays) * denominator;
        denominator *= nextDenominator;

        const divisor = greatestCommonDivisor(numerator, denominator);
        if (divisor > 1n) {
            numerator /= divisor;
            denominator /= divisor;
        }
    }

    return bigintToSafeNumber(roundRational(numerator, denominator), 'prorated amount');
};

/**
 * Produces a stable integer amount for every requested calendar day. Each full
 * month is allocated independently, so a full month always adds up to exactly
 * `monthlyMinor` and adjacent report ranges remain additive.
 */
export const allocateMonthlyAmountByDay = (
    monthlyMinor: number,
    fromKey: string,
    toKey: string,
): Record<string, number> => {
    assertSafeInteger(monthlyMinor, 'monthlyMinor');
    const requestedKeys = inclusiveDateKeys(fromKey, toKey);
    const requestedSet = new Set(requestedKeys);
    const result: Record<string, number> = {};

    for (const monthKey of new Set(requestedKeys.map((dateKey) => dateKey.slice(0, 7)))) {
        const firstKey = `${monthKey}-01` as DateKey;
        const lastKey = `${monthKey}-${String(daysInDateKeyMonth(firstKey)).padStart(2, '0')}` as DateKey;
        const monthKeys = inclusiveDateKeys(firstKey, lastKey);
        const monthAllocation = allocateMinorByWeights(
            monthlyMinor,
            monthKeys.map((key) => ({ key, weight: 1 })),
        );

        for (const key of monthKeys) {
            if (requestedSet.has(key)) result[key] = monthAllocation[key] ?? 0;
        }
    }

    return result;
};

/**
 * Allocates integer minor units with the largest-remainder method.
 * Duplicate keys are combined before allocation. Ties are resolved by key,
 * making the result independent of input ordering.
 */
export const allocateMinorByWeights = (
    amount: number,
    inputs: readonly WeightedAllocationInput[],
): Record<string, number> => {
    assertSafeInteger(amount, 'amount');
    const weights = new Map<string, bigint>();

    for (const input of inputs) {
        assertNonEmptyKey(input.key, 'allocation key');
        assertSafeInteger(input.weight, `weight for ${input.key}`);
        if (input.weight < 0) {
            throw new RangeError(`weight for ${input.key} must not be negative`);
        }
        weights.set(input.key, (weights.get(input.key) ?? 0n) + BigInt(input.weight));
    }

    const sortedKeys = Array.from(weights.keys()).sort(compareStrings);
    const result: Record<string, number> = {};
    for (const key of sortedKeys) {
        result[key] = 0;
    }

    if (amount === 0) {
        return result;
    }
    if (sortedKeys.length === 0) {
        throw new RangeError('Cannot allocate a non-zero amount without weights');
    }

    const totalWeight = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0n);
    if (totalWeight === 0n) {
        throw new RangeError('Cannot allocate a non-zero amount without a positive weight');
    }

    const sign = amount < 0 ? -1 : 1;
    const absoluteAmount = BigInt(Math.abs(amount));
    const shares = sortedKeys.map((key) => {
        const weightedAmount = absoluteAmount * (weights.get(key) ?? 0n);
        return {
            key,
            units: weightedAmount / totalWeight,
            remainder: weightedAmount % totalWeight,
        };
    });
    const allocated = shares.reduce((sum, share) => sum + share.units, 0n);
    const unitsLeft = bigintToSafeNumber(absoluteAmount - allocated, 'allocation remainder');

    shares.sort((left, right) => {
        if (left.remainder === right.remainder) {
            return compareStrings(left.key, right.key);
        }
        return left.remainder > right.remainder ? -1 : 1;
    });

    for (let index = 0; index < unitsLeft; index += 1) {
        shares[index].units += 1n;
    }

    for (const share of shares) {
        result[share.key] = bigintToSafeNumber(share.units, `allocation for ${share.key}`) * sign;
    }

    return result;
};

/** Even allocation with a deterministic rotating recipient for remainder units. */
export const allocateMinorEvenly = (
    amount: number,
    keys: readonly string[],
    rotation = 0,
): Record<string, number> => {
    assertSafeInteger(amount, 'amount');
    assertSafeInteger(rotation, 'rotation');
    const uniqueKeys = Array.from(new Set(keys)).sort(compareStrings);
    if (!uniqueKeys.length) return {};

    const base = Math.trunc(amount / uniqueKeys.length);
    const result = Object.fromEntries(uniqueKeys.map((key) => [key, base])) as Record<string, number>;
    const remainder = amount - base * uniqueKeys.length;
    const direction = remainder < 0 ? -1 : 1;
    const start = ((rotation % uniqueKeys.length) + uniqueKeys.length) % uniqueKeys.length;

    for (let offset = 0; offset < Math.abs(remainder); offset += 1) {
        const key = uniqueKeys[(start + offset) % uniqueKeys.length];
        result[key] += direction;
    }

    return result;
};

/** Profit as a percentage of revenue, rounded to one decimal place. */
export const percentMargin = (profit: number, revenue: number) => {
    assertSafeInteger(profit, 'profit');
    assertSafeInteger(revenue, 'revenue');
    if (revenue === 0) {
        return 0;
    }

    const denominator = BigInt(revenue);
    const normalizedDenominator = denominator < 0n ? -denominator : denominator;
    const normalizedNumerator = denominator < 0n ? -BigInt(profit) * 1000n : BigInt(profit) * 1000n;
    return Number(roundRational(normalizedNumerator, normalizedDenominator)) / 10;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateTimeFormatter = (timezone: string) => {
    const existing = dateTimeFormatterCache.get(timezone);
    if (existing) {
        return existing;
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    dateTimeFormatterCache.set(timezone, formatter);
    return formatter;
};

const localDateTimeParts = (value: DateLike, timezone: string): LocalDateTimeParts => {
    const date = toValidDate(value, 'date');
    const parts = getDateTimeFormatter(timezone).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
    return {
        year: pick('year'),
        month: pick('month'),
        day: pick('day'),
        hour: pick('hour'),
        minute: pick('minute'),
        second: pick('second'),
        millisecond: date.getUTCMilliseconds(),
    };
};

export const dateKeyInTimeZone = (value: DateLike, timezone: string): DateKey => {
    const { year, month, day } = localDateTimeParts(value, timezone);
    return formatDateKeyParts({ year, month, day });
};

const localPartsAsUtcMilliseconds = (parts: LocalDateTimeParts) => Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
);

/** Resolves a valid local wall-clock time to an instant without a fixed UTC offset. */
const localDateTimeToInstant = (parts: LocalDateTimeParts, timezone: string) => {
    const desired = localPartsAsUtcMilliseconds(parts);
    let candidate = desired;

    // Offset iteration handles the fixed-offset zones used by the application and
    // ordinary DST transitions without baking an offset table into this module.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const observed = localDateTimeParts(new Date(candidate), timezone);
        const difference = desired - localPartsAsUtcMilliseconds(observed);
        if (difference === 0) {
            break;
        }
        candidate += difference;
    }

    return new Date(candidate);
};

const mergeAdjacentSegments = (segments: StayRoomSegment[]) => {
    const merged: StayRoomSegment[] = [];
    for (const segment of segments) {
        const previous = merged[merged.length - 1];
        if (previous && previous.roomId === segment.roomId && previous.endAt.getTime() === segment.startAt.getTime()) {
            previous.endAt = new Date(segment.endAt.getTime());
        } else {
            merged.push({
                roomId: segment.roomId,
                startAt: new Date(segment.startAt.getTime()),
                endAt: new Date(segment.endAt.getTime()),
            });
        }
    }
    return merged;
};

/** Builds contiguous half-open room segments [startAt, endAt) for a stay. */
export const buildStayRoomSegments = (
    stay: StayRoomTiming,
    options: BuildStayRoomSegmentsOptions = {},
): StayRoomSegment[] => {
    assertNonEmptyKey(stay.roomId, 'stay roomId');
    const scheduledStart = toValidDate(stay.scheduledCheckIn, 'scheduledCheckIn');
    const scheduledEnd = toValidDate(stay.scheduledCheckOut, 'scheduledCheckOut');
    const useScheduled = options.bounds === 'scheduled';
    const start = useScheduled || stay.actualCheckIn == null
        ? scheduledStart
        : toValidDate(stay.actualCheckIn, 'actualCheckIn');
    const end = useScheduled || stay.actualCheckOut == null
        ? scheduledEnd
        : toValidDate(stay.actualCheckOut, 'actualCheckOut');

    if (end.getTime() <= start.getTime()) {
        throw new RangeError('Stay end must be after stay start');
    }

    const transfers = (stay.transfers ?? [])
        .map((transfer, index) => ({
            ...transfer,
            index,
            at: toValidDate(transfer.createdAt, `transfer[${index}].createdAt`),
        }))
        .sort((left, right) => left.at.getTime() - right.at.getTime() || left.index - right.index);

    for (const transfer of transfers) {
        assertNonEmptyKey(transfer.fromRoomId, `transfer[${transfer.index}].fromRoomId`);
        assertNonEmptyKey(transfer.toRoomId, `transfer[${transfer.index}].toRoomId`);
    }

    let currentRoomId = transfers[0]?.fromRoomId ?? stay.roomId;
    let cursor = start.getTime();
    const endTime = end.getTime();
    const segments: StayRoomSegment[] = [];

    for (const transfer of transfers) {
        const transferTime = transfer.at.getTime();
        if (transferTime <= cursor) {
            currentRoomId = transfer.toRoomId;
            continue;
        }
        if (transferTime >= endTime) {
            break;
        }

        segments.push({
            roomId: currentRoomId,
            startAt: new Date(cursor),
            endAt: new Date(transferTime),
        });
        currentRoomId = transfer.toRoomId;
        cursor = transferTime;
    }

    if (cursor < endTime) {
        segments.push({
            roomId: currentRoomId,
            startAt: new Date(cursor),
            endAt: new Date(endTime),
        });
    }

    return mergeAdjacentSegments(segments);
};

/** Returns the room occupying an instant using half-open segment boundaries. */
export const roomAtInstant = (segments: readonly StayRoomSegment[], value: DateLike) => {
    const instant = toValidDate(value, 'instant').getTime();
    return segments.find((segment) => (
        segment.startAt.getTime() <= instant && instant < segment.endAt.getTime()
    ))?.roomId ?? null;
};

type StayNightInterval = {
    key: DateKey;
    startAt: Date;
    endAt: Date;
};

const buildStayNightIntervals = (
    scheduledCheckIn: Date,
    scheduledCheckOut: Date,
    timezone: string,
): StayNightInterval[] => {
    if (scheduledCheckOut.getTime() <= scheduledCheckIn.getTime()) {
        throw new RangeError('scheduledCheckOut must be after scheduledCheckIn');
    }

    const startParts = localDateTimeParts(scheduledCheckIn, timezone);
    const startKey = formatDateKeyParts(startParts);
    const endKey = dateKeyInTimeZone(scheduledCheckOut, timezone);
    const calendarDifference = dateKeyDayDifference(startKey, endKey);
    const nightCount = Math.max(1, calendarDifference);
    const nightKeys = Array.from({ length: nightCount }, (_, index) => addDaysToDateKey(startKey, index));
    const boundaries: Date[] = [new Date(scheduledCheckIn.getTime())];

    for (let index = 1; index < nightCount; index += 1) {
        const keyParts = parseDateKey(nightKeys[index]);
        const boundary = localDateTimeToInstant({
            ...keyParts,
            hour: startParts.hour,
            minute: startParts.minute,
            second: startParts.second,
            millisecond: startParts.millisecond,
        }, timezone);
        if (boundary.getTime() <= boundaries[index - 1].getTime() || boundary.getTime() >= scheduledCheckOut.getTime()) {
            throw new RangeError('Could not build increasing local calendar-night boundaries');
        }
        boundaries.push(boundary);
    }
    boundaries.push(new Date(scheduledCheckOut.getTime()));

    return nightKeys.map((key, index) => ({
        key,
        startAt: boundaries[index],
        endAt: boundaries[index + 1],
    }));
};

const segmentOverlapWeights = (segments: readonly StayRoomSegment[], startAt: Date, endAt: Date) => {
    const start = startAt.getTime();
    const end = endAt.getTime();
    const weights = new Map<string, number>();

    for (const segment of segments) {
        const overlapStart = Math.max(start, segment.startAt.getTime());
        const overlapEnd = Math.min(end, segment.endAt.getTime());
        if (overlapEnd <= overlapStart) {
            continue;
        }
        weights.set(segment.roomId, (weights.get(segment.roomId) ?? 0) + overlapEnd - overlapStart);
    }

    return weights;
};

const addRecordAmount = (record: Record<string, number>, key: string, amount: number) => {
    record[key] = (record[key] ?? 0) + amount;
};

/**
 * Allocates a stay tariff across all contractual local calendar nights, then
 * returns only the nights in the inclusive report period. A transferred night
 * is split between rooms by the duration spent in each room.
 */
export const calculateStayPeriodAllocation = (
    input: StayPeriodAllocationInput,
): StayPeriodAllocation => {
    if (compareDateKeys(input.fromKey, input.toKey) > 0) {
        throw new RangeError('fromKey must not be after toKey');
    }

    const scheduledCheckIn = toValidDate(input.scheduledCheckIn, 'scheduledCheckIn');
    const scheduledCheckOut = toValidDate(input.scheduledCheckOut, 'scheduledCheckOut');
    const nightIntervals = buildStayNightIntervals(scheduledCheckIn, scheduledCheckOut, input.timezone);
    const selectedNights = nightIntervals.filter((night) => (
        compareStrings(night.key, input.fromKey) >= 0 && compareStrings(night.key, input.toKey) <= 0
    ));
    const timeline = buildStayRoomSegments(input, { bounds: 'scheduled' });
    const incomplete = input.totalAmount == null || input.totalAmount <= 0;

    if (input.totalAmount != null) {
        assertSafeInteger(input.totalAmount, 'totalAmount');
        if (input.totalAmount < 0) {
            throw new RangeError('totalAmount must not be negative');
        }
    }

    const fullNightAmounts = incomplete
        ? {}
        : allocateMinorByWeights(
            input.totalAmount as number,
            nightIntervals.map((night) => ({ key: night.key, weight: 1 })),
        );
    const roomAmounts: Record<string, number> = {};
    const roomOccupiedNights: Record<string, number> = {};
    const roomNightOccupancy: Record<string, Record<string, number>> = {};

    for (const night of selectedNights) {
        const overlapWeights = segmentOverlapWeights(timeline, night.startAt, night.endAt);
        const totalOverlap = Array.from(overlapWeights.values()).reduce((sum, weight) => sum + weight, 0);
        if (totalOverlap <= 0) {
            continue;
        }

        for (const [roomId, weight] of overlapWeights) {
            const occupiedFraction = weight / totalOverlap;
            addRecordAmount(roomOccupiedNights, roomId, occupiedFraction);
            roomNightOccupancy[roomId] ??= {};
            roomNightOccupancy[roomId][night.key] = occupiedFraction;
            if (!(roomId in roomAmounts)) {
                roomAmounts[roomId] = 0;
            }
        }

        if (!incomplete) {
            const allocations = allocateMinorByWeights(
                fullNightAmounts[night.key] ?? 0,
                Array.from(overlapWeights, ([key, weight]) => ({ key, weight })),
            );
            for (const [roomId, amount] of Object.entries(allocations)) {
                addRecordAmount(roomAmounts, roomId, amount);
            }
        }
    }

    const periodAmount = Object.values(roomAmounts).reduce((sum, amount) => sum + amount, 0);

    return {
        roomAmounts,
        roomOccupiedNights,
        roomNightOccupancy,
        occupiedNights: selectedNights.length,
        periodAmount,
        totalNightCount: nightIntervals.length,
        incomplete,
    };
};
