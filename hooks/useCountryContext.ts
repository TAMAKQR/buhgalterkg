'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import type { CountryCode } from '@/lib/country';

const parseCountry = (value?: string | null): CountryCode | null => {
    const normalized = value?.toUpperCase();
    return normalized === 'KZ' || normalized === 'KG' ? normalized : null;
};

const getCountryFromCookie = (): CountryCode | null => {
    if (typeof document === 'undefined') {
        return null;
    }

    const cookieMatch = document.cookie.match(/(?:^|; )country=([^;]+)/);
    return parseCountry(cookieMatch?.[1]);
};

const getCountryFromBrowserUrl = (): CountryCode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const queryCountry = parseCountry(new URLSearchParams(window.location.search).get('country'));
    if (queryCountry) {
        return queryCountry;
    }

    const pathCountry = parseCountry(window.location.pathname.match(/^\/(kg|kz)(?=\/|$)/i)?.[1]);
    return pathCountry;
};

export function useCountryContext() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const country = useMemo<CountryCode>(() => {
        const queryCountry = parseCountry(searchParams.get('country'));
        if (queryCountry) {
            return queryCountry;
        }

        const pathCountry = parseCountry(pathname.match(/^\/(kg|kz)(?=\/|$)/i)?.[1]);
        if (pathCountry) {
            return pathCountry;
        }

        const browserCountry = getCountryFromBrowserUrl();
        if (browserCountry) {
            return browserCountry;
        }

        const cookieCountry = getCountryFromCookie();
        if (cookieCountry) {
            return cookieCountry;
        }

        return 'KG';
    }, [pathname, searchParams]);

    const withCountry = useCallback((path: string) => {
        const [beforeHash, hash = ''] = path.split('#');
        const [basePath, rawQuery = ''] = beforeHash.split('?');
        const params = new URLSearchParams(rawQuery);
        params.set('country', country);
        const query = params.toString();
        return `${basePath}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
    }, [country]);

    return { country, withCountry };
}