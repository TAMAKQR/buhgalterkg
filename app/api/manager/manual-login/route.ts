import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import { createManualSession, manualSessionAvailable } from "@/lib/server/manual-session";
import { getCountryFromRequest } from "@/lib/server/request-country";
import { upgradeLegacyPin, verifyDummyPin, verifyPin } from "@/lib/pin";
import {
    clearRequestRateLimits,
    consumeRequestRateLimits,
    getClientIp,
    readRateLimitInteger,
    type RequestRateLimitPolicy,
} from "@/lib/server/request-rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/server/read-json-body";

const IP_ATTEMPT_LIMIT = readRateLimitInteger(
    process.env.MANAGER_PIN_ATTEMPTS ?? process.env.ADMIN_LOGIN_ATTEMPTS,
    5
);
const ACCOUNT_ATTEMPT_LIMIT = Math.max(
    IP_ATTEMPT_LIMIT + 1,
    readRateLimitInteger(process.env.MANAGER_PIN_ACCOUNT_ATTEMPTS, IP_ATTEMPT_LIMIT * 4)
);
const WINDOW_MINUTES = readRateLimitInteger(
    process.env.MANAGER_PIN_WINDOW_MINUTES ?? process.env.ADMIN_LOGIN_WINDOW_MINUTES,
    15,
    { max: 24 * 60 }
);
const WINDOW_SECONDS = WINDOW_MINUTES * 60;

const createIpRateLimitPolicy = (clientIp: string): RequestRateLimitPolicy => ({
    scope: 'login:manager:ip',
    identifier: clientIp,
    limit: IP_ATTEMPT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
});

const createAccountRateLimitPolicy = (login: string): RequestRateLimitPolicy => ({
    scope: 'login:manager:account',
    identifier: login,
    limit: ACCOUNT_ATTEMPT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
});

const tooManyAttemptsResponse = (retryAfterSeconds: number) => new NextResponse(
    "Превышено число попыток. Попробуйте позже",
    {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
    }
);

const pinSchema = z.object({
    login: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, "Логин может содержать только латиницу, цифры и _"),
    pinCode: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
});

export async function GET() {
    try {
        if (!manualSessionAvailable()) {
            return new NextResponse("Веб-доступ отключён", { status: 503 });
        }
        return new NextResponse("Список менеджеров недоступен", { status: 405 });
    } catch (error) {
        console.error(error);
        return new NextResponse("Не удалось выполнить запрос", { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!manualSessionAvailable()) {
            return new NextResponse("Веб-доступ отключён", { status: 503 });
        }

        const ipRateLimitPolicy = createIpRateLimitPolicy(getClientIp(request));
        const ipRateStatus = await consumeRequestRateLimits([ipRateLimitPolicy]);
        if (!ipRateStatus.allowed) {
            return tooManyAttemptsResponse(ipRateStatus.retryAfterSeconds);
        }

        const country = getCountryFromRequest(request);

        const body = await readJsonBody(request, 8 * 1024);
        const { login, pinCode } = pinSchema.parse(body);
        const normalizedLogin = login.trim().toLowerCase();
        const accountRateLimitPolicy = createAccountRateLimitPolicy(normalizedLogin);
        const accountRateStatus = await consumeRequestRateLimits([accountRateLimitPolicy]);
        if (!accountRateStatus.allowed) {
            return tooManyAttemptsResponse(accountRateStatus.retryAfterSeconds);
        }

        const managerRecord = await prisma.user.findUnique({
            where: { loginName: normalizedLogin },
            include: {
                assignments: {
                    where: {
                        isActive: true,
                        hotel: { country },
                    },
                    include: { hotel: true },
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!managerRecord || managerRecord.role !== UserRole.MANAGER) {
            verifyDummyPin(pinCode);
            return new NextResponse("Неверный логин или PIN", { status: 401 });
        }

        if (managerRecord.assignments.length === 0) {
            verifyDummyPin(pinCode);
        }
        const selectedAssignment = managerRecord.assignments.find((assignment) => verifyPin(pinCode, assignment));

        if (!selectedAssignment) {
            return new NextResponse("Неверный логин или PIN", { status: 401 });
        }

        await upgradeLegacyPin(pinCode, selectedAssignment);

        const sessionUser: SessionUser = {
            id: managerRecord.id,
            telegramId: managerRecord.telegramId,
            displayName: managerRecord.displayName,
            avatarUrl: managerRecord.avatarUrl,
            role: managerRecord.role,
            hotels: [{
                id: selectedAssignment.hotel.id,
                name: selectedAssignment.hotel.name,
                address: selectedAssignment.hotel.address,
            }],
        };

        const { token, user } = createManualSession(sessionUser);
        await clearRequestRateLimits([ipRateLimitPolicy, accountRateLimitPolicy]);

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
