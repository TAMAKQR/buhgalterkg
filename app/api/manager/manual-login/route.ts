import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import { createManualSession, manualSessionAvailable } from "@/lib/server/manual-session";

const PIN_ATTEMPT_LIMIT = Math.max(1, Number(process.env.MANAGER_PIN_ATTEMPTS ?? process.env.ADMIN_LOGIN_ATTEMPTS ?? "5"));
const PIN_WINDOW_MINUTES = Math.max(1, Number(process.env.MANAGER_PIN_WINDOW_MINUTES ?? process.env.ADMIN_LOGIN_WINDOW_MINUTES ?? "15"));
const PIN_WINDOW_MS = PIN_WINDOW_MINUTES * 60 * 1000;

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
    if (entry.count >= PIN_ATTEMPT_LIMIT) {
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
    attemptStore.set(key, { count: 1, resetAt: now + PIN_WINDOW_MS });
};

const clearAttempts = (key: string) => {
    attemptStore.delete(key);
};

const pinSchema = z.object({
    pinCode: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
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
        if (!manualSessionAvailable()) {
            return new NextResponse("Веб-доступ отключён", { status: 503 });
        }

        const body = await request.json();
        const { pinCode } = pinSchema.parse(body);

        const assignments = await prisma.hotelAssignment.findMany({
            where: { pinCode, isActive: true },
            include: {
                user: {
                    include: {
                        assignments: {
                            where: { isActive: true },
                            include: { hotel: true },
                        },
                    },
                },
            },
        });

        if (assignments.length === 0) {
            registerFailure(fingerprint);
            return new NextResponse("Неверный PIN", { status: 401 });
        }

        const uniqueUsers = new Set(assignments.map((assignment) => assignment.userId));
        if (uniqueUsers.size > 1) {
            registerFailure(fingerprint);
            return new NextResponse("PIN назначен нескольким менеджерам. Обратитесь к администратору", { status: 409 });
        }

        const managerRecord = assignments[0].user;
        if (managerRecord.assignments.length === 0) {
            registerFailure(fingerprint);
            return new NextResponse("У менеджера нет активных точек", { status: 403 });
        }

        const sessionUser: SessionUser = {
            id: managerRecord.id,
            telegramId: managerRecord.telegramId,
            displayName: managerRecord.displayName,
            username: managerRecord.username,
            avatarUrl: managerRecord.avatarUrl,
            role: managerRecord.role,
            hotels: managerRecord.assignments.map((assignment) => ({
                id: assignment.hotel.id,
                name: assignment.hotel.name,
                address: assignment.hotel.address,
            })),
        };

        const { token, user } = createManualSession(sessionUser);
        clearAttempts(fingerprint);
        return NextResponse.json({ token, user });
    } catch (error) {
        if (error instanceof z.ZodError) {
            registerFailure(fingerprint);
            return new NextResponse(error.message, { status: 400 });
        }
        console.error(error);
        return new NextResponse("Не удалось выполнить вход", { status: 500 });
    }
}
