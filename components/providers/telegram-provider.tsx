'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import useSWR from 'swr';
import type { SessionUser } from '@/lib/types';

const fetchSession = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/telegram/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error('Не удалось получить сессию Telegram');
    }

    return (await response.json()) as SessionUser;
};

interface TelegramContextValue {
    initData?: string;
    authPayload?: Record<string, unknown>;
    user?: SessionUser;
    loading: boolean;
    error?: string;
    refresh: () => void;
    manualMode: boolean;
    manualLogin: (token: string, session?: SessionUser) => void;
    logout: () => void;
}

const TelegramContext = createContext<TelegramContextValue | undefined>(undefined);

export function TelegramProvider({ children }: { children: ReactNode }) {
    const [initData, setInitData] = useState<string>();
    const [devOverride, setDevOverride] = useState<{ telegramId: string; role?: string }>();
    const [manualSession, setManualSession] = useState<{ token: string; user?: SessionUser }>();

    useEffect(() => {
        if (typeof window === 'undefined') return;

        let isMounted = true;

        const bootstrap = async () => {
            try {
                const { default: TelegramWebApp } = await import('@twa-dev/sdk');
                if (!isMounted) return;

                const tg = TelegramWebApp;
                if (tg?.initData) {
                    setInitData(tg.initData);
                    tg.ready?.();
                    tg.expand?.();
                    return;
                }
            } catch (sdkError) {
                console.warn('Не удалось инициализировать Telegram SDK', sdkError);
            }

            if (!isMounted) return;

            const devTelegramId = process.env.NEXT_PUBLIC_DEV_TELEGRAM_ID;
            if (devTelegramId) {
                setDevOverride({ telegramId: devTelegramId, role: process.env.NEXT_PUBLIC_DEV_ROLE });
            }
        };

        bootstrap();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const storedToken = window.sessionStorage.getItem('manualAdminToken');
        if (storedToken) {
            setManualSession((prev) => (prev?.token === storedToken ? prev : { token: storedToken }));
        }
    }, []);

    const requestBody = useMemo(() => {
        if (manualSession?.token) {
            return { manualToken: manualSession.token };
        }
        if (initData) {
            return { initData };
        }
        if (devOverride) {
            return { devOverride };
        }
        return undefined;
    }, [manualSession, initData, devOverride]);

    const { data, error, isLoading, mutate } = useSWR(() => requestBody && ['telegram-session', requestBody], ([, body]) => fetchSession(body));

    useEffect(() => {
        if (!manualSession?.token || !data) {
            return;
        }
        if (manualSession.user && manualSession.user.id === data.id) {
            return;
        }
        setManualSession((prev) => (prev && prev.token === manualSession.token ? { ...prev, user: data } : prev));
    }, [data, manualSession]);

    const manualLogin = useCallback(
        (token: string, session?: SessionUser) => {
            setInitData(undefined);
            setManualSession({ token, user: session });
            if (typeof window !== 'undefined') {
                window.sessionStorage.setItem('manualAdminToken', token);
            }
            mutate();
        },
        [mutate]
    );

    const logout = useCallback(() => {
        setManualSession(undefined);
        if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem('manualAdminToken');
        }
        mutate(undefined, false);
    }, [mutate]);

    const resolvedUser = manualSession?.user ?? data;
    const manualMode = Boolean(manualSession?.token);

    const value = useMemo<TelegramContextValue>(
        () => ({
            initData,
            authPayload: requestBody,
            user: resolvedUser,
            loading: isLoading && !resolvedUser,
            error: error?.message,
            refresh: () => mutate(),
            manualMode,
            manualLogin,
            logout,
        }),
        [initData, requestBody, resolvedUser, isLoading, error, mutate, manualMode, manualLogin, logout]
    );

    return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export const useTelegramContext = () => {
    const ctx = useContext(TelegramContext);
    if (!ctx) {
        throw new Error('useTelegramContext must be used inside TelegramProvider');
    }
    return ctx;
};
