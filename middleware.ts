import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const isApiPath = pathname.startsWith('/api');
    const pathMatch = pathname.match(/^\/(kg|kz)(?=\/|$)/i);
    const pathCountry = pathMatch?.[1]?.toUpperCase();
    const queryCountry = request.nextUrl.searchParams.get('country')?.toUpperCase();
    const cookieCountry = request.cookies.get('country')?.value?.toUpperCase();

    // Определяем страну:
    // путь/query имеют приоритет всегда,
    // cookie применяем только для API, чтобы на обычном "/" не залипала чужая страна.
    let country = 'KG';
    if (pathCountry === 'KZ' || pathCountry === 'KG') {
        country = pathCountry;
    } else if (queryCountry === 'KZ' || queryCountry === 'KG') {
        country = queryCountry;
    } else if (isApiPath && (cookieCountry === 'KZ' || cookieCountry === 'KG')) {
        country = cookieCountry;
    }

    // Добавляем заголовок с кодом страны для использования в API
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-country-code', country);

    let response: NextResponse;

    if (pathMatch) {
        const rewrittenUrl = request.nextUrl.clone();
        rewrittenUrl.pathname = pathname.replace(/^\/(kg|kz)(?=\/|$)/i, '') || '/';

        response = NextResponse.rewrite(rewrittenUrl, {
            request: {
                headers: requestHeaders,
            },
        });
    } else {
        response = NextResponse.next({
            request: {
                headers: requestHeaders,
            },
        });
    }

    response.cookies.set('country', country, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
    });

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico|sw.js|workbox-).*)',
    ],
};
