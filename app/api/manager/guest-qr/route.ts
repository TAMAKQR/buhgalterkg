import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelOperatorAccess, assertOperationalRole } from '@/lib/permissions';
import { handleApiError, SessionError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const lookupSchema = z.object({
    code: z.string().trim().min(4).max(32)
});

const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '-');

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertOperationalRole(session);
        const body = await request.json();
        const payload = lookupSchema.parse(body);
        const code = normalizeCode(payload.code);

        const tokenReference = await prisma.guestQrToken.findUnique({
            where: { code },
            select: {
                id: true,
                guestProfileId: true
            }
        });

        if (!tokenReference) {
            return new NextResponse('Guest QR not found', { status: 404 });
        }

        const result = await prisma.$transaction(async (tx) => {
            const lockedProfiles = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "GuestProfile"
                WHERE "id" = ${tokenReference.guestProfileId}
                FOR UPDATE
            `);
            if (lockedProfiles.length !== 1) {
                throw new SessionError('Guest profile not found', 404);
            }

            const lockedTokens = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "GuestQrToken"
                WHERE "id" = ${tokenReference.id}
                FOR UPDATE
            `);
            if (lockedTokens.length !== 1) {
                throw new SessionError('Guest QR not found', 404);
            }

            const token = await tx.guestQrToken.findUnique({
                where: { id: tokenReference.id },
                include: {
                    hotel: {
                        select: { id: true, name: true, guestQrEnabled: true }
                    },
                    guestProfile: {
                        select: {
                            id: true,
                            hotelId: true,
                            fullName: true,
                            phone: true,
                            telegramId: true,
                            documentNumber: true,
                            verificationStatus: true,
                            verifiedAt: true,
                            notes: true,
                            verifiedBy: { select: { displayName: true } },
                            verifiedHotel: { select: { name: true } }
                        }
                    }
                }
            });

            if (!token || token.revokedAt) {
                throw new SessionError('Guest QR not found', 404);
            }
            if (token.expiresAt && token.expiresAt < new Date()) {
                throw new SessionError('Guest QR expired', 410);
            }
            if (!token.hotelId || token.guestProfile.hotelId !== token.hotelId) {
                throw new SessionError('Guest QR is not assigned to this hotel', 403);
            }

            assertHotelOperatorAccess(session, token.hotelId);
            if (!token.hotel?.guestQrEnabled) {
                throw new SessionError('Guest QR is disabled for this hotel', 403);
            }

            const [recentStays, auditLogs] = await Promise.all([
                tx.roomStay.findMany({
                    where: { guestProfileId: token.guestProfile.id, hotelId: token.hotelId },
                    orderBy: { scheduledCheckIn: 'desc' },
                    take: 5,
                    select: {
                        id: true,
                        scheduledCheckIn: true,
                        scheduledCheckOut: true,
                        status: true,
                        hotel: { select: { name: true } },
                        room: { select: { label: true } }
                    }
                }),
                tx.guestProfileAuditLog.findMany({
                    where: { guestProfileId: token.guestProfile.id, hotelId: token.hotelId },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        id: true,
                        action: true,
                        actorType: true,
                        actorLabel: true,
                        changedFields: true,
                        createdAt: true,
                        hotel: { select: { name: true } },
                        actorUser: { select: { displayName: true } }
                    }
                })
            ]);

            await tx.guestQrToken.update({
                where: { id: token.id },
                data: { lastScannedAt: new Date() }
            });

            return {
                guest: {
                    id: token.guestProfile.id,
                    fullName: token.guestProfile.fullName,
                    phone: token.guestProfile.phone,
                    telegramId: token.guestProfile.telegramId,
                    documentNumber: token.guestProfile.documentNumber,
                    verificationStatus: token.guestProfile.verificationStatus,
                    verifiedAt: token.guestProfile.verifiedAt?.toISOString() ?? null,
                    verifiedByName: token.guestProfile.verifiedBy?.displayName ?? null,
                    verifiedHotelName: token.guestProfile.verifiedHotel?.name ?? null,
                    notes: token.guestProfile.notes,
                    hotelId: token.guestProfile.hotelId,
                    hotelName: token.hotel.name
                },
                recentStays: recentStays.map((stay) => ({
                    id: stay.id,
                    hotelName: stay.hotel.name,
                    roomLabel: stay.room.label,
                    status: stay.status,
                    scheduledCheckIn: stay.scheduledCheckIn.toISOString(),
                    scheduledCheckOut: stay.scheduledCheckOut.toISOString()
                })),
                auditLogs: auditLogs.map((entry) => ({
                    id: entry.id,
                    action: entry.action,
                    actorType: entry.actorType,
                    actorName: entry.actorUser?.displayName ?? entry.actorLabel ?? null,
                    hotelName: entry.hotel?.name ?? null,
                    changedFields: entry.changedFields,
                    createdAt: entry.createdAt.toISOString()
                }))
            };
        });

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to lookup guest QR');
    }
}
