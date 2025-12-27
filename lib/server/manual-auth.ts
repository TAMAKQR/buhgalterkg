import { createHmac, timingSafeEqual } from "crypto";

import type { SessionUser } from "@/lib/types";

const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME ?? "Web Admin";
const SESSION_TTL_MINUTES = Number(process.env.ADMIN_SESSION_TTL_MINUTES ?? "720");
const ADMIN_PASSWORD_MIN_LENGTH = Number(process.env.ADMIN_PASSWORD_MIN_LENGTH ?? "10");

const manualTemplate: SessionUser = {
    id: "manual-admin",
    telegramId: "manual-admin",
    displayName: ADMIN_DISPLAY_NAME,
    username: null,
    avatarUrl: null,
    role: "ADMIN",
    hotels: [],
};

const cloneSessionUser = (user: SessionUser): SessionUser => ({
    ...user,
    hotels: user.hotels.map((hotel) => ({ ...hotel })),
});

type TokenPayload = {
    exp: number;
    user: SessionUser;
};

const sign = (payload: string) => {
    if (!ADMIN_SESSION_SECRET) {
        throw new Error("ADMIN_SESSION_SECRET is not configured");
    }
    return createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
};

const safeCompare = (input: string, expected: string) => {
    const left = Buffer.from(input);
    const right = Buffer.from(expected);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
};

const passwordStrongEnough = (password: string) => {
    if (!password || Number.isNaN(ADMIN_PASSWORD_MIN_LENGTH)) {
        return false;
    }
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
        return false;
    }
    const hasLetter = /[A-Za-zА-Яа-я]/.test(password);
    const hasDigit = /\d/.test(password);
    return hasLetter && hasDigit;
};

export const manualAuthConfigured = () => {
    if (!ADMIN_LOGIN || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
        return false;
    }
    if (!passwordStrongEnough(ADMIN_PASSWORD)) {
        if (process.env.NODE_ENV !== "production") {
            console.warn("ADMIN_PASSWORD не соответствует политике сложности");
        }
        return false;
    }
    return true;
};

export const verifyManualAdminCredentials = (username: string, password: string) => {
    if (!manualAuthConfigured()) {
        return false;
    }
    return safeCompare(username, ADMIN_LOGIN as string) && safeCompare(password, ADMIN_PASSWORD as string);
};

const encodePayload = (payload: TokenPayload) => Buffer.from(JSON.stringify(payload)).toString("base64url");

const decodePayload = (encoded: string): TokenPayload | null => {
    try {
        const buffer = Buffer.from(encoded, "base64url");
        return JSON.parse(buffer.toString("utf8")) as TokenPayload;
    } catch (error) {
        console.error("Failed to decode manual admin token", error);
        return null;
    }
};

export const createManualAdminSession = (): { token: string; user: SessionUser } => {
    if (!manualAuthConfigured()) {
        throw new Error("Manual admin login is not configured");
    }

    const payload: TokenPayload = {
        exp: Date.now() + SESSION_TTL_MINUTES * 60 * 1000,
        user: cloneSessionUser(manualTemplate),
    };

    const encoded = encodePayload(payload);
    const signature = sign(encoded);

    return {
        token: `${encoded}.${signature}`,
        user: payload.user,
    };
};

export const resolveManualAdminSession = (token?: string): SessionUser | null => {
    if (!token || !manualAuthConfigured()) {
        return null;
    }

    const [encoded, providedSignature] = token.split(".");
    if (!encoded || !providedSignature) {
        return null;
    }

    const expectedSignature = sign(encoded);
    if (!safeCompare(providedSignature, expectedSignature)) {
        return null;
    }

    const payload = decodePayload(encoded);
    if (!payload) {
        return null;
    }

    if (payload.exp < Date.now()) {
        return null;
    }

    return cloneSessionUser(payload.user);
};
