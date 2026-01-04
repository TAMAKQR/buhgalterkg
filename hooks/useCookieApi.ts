'use client';

import { useCallback } from 'react';

type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
    if (!headers) return {};
    if (headers instanceof Headers) {
        return Object.fromEntries(headers.entries());
    }
    if (Array.isArray(headers)) {
        return Object.fromEntries(headers);
    }
    return headers as Record<string, string>;
};

/**
 * Cookie-based API hook for authenticated requests
 * Uses HTTP-only cookies for session management
 */
export function useCookieApi() {
    const request = useCallback(
        async <T,>(path: string, options?: ApiRequestOptions) => {
            const { body, headers, ...rest } = options ?? {};

            const response = await fetch(path, {
                method: rest.method ?? 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...normalizeHeaders(headers)
                },
                credentials: 'include', // Include cookies
                ...rest,
                body: body ? JSON.stringify(body) : undefined
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'API request failed');
            }

            return (await response.json()) as T;
        },
        []
    );

    const get = useCallback(
        async <T,>(path: string) => {
            const response = await fetch(path, {
                credentials: 'include' // Include cookies
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            return (await response.json()) as T;
        },
        []
    );

    return { request, get };
}
