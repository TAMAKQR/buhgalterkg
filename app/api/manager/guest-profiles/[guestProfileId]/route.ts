import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertHotelAccess, assertOperationalRole } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { getDatabaseActorUserId } from '@/lib/server/audit-actor';

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ guestProfileId: string }> }) {
    try {
        const { guestProfileId } = await params;
        const session = await getSessionUser(request);
        assertOperationalRole(session);
        const body = await request.json();
        const payload = updateGuestProfileSchema.parse(body);

        const profile = await prisma.guestProfile.findUnique({
            where: { id: guestProfileId },
            select: {
                id: true,
                hotelId: true,
                fullName: true,
                phone: true,
                telegramId: true,
                documentNumber: true,
                verificationStatus: true,
                notes: true,
                updatedAt: true
            }
        });

        if (!profile) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        if (!profile.hotelId) {
            return new NextResponse('Guest profile is not assigned to a hotel', { status: 403 });
        }
        assertHotelAccess(session, profile.hotelId);

        const nextDocumentNumber = normalizeOptionalText(payload.documentNumber);
        const documentChanged = (profile.documentNumber ?? null) !== nextDocumentNumber;
        const beforeSnapshot = guestProfileSnapshot(profile);
        const actorUserId = getDatabaseActorUserId(session);

        const result = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.guestProfile.updateMany({
                where: {
                    id: profile.id,
                    hotelId: profile.hotelId,
                    updatedAt: profile.updatedAt
                },
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
                }
            });

            if (updateResult.count !== 1) {
                throw new SessionError('Профиль уже изменён. Обновите данные и повторите', 409);
            }

            const nextProfile = await tx.guestProfile.findUniqueOrThrow({
                where: { id: profile.id },
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
                        hotelId: nextProfile.hotelId,
                        actorUserId,
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
