import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { guestProfileId: string } }) {
    try {
        const session = await getSessionUser(request);

        const profile = await prisma.guestProfile.findUnique({
            where: { id: params.guestProfileId },
            select: {
                id: true,
                hotelId: true,
                documentNumber: true,
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

        if (!profile.documentNumber?.trim()) {
            return new NextResponse('Document number is required before verification', { status: 400 });
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

        const verifiedHotelId = (() => {
            if (session.role === 'ADMIN') {
                return profile.hotelId && accessibleHotelIds.has(profile.hotelId)
                    ? profile.hotelId
                    : [...accessibleHotelIds][0];
            }

            const sessionHotelIds = new Set(session.hotels.map((hotel) => hotel.id));
            return [...accessibleHotelIds].find((hotelId) => sessionHotelIds.has(hotelId)) ?? null;
        })();

        if (!verifiedHotelId) {
            return new NextResponse('You are not assigned to this hotel', { status: 403 });
        }

        const updated = await prisma.guestProfile.update({
            where: { id: profile.id },
            data: {
                verificationStatus: 'VERIFIED',
                verifiedAt: new Date(),
                verifiedById: session.id,
                verifiedHotelId
            },
            select: {
                id: true,
                fullName: true,
                phone: true,
                telegramId: true,
                documentNumber: true,
                verificationStatus: true,
                verifiedAt: true,
                verifiedBy: {
                    select: { displayName: true }
                },
                verifiedHotel: {
                    select: { name: true }
                },
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
                verificationStatus: updated.verificationStatus,
                verifiedAt: updated.verifiedAt?.toISOString() ?? null,
                verifiedByName: updated.verifiedBy?.displayName ?? null,
                verifiedHotelName: updated.verifiedHotel?.name ?? null,
                notes: updated.notes,
                hotelId: updated.hotelId,
                hotelName: updated.hotel?.name ?? null
            }
        });
    } catch (error) {
        return handleApiError(error, 'Failed to verify guest profile');
    }
}
