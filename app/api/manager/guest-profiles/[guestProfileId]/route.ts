import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertHotelAccess } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const updateGuestProfileSchema = z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    documentNumber: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(300).optional().nullable()
});

const normalizeOptionalText = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

export async function PATCH(request: NextRequest, { params }: { params: { guestProfileId: string } }) {
    try {
        const session = await getSessionUser(request);
        const body = await request.json();
        const payload = updateGuestProfileSchema.parse(body);

        const profile = await prisma.guestProfile.findUnique({
            where: { id: params.guestProfileId },
            select: {
                id: true,
                hotelId: true,
                telegramId: true,
                qrTokens: {
                    where: { revokedAt: null },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: { hotelId: true }
                }
            }
        });

        if (!profile) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        const accessibleHotelIds = new Set<string>();
        if (profile.hotelId) {
            accessibleHotelIds.add(profile.hotelId);
        }
        for (const token of profile.qrTokens) {
            if (token.hotelId) {
                accessibleHotelIds.add(token.hotelId);
            }
        }

        if (!accessibleHotelIds.size) {
            return new NextResponse('Guest profile is not assigned to a hotel', { status: 403 });
        }

        if (session.role !== 'ADMIN') {
            const sessionHotelIds = new Set(session.hotels.map((hotel) => hotel.id));
            const hasAccess = [...accessibleHotelIds].some((hotelId) => sessionHotelIds.has(hotelId));

            if (!hasAccess) {
                return new NextResponse('You are not assigned to this hotel', { status: 403 });
            }
        } else {
            for (const hotelId of accessibleHotelIds) {
                assertHotelAccess(session, hotelId);
            }
        }

        const updated = await prisma.guestProfile.update({
            where: { id: profile.id },
            data: {
                fullName: payload.fullName,
                phone: normalizeOptionalText(payload.phone),
                documentNumber: normalizeOptionalText(payload.documentNumber),
                notes: normalizeOptionalText(payload.notes)
            },
            select: {
                id: true,
                fullName: true,
                phone: true,
                telegramId: true,
                documentNumber: true,
                notes: true,
                hotelId: true,
                hotel: {
                    select: { name: true }
                }
            }
        });

        return NextResponse.json({
            guest: {
                id: updated.id,
                fullName: updated.fullName,
                phone: updated.phone,
                telegramId: updated.telegramId,
                documentNumber: updated.documentNumber,
                notes: updated.notes,
                hotelId: updated.hotelId,
                hotelName: updated.hotel?.name ?? null
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to update guest profile');
    }
}
