import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const host = request.headers.get('host') || '';
    const subdomain = host.split('.')[0];

    // Определяем страну по поддомену
    let country = 'KG';
    if (subdomain === 'kz') {
        country = 'KZ';
    }

    // Добавляем заголовок с кодом страны для использования в API
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-country-code', country);

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
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
