import { PaymentMethod } from '@prisma/client';

const normalizeComparable = (value: string) => {
    const normalized = value.trim().toLocaleLowerCase('ru-RU');
    if (['booking', 'booking.com', 'bgc'].includes(normalized)) return 'booking';
    if (['ostrovok', 'островок', 'otk'].includes(normalized)) return 'ostrovok';
    if (['trip.com', 'trip', 'ctp'].includes(normalized)) return 'trip.com';
    return normalized;
};

export const sanitizeExtranetNames = (values: Array<string | null | undefined>) => {
    const unique = new Set<string>();
    const sanitized: string[] = [];

    for (const value of values) {
        const trimmed = value?.trim();
        if (!trimmed) {
            continue;
        }

        const comparable = normalizeComparable(trimmed);
        if (unique.has(comparable)) {
            continue;
        }

        unique.add(comparable);
        sanitized.push(trimmed.slice(0, 60));
    }

    return sanitized.slice(0, 30);
};

export const normalizeBookingSource = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed?.toLocaleLowerCase('ru-RU') === 'exely pms') {
        return null;
    }
    return trimmed ? trimmed.slice(0, 80) : null;
};

export const resolveBookingSource = (value: string | null, extranetNames: string[]) => {
    if (!value) {
        return null;
    }

    const comparable = normalizeComparable(value);
    return extranetNames.find((name) => normalizeComparable(name) === comparable) ?? null;
};

export const detectStayPaymentMethod = ({
    cashPaid,
    cardPaid,
    onlinePaid,
}: {
    cashPaid: number;
    cardPaid: number;
    onlinePaid: number;
}) => {
    if (onlinePaid > 0) {
        return null;
    }

    if (cashPaid > 0 && cardPaid > 0) {
        return null;
    }

    if (cashPaid > 0) {
        return PaymentMethod.CASH;
    }

    if (cardPaid > 0) {
        return PaymentMethod.CARD;
    }

    return null;
};

export const sumStayPayments = ({
    cashPaid,
    cardPaid,
    onlinePaid,
}: {
    cashPaid: number;
    cardPaid: number;
    onlinePaid: number;
}) => cashPaid + cardPaid + onlinePaid;
