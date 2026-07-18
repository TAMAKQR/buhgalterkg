import { NextRequest, NextResponse } from 'next/server';

import { buildShiftAnalysis } from '@/lib/ai-shift-analysis';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
    try {
        const { shiftId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const analysis = await buildShiftAnalysis(shiftId, 'admin', session, country);
        if (!analysis) {
            return new NextResponse('Shift not found', { status: 404 });
        }

        return NextResponse.json(analysis);
    } catch (error) {
        return handleApiError(error, 'Failed to analyze shift');
    }
}
