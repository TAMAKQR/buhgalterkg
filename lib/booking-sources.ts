export type KnownBookingSourceKey =
    | 'booking'
    | 'agoda'
    | 'ostrovok'
    | 'trip'
    | 'expedia'
    | 'airbnb'
    | 'exely'
    | 'yandex'
    | 'sutochno';

const bookingSourceAliases: Record<string, KnownBookingSourceKey> = {
    booking: 'booking',
    'booking.com': 'booking',
    bgc: 'booking',
    'букинг': 'booking',
    agoda: 'agoda',
    'agoda.com': 'agoda',
    ostrovok: 'ostrovok',
    'ostrovok.ru': 'ostrovok',
    'островок': 'ostrovok',
    otk: 'ostrovok',
    trip: 'trip',
    'trip.com': 'trip',
    ctrip: 'trip',
    ctp: 'trip',
    expedia: 'expedia',
    'expedia.com': 'expedia',
    airbnb: 'airbnb',
    'airbnb.com': 'airbnb',
    exely: 'exely',
    yandex: 'yandex',
    'yandex travel': 'yandex',
    'яндекс': 'yandex',
    'яндекс путешествия': 'yandex',
    sutochno: 'sutochno',
    'sutochno.ru': 'sutochno',
    'суточно': 'sutochno',
    'суточно.ру': 'sutochno',
};

export const normalizeBookingSourceKey = (value: string) => {
    const normalized = value.trim().toLocaleLowerCase('ru-RU');
    return bookingSourceAliases[normalized] ?? normalized;
};

export const getKnownBookingSourceKey = (value?: string | null): KnownBookingSourceKey | null => {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }

    return bookingSourceAliases[normalized.toLocaleLowerCase('ru-RU')] ?? null;
};
