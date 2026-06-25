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

const guestProfileSnapshot = (profile: {
    fullName: string;
    phone?: string | null;
    documentNumber?: string | null;
    verificationStatus?: string | null;
    notes?: string | null;
}) => ({
    fullName: profile.fullName,
    phone: profile.phone ?? null,
    documentNumber: profile.documentNumber ?? null,
    verificationStatus: profile.verificationStatus ?? null,
    notes: profile.notes ?? null
});

const changedProfileFields = (
    before: ReturnType<typeof guestProfileSnapshot>,
    after: ReturnType<typeof guestProfileSnapshot>
) => Object.keys(after).filter((field) => before[field as keyof typeof before] !== after[field as keyof typeof after]);

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
                fullName: true,
                phone: true,
                telegramId: true,
                documentNumber: true,
                verificationStatus: true,
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

        const nextDocumentNumber = normalizeOptionalText(payload.documentNumber);
        const documentChanged = (profile.documentNumber ?? null) !== nextDocumentNumber;
        const beforeSnapshot = guestProfileSnapshot(profile);

        const result = await prisma.$transaction(async (tx) => {
            const nextProfile = await tx.guestProfile.update({
                where: { id: profile.id },
                data: {
                    fullName: payload.fullName,
                    phone: normalizeOptionalText(payload.phone),
                    documentNumber: nextDocumentNumber,
                    notes: normalizeOptionalText(payload.notes),
                    ...(documentChanged && profile.verificationStatus === 'VERIFIED'
                        ? {
                            verificationStatus: 'NEEDS_REVIEW',
                            verifiedAt: null,
                            verifiedById: null,
                            verifiedHotelId: null
                        }
                        : {})
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

            const afterSnapshot = guestProfileSnapshot(nextProfile);
            const changedFields = changedProfileFields(beforeSnapshot, afterSnapshot);
            let auditLog: {
                id: string;
                action: string;
                actorType: string;
                actorLabel: string | null;
                changedFields: string[];
                createdAt: Date;
                hotel: { name: string } | null;
                actorUser: { displayName: string } | null;
            } | null = null;
            if (changedFields.length) {
                auditLog = await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: nextProfile.id,
                        hotelId: nextProfile.hotelId ?? [...accessibleHotelIds][0] ?? null,
                        actorUserId: session.id,
                        actorType: session.role === 'ADMIN' ? 'ADMIN' : 'MANAGER',
                        actorLabel: session.displayName,
                        action: 'PROFILE_UPDATED',
                        changedFields,
                        before: beforeSnapshot,
                        after: afterSnapshot
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
            }

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
            auditLog: result.auditLog
                ? {
                    id: result.auditLog.id,
                    action: result.auditLog.action,
                    actorType: result.auditLog.actorType,
                    actorName: result.auditLog.actorUser?.displayName ?? result.auditLog.actorLabel ?? null,
                    hotelName: result.auditLog.hotel?.name ?? null,
                    changedFields: result.auditLog.changedFields,
                    createdAt: result.auditLog.createdAt.toISOString()
                }
                : null
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to update guest profile');
    }
}
