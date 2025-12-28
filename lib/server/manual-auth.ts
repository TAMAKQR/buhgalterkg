import { timingSafeEqual } from "crypto";

import type { SessionUser } from "@/lib/types";
import { createManualSession, manualSessionAvailable } from "@/lib/server/manual-session";

const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME ?? "Web Admin";
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

const safeCompare = (input: string, expected: string) => {
    const left = Buffer.from(input);
    const right = Buffer.from(expected);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
};

export const manualAuthConfigured = () => {
    if (!ADMIN_LOGIN || !ADMIN_PASSWORD || !manualSessionAvailable()) {
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

export const createManualAdminSession = (): { token: string; user: SessionUser } => {
    if (!manualAuthConfigured()) {
        throw new Error("Manual admin login is not configured");
    }
    return createManualSession(manualTemplate);
};
