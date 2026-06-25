import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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
    notes: z.string().trim().max(300).optional().nullable()
});

const normalizeOptionalText = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
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

            const profile = existingProfile
                ? await tx.guestProfile.update({
                    where: { id: existingProfile.id },
                    data: {
                        fullName: payload.fullName,
                        phone: phone ?? existingProfile.phone,
                        telegramId: telegramId ?? existingProfile.telegramId,
                        documentNumber: documentNumber ?? existingProfile.documentNumber,
                        notes: notes ?? existingProfile.notes
                    }
                })
                : await tx.guestProfile.create({
                    data: {
                        hotelId,
                        fullName: payload.fullName,
                        phone,
                        telegramId,
                        documentNumber,
                        notes
                    }
                });

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
