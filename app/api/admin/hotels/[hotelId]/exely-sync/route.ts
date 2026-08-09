import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { getSessionUser } from '@/lib/server/session';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getExelySyncStatus, syncExelyReservationsCoalesced, verifyExelyCredentials } from '@/lib/server/exely-sync';
import { decryptIntegrationCredential, encryptIntegrationCredential } from '@/lib/server/integration-credentials';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
    since: z.string().datetime().optional(),
});

const connectionSchema = z.object({
    enabled: z.boolean(),
    propertyId: z.string().trim().min(1, 'Укажите property_id').max(100),
    clientId: z.string().trim().min(1, 'Укажите client_id').max(300),
    clientSecret: z.string().trim().min(8, 'client_secret слишком короткий').max(2000).optional(),
});

async function assertHotelAccess(request: NextRequest, hotelId: string) {
    const session = await getSessionUser(request);
    assertAdmin(session);
    const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, country: getCountryFromRequest(request) }, select: { id: true } });
    if (!hotel) throw new Error('Объект не найден');
}

export async function GET(request: NextRequest, context: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await context.params;
        await assertHotelAccess(request, hotelId);
        return NextResponse.json(await getExelySyncStatus(hotelId));
    } catch (error) {
        return handleApiError(error, 'Failed to get Exely sync status');
    }
}

export async function POST(request: NextRequest, context: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await context.params;
        await assertHotelAccess(request, hotelId);
        const body = bodySchema.parse(await request.json().catch(() => ({})));
        const since = body.since ? new Date(body.since) : new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        const result = await syncExelyReservationsCoalesced(hotelId, since);
        return NextResponse.json({ result, status: await getExelySyncStatus(hotelId) });
    } catch (error) {
        return handleApiError(error, 'Failed to sync Exely reservations');
    }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await context.params;
        await assertHotelAccess(request, hotelId);
        const body = connectionSchema.parse(await request.json());
        const existing = await prisma.exelyConnection.findUnique({
            where: { hotelId },
            select: { clientSecretEncrypted: true, propertyId: true, clientId: true },
        });

        const clientSecret = body.clientSecret
            ?? (existing ? decryptIntegrationCredential(existing.clientSecretEncrypted) : null);
        if (!clientSecret) {
            return new NextResponse('Введите client_secret', { status: 400 });
        }

        if (body.enabled) {
            await verifyExelyCredentials({
                propertyId: body.propertyId,
                clientId: body.clientId,
                clientSecret,
            });
        }

        const clientSecretEncrypted = body.clientSecret
            ? encryptIntegrationCredential(body.clientSecret)
            : existing?.clientSecretEncrypted;
        if (!clientSecretEncrypted) {
            return new NextResponse('Введите client_secret', { status: 400 });
        }

        await prisma.exelyConnection.upsert({
            where: { hotelId },
            create: {
                hotelId,
                isEnabled: body.enabled,
                propertyId: body.propertyId,
                clientId: body.clientId,
                clientSecretEncrypted,
            },
            update: {
                isEnabled: body.enabled,
                propertyId: body.propertyId,
                clientId: body.clientId,
                clientSecretEncrypted,
                ...((existing?.propertyId !== body.propertyId || existing?.clientId !== body.clientId)
                    ? { reservationContinueToken: null }
                    : {}),
            },
        });

        return NextResponse.json(await getExelySyncStatus(hotelId));
    } catch (error) {
        return handleApiError(error, 'Failed to save Exely connection');
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ hotelId: string }> }) {
    try {
        const { hotelId } = await context.params;
        await assertHotelAccess(request, hotelId);
        await prisma.exelyConnection.deleteMany({ where: { hotelId } });
        return NextResponse.json(await getExelySyncStatus(hotelId));
    } catch (error) {
        return handleApiError(error, 'Failed to delete Exely connection');
    }
}
