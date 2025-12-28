import { NextRequest } from 'next/server';
import { resolveDevSession, resolveSessionFromInitData } from '@/lib/auth';
import type { SessionUser } from '@/lib/types';
import { resolveManualSession } from '@/lib/server/manual-session';

export type AuthPayload = {
    initData?: string;
    devOverride?: {
        telegramId: string;
        role?: 'ADMIN' | 'MANAGER';
        displayName?: string;
    };
    manualToken?: string;
};

export const readAuthPayloadFromHeader = (req: NextRequest): AuthPayload | undefined => {
    const header = req.headers.get('x-telegram-auth-payload');
    if (header) {
        try {
            return JSON.parse(header) as AuthPayload;
        } catch (error) {
            console.error('Failed to parse auth header', error);
        }
    }

    const initData = req.nextUrl.searchParams.get('initData');
    if (initData) {
        return { initData };
    }

    return undefined;
};

export const sessionFromPayload = async (payload?: AuthPayload): Promise<SessionUser> => {
    if (!payload) {
        throw new Error('Telegram init data is required');
    }

    if (payload.manualToken) {
        const session = resolveManualSession(payload.manualToken);
        if (!session) {
            throw new Error('Manual session expired');
        }
        return session;
    }

    if (payload.initData) {
        return resolveSessionFromInitData(payload.initData);
    }

    if (payload.devOverride) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Dev override is disabled in production');
        }
        return resolveDevSession({
            telegramId: payload.devOverride.telegramId,
            role: payload.devOverride.role,
            displayName: payload.devOverride.displayName
        });
    }

    throw new Error('Telegram init data is required');
};

export const getSessionUser = async (req: NextRequest, bodyPayload?: AuthPayload) => {
    const payload = bodyPayload ?? readAuthPayloadFromHeader(req);
    return sessionFromPayload(payload);
};
