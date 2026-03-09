import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";

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
    managerId: z.string().cuid().optional(),
    hotelId: z.string().cuid().optional(),
    pinCode: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
});

export async function GET() {
    try {
        if (!manualSessionAvailable()) {
            return new NextResponse("Веб-доступ отключён", { status: 503 });
        }

        const managers = await prisma.user.findMany({
            where: {
                role: UserRole.MANAGER,
                assignments: {
                    some: {
                        isActive: true,
                    },
                },
            },
            select: {
                id: true,
                displayName: true,
                username: true,
                assignments: {
                    where: { isActive: true },
                    select: {
                        hotel: {
                            select: {
                                id: true,
                                name: true,
                                address: true,
                            },
                        },
                    },
                },
            },
            orderBy: [
                { displayName: "asc" },
                { id: "asc" },
            ],
        });

        return NextResponse.json(
            managers.map((manager) => ({
                id: manager.id,
                displayName: manager.displayName,
                username: manager.username,
                hotels: manager.assignments.map((assignment) => assignment.hotel),
            })),
        );
    } catch (error) {
        console.error(error);
        return new NextResponse("Не удалось загрузить список менеджеров", { status: 500 });
    }
}

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
        const { managerId, hotelId, pinCode } = pinSchema.parse(body);

        const managerRecord = managerId
            ? await prisma.user.findFirst({
                where: {
                    id: managerId,
                    role: UserRole.MANAGER,
                    assignments: {
                        some: {
                            isActive: true,
                            pinCode,
                        },
                    },
                },
                include: {
                    assignments: {
                        where: { isActive: true },
                        include: { hotel: true },
                    },
                },
            })
            : await prisma.user.findFirst({
                where: {
                    role: UserRole.MANAGER,
                    assignments: {
                        some: {
                            isActive: true,
                            pinCode,
                        },
                    },
                },
                include: {
                    assignments: {
                        where: { isActive: true },
                        include: { hotel: true },
                    },
                },
                orderBy: { displayName: "asc" },
            });

        if (!managerRecord) {
            registerFailure(fingerprint);
            return new NextResponse(managerId ? "Неверное имя или PIN" : "Неверный PIN", { status: 401 });
        }

        const activeAssignments = hotelId
            ? managerRecord.assignments.filter((assignment) => assignment.hotelId === hotelId)
            : managerRecord.assignments;

        if (activeAssignments.length === 0) {
            registerFailure(fingerprint);
            return new NextResponse("Выберите корректный объект", { status: 403 });
        }

        if (!hotelId && activeAssignments.length > 1) {
            registerFailure(fingerprint);
            return new NextResponse("Выберите объект", { status: 400 });
        }

        const selectedAssignment = activeAssignments[0];

        if (!selectedAssignment) {
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
            hotels: [{
                id: selectedAssignment.hotel.id,
                name: selectedAssignment.hotel.name,
                address: selectedAssignment.hotel.address,
            }],
        };

        const { token, user } = createManualSession(sessionUser);
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
