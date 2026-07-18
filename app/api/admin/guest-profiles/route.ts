import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';
import { getCountryFromRequest } from '@/lib/server/request-country';
import { getDatabaseActorUserId } from '@/lib/server/audit-actor';

export const dynamic = 'force-dynamic';

const guestProfilesQuerySchema = z.object({
    hotelId: z.string().cuid().optional(),
    status: z.enum(['PENDING', 'VERIFIED', 'NEEDS_REVIEW']).optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80)
});

const createGuestProfileSchema = z.object({
    hotelId: z.string().cuid(),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    telegramId: z.string().trim().max(64).optional().nullable(),
    documentNumber: z.string().trim().max(80).optional().nullable(),
    verificationStatus: z.enum(['PENDING', 'VERIFIED', 'NEEDS_REVIEW']).default('PENDING'),
    notes: z.string().trim().max(300).optional().nullable(),
    consentAccepted: z.boolean(),
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

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const searchParams = request.nextUrl.searchParams;
        const query = guestProfilesQuerySchema.parse({
            hotelId: searchParams.get('hotelId') || undefined,
            status: searchParams.get('status') || undefined,
            search: searchParams.get('search') || undefined,
            limit: searchParams.get('limit') || undefined
        });

        const search = query.search?.trim();
        const profiles = await prisma.guestProfile.findMany({
            where: {
                hotel: { country },
                ...(query.hotelId ? { hotelId: query.hotelId } : {}),
                ...(query.status ? { verificationStatus: query.status } : {}),
                ...(search
                    ? {
                        OR: [
                            { fullName: { contains: search, mode: 'insensitive' } },
                            { phone: { contains: search, mode: 'insensitive' } },
                            { documentNumber: { contains: search, mode: 'insensitive' } },
                            { telegramId: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                    : {})
            },
            orderBy: { updatedAt: 'desc' },
            take: query.limit,
            select: guestProfileSelect
        });

        return NextResponse.json({
            guests: profiles.map(serializeGuestProfile)
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to load guest profiles');
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);
        const country = getCountryFromRequest(request);

        const payload = createGuestProfileSchema.parse(await request.json());
        if (!payload.consentAccepted) {
            return new NextResponse('Personal data consent is required', { status: 400 });
        }

        const hotelId = payload.hotelId;
        const hotel = await prisma.hotel.findFirst({
            where: { id: hotelId, country },
            select: { id: true }
        });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const consentAcceptedAt = new Date();
        const consentVersion = CURRENT_CONSENT_VERSION;
        const shouldVerify = payload.verificationStatus === 'VERIFIED' && Boolean(normalizeOptionalText(payload.documentNumber));
        if (payload.verificationStatus === 'VERIFIED' && !shouldVerify) {
            return new NextResponse('Document number is required before verification', { status: 400 });
        }
        const actorUserId = getDatabaseActorUserId(session);

        const profile = await prisma.$transaction(async (tx) => {
            const created = await tx.guestProfile.create({
                data: {
                    hotelId,
                    fullName: payload.fullName,
                    phone: normalizeOptionalText(payload.phone),
                    telegramId: normalizeOptionalText(payload.telegramId),
                    documentNumber: normalizeOptionalText(payload.documentNumber),
                    verificationStatus: shouldVerify ? 'VERIFIED' : payload.verificationStatus,
                    verifiedAt: shouldVerify ? new Date() : null,
                    verifiedById: shouldVerify ? actorUserId : null,
                    verifiedHotelId: shouldVerify ? hotelId : null,
                    notes: normalizeOptionalText(payload.notes),
                    consentAcceptedAt,
                    consentVersion
                },
                select: guestProfileSelect
            });

            await tx.guestProfileAuditLog.create({
                data: {
                    guestProfileId: created.id,
                    hotelId,
                    actorUserId,
                    actorType: 'ADMIN',
                    actorLabel: session.displayName,
                    action: 'PROFILE_CREATED',
                    changedFields: ['fullName', 'phone', 'telegramId', 'documentNumber', 'verificationStatus', 'notes', 'consentAcceptedAt', 'consentVersion'],
                    before: Prisma.JsonNull,
                    after: {
                        fullName: created.fullName,
                        phone: created.phone,
                        telegramId: created.telegramId,
                        documentNumber: created.documentNumber,
                        verificationStatus: created.verificationStatus,
                        notes: created.notes,
                        consentAcceptedAt: created.consentAcceptedAt?.toISOString() ?? null,
                        consentVersion: created.consentVersion
                    }
                }
            });

            if (shouldVerify) {
                await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: created.id,
                        hotelId,
                        actorUserId,
                        actorType: 'ADMIN',
                        actorLabel: session.displayName,
                        action: 'DOCUMENT_VERIFIED',
                        changedFields: ['verificationStatus', 'verifiedAt', 'verifiedById', 'verifiedHotelId']
                    }
                });
            }

            return created;
        });

        return NextResponse.json({ guest: serializeGuestProfile(profile) }, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to create guest profile');
    }
}
