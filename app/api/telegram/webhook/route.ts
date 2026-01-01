import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export const dynamic = 'force-dynamic';

interface TelegramUpdate {
    message?: {
        chat: { id: number; title?: string; type: string };
        text?: string;
    };
}

const isChatIdCommand = (text?: string | null) => {
    if (!text) return false;
    const normalized = text.trim();
    return normalized === '/chatid' || normalized.startsWith('/chatid@');
};

const chatLabel = (chat: { id: number; title?: string; type: string }) => {
    if (chat.title) {
        return `${chat.title} (${chat.type})`;
    }
    return `Чат (${chat.type})`;
};

export async function POST(request: Request) {
    try {
        const update = (await request.json()) as TelegramUpdate;
        const message = update.message;
        if (!message || !isChatIdCommand(message.text)) {
            return NextResponse.json({ ok: true });
        }

        const replyText = [
            'ℹ️ ID текущего чата',
            `${chatLabel(message.chat)}: ${message.chat.id}`,
            'Скопируйте это значение в настройках отеля (поле "ID чата уборки").'
        ].join('\n');

        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: message.chat.id,
                text: replyText
            })
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[telegram-webhook-error]', error);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
