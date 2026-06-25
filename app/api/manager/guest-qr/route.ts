import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const lookupSchema = z.object({
    code: z.string().trim().min(4).max(32)
});

const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '-');

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const body = await request.json();
        const payload = lookupSchema.parse(body);
        const code = normalizeCode(payload.code);

        const token = await prisma.guestQrToken.findUnique({
            where: { code },
            include: {
                hotel: {
                    select: {
                        id: true,
                        name: true,
                        guestQrEnabled: true
                    }
                },
                guestProfile: {
                    select: {
                        id: true,
                        hotelId: true,
                        fullName: true,
                        phone: true,
                        telegramId: true,
                        documentNumber: true,
                        notes: true,
                        stays: {
                            orderBy: { scheduledCheckIn: 'desc' },
                            take: 5,
                            select: {
                                id: true,
                                scheduledCheckIn: true,
                                scheduledCheckOut: true,
                                status: true,
                                hotel: {
                                    select: { name: true }
                                },
                                room: {
                                    select: { label: true }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!token || token.revokedAt) {
            return new NextResponse('Guest QR not found', { status: 404 });
        }

        if (token.expiresAt && token.expiresAt < new Date()) {
            return new NextResponse('Guest QR expired', { status: 410 });
        }

        if (token.hotelId) {
            assertHotelAccess(session, token.hotelId);
        }

        if (token.hotel && !token.hotel.guestQrEnabled) {
            return new NextResponse('Guest QR is disabled for this hotel', { status: 403 });
        }

        await prisma.guestQrToken.update({
            where: { id: token.id },
            data: { lastScannedAt: new Date() }
        });

        return NextResponse.json({
            guest: {
                id: token.guestProfile.id,
                fullName: token.guestProfile.fullName,
                phone: token.guestProfile.phone,
                telegramId: token.guestProfile.telegramId,
                documentNumber: token.guestProfile.documentNumber,
                notes: token.guestProfile.notes,
                hotelId: token.guestProfile.hotelId,
                hotelName: token.hotel?.name ?? null
            },
            recentStays: token.guestProfile.stays.map((stay) => ({
                id: stay.id,
                hotelName: stay.hotel.name,
                roomLabel: stay.room.label,
                status: stay.status,
                scheduledCheckIn: stay.scheduledCheckIn.toISOString(),
                scheduledCheckOut: stay.scheduledCheckOut.toISOString()
            }))
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to lookup guest QR');
    }
}
