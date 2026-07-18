import { createHash, timingSafeEqual } from 'crypto';

export type TelegramWebhookAuthFailure = {
    status: 401 | 503;
    message: string;
};

const webhookSecretReady = (secret?: string) => {
    const normalized = secret?.trim() ?? '';
    return Buffer.byteLength(normalized, 'utf8') >= 32
        && !/(?:change|replace|generate|example|placeholder|secret[-_ ]?here)/i.test(normalized);
};

export const deriveTelegramWebhookSecret = (botToken?: string) => {
    const normalizedToken = botToken?.trim();
    if (!normalizedToken) return undefined;
    return createHash('sha256')
        .update('hotel-ops:telegram-webhook:')
        .update(normalizedToken)
        .digest('hex');
};

export const validateTelegramWebhookSecret = (
    request: Request,
    expectedSecrets?: string | Array<string | undefined>
): TelegramWebhookAuthFailure | null => {
    const secureSecrets = (Array.isArray(expectedSecrets) ? expectedSecrets : [expectedSecrets])
        .filter((secret): secret is string => webhookSecretReady(secret))
        .map((secret) => secret.trim());
    if (!secureSecrets.length) {
        return { status: 503, message: 'Telegram webhook secret is not securely configured' };
    }

    const providedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    const provided = Buffer.from(providedSecret);
    const matches = secureSecrets.some((secret) => {
        const expected = Buffer.from(secret);
        return provided.length === expected.length && timingSafeEqual(provided, expected);
    });
    if (!matches) {
        return { status: 401, message: 'Invalid Telegram webhook secret' };
    }

    return null;
};
