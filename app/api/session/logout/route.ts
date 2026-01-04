import { NextResponse } from 'next/server';

/**
 * POST /api/session/logout
 * Clear the manual session cookie to log out the user
 */
export async function POST() {
    const response = NextResponse.json({ success: true });

    // Delete the session cookie by setting maxAge to 0
    response.cookies.set('manualSession', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0
    });

    return response;
}
