import { NextResponse } from 'next/server';
import { resolveDevSession, resolveSessionFromInitData } from '@/lib/auth';
import { resolveManualAdminSession } from '@/lib/server/manual-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        if (body.initData) {
            const session = await resolveSessionFromInitData(body.initData);
            return NextResponse.json(session);
        }

        if (body.devOverride) {
            if (process.env.NODE_ENV === 'production') {
                return new NextResponse('Dev override is disabled in production', { status: 400 });
            }
            const session = await resolveDevSession(body.devOverride);
            return NextResponse.json(session);
        }

        if (body.manualToken) {
            const session = resolveManualAdminSession(body.manualToken);
            if (!session) {
                return new NextResponse('Недействительная сессия', { status: 401 });
            }
            return NextResponse.json(session);
        }

        return new NextResponse('initData, devOverride или manualToken обязательны', { status: 400 });
    } catch (error) {
        console.error(error);
        return new NextResponse('Failed to resolve Telegram session', { status: 500 });
    }
}
