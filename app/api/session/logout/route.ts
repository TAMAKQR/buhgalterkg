import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/session/logout
 * Clear the manual session cookie to log out the user
 */
export async function POST(request: NextRequest) {
    void request; // consume param

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
