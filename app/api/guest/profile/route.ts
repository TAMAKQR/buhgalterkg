import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/server/errors';
import { verifyTelegramWebAppInitData } from '@/lib/server/telegram-webapp';

export const dynamic = 'force-dynamic';

const guestProfileSchema = z.object({
    hotelId: z.string().cuid().optional().nullable(),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    telegramInitData: z.string().max(4096).optional().nullable(),
    telegramId: z.string().trim().max(64).optional().nullable(),
    documentNumber: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(300).optional().nullable(),
    consentAccepted: z.boolean(),
    consentVersion: z.string().trim().max(40).optional().nullable()
});

const CURRENT_CONSENT_VERSION = 'guestpass-2026-06-25';

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
    consentAcceptedAt?: Date | null;
    consentVersion?: string | null;
}) => ({
    fullName: profile.fullName,
    phone: profile.phone ?? null,
    documentNumber: profile.documentNumber ?? null,
    verificationStatus: profile.verificationStatus ?? null,
    notes: profile.notes ?? null,
    consentAcceptedAt: profile.consentAcceptedAt?.toISOString() ?? null,
    consentVersion: profile.consentVersion ?? null
});

const changedProfileFields = (
    before: ReturnType<typeof guestProfileSnapshot> | null,
    after: ReturnType<typeof guestProfileSnapshot>
) => {
    if (!before) {
        return Object.keys(after).filter((field) => after[field as keyof typeof after] !== null);
    }

    return Object.keys(after).filter((field) => before[field as keyof typeof before] !== after[field as keyof typeof after]);
};

const qrAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const createGuestCode = () => {
    const bytes = randomBytes(8);
    let value = '';

    for (let index = 0; index < 8; index += 1) {
        value += qrAlphabet[bytes[index] % qrAlphabet.length];
    }

    return `KG-${value.slice(0, 4)}-${value.slice(4)}`;
};

const createUniqueGuestCode = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = createGuestCode();
        const existing = await prisma.guestQrToken.findUnique({
            where: { code },
            select: { id: true }
        });

        if (!existing) {
            return code;
        }
    }

    throw new Error('Could not generate unique guest code');
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const payload = guestProfileSchema.parse(body);

        if (!payload.consentAccepted) {
            return new NextResponse('Personal data consent is required', { status: 400 });
        }

        const hotelId = payload.hotelId ?? null;
        if (hotelId) {
            const hotel = await prisma.hotel.findUnique({
                where: { id: hotelId },
                select: { id: true, guestQrEnabled: true }
            });

            if (!hotel) {
                return new NextResponse('Hotel not found', { status: 404 });
            }

            if (!hotel.guestQrEnabled) {
                return new NextResponse('Guest QR is disabled for this hotel', { status: 403 });
            }
        }

        const phone = normalizeOptionalText(payload.phone);
        const verifiedTelegram = (() => {
            const initData = normalizeOptionalText(payload.telegramInitData);
            const token = process.env.GUEST_TELEGRAM_BOT_TOKEN;

            if (!initData || !token) {
                return null;
            }

            return verifyTelegramWebAppInitData(initData, token);
        })();
        const telegramId = verifiedTelegram?.user?.id ? String(verifiedTelegram.user.id) : null;
        const documentNumber = normalizeOptionalText(payload.documentNumber);
        const notes = normalizeOptionalText(payload.notes);
        const consentVersion = normalizeOptionalText(payload.consentVersion) ?? CURRENT_CONSENT_VERSION;
        const consentAcceptedAt = new Date();
        const code = await createUniqueGuestCode();

        const result = await prisma.$transaction(async (tx) => {
            const existingByTelegram = telegramId
                ? await tx.guestProfile.findFirst({
                    where: {
                        hotelId,
                        telegramId
                    },
                    orderBy: { updatedAt: 'desc' }
                })
                : null;
            const existingByPhone = !existingByTelegram && phone
                ? await tx.guestProfile.findFirst({
                    where: {
                        hotelId,
                        phone
                    },
                    orderBy: { updatedAt: 'desc' }
                })
                : null;
            const existingProfile = existingByTelegram ?? existingByPhone;
            const beforeSnapshot = existingProfile ? guestProfileSnapshot(existingProfile) : null;
            const documentChanged = existingProfile
                ? (existingProfile.documentNumber ?? null) !== (documentNumber ?? existingProfile.documentNumber ?? null)
                : false;

            const profile = existingProfile
                ? await tx.guestProfile.update({
                    where: { id: existingProfile.id },
                    data: {
                        fullName: payload.fullName,
                        phone: phone ?? existingProfile.phone,
                        telegramId: telegramId ?? existingProfile.telegramId,
                        documentNumber: documentNumber ?? existingProfile.documentNumber,
                        notes: notes ?? existingProfile.notes,
                        consentAcceptedAt,
                        consentVersion,
                        ...(documentChanged && existingProfile.verificationStatus === 'VERIFIED'
                            ? {
                                verificationStatus: 'NEEDS_REVIEW',
                                verifiedAt: null,
                                verifiedById: null,
                                verifiedHotelId: null
                            }
                            : {})
                    }
                })
                : await tx.guestProfile.create({
                    data: {
                        hotelId,
                        fullName: payload.fullName,
                        phone,
                        telegramId,
                        documentNumber,
                        notes,
                        consentAcceptedAt,
                        consentVersion
                    }
                });

            const afterSnapshot = guestProfileSnapshot(profile);
            const changedFields = changedProfileFields(beforeSnapshot, afterSnapshot);
            if (!existingProfile || changedFields.length) {
                await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: profile.id,
                        hotelId,
                        actorType: 'GUEST',
                        actorLabel: telegramId ? `telegram:${telegramId}` : phone ? `phone:${phone}` : 'guest',
                        action: existingProfile ? 'PROFILE_UPDATED' : 'PROFILE_CREATED',
                        changedFields,
                        before: beforeSnapshot ?? Prisma.JsonNull,
                        after: afterSnapshot
                    }
                });
            }

            if (!existingProfile || existingProfile.consentVersion !== consentVersion || !existingProfile.consentAcceptedAt) {
                await tx.guestProfileAuditLog.create({
                    data: {
                        guestProfileId: profile.id,
                        hotelId,
                        actorType: 'GUEST',
                        actorLabel: telegramId ? `telegram:${telegramId}` : phone ? `phone:${phone}` : 'guest',
                        action: 'CONSENT_ACCEPTED',
                        changedFields: ['consentAcceptedAt', 'consentVersion'],
                        before: beforeSnapshot ? {
                            consentAcceptedAt: beforeSnapshot.consentAcceptedAt,
                            consentVersion: beforeSnapshot.consentVersion
                        } : Prisma.JsonNull,
                        after: {
                            consentAcceptedAt: afterSnapshot.consentAcceptedAt,
                            consentVersion: afterSnapshot.consentVersion
                        }
                    }
                });
            }

            const token = await tx.guestQrToken.create({
                data: {
                    guestProfileId: profile.id,
                    hotelId,
                    code,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                }
            });

            return { profile, token };
        });

        return NextResponse.json({
            guest: {
                id: result.profile.id,
                fullName: result.profile.fullName,
                phone: result.profile.phone,
                telegramId: result.profile.telegramId,
                documentNumber: result.profile.documentNumber,
                verificationStatus: result.profile.verificationStatus,
                verifiedAt: result.profile.verifiedAt?.toISOString() ?? null,
                consentAcceptedAt: result.profile.consentAcceptedAt?.toISOString() ?? null,
                consentVersion: result.profile.consentVersion,
                notes: result.profile.notes,
                hotelId: result.profile.hotelId
            },
            qr: {
                code: result.token.code,
                expiresAt: result.token.expiresAt?.toISOString() ?? null
            }
        }, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }

        return handleApiError(error, 'Failed to create guest profile');
    }
}
