import { NextRequest } from 'next/server';
import { getManualSessionUser } from '@/lib/server/manual-session';
import { SessionError } from '@/lib/server/errors';

export const getSessionUser = async (req: NextRequest) => {
    const session = await getManualSessionUser(req);
    if (session) {
        return session;
    }

    throw new SessionError('Authentication required');
};
