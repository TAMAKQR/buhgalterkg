import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import type { SessionUser } from '@/lib/types';
import { createManualSession, manualSessionAvailable } from '@/lib/server/manual-session';
import {
    hashPassword,
    passwordHashNeedsUpgrade,
    verifyDummyPassword,
    verifyPassword,
} from '@/lib/password';
import {
    clearRequestRateLimits,
    consumeRequestRateLimits,
    getClientIp,
    readRateLimitInteger,
    type RequestRateLimitPolicy,
} from '@/lib/server/request-rate-limit';
import { readJsonBody, RequestBodyTooLargeError } from '@/lib/server/read-json-body';

const IP_ATTEMPT_LIMIT = readRateLimitInteger(
    process.env.OBSERVER_LOGIN_ATTEMPTS ?? process.env.ADMIN_LOGIN_ATTEMPTS,
    5
);
const ACCOUNT_ATTEMPT_LIMIT = Math.max(
    IP_ATTEMPT_LIMIT + 1,
    readRateLimitInteger(process.env.OBSERVER_LOGIN_ACCOUNT_ATTEMPTS, IP_ATTEMPT_LIMIT * 4)
);
const WINDOW_MINUTES = readRateLimitInteger(
    process.env.OBSERVER_LOGIN_WINDOW_MINUTES ?? process.env.ADMIN_LOGIN_WINDOW_MINUTES,
    15,
    { max: 24 * 60 }
);
const WINDOW_SECONDS = WINDOW_MINUTES * 60;

const createIpRateLimitPolicy = (clientIp: string): RequestRateLimitPolicy => ({
    scope: 'login:observer:ip',
    identifier: clientIp,
    limit: IP_ATTEMPT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
});

const createAccountRateLimitPolicy = (login: string): RequestRateLimitPolicy => ({
    scope: 'login:observer:account',
    identifier: login,
    limit: ACCOUNT_ATTEMPT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
});

const tooManyAttemptsResponse = (retryAfterSeconds: number) => new NextResponse(
    'Превышено число попыток. Попробуйте позже',
    {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
    }
);

const loginSchema = z.object({
    login: z.string().min(1),
    password: z.string().min(1),
});

export async function POST(request: NextRequest) {
    try {
        if (!manualSessionAvailable()) {
            return new NextResponse('Веб-доступ отключён', { status: 503 });
        }

        const ipRateLimitPolicy = createIpRateLimitPolicy(getClientIp(request));
        const ipRateStatus = await consumeRequestRateLimits([ipRateLimitPolicy]);
        if (!ipRateStatus.allowed) {
            return tooManyAttemptsResponse(ipRateStatus.retryAfterSeconds);
        }

        const body = await readJsonBody(request, 8 * 1024);
        const { login, password } = loginSchema.parse(body);
        const accountRateLimitPolicy = createAccountRateLimitPolicy(login.trim().toLowerCase());
        const accountRateStatus = await consumeRequestRateLimits([accountRateLimitPolicy]);
        if (!accountRateStatus.allowed) {
            return tooManyAttemptsResponse(accountRateStatus.retryAfterSeconds);
        }

        const user = await prisma.user.findUnique({
            where: { loginName: login },
            include: {
                assignments: {
                    where: { isActive: true },
                    include: { hotel: true },
                },
            },
        });

        if (!user || user.role !== UserRole.OBSERVER || !user.loginHash) {
            verifyDummyPassword(password);
            return new NextResponse('Неверный логин или пароль', { status: 401 });
        }

        if (!verifyPassword(password, user.loginHash)) {
            return new NextResponse('Неверный логин или пароль', { status: 401 });
        }

        if (passwordHashNeedsUpgrade(user.loginHash)) {
            await prisma.user.updateMany({
                where: { id: user.id, loginHash: user.loginHash },
                data: { loginHash: hashPassword(password) },
            });
        }

        if (user.assignments.length === 0) {
            return new NextResponse('Нет активных назначений', { status: 403 });
        }

        const sessionUser: SessionUser = {
            id: user.id,
            telegramId: user.telegramId,
            displayName: user.displayName,
            username: user.username,
            avatarUrl: user.avatarUrl,
            role: user.role,
            hotels: user.assignments.map((a) => ({
                id: a.hotel.id,
                name: a.hotel.name,
                address: a.hotel.address,
            })),
        };

        const { token, user: sessionData } = createManualSession(sessionUser);
        await clearRequestRateLimits([ipRateLimitPolicy, accountRateLimitPolicy]);

        const response = NextResponse.json({ success: true, user: sessionData });
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 30,
            sameSite: 'lax' as const,
            ...(process.env.NODE_ENV === 'production' && {
                secure: true,
            }),
        };
        response.cookies.set('manualSession', token, cookieOptions);

        return response;
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return new NextResponse(error.message, { status: 413 });
        }
        if (error instanceof z.ZodError) {
            return new NextResponse('Неверные данные', { status: 400 });
        }
        if (error instanceof SyntaxError) {
            return new NextResponse('Неверные данные', { status: 400 });
        }
        console.error(error);
        return new NextResponse('Не удалось выполнить вход', { status: 500 });
    }
}
