'use client';

import { useCallback } from 'react';

import { useCountryContext } from '@/hooks/useCountryContext';

type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

export class ApiRequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = status;
    }
}

const readErrorMessage = async (response: Response) => {
    const body = await response.text();
    if (!body) return `API request failed (${response.status})`;

    try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === 'object') {
            const message = 'error' in parsed
                ? (parsed as { error?: unknown }).error
                : 'message' in parsed
                    ? (parsed as { message?: unknown }).message
                    : null;
            if (typeof message === 'string' && message.trim()) {
                return message;
            }
        }
    } catch {
        // Plain-text API errors are valid and should be shown as-is.
    }

    return body;
};

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
                throw new ApiRequestError(response.status, await readErrorMessage(response));
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
                throw new ApiRequestError(response.status, await readErrorMessage(response));
            }
            return (await response.json()) as T;
        },
        [withCountry]
    );

    return { request, get };
}
