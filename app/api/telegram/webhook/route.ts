import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { RoomStatus } from '@prisma/client';

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export const dynamic = 'force-dynamic';

interface TelegramUpdate {
    message?: {
        message_id: number;
        chat: { id: number; title?: string; type: string };
        text?: string;
    };
    callback_query?: {
        id: string;
        data?: string;
        from?: {
            first_name?: string;
            last_name?: string;
            username?: string;
        };
        message?: {
            message_id: number;
            text?: string;
            chat: { id: number; title?: string; type: string };
        };
    };
}

const CLEAN_CALLBACK_PREFIX = 'clean:';
const CHAT_ID_COMMAND_PATTERN = /^\/(?:chatid|chat_id|id)(?:@[a-z0-9_]+)?(?:\s|$)/i;

const isChatIdCommand = (text?: string | null) => {
    if (!text) return false;
    const normalized = text.trim();
    return CHAT_ID_COMMAND_PATTERN.test(normalized);
};

const chatLabel = (chat: { id: number; title?: string; type: string }) => {
    if (chat.title) {
        return `${chat.title} (${chat.type})`;
    }
    return `Чат (${chat.type})`;
};

const sendTelegramRequest = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`${TELEGRAM_API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Telegram API ${method} failed: ${detail}`);
    }
};

const formatChatIdReply = (chat: { id: number; title?: string; type: string }) => [
    'ID текущего чата',
    `${chatLabel(chat)}: ${chat.id}`,
    '',
    'Команды: /id, /chatid',
    'Скопируйте это значение в настройках отеля (поле "ID чата уборки").'
].join('\n');

const formatCleanerName = (from?: { first_name?: string; last_name?: string; username?: string }) => {
    const fullName = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
    if (fullName) {
        return fullName;
    }
    if (from?.username) {
        return from.username;
    }
    return 'Горничная';
};

const appendCleanedLine = (text: string | undefined, roomLabel: string, cleanerName: string) => {
    const baseText = (text || '').trim();
    const confirmationLine = `${roomLabel} — ✅ убран (${cleanerName})`;

    if (!baseText) {
        return confirmationLine;
    }

    const roomLinePattern = new RegExp(`(^|\\n)${roomLabel.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} — [^\\n]*`, 'u');
    if (roomLinePattern.test(baseText)) {
        return baseText.replace(roomLinePattern, (_match, prefix) => `${prefix}${confirmationLine}`);
    }

    return `${baseText}\n${confirmationLine}`;
};

const handleCleaningCallback = async (callbackQuery: NonNullable<TelegramUpdate['callback_query']>) => {
    const callbackData = callbackQuery.data?.trim() || '';
    if (!callbackData.startsWith(CLEAN_CALLBACK_PREFIX)) {
        await sendTelegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
        });
        return;
    }

    const roomId = callbackData.slice(CLEAN_CALLBACK_PREFIX.length);
    if (!roomId) {
        await sendTelegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: 'Не удалось определить комнату',
            show_alert: true,
        });
        return;
    }

    const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, label: true, status: true, currentStayId: true },
    });

    if (!room) {
        await sendTelegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: 'Комната не найдена',
            show_alert: true,
        });
        return;
    }

    if (room.status !== RoomStatus.DIRTY) {
        await sendTelegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: `Комната ${room.label} уже не в статусе уборки`,
        });
        return;
    }

    await prisma.room.update({
        where: { id: room.id },
        data: {
            status: RoomStatus.AVAILABLE,
            currentStayId: room.currentStayId ?? null,
        },
    });

    const cleanerName = formatCleanerName(callbackQuery.from);
    const message = callbackQuery.message;

    if (message) {
        await sendTelegramRequest('editMessageText', {
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: appendCleanedLine(message.text, room.label, cleanerName),
            reply_markup: { inline_keyboard: [] },
        });
    }

    await sendTelegramRequest('answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: `Комната ${room.label} отмечена как убранная`,
    });
};

export async function POST(request: Request) {
    try {
        const update = (await request.json()) as TelegramUpdate;
        if (update.callback_query) {
            await handleCleaningCallback(update.callback_query);
            return NextResponse.json({ ok: true });
        }

        const message = update.message;
        if (!message || !isChatIdCommand(message.text)) {
            return NextResponse.json({ ok: true });
        }

        await sendTelegramRequest('sendMessage', {
            chat_id: message.chat.id,
            text: formatChatIdReply(message.chat),
            reply_to_message_id: message.message_id
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[telegram-webhook-error]', error);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
