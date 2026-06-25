import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type GuestTelegramUpdate = {
    message?: {
        message_id: number;
        chat: { id: number };
        text?: string;
        from?: {
            first_name?: string;
            last_name?: string;
            username?: string;
        };
    };
};

type GuestTelegramUser = NonNullable<NonNullable<GuestTelegramUpdate['message']>['from']>;

const getGuestBotToken = () => process.env.GUEST_TELEGRAM_BOT_TOKEN;

const getGuestWebAppUrl = () => {
    if (process.env.GUEST_TELEGRAM_WEBAPP_URL) {
        return process.env.GUEST_TELEGRAM_WEBAPP_URL;
    }

    const baseUrl = process.env.TELEGRAM_WEBAPP_URL?.replace(/\/$/, '');
    return baseUrl ? `${baseUrl}/guest` : 'https://buhgalterkg.onrender.com/guest';
};

const isStartCommand = (text?: string | null) => /^\/start(?:@\w+)?(?:\s|$)/i.test(text?.trim() ?? '');

const sendGuestTelegramRequest = async (method: string, body: Record<string, unknown>) => {
    const token = getGuestBotToken();
    if (!token) {
        throw new Error('GUEST_TELEGRAM_BOT_TOKEN is not configured');
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Guest Telegram API ${method} failed: ${detail}`);
    }
};

const getDisplayName = (from?: GuestTelegramUser) => [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();

export async function POST(request: Request) {
    try {
        const update = (await request.json()) as GuestTelegramUpdate;
        const message = update.message;

        if (!message || !isStartCommand(message.text)) {
            return NextResponse.json({ ok: true });
        }

        const name = getDisplayName(message.from);
        const greeting = [
            name ? `Здравствуйте, ${name}.` : 'Здравствуйте.',
            'Добро пожаловать в GuestPass.',
            'Откройте приложение, чтобы создать гостевой QR для быстрого заселения.'
        ].join('\n');

        await sendGuestTelegramRequest('sendMessage', {
            chat_id: message.chat.id,
            text: greeting,
            reply_to_message_id: message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: 'Открыть GuestPass',
                            web_app: { url: getGuestWebAppUrl() }
                        }
                    ]
                ]
            }
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[guest-telegram-webhook-error]', error);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
