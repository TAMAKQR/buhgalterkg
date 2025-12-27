import crypto from 'crypto';
import { env } from './env';
import type { TelegramInitPayload, TelegramUserPayload } from './types';

const TELEGRAM_DATA_KEY = crypto
    .createHmac('sha256', 'WebAppData')
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

const parseInitData = (initData: string): TelegramInitPayload => {
    const searchParams = new URLSearchParams(initData);
    const payload: Record<string, unknown> = {};

    for (const [key, value] of searchParams.entries()) {
        if (key === 'user') {
            payload.user = JSON.parse(value) as TelegramUserPayload;
            continue;
        }

        payload[key] = value;
    }

    if (!payload.user) {
        throw new Error('Invalid Telegram init data: user is missing');
    }

    return payload as TelegramInitPayload;
};

const dataCheckString = (payload: TelegramInitPayload) => {
    const entries = Object.entries(payload)
        .filter(([key]) => key !== 'hash')
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .sort();

    return entries.join('\n');
};

export const validateTelegramInitData = (initData: string) => {
    const payload = parseInitData(initData);
    const check = dataCheckString(payload);

    const signature = crypto.createHmac('sha256', TELEGRAM_DATA_KEY).update(check).digest('hex');

    if (signature !== payload.hash) {
        throw new Error('Telegram init data failed signature check');
    }

    const now = Math.floor(Date.now() / 1000);
    const ageSeconds = now - payload.auth_date;

    if (ageSeconds > 86400) {
        throw new Error('Telegram init data has expired');
    }

    return payload;
};

export const normalizeTelegramName = (user: TelegramUserPayload) => {
    return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
};
