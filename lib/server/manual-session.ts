import { createHmac, timingSafeEqual } from 'crypto';

import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/types';

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const SESSION_TTL_MINUTES = Number(process.env.ADMIN_SESSION_TTL_MINUTES ?? '720');
const MIN_SESSION_SECRET_BYTES = 32;
const unsafeSessionSecrets = new Set([
    'set-a-strong-secret',
    'change-me',
    'replace-me',
    'your-secret',
]);

type TokenPayload = {
    exp: number;
    user: SessionUser;
};

const cloneSessionUser = (user: SessionUser): SessionUser => ({
    ...user,
    hotels: user.hotels.map((hotel) => ({ ...hotel }))
});

const manualSecretReady = () => {
    const normalizedSecret = SESSION_SECRET?.trim() ?? '';
    const isPlaceholder = unsafeSessionSecrets.has(normalizedSecret.toLowerCase())
        || /(?:change|replace|generate|example|placeholder|secret[-_ ]?here)/i.test(normalizedSecret);
    const isReady = Buffer.byteLength(normalizedSecret, 'utf8') >= MIN_SESSION_SECRET_BYTES && !isPlaceholder;

    if (!isReady) {
        console.error('[manual-session] ADMIN_SESSION_SECRET must be a non-placeholder secret of at least 32 bytes');
    }
    return isReady;
};

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
    const token = `${encoded}.${signature}`;

    return {
        token,
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

const refreshManualSessionUser = async (snapshot: SessionUser): Promise<SessionUser | null> => {
    // The web administrator is configured through environment variables and
    // intentionally has no User row to revalidate against.
    if (snapshot.role === 'ADMIN' && snapshot.id === 'manual-admin') {
        return cloneSessionUser(snapshot);
    }

    const scopedHotelIds = snapshot.hotels.map((hotel) => hotel.id);
    const user = await prisma.user.findUnique({
        where: { id: snapshot.id },
        select: {
            id: true,
            telegramId: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            role: true,
            assignments: {
                where: {
                    isActive: true,
                    role: snapshot.role,
                    ...(scopedHotelIds.length > 0 ? { hotelId: { in: scopedHotelIds } } : {})
                },
                select: {
                    hotel: {
                        select: { id: true, name: true, address: true }
                    }
                }
            }
        }
    });

    // A role change invalidates the old signed snapshot instead of silently
    // granting the permissions of either the old or the new role.
    if (!user || user.role !== snapshot.role) {
        return null;
    }

    const hotels = user.role === 'ADMIN'
        ? snapshot.hotels
        : user.assignments.map((assignment) => assignment.hotel);

    // Managers and observers without an active assignment are revoked
    // immediately, even if their signed cookie has not expired yet.
    if (user.role !== 'ADMIN' && hotels.length === 0) {
        return null;
    }

    return {
        id: user.id,
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        role: user.role,
        hotels
    };
};

export const getManualSessionUser = async (req: Request): Promise<SessionUser | null> => {
    const cookieHeader = req.headers.get('cookie');
    if (!cookieHeader) {
        return null;
    }

    const cookies = Object.fromEntries(
        cookieHeader.split('; ').map((cookie) => {
            const [name, ...rest] = cookie.split('=');
            return [name, rest.join('=')];
        })
    );

    const token = cookies['manualSession'];
    const snapshot = resolveManualSession(token);
    return snapshot ? refreshManualSessionUser(snapshot) : null;
};
