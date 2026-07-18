import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { handleApiError } from '@/lib/server/errors';
import { buildBusinessAnalysis } from '@/lib/ai-business-analysis';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
    period: z.enum(['week', 'month', 'custom']).optional(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);
        const payload = requestSchema.parse(await request.json().catch(() => ({})));

        const analysis = await buildBusinessAnalysis(hotelId, session, country, payload);
        if (!analysis) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        return NextResponse.json(analysis);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to build hotel AI analysis');
    }
}
