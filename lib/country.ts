export type CountryCode = 'KG' | 'KZ';

export const COUNTRY_CONFIG: Record<CountryCode, {
    name: string;
    timezone: string;
    currency: string;
}> = {
    KG: {
        name: 'Кыргызстан',
        timezone: 'Asia/Bishkek',
        currency: 'KGS'
    },
    KZ: {
        name: 'Казахстан',
        timezone: 'Asia/Almaty',
        currency: 'KZT'
    }
};

/**
 * Получает конфигурацию страны по коду
 */
export function getCountryConfig(country: CountryCode) {
    return COUNTRY_CONFIG[country];
}

/**
 * Формирует URL с нужным параметром страны
 */
export function getCountryUrl(country: CountryCode, path: string = '/'): string {
    const baseUrl = process.env.TELEGRAM_WEBAPP_URL || 'http://localhost:3000';

    return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}country=${country}`;
}
