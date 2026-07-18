import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { SessionError } from '@/lib/server/errors';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getDatabaseActorUserId } from '@/lib/server/audit-actor';

export const dynamic = 'force-dynamic';

const updateGuestProfileSchema = z.object({
    hotelId: z.string().cuid(),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    telegramId: z.string().trim().max(64).optional().nullable(),
    documentNumber: z.string().trim().max(80).optional().nullable(),
    verificationStatus: z.enum(['PENDING', 'VERIFIED', 'NEEDS_REVIEW']),
    notes: z.string().trim().max(300).optional().nullable(),
    consentAccepted: z.boolean().optional(),
    consentVersion: z.string().trim().max(40).optional().nullable()
});

const CURRENT_CONSENT_VERSION = 'admin-manual-2026-06-25';

const normalizeOptionalText = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

const guestProfileSelect = {
    id: true,
    fullName: true,
    phone: true,
    telegramId: true,
    documentNumber: true,
    verificationStatus: true,
    verifiedAt: true,
    consentAcceptedAt: true,
    consentVersion: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    hotel: {
        select: {
            id: true,
            name: true,
            timezone: true,
            currency: true
        }
    },
    verifiedBy: {
        select: { displayName: true }
    },
    verifiedHotel: {
        select: { name: true }
    },
    stays: {
        orderBy: { scheduledCheckIn: 'desc' as const },
        take: 1,
        select: {
            id: true,
            status: true,
            scheduledCheckIn: true,
            scheduledCheckOut: true,
            room: {
                select: { label: true }
            },
            hotel: {
                select: { name: true, timezone: true }
            }
        }
    },
    auditLogs: {
        orderBy: { createdAt: 'desc' as const },
        take: 3,
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
    }
};

const serializeGuestProfile = (profile: {
    id: string;
    fullName: string;
    phone: string | null;
    telegramId: string | null;
    documentNumber: string | null;
    verificationStatus: 'PENDING' | 'VERIFIED' | 'NEEDS_REVIEW';
    verifiedAt: Date | null;
    consentAcceptedAt: Date | null;
    consentVersion: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    hotel: { id: string; name: string; timezone: string | null; currency: string | null } | null;
    verifiedBy: { displayName: string } | null;
    verifiedHotel: { name: string } | null;
    stays: Array<{
        id: string;
        status: string;
        scheduledCheckIn: Date;
        scheduledCheckOut: Date;
        room: { label: string };
        hotel: { name: string; timezone: string | null };
    }>;
    auditLogs: Array<{
        id: string;
        action: string;
        actorType: string;
        actorLabel: string | null;
        changedFields: string[];
        createdAt: Date;
        hotel: { name: string } | null;
        actorUser: { displayName: string } | null;
    }>;
}) => ({
    id: profile.id,
    fullName: profile.fullName,
    phone: profile.phone,
    telegramId: profile.telegramId,
    documentNumber: profile.documentNumber,
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt?.toISOString() ?? null,
    verifiedByName: profile.verifiedBy?.displayName ?? null,
    verifiedHotelName: profile.verifiedHotel?.name ?? null,
    consentAcceptedAt: profile.consentAcceptedAt?.toISOString() ?? null,
    consentVersion: profile.consentVersion,
    notes: profile.notes,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    hotel: profile.hotel
        ? {
            id: profile.hotel.id,
            name: profile.hotel.name,
            timezone: profile.hotel.timezone,
            currency: profile.hotel.currency
        }
        : null,
    lastStay: profile.stays[0]
        ? {
            id: profile.stays[0].id,
            status: profile.stays[0].status,
            hotelName: profile.stays[0].hotel.name,
            roomLabel: profile.stays[0].room.label,
            scheduledCheckIn: profile.stays[0].scheduledCheckIn.toISOString(),
            scheduledCheckOut: profile.stays[0].scheduledCheckOut.toISOString(),
            timezone: profile.stays[0].hotel.timezone
        }
        : null,
    auditLogs: profile.auditLogs.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorType: entry.actorType,
        actorName: entry.actorUser?.displayName ?? entry.actorLabel ?? null,
        hotelName: entry.hotel?.name ?? null,
        changedFields: entry.changedFields,
        createdAt: entry.createdAt.toISOString()
    }))
});

const profileSnapshot = (profile: {
    hotelId?: string | null;
    fullName: string;
    phone?: string | null;
    telegramId?: string | null;
    documentNumber?: string | null;
    verificationStatus?: string | null;
    notes?: string | null;
    consentAcceptedAt?: Date | null;
    consentVersion?: string | null;
}) => ({
    hotelId: profile.hotelId ?? null,
    fullName: profile.fullName,
    phone: profile.phone ?? null,
    telegramId: profile.telegramId ?? null,
    documentNumber: profile.documentNumber ?? null,
    verificationStatus: profile.verificationStatus ?? null,
    notes: profile.notes ?? null,
    consentAcceptedAt: profile.consentAcceptedAt?.toISOString() ?? null,
    consentVersion: profile.consentVersion ?? null
});

const changedFields = (before: ReturnType<typeof profileSnapshot>, after: ReturnType<typeof profileSnapshot>) =>
    Object.keys(after).filter((field) => before[field as keyof typeof before] !== after[field as keyof typeof after]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ guestProfileId: string }> }) {
    try {
        const { guestProfileId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);
        const payload = updateGuestProfileSchema.parse(await request.json());

        const existing = await prisma.guestProfile.findFirst({
            where: { id: guestProfileId, hotel: { country } },
            select: {
                id: true,
                hotelId: true,
                fullName: true,
                phone: true,
                telegramId: true,
                documentNumber: true,
                verificationStatus: true,
                notes: true,
                consentAcceptedAt: true,
                consentVersion: true,
                updatedAt: true
            }
        });

        if (!existing) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        const hotelId = payload.hotelId;
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true }
        });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const before = profileSnapshot(existing);
        const nextDocumentNumber = normalizeOptionalText(payload.documentNumber);
        const shouldVerify = payload.verificationStatus === 'VERIFIED' && Boolean(nextDocumentNumber);
        if (payload.verificationStatus === 'VERIFIED' && !nextDocumentNumber) {
            return new NextResponse('Document number is required before verification', { status: 400 });
        }
        const consentAcceptedAt = payload.consentAccepted
            ? existing.consentAcceptedAt ?? new Date()
            : existing.consentAcceptedAt;
        const consentVersion = payload.consentAccepted
            ? existing.consentVersion ?? CURRENT_CONSENT_VERSION
            : existing.consentVersion;
        const actorUserId = getDatabaseActorUserId(session);

        const profile = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.guestProfile.updateMany({
                where: { id: existing.id, updatedAt: existing.updatedAt },
                data: {
                    hotelId,
                    fullName: payload.fullName,
                    phone: normalizeOptionalText(payload.phone),
                    telegramId: normalizeOptionalText(payload.telegramId),
                    documentNumber: nextDocumentNumber,
                    verificationStatus: shouldVerify ? 'VERIFIED' : payload.verificationStatus,
                    verifiedAt: shouldVerify ? new Date() : null,
                    verifiedById: shouldVerify ? actorUserId : null,
                    verifiedHotelId: shouldVerify ? hotelId : null,
                    notes: normalizeOptionalText(payload.notes),
                    consentAcceptedAt,
                    consentVersion
                }
            });

            if (updateResult.count !== 1) {
                throw new SessionError('Профиль уже изменён. Обновите данные и повторите', 409);
            }

            if (existing.hotelId !== hotelId) {
                await tx.guestQrToken.updateMany({
                    where: { guestProfileId: existing.id, revokedAt: null },
                    data: { revokedAt: new Date() }
                });
            }

            const updated = await tx.guestProfile.findUniqueOrThrow({
                where: { id: existing.id },
                select: guestProfileSelect
            });

            const after = profileSnapshot({
                hotelId: updated.hotel?.id ?? null,
                fullName: updated.fullName,
                phone: updated.phone,
                telegramId: updated.telegramId,
                documentNumber: updated.documentNumber,
                verificationStatus: updated.verificationStatus,
                notes: updated.notes,
                consentAcceptedAt: updated.consentAcceptedAt,
                consentVersion: updated.consentVersion
            });
            const fields = changedFields(before, after);

            if (fields.length) {
                await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: updated.id,
                        hotelId,
                        actorUserId,
                        actorType: 'ADMIN',
                        actorLabel: session.displayName,
                        action: 'PROFILE_UPDATED',
                        changedFields: fields,
                        before,
                        after
                    }
                });
            }

            if (before.verificationStatus !== 'VERIFIED' && after.verificationStatus === 'VERIFIED') {
                await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: updated.id,
                        hotelId,
                        actorUserId,
                        actorType: 'ADMIN',
                        actorLabel: session.displayName,
                        action: 'DOCUMENT_VERIFIED',
                        changedFields: ['verificationStatus', 'verifiedAt', 'verifiedById', 'verifiedHotelId']
                    }
                });
            }

            return updated;
        });

        return NextResponse.json({ guest: serializeGuestProfile(profile) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to update guest profile');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ guestProfileId: string }> }) {
    try {
        const { guestProfileId } = await params;
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const existing = await prisma.guestProfile.findFirst({
            where: { id: guestProfileId, hotel: { country } },
            select: { id: true }
        });

        if (!existing) {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        await prisma.guestProfile.delete({
            where: { id: existing.id }
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return new NextResponse('Guest profile not found', { status: 404 });
        }

        return handleApiError(error, 'Failed to delete guest profile');
    }
}
