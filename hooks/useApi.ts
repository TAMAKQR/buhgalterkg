'use client';

import { useCallback } from 'react';

import { useCountryContext } from '@/hooks/useCountryContext';

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

export function useApi() {
    const { withCountry } = useCountryContext();

    const request = useCallback(
        async <T,>(path: string, options?: ApiRequestOptions) => {
            const { body, headers, ...rest } = options ?? {};
            const jsonBody = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
            const requestPath = withCountry(path);

            const response = await fetch(requestPath, {
                method: rest.method ?? 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...normalizeHeaders(headers)
                },
                credentials: 'include', // Include cookies
                cache: 'no-store',
                ...rest,
                body: JSON.stringify(jsonBody)
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'API request failed');
            }

            return (await response.json()) as T;
        },
        [withCountry]
    );

    const get = useCallback(
        async <T,>(path: string) => {
            const response = await fetch(withCountry(path), {
                credentials: 'include', // Include cookies
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            return (await response.json()) as T;
        },
        [withCountry]
    );

    return { request, get };
}
