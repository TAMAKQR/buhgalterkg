'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import type { CountryCode } from '@/lib/country';

export function useCountryContext() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const country = useMemo<CountryCode>(() => {
        const queryCountry = searchParams.get('country')?.toUpperCase();
        if (queryCountry === 'KZ' || queryCountry === 'KG') {
            return queryCountry;
        }

        const pathCountry = pathname.match(/^\/(kg|kz)(?=\/|$)/i)?.[1]?.toUpperCase();
        if (pathCountry === 'KZ' || pathCountry === 'KG') {
            return pathCountry;
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