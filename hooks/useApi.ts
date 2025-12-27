'use client';

import { useCallback } from 'react';
import { useTelegramContext } from '@/components/providers/telegram-provider';

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
    const { authPayload } = useTelegramContext();

    const request = useCallback(
        async <T,>(path: string, options?: ApiRequestOptions) => {
            if (!authPayload) {
                throw new Error('Auth payload missing. Make sure Telegram has initialised.');
            }

            const { body, headers, ...rest } = options ?? {};
            const jsonBody = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

            const response = await fetch(path, {
                method: rest.method ?? 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...normalizeHeaders(headers)
                },
                ...rest,
                body: JSON.stringify({ ...authPayload, ...jsonBody })
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'API request failed');
            }

            return (await response.json()) as T;
        },
        [authPayload]
    );

    const get = useCallback(
        async <T,>(path: string) => {
            if (!authPayload) throw new Error('Auth payload missing.');
            const response = await fetch(path, {
                headers: {
                    'x-telegram-auth-payload': JSON.stringify(authPayload)
                }
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            return (await response.json()) as T;
        },
        [authPayload]
    );

    return { request, get };
}
