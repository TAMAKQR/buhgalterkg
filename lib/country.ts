import { headers } from 'next/headers';

export type CountryCode = 'KG' | 'KZ';

export const COUNTRY_CONFIG: Record<CountryCode, {
    name: string;
    subdomain: string;
    timezone: string;
    currency: string;
}> = {
    KG: {
        name: 'Кыргызстан',
        subdomain: 'kg',
        timezone: 'Asia/Bishkek',
        currency: 'KGS'
    },
    KZ: {
        name: 'Казахстан',
        subdomain: 'kz',
        timezone: 'Asia/Almaty',
        currency: 'KZT'
    }
};

/**
 * Определяет страну по поддомену из заголовка Host
 */
export function getCountryFromSubdomain(host?: string): CountryCode {
    if (!host) {
        const headersList = headers();
        host = headersList.get('host') || '';
    }

    // Извлекаем поддомен (например, kz из kz.buhgalterkg.com)
    const subdomain = host.split('.')[0];

    // Ищем страну по поддомену
    for (const [code, config] of Object.entries(COUNTRY_CONFIG)) {
        if (config.subdomain === subdomain) {
            return code as CountryCode;
        }
    }

    // По умолчанию - Кыргызстан
    return 'KG';
}

/**
 * Получает конфигурацию страны по коду
 */
export function getCountryConfig(country: CountryCode) {
    return COUNTRY_CONFIG[country];
}

/**
 * Формирует URL с нужным поддоменом для страны
 */
export function getCountryUrl(country: CountryCode, path: string = '/'): string {
    const config = COUNTRY_CONFIG[country];
    const baseUrl = process.env.TELEGRAM_WEBAPP_URL || 'http://localhost:3000';

    // Если это продакшн, добавляем поддомен
    if (baseUrl.includes('buhgalterkg.com')) {
        return `https://${config.subdomain}.buhgalterkg.com${path}`;
    }

    // Для локальной разработки используем query param
    return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}country=${country}`;
}
