import type { NextRequest } from 'next/server';

import { CountryCode, getCountryFromSubdomain } from '@/lib/country';

const isCountryCode = (value: string | null | undefined): value is CountryCode =>
    value === 'KG' || value === 'KZ';

export const getCountryFromRequest = (request: NextRequest): CountryCode => {
    const headerCountry = request.headers.get('x-country-code')?.toUpperCase();
    if (isCountryCode(headerCountry)) {
        return headerCountry;
    }

    const host = request.headers.get('host') || '';
    return getCountryFromSubdomain(host);
};
