import { NextRequest } from 'next/server';
import { resolveDevSession, resolveSessionFromInitData } from '@/lib/auth';
import type { SessionUser } from '@/lib/types';
import { resolveManualSession } from '@/lib/server/manual-session';
import { SessionError } from '@/lib/server/errors';

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
        throw new SessionError('Telegram init data is required');
    }

    if (payload.manualToken) {
        const session = resolveManualSession(payload.manualToken);
        if (!session) {
            throw new SessionError('Manual session expired');
        }
        return session;
    }

    if (payload.initData) {
        return resolveSessionFromInitData(payload.initData);
    }

    if (payload.devOverride) {
        if (process.env.NODE_ENV === 'production') {
            throw new SessionError('Dev override is disabled in production', 403);
        }
        return resolveDevSession({
            telegramId: payload.devOverride.telegramId,
            role: payload.devOverride.role,
            displayName: payload.devOverride.displayName
        });
    }

    throw new SessionError('Telegram init data is required');
};

export const getSessionUser = async (req: NextRequest, bodyPayload?: AuthPayload) => {
    // Use cookie-based auth for both admin and manager
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split('; ').map((cookie) => {
                const [name, ...rest] = cookie.split('=');
                return [name, rest.join('=')];
            })
        );

        const token = cookies['manualSession'];
        if (token) {
            const session = resolveManualSession(token);
            if (session) {
                return session;
            }
        }
    }

    // No valid auth found
    throw new SessionError('Authentication required');
};
