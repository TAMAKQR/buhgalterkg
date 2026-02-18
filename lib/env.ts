import { z } from 'zod';

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    DATABASE_URL: z.string().url(),
    NEXT_PUBLIC_DEV_TELEGRAM_ID: z.string().optional(),
    NEXT_PUBLIC_DEV_ROLE: z.enum(['ADMIN', 'MANAGER']).optional(),
    ADMIN_TELEGRAM_CHAT_ID: z.string().optional()
});

export const env = envSchema.parse({
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_DEV_TELEGRAM_ID: process.env.NEXT_PUBLIC_DEV_TELEGRAM_ID,
    NEXT_PUBLIC_DEV_ROLE: process.env.NEXT_PUBLIC_DEV_ROLE,
    ADMIN_TELEGRAM_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID
});
