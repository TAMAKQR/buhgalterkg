/**
 * Session store for tracking active sessions per user
 * When a user logs in from a new device, their old session is invalidated
 */

import { createHash } from 'crypto';

type SessionRecord = {
    tokenHash: string;
    createdAt: number;
};

// Map of userId -> active session
const activeSessions = new Map<string, SessionRecord>();

const hashToken = (token: string): string => {
    return createHash('sha256').update(token).digest('hex');
};

/**
 * Register a new session and invalidate any existing session for this user
 */
export const registerSession = (userId: string, token: string): void => {
    const tokenHash = hashToken(token);
    activeSessions.set(userId, {
        tokenHash,
        createdAt: Date.now()
    });
};

/**
 * Check if a token is valid for the given user
 * Returns true if this is the active session, false if invalidated
 */
export const isSessionValid = (userId: string, token: string): boolean => {
    const session = activeSessions.get(userId);
    if (!session) {
        // No session registered yet - allow it
        return true;
    }

    const tokenHash = hashToken(token);
    return session.tokenHash === tokenHash;
};

/**
 * Invalidate a user's session
 */
export const invalidateSession = (userId: string): void => {
    activeSessions.delete(userId);
};

/**
 * Clean up old sessions (optional, for memory management)
 */
export const cleanupOldSessions = (maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): void => {
    const now = Date.now();
    for (const [userId, session] of activeSessions.entries()) {
        if (now - session.createdAt > maxAgeMs) {
            activeSessions.delete(userId);
        }
    }
};
