import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const guestProfileSnapshot = (profile: {
    fullName: string;
    phone?: string | null;
    documentNumber?: string | null;
    verificationStatus?: string | null;
    verifiedAt?: Date | null;
    verifiedById?: string | null;
    verifiedHotelId?: string | null;
    notes?: string | null;
}) => ({
    fullName: profile.fullName,
    phone: profile.phone ?? null,
    documentNumber: profile.documentNumber ?? null,
    verificationStatus: profile.verificationStatus ?? null,
    verifiedAt: profile.verifiedAt?.toISOString() ?? null,
    verifiedById: profile.verifiedById ?? null,
    verifiedHotelId: profile.verifiedHotelId ?? null,
    notes: profile.notes ?? null
});

export async function POST(request: NextRequest, { params }: { params: { guestProfileId: string } }) {
    try {
        const session = await getSessionUser(request);

        const profile = await prisma.guestProfile.findUnique({
            where: { id: params.guestProfileId },
            select: {
                id: true,
                hotelId: true,
                fullName: true,
                phone: true,
                documentNumber: true,
                verificationStatus: true,
                verifiedAt: true,
                verifiedById: true,
                verifiedHotelId: true,
                notes: true,
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

        const beforeSnapshot = guestProfileSnapshot(profile);

        const result = await prisma.$transaction(async (tx) => {
            const nextProfile = await tx.guestProfile.update({
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
                    verifiedById: true,
                    verifiedHotelId: true,
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

            const auditLog = await tx.guestProfileAuditLog.create({
                data: {
                    guestProfileId: nextProfile.id,
                    hotelId: verifiedHotelId,
                    actorUserId: session.id,
                    actorType: session.role === 'ADMIN' ? 'ADMIN' : 'MANAGER',
                    actorLabel: session.displayName,
                    action: 'DOCUMENT_VERIFIED',
                    changedFields: ['verificationStatus', 'verifiedAt', 'verifiedById', 'verifiedHotelId'],
                    before: beforeSnapshot,
                    after: guestProfileSnapshot(nextProfile)
                },
                select: {
                    id: true,
                    action: true,
                    actorType: true,
                    actorLabel: true,
                    changedFields: true,
                    createdAt: true,
                    hotel: {
                        select: { name: true }
                    },
                    actorUser: {
                        select: { displayName: true }
                    }
                }
            });

            return { profile: nextProfile, auditLog };
        });
        const updated = result.profile;

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
            },
            auditLog: {
                id: result.auditLog.id,
                action: result.auditLog.action,
                actorType: result.auditLog.actorType,
                actorName: result.auditLog.actorUser?.displayName ?? result.auditLog.actorLabel ?? null,
                hotelName: result.auditLog.hotel?.name ?? null,
                changedFields: result.auditLog.changedFields,
                createdAt: result.auditLog.createdAt.toISOString()
            }
        });
    } catch (error) {
        return handleApiError(error, 'Failed to verify guest profile');
    }
}
