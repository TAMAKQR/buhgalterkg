import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MAX_API_MUTATION_BYTES = 2 * 1024 * 1024;

export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const isApiPath = pathname.startsWith('/api');
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

    if (isApiPath && isMutation) {
        const contentLength = request.headers.get('content-length');
        if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_API_MUTATION_BYTES) {
            return new NextResponse('Request body is too large', { status: 413 });
        }

        const fetchSite = request.headers.get('sec-fetch-site');
        if (fetchSite === 'cross-site') {
            return new NextResponse('Cross-site request blocked', { status: 403 });
        }

        const origin = request.headers.get('origin');
        if (origin) {
            try {
                const originUrl = new URL(origin);
                const requestHost = request.headers.get('x-forwarded-host')
                    ?? request.headers.get('host')
                    ?? request.nextUrl.host;
                const requestProtocol = request.headers.get('x-forwarded-proto')
                    ?? request.nextUrl.protocol.replace(':', '');
                if (originUrl.host !== requestHost || originUrl.protocol !== `${requestProtocol}:`) {
                    return new NextResponse('Request origin is not allowed', { status: 403 });
                }
            } catch {
                return new NextResponse('Invalid request origin', { status: 403 });
            }
        }
    }

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

    const hasExplicitCountry = pathCountry === 'KZ' || pathCountry === 'KG' || queryCountry === 'KZ' || queryCountry === 'KG';
    const shouldPersistCountry = cookieCountry !== country && (hasExplicitCountry || !isApiPath);

    if (shouldPersistCountry) {
        response.cookies.set('country', country, {
            path: '/',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 365,
        });
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico|sw.js|workbox-).*)',
    ],
};
