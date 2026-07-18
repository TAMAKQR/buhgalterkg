import { z } from 'zod';

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(32).optional(),
    GUEST_TELEGRAM_WEBHOOK_SECRET: z.string().min(32).optional(),
    DATABASE_URL: z.string().url(),
    ADMIN_TELEGRAM_CHAT_ID: z.string().optional()
});

export const env = envSchema.parse({
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    GUEST_TELEGRAM_WEBHOOK_SECRET: process.env.GUEST_TELEGRAM_WEBHOOK_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_TELEGRAM_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID
});
