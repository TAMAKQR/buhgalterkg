import { prisma } from './db';
import { normalizeTelegramName, validateTelegramInitData } from './telegram';
import type { SessionUser } from './types';
import type { UserRole } from '@prisma/client';

type DevOverride = {
    telegramId: string;
    role?: UserRole;
    displayName?: string;
    username?: string;
};

export async function resolveSessionFromInitData(initData: string): Promise<SessionUser> {
    const payload = validateTelegramInitData(initData);
    const { user } = payload;

    const displayName = normalizeTelegramName(user);

    const dbUser = await prisma.user.upsert({
        where: { telegramId: String(user.id) },
        update: {
            displayName,
            username: user.username,
            avatarUrl: user.photo_url ?? undefined
        },
        create: {
            telegramId: String(user.id),
            displayName,
            username: user.username,
            avatarUrl: user.photo_url ?? undefined
        },
        include: {
            assignments: {
                where: { isActive: true },
                include: { hotel: true }
            }
        }
    });

    return {
        id: dbUser.id,
        telegramId: dbUser.telegramId,
        displayName: dbUser.displayName,
        username: dbUser.username,
        avatarUrl: dbUser.avatarUrl,
        role: dbUser.role,
        hotels: dbUser.assignments.map((assignment) => ({
            id: assignment.hotel.id,
            name: assignment.hotel.name,
            address: assignment.hotel.address
        }))
    };
}

export async function resolveDevSession(override: DevOverride): Promise<SessionUser> {
    const telegramId = override.telegramId;
    if (!telegramId) {
        throw new Error('Dev override requires telegramId');
    }

    const dbUser = await prisma.user.upsert({
        where: { telegramId },
        update: {
            displayName: override.displayName ?? 'Dev User',
            username: override.username,
            role: override.role ?? 'ADMIN'
        },
        create: {
            telegramId,
            displayName: override.displayName ?? 'Dev User',
            username: override.username,
            role: override.role ?? 'ADMIN'
        },
        include: {
            assignments: {
                where: { isActive: true },
                include: { hotel: true }
            }
        }
    });

    return {
        id: dbUser.id,
        telegramId: dbUser.telegramId,
        displayName: dbUser.displayName,
        username: dbUser.username,
        avatarUrl: dbUser.avatarUrl,
        role: dbUser.role,
        hotels: dbUser.assignments.map((assignment) => ({
            id: assignment.hotel.id,
            name: assignment.hotel.name,
            address: assignment.hotel.address
        }))
    };
}
