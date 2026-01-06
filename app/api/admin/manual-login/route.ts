import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createManualAdminSession, manualAuthConfigured, verifyManualAdminCredentials } from "@/lib/server/manual-auth";

const ATTEMPT_LIMIT = Math.max(1, Number(process.env.ADMIN_LOGIN_ATTEMPTS ?? "5"));
const WINDOW_MINUTES = Math.max(1, Number(process.env.ADMIN_LOGIN_WINDOW_MINUTES ?? "15"));
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

type AttemptRecord = {
    count: number;
    resetAt: number;
};

const attemptStore = new Map<string, AttemptRecord>();

const getClientFingerprint = (request: NextRequest) => {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const [first] = forwarded.split(",");
        if (first?.trim()) {
            return first.trim();
        }
    }
    return (
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-real-ip") ??
        request.headers.get("fastly-client-ip") ??
        request.ip ??
        "unknown"
    );
};

const checkRateLimit = (key: string) => {
    const entry = attemptStore.get(key);
    if (!entry) {
        return { allowed: true } as const;
    }
    const now = Date.now();
    if (entry.resetAt <= now) {
        attemptStore.delete(key);
        return { allowed: true } as const;
    }
    if (entry.count >= ATTEMPT_LIMIT) {
        return { allowed: false, retryAfter: entry.resetAt - now } as const;
    }
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

const clearAttempts = (key: string) => {
    attemptStore.delete(key);
};

const credentialsSchema = z.object({
    username: z.string().min(1, "Укажите логин"),
    password: z.string().min(1, "Введите пароль"),
});

export async function POST(request: NextRequest) {
    const fingerprint = getClientFingerprint(request);
    const rateStatus = checkRateLimit(fingerprint);
    if (!rateStatus.allowed) {
        const retrySeconds = Math.ceil(rateStatus.retryAfter / 1000);
        return new NextResponse("Превышено число попыток. Попробуйте позже", {
            status: 429,
            headers: { "Retry-After": String(retrySeconds) },
        });
    }

    try {
        if (!manualAuthConfigured()) {
            return new NextResponse("Веб-доступ отключён", { status: 403 });
        }

        const body = await request.json();
        const { username, password } = credentialsSchema.parse(body);

        if (!verifyManualAdminCredentials(username, password)) {
            registerFailure(fingerprint);
            return new NextResponse("Неверный логин или пароль", { status: 401 });
        }

        const { token, user } = createManualAdminSession();
        clearAttempts(fingerprint);

        const response = NextResponse.json({ success: true, user });
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 30, // 30 days
            ...(process.env.NODE_ENV === 'production' && {
                secure: true,
                sameSite: 'none' as const
            })
        };
        response.cookies.set('manualSession', token, cookieOptions);

        return response;
    } catch (error) {
        if (error instanceof z.ZodError) {
            registerFailure(fingerprint);
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse("Не удалось выполнить вход", { status: 500 });
    }
}
