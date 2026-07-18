import { z } from 'zod';

export const httpUrlSchema = z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
    }, 'Разрешены только ссылки http:// или https://');
