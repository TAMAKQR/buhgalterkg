import { createHmac, timingSafeEqual } from 'crypto';

export type TelegramWebAppUser = {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
};

const maxInitDataAgeMs = 7 * 24 * 60 * 60 * 1000;

const safeEqualHex = (left: string, right: string) => {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyTelegramWebAppInitData = (
    initData: string,
    botToken: string,
    now = Date.now()
): { user: TelegramWebAppUser | null; authDate: Date | null } | null => {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');

    if (!receivedHash) {
        return null;
    }

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!safeEqualHex(calculatedHash, receivedHash)) {
        return null;
    }

    const authDateRaw = params.get('auth_date');
    const authDateSeconds = authDateRaw ? Number(authDateRaw) : NaN;
    const authDate = Number.isFinite(authDateSeconds) ? new Date(authDateSeconds * 1000) : null;

    if (!authDate || now - authDate.getTime() > maxInitDataAgeMs) {
        return null;
    }

    const rawUser = params.get('user');
    if (!rawUser) {
        return { user: null, authDate };
    }

    try {
        return { user: JSON.parse(rawUser) as TelegramWebAppUser, authDate };
    } catch {
        return null;
    }
};
