import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import type { SessionUser } from '@/lib/types';
import { createManualSession, manualSessionAvailable } from '@/lib/server/manual-session';
import { verifyPassword } from '@/lib/password';

const ATTEMPT_LIMIT = Math.max(1, Number(process.env.OBSERVER_LOGIN_ATTEMPTS ?? process.env.ADMIN_LOGIN_ATTEMPTS ?? '5'));
const WINDOW_MINUTES = Math.max(1, Number(process.env.OBSERVER_LOGIN_WINDOW_MINUTES ?? process.env.ADMIN_LOGIN_WINDOW_MINUTES ?? '15'));
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

type AttemptRecord = { count: number; resetAt: number };
const attemptStore = new Map<string, AttemptRecord>();

const getClientFingerprint = (request: NextRequest) => {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const [first] = forwarded.split(',');
        if (first?.trim()) return first.trim();
    }
    return (
        request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-real-ip') ??
        request.ip ??
        'unknown'
    );
};

const checkRateLimit = (key: string) => {
    const entry = attemptStore.get(key);
    if (!entry) return { allowed: true } as const;
    const now = Date.now();
    if (entry.resetAt <= now) { attemptStore.delete(key); return { allowed: true } as const; }
    if (entry.count >= ATTEMPT_LIMIT) return { allowed: false, retryAfter: entry.resetAt - now } as const;
    return { allowed: true } as const;
};

const registerFailure = (key: string) => {
    const now = Date.now();
    const entry = attemptStore.get(key);
    if (entry && entry.resetAt > now) {
        attemptStore.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
        return;
    }
    attemptStore.set(key, { count: 1, resetAt: now + WINDOW_MS });
};

const clearAttempts = (key: string) => { attemptStore.delete(key); };

const loginSchema = z.object({
    login: z.string().min(1),
    password: z.string().min(1),
});

export async function POST(request: NextRequest) {
    const fingerprint = getClientFingerprint(request);
    const rateStatus = checkRateLimit(fingerprint);
    if (!rateStatus.allowed) {
        const retrySeconds = Math.ceil(rateStatus.retryAfter / 1000);
        return new NextResponse('Превышено число попыток. Попробуйте позже', {
            status: 429,
            headers: { 'Retry-After': String(retrySeconds) },
        });
    }

    try {
        if (!manualSessionAvailable()) {
            return new NextResponse('Веб-доступ отключён', { status: 503 });
        }

        const body = await request.json();
        const { login, password } = loginSchema.parse(body);

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
            registerFailure(fingerprint);
            return new NextResponse('Неверный логин или пароль', { status: 401 });
        }

        if (!verifyPassword(password, user.loginHash)) {
            registerFailure(fingerprint);
            return new NextResponse('Неверный логин или пароль', { status: 401 });
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
        clearAttempts(fingerprint);

        const response = NextResponse.json({ success: true, user: sessionData });
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 30,
            ...(process.env.NODE_ENV === 'production' && {
                secure: true,
                sameSite: 'none' as const,
            }),
        };
        response.cookies.set('manualSession', token, cookieOptions);

        return response;
    } catch (error) {
        if (error instanceof z.ZodError) {
            registerFailure(fingerprint);
            return new NextResponse('Неверные данные', { status: 400 });
        }
        console.error(error);
        return new NextResponse('Не удалось выполнить вход', { status: 500 });
    }
}
