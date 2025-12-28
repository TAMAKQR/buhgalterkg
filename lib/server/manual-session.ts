import { createHmac, timingSafeEqual } from 'crypto';

import type { SessionUser } from '@/lib/types';

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const SESSION_TTL_MINUTES = Number(process.env.ADMIN_SESSION_TTL_MINUTES ?? '720');

type TokenPayload = {
    exp: number;
    user: SessionUser;
};

const cloneSessionUser = (user: SessionUser): SessionUser => ({
    ...user,
    hotels: user.hotels.map((hotel) => ({ ...hotel }))
});

const manualSecretReady = () => Boolean(SESSION_SECRET);

const sign = (payload: string) => {
    if (!SESSION_SECRET) {
        throw new Error('Manual session secret is not configured');
    }

    return createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
};

const safeCompare = (input: string, expected: string) => {
    const left = Buffer.from(input);
    const right = Buffer.from(expected);
    if (left.length !== right.length) {
        return false;
    }

    return timingSafeEqual(left, right);
};

export const manualSessionAvailable = () => manualSecretReady();

export const createManualSession = (user: SessionUser): { token: string; user: SessionUser } => {
    if (!manualSecretReady()) {
        throw new Error('Manual session secret is not configured');
    }

    const payload: TokenPayload = {
        exp: Date.now() + SESSION_TTL_MINUTES * 60 * 1000,
        user: cloneSessionUser(user)
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign(encoded);

    return {
        token: `${encoded}.${signature}`,
        user: payload.user
    };
};

export const resolveManualSession = (token?: string): SessionUser | null => {
    if (!token || !manualSecretReady()) {
        return null;
    }

    const [encoded, providedSignature] = token.split('.');
    if (!encoded || !providedSignature) {
        return null;
    }

    const expectedSignature = sign(encoded);
    if (!safeCompare(providedSignature, expectedSignature)) {
        return null;
    }

    try {
        const buffer = Buffer.from(encoded, 'base64url');
        const payload = JSON.parse(buffer.toString('utf8')) as TokenPayload;

        if (payload.exp < Date.now()) {
            return null;
        }

        return cloneSessionUser(payload.user);
    } catch (error) {
        console.error('Failed to decode manual session token', error);
        return null;
    }
};
