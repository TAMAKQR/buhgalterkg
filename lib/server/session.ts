import { NextRequest } from 'next/server';
import { resolveManualSession } from '@/lib/server/manual-session';
import { SessionError } from '@/lib/server/errors';

export const getSessionUser = async (req: NextRequest) => {
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split('; ').map((cookie) => {
                const [name, ...rest] = cookie.split('=');
                return [name, rest.join('=')];
            })
        );

        const token = cookies['manualSession'];
        if (token) {
            const session = resolveManualSession(token);
            if (session) {
                return session;
            }
        }
    }

    throw new SessionError('Authentication required');
};
