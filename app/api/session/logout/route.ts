import { NextRequest, NextResponse } from 'next/server';
import { getManualSessionUser } from '@/lib/server/manual-session';
import { invalidateSession } from '@/lib/server/session-store';

/**
 * POST /api/session/logout
 * Clear the manual session cookie to log out the user
 */
export async function POST(request: NextRequest) {
    // Get current user to invalidate their session
    const user = await getManualSessionUser(request);
    if (user) {
        invalidateSession(user.id);
    }

    const response = NextResponse.json({ success: true });

    // Delete the session cookie by setting maxAge to 0
    const cookieOptions = {
        httpOnly: true,
        path: '/',
        maxAge: 0,
        ...(process.env.NODE_ENV === 'production' && {
            secure: true,
            sameSite: 'none' as const
        })
    };
    response.cookies.set('manualSession', '', cookieOptions);

    return response;
}
