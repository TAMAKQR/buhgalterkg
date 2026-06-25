import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';
import { getSessionUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const guestProfilesQuerySchema = z.object({
    hotelId: z.string().cuid().optional(),
    status: z.enum(['PENDING', 'VERIFIED', 'NEEDS_REVIEW']).optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80)
});

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

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
            select: {
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
                    orderBy: { scheduledCheckIn: 'desc' },
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
                    orderBy: { createdAt: 'desc' },
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
            }
        });

        return NextResponse.json({
            guests: profiles.map((profile) => ({
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
            }))
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to load guest profiles');
    }
}
