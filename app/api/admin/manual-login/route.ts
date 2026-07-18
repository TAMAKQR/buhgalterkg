import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createManualAdminSession, manualAuthConfigured, verifyManualAdminCredentials } from "@/lib/server/manual-auth";
import {
    clearRequestRateLimits,
    consumeRequestRateLimits,
    getClientIp,
    readRateLimitInteger,
    type RequestRateLimitPolicy,
} from "@/lib/server/request-rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/server/read-json-body";

const IP_ATTEMPT_LIMIT = readRateLimitInteger(process.env.ADMIN_LOGIN_ATTEMPTS, 5);
const ACCOUNT_ATTEMPT_LIMIT = Math.max(
    IP_ATTEMPT_LIMIT + 1,
    readRateLimitInteger(process.env.ADMIN_LOGIN_ACCOUNT_ATTEMPTS, IP_ATTEMPT_LIMIT * 4)
);
const WINDOW_MINUTES = readRateLimitInteger(process.env.ADMIN_LOGIN_WINDOW_MINUTES, 15, { max: 24 * 60 });
const WINDOW_SECONDS = WINDOW_MINUTES * 60;

const createRateLimitPolicies = (clientIp: string): RequestRateLimitPolicy[] => [
    {
        scope: 'login:admin:ip',
        identifier: clientIp,
        limit: IP_ATTEMPT_LIMIT,
        windowSeconds: WINDOW_SECONDS,
    },
    {
        scope: 'login:admin:account',
        identifier: 'manual-admin',
        limit: ACCOUNT_ATTEMPT_LIMIT,
        windowSeconds: WINDOW_SECONDS,
    },
];

const credentialsSchema = z.object({
    username: z.string().min(1, "Укажите логин"),
    password: z.string().min(1, "Введите пароль"),
});

export async function POST(request: NextRequest) {
    try {
        if (!manualAuthConfigured()) {
            return new NextResponse("Веб-доступ отключён", { status: 403 });
        }

        const rateLimitPolicies = createRateLimitPolicies(getClientIp(request));
        const rateStatus = await consumeRequestRateLimits(rateLimitPolicies);
        if (!rateStatus.allowed) {
            return new NextResponse("Превышено число попыток. Попробуйте позже", {
                status: 429,
                headers: { "Retry-After": String(rateStatus.retryAfterSeconds) },
            });
        }

        const body = await readJsonBody(request, 8 * 1024);
        const { username, password } = credentialsSchema.parse(body);

        if (!verifyManualAdminCredentials(username, password)) {
            return new NextResponse("Неверный логин или пароль", { status: 401 });
        }

        const { token, user } = createManualAdminSession();
        await clearRequestRateLimits(rateLimitPolicies);

        const response = NextResponse.json({ success: true, user });
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 30, // 30 days
            sameSite: 'lax' as const,
            ...(process.env.NODE_ENV === 'production' && {
                secure: true,
            })
        };
        response.cookies.set('manualSession', token, cookieOptions);

        return response;
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return new NextResponse(error.message, { status: 413 });
        }
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof SyntaxError) {
            return new NextResponse("Неверные данные", { status: 400 });
        }
        console.error(error);
        return new NextResponse("Не удалось выполнить вход", { status: 500 });
    }
}
