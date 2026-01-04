import { NextRequest, NextResponse } from 'next/server';
import { getManualSessionUser } from '@/lib/server/manual-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const user = await getManualSessionUser(request);

        if (!user) {
            return NextResponse.json({ user: null }, { status: 401 });
        }

        return NextResponse.json({ user });
    } catch {
        return NextResponse.json({ user: null }, { status: 401 });
    }
}
