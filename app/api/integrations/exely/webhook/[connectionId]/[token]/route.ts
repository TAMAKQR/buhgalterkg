import { after, NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncExelyReservationsCoalesced } from '@/lib/server/exely-sync';
import { validateExelyWebhookToken } from '@/lib/server/exely-webhook-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

type RouteContext = { params: Promise<{ connectionId: string; token: string }> };

const findConnection = async (context: RouteContext) => {
    const { connectionId, token } = await context.params;
    const connection = await prisma.exelyConnection.findUnique({
        where: { id: connectionId },
        select: { id: true, hotelId: true, isEnabled: true, clientSecretEncrypted: true },
    });
    if (!connection || !validateExelyWebhookToken(connectionId, connection.clientSecretEncrypted, token)) return null;
    return connection;
};

const hiddenNotFound = () => new NextResponse('Not found', { status: 404 });

export async function GET(_request: NextRequest, context: RouteContext) {
    const connection = await findConnection(context);
    if (!connection) return hiddenNotFound();
    return NextResponse.json({ ok: true, enabled: connection.isEnabled });
}

export async function HEAD(_request: NextRequest, context: RouteContext) {
    const connection = await findConnection(context);
    return new NextResponse(null, { status: connection ? 200 : 404 });
}

export async function POST(request: NextRequest, context: RouteContext) {
    const connection = await findConnection(context);
    if (!connection) return hiddenNotFound();

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 256_000) {
        return new NextResponse('Payload too large', { status: 413 });
    }

    // Read the request before returning so that Exely can safely close the connection.
    // Booking data is always fetched from the authenticated API rather than trusted
    // directly from the unauthenticated webhook body.
    const payload = await request.text();
    if (Buffer.byteLength(payload, 'utf8') > 256_000) {
        return new NextResponse('Payload too large', { status: 413 });
    }

    const receivedAt = new Date();
    await prisma.exelyConnection.update({
        where: { id: connection.id },
        data: { lastWebhookAt: receivedAt, lastWebhookError: null },
    });

    if (!connection.isEnabled) {
        return NextResponse.json({ accepted: true, ignored: 'connection_disabled' });
    }

    after(async () => {
        try {
            // Exely recommends falling back two days when restoring an incremental
            // feed. The saved continueToken normally means only new changes load.
            const since = new Date(receivedAt.getTime() - 2 * 24 * 60 * 60 * 1000);
            const result = await syncExelyReservationsCoalesced(connection.hotelId, since, { useContinueToken: true });
            if (result.failed.length) {
                throw new Error(`Не обработано бронирований: ${result.failed.length}`);
            }
            await prisma.exelyConnection.updateMany({
                where: { id: connection.id },
                data: { lastWebhookError: null },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
            console.error('[exely-webhook-sync-error]', { connectionId: connection.id, message });
            await prisma.exelyConnection.updateMany({
                where: { id: connection.id },
                data: { lastWebhookError: message.slice(0, 2_000) },
            });
        }
    });

    return NextResponse.json({ accepted: true });
}
