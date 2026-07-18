import { createHash } from 'crypto';
import { isIP } from 'net';

import { prisma } from '@/lib/db';

const MAX_SCOPE_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_IP_HEADER_LENGTH = 128;
const MAX_LIMIT = 100_000;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const CLEANUP_EVERY = 64;
const CLEANUP_BATCH_SIZE = 250;

export type RequestRateLimitPolicy = {
    scope: string;
    identifier: string;
    limit: number;
    windowSeconds: number;
};

export type RequestRateLimitDecision = {
    allowed: boolean;
    retryAfterSeconds: number;
    remaining: number;
};

type ConsumedRateLimit = {
    attempts: number;
    expiresAt: Date;
    limit: number;
};

type RequestWithIp = Request & {
    ip?: string | null;
};

let cleanupCounter = 0;

export const readRateLimitInteger = (
    rawValue: string | undefined,
    fallback: number,
    options: { min?: number; max?: number } = {}
) => {
    const min = options.min ?? 1;
    const max = options.max ?? MAX_LIMIT;
    const value = Number(rawValue);

    if (!Number.isSafeInteger(value) || value < min) {
        return Math.min(Math.max(Math.trunc(fallback), min), max);
    }

    return Math.min(value, max);
};

const normalizeScope = (value: string) => {
    const normalized = value
        .slice(0, MAX_SCOPE_LENGTH * 2)
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]/g, '-')
        .slice(0, MAX_SCOPE_LENGTH);

    if (!normalized) {
        throw new Error('Rate limit scope is required');
    }

    return normalized;
};

const normalizeIdentifier = (value: string) => (
    value
        .slice(0, MAX_IDENTIFIER_LENGTH * 2)
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .slice(0, MAX_IDENTIFIER_LENGTH) || 'unknown'
);

const createKeyHash = (policy: Pick<RequestRateLimitPolicy, 'scope' | 'identifier'>) => createHash('sha256')
    .update(normalizeScope(policy.scope), 'utf8')
    .update('\0', 'utf8')
    .update(normalizeIdentifier(policy.identifier), 'utf8')
    .digest('hex');

const normalizeIpCandidate = (rawValue?: string | null) => {
    if (!rawValue) return null;

    let value = rawValue.trim();
    if (!value || value.length > MAX_IP_HEADER_LENGTH) return null;

    if (value.startsWith('[')) {
        const closingBracket = value.indexOf(']');
        if (closingBracket <= 1) return null;
        value = value.slice(1, closingBracket);
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
        value = value.slice(0, value.lastIndexOf(':'));
    }

    const zoneIndex = value.indexOf('%');
    if (zoneIndex > 0) {
        value = value.slice(0, zoneIndex);
    }

    const version = isIP(value);
    if (!version) return null;

    if (version === 6) {
        try {
            const hostname = new URL(`http://[${value}]/`).hostname;
            return hostname.replace(/^\[|\]$/g, '').toLowerCase();
        } catch {
            return value.toLowerCase();
        }
    }

    return value;
};

const lastForwardedAddress = (value?: string | null) => {
    if (!value) return null;

    const bounded = value.slice(-MAX_IP_HEADER_LENGTH);
    const lastComma = bounded.lastIndexOf(',');
    return bounded.slice(lastComma + 1).trim();
};

export const getClientIp = (request: RequestWithIp) => {
    const candidates = [
        request.headers.get('cf-connecting-ip'),
        request.headers.get('x-real-ip'),
        lastForwardedAddress(request.headers.get('x-forwarded-for')),
        request.headers.get('fastly-client-ip'),
        request.ip,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeIpCandidate(candidate);
        if (normalized) return normalized;
    }

    return 'unknown';
};

const normalizePolicy = (policy: RequestRateLimitPolicy) => ({
    keyHash: createKeyHash(policy),
    limit: readRateLimitInteger(String(policy.limit), 1, { max: MAX_LIMIT }),
    windowSeconds: readRateLimitInteger(String(policy.windowSeconds), 60, { max: MAX_WINDOW_SECONDS }),
});

const consumeRateLimit = async (policy: RequestRateLimitPolicy): Promise<ConsumedRateLimit> => {
    const normalized = normalizePolicy(policy);
    const rows = await prisma.$queryRaw<Array<{ attempts: number; expiresAt: Date }>>`
        INSERT INTO "request_rate_limits" (
            "key_hash",
            "attempts",
            "window_started_at",
            "expires_at"
        )
        VALUES (
            ${normalized.keyHash},
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + (${normalized.windowSeconds} * INTERVAL '1 second')
        )
        ON CONFLICT ("key_hash") DO UPDATE SET
            "attempts" = CASE
                WHEN "request_rate_limits"."expires_at" <= CURRENT_TIMESTAMP THEN 1
                WHEN "request_rate_limits"."attempts" >= 2147483647 THEN 2147483647
                ELSE "request_rate_limits"."attempts" + 1
            END,
            "window_started_at" = CASE
                WHEN "request_rate_limits"."expires_at" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
                ELSE "request_rate_limits"."window_started_at"
            END,
            "expires_at" = CASE
                WHEN "request_rate_limits"."expires_at" <= CURRENT_TIMESTAMP
                    THEN CURRENT_TIMESTAMP + (${normalized.windowSeconds} * INTERVAL '1 second')
                ELSE "request_rate_limits"."expires_at"
            END,
            "updated_at" = CURRENT_TIMESTAMP
        RETURNING
            "attempts",
            "expires_at" AS "expiresAt"
    `;

    const row = rows[0];
    if (!row) {
        throw new Error('Rate limit state was not returned');
    }

    return {
        attempts: row.attempts,
        expiresAt: row.expiresAt,
        limit: normalized.limit,
    };
};

const maybeCleanupExpiredRateLimits = async () => {
    cleanupCounter = (cleanupCounter + 1) % CLEANUP_EVERY;
    if (cleanupCounter !== 1) return;

    try {
        await prisma.$executeRaw`
            DELETE FROM "request_rate_limits" AS target
            USING (
                SELECT "key_hash"
                FROM "request_rate_limits"
                WHERE "expires_at" <= CURRENT_TIMESTAMP
                ORDER BY "expires_at" ASC
                LIMIT ${CLEANUP_BATCH_SIZE}
            ) AS expired
            WHERE target."key_hash" = expired."key_hash"
              AND target."expires_at" <= CURRENT_TIMESTAMP
        `;
    } catch {
        // Cleanup is opportunistic and must never disable authentication.
        console.warn('[request-rate-limit] Expired-key cleanup failed');
    }
};

export const consumeRequestRateLimits = async (
    policies: RequestRateLimitPolicy[]
): Promise<RequestRateLimitDecision> => {
    if (!policies.length) {
        return { allowed: true, retryAfterSeconds: 0, remaining: 0 };
    }

    const uniquePolicies = Array.from(new Map(
        policies.map((policy) => [createKeyHash(policy), policy])
    ).values());
    const consumed = await Promise.all(uniquePolicies.map(consumeRateLimit));
    await maybeCleanupExpiredRateLimits();

    const blocked = consumed.filter((entry) => entry.attempts > entry.limit);
    const now = Date.now();
    const retryAfterSeconds = blocked.reduce((maximum, entry) => (
        Math.max(maximum, Math.max(1, Math.ceil((entry.expiresAt.getTime() - now) / 1000)))
    ), 0);
    const remaining = consumed.reduce((minimum, entry) => (
        Math.min(minimum, Math.max(0, entry.limit - entry.attempts))
    ), Number.POSITIVE_INFINITY);

    return {
        allowed: blocked.length === 0,
        retryAfterSeconds,
        remaining: Number.isFinite(remaining) ? remaining : 0,
    };
};

export const clearRequestRateLimits = async (policies: RequestRateLimitPolicy[]) => {
    const keyHashes = Array.from(new Set(policies.map(createKeyHash)));
    if (!keyHashes.length) return;

    await prisma.requestRateLimit.deleteMany({
        where: { keyHash: { in: keyHashes } },
    });
};
