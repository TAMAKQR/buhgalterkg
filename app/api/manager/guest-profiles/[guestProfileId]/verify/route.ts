import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, SessionError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess, assertOperationalRole } from '@/lib/permissions';
import { getDatabaseActorUserId } from '@/lib/server/audit-actor';

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ guestProfileId: string }> }) {
    try {
        const { guestProfileId } = await params;
        const session = await getSessionUser(request);
        assertOperationalRole(session);

        const profile = await prisma.guestProfile.findUnique({
            where: { id: guestProfileId },
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
                updatedAt: true
            }
        });

        if (!profile) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        if (!profile.documentNumber?.trim()) {
            return new NextResponse('Document number is required before verification', { status: 400 });
        }

        if (!profile.hotelId) {
            return new NextResponse('Guest profile is not assigned to a hotel', { status: 403 });
        }
        assertHotelAccess(session, profile.hotelId);
        const verifiedHotelId = profile.hotelId;

        const beforeSnapshot = guestProfileSnapshot(profile);
        const actorUserId = getDatabaseActorUserId(session);

        const result = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.guestProfile.updateMany({
                where: {
                    id: profile.id,
                    hotelId: profile.hotelId,
                    updatedAt: profile.updatedAt,
                    documentNumber: profile.documentNumber
                },
                data: {
                    verificationStatus: 'VERIFIED',
                    verifiedAt: new Date(),
                    verifiedById: actorUserId,
                    verifiedHotelId
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
                    actorUserId,
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
