import type { SessionUser } from '@/lib/types';

/**
 * The environment-backed web administrator has no User row. Audit relations
 * stay nullable for that identity while actorLabel still records who acted.
 */
export const getDatabaseActorUserId = (user: SessionUser) => (
    user.id === 'manual-admin' ? null : user.id
);
