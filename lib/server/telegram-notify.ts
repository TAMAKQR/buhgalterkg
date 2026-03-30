import { PaymentMethod } from "@prisma/client";

import { env } from "@/lib/env";
import { formatDateTime, formatMoney } from "@/lib/timezone";

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

const formatDate = (value?: string | null, tz?: string) => formatDateTime(value, tz, undefined, "не указано");

const formatAmount = (value: number, currency?: string) => formatMoney(value, currency);

const escapeTelegramHtml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

const formatCleaningSnapshotLine = (line: string) => {
    const safeLine = escapeTelegramHtml(line);
    return /нужна уборка/i.test(line) ? `<b>${safeLine}</b>` : safeLine;
};

export type CheckInNotificationPayload = {
    hotelName: string;
    roomLabel: string;
    checkIn: string;
    checkOut?: string | null;
    amount: number;
    paymentMethod?: PaymentMethod | null;
    bookingSource?: string | null;
    paymentDetails?: {
        cashAmount?: number;
        cardAmount?: number;
        onlineAmount?: number;
    };
    timezone?: string;
    currency?: string;
};

export type StayExtensionNotificationPayload = {
    hotelName: string;
    roomLabel: string;
    guestName?: string | null;
    previousCheckOut: string;
    nextCheckOut: string;
    extraAmount: number;
    paymentDetails?: {
        cashAmount?: number;
        cardAmount?: number;
        onlineAmount?: number;
    };
    timezone?: string;
    currency?: string;
    managerName?: string | null;
};

export type StayTransferNotificationPayload = {
    hotelName: string;
    guestName?: string | null;
    fromRoomLabel: string;
    toRoomLabel: string;
    currentCheckOut?: string | null;
    timezone?: string;
    managerName?: string | null;
};

const formatPaymentDetails = (payload: {
    amount: number;
    paymentMethod?: PaymentMethod | null;
    paymentDetails?: {
        cashAmount?: number;
        cardAmount?: number;
        onlineAmount?: number;
    };
    currency?: string;
}) => {
    const cash = payload.paymentDetails?.cashAmount ?? (payload.paymentMethod === PaymentMethod.CASH ? payload.amount : 0);
    const card = payload.paymentDetails?.cardAmount ?? (payload.paymentMethod === PaymentMethod.CARD ? payload.amount : 0);
    const online = payload.paymentDetails?.onlineAmount ?? 0;
    const segments: string[] = [];

    if (cash) {
        segments.push(`наличные ${formatAmount(cash, payload.currency)}`);
    }
    if (card) {
        segments.push(`безнал ${formatAmount(card, payload.currency)}`);
    }
    if (online) {
        segments.push(`сайт ${formatAmount(online, payload.currency)}`);
    }
    if (segments.length) {
        return `Оплата: ${segments.join(' + ')}`;
    }
    return payload.paymentMethod ? `Оплата: ${payload.paymentMethod}` : 'Оплата: не указано';
};

export const notifyAdminAboutCheckIn = async (payload: CheckInNotificationPayload) => {
    if (!env.ADMIN_TELEGRAM_CHAT_ID) {
        return;
    }

    const tz = payload.timezone;
    const cur = payload.currency;

    const text = [
        "🛎 Новое заселение",
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        `Заезд: ${formatDate(payload.checkIn, tz)}`,
        `Выезд: ${formatDate(payload.checkOut, tz)}`,
        `Сумма: ${formatAmount(payload.amount, cur)}`,
        payload.bookingSource ? `Источник: ${payload.bookingSource}` : null,
        formatPaymentDetails(payload),
    ].filter(Boolean).join("\n");

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: env.ADMIN_TELEGRAM_CHAT_ID,
            text,
        }),
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to send Telegram notification: ${detail}`);
    }
};

export const notifyAdminAboutStayExtension = async (payload: StayExtensionNotificationPayload) => {
    if (!env.ADMIN_TELEGRAM_CHAT_ID) {
        return;
    }

    const tz = payload.timezone;
    const cur = payload.currency;

    const text = [
        '⏱ Продление номера',
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        payload.guestName ? `Гость: ${payload.guestName}` : null,
        `Было до: ${formatDate(payload.previousCheckOut, tz)}`,
        `Продлено до: ${formatDate(payload.nextCheckOut, tz)}`,
        `Доплата: ${formatAmount(payload.extraAmount, cur)}`,
        formatPaymentDetails({
            amount: payload.extraAmount,
            paymentDetails: payload.paymentDetails,
            currency: cur,
        }),
        payload.managerName ? `Менеджер: ${payload.managerName}` : null,
    ]
        .filter(Boolean)
        .join('\n');

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: env.ADMIN_TELEGRAM_CHAT_ID,
            text,
        }),
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to send Telegram extension notification: ${detail}`);
    }
};

export const notifyAdminAboutStayTransfer = async (payload: StayTransferNotificationPayload) => {
    if (!env.ADMIN_TELEGRAM_CHAT_ID) {
        return;
    }

    const text = [
        '🔁 Переселение гостя',
        `Отель: ${payload.hotelName}`,
        payload.guestName ? `Гость: ${payload.guestName}` : null,
        `Из номера: ${payload.fromRoomLabel}`,
        `В номер: ${payload.toRoomLabel}`,
        payload.currentCheckOut ? `Текущий выезд: ${formatDate(payload.currentCheckOut, payload.timezone)}` : null,
        payload.managerName ? `Менеджер: ${payload.managerName}` : null,
    ]
        .filter(Boolean)
        .join('\n');

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: env.ADMIN_TELEGRAM_CHAT_ID,
            text,
        }),
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to send Telegram transfer notification: ${detail}`);
    }
};

export type CleaningNotificationPayload = {
    chatId?: string | null;
    roomId: string;
    hotelName: string;
    roomLabel: string;
    managerName?: string | null;
    roomSnapshotLines?: string[];
};

export const notifyCleaningCrew = async (payload: CleaningNotificationPayload) => {
    if (!payload.chatId) {
        return;
    }

    const text = [
        "🧹 <b>Требуется уборка</b>",
        `<b>Отель:</b> ${escapeTelegramHtml(payload.hotelName)}`,
        `<b>Номер:</b> ${escapeTelegramHtml(payload.roomLabel)}`,
        payload.managerName ? `<b>Менеджер:</b> ${escapeTelegramHtml(payload.managerName)}` : null,
        "<b>Просьба подтвердить уборку после завершения.</b>",
        payload.roomSnapshotLines?.length ? '' : null,
        ...(payload.roomSnapshotLines ?? []).map(formatCleaningSnapshotLine)
    ]
        .filter(Boolean)
        .join("\n");

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: payload.chatId,
            text,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: 'УБРАНО',
                        callback_data: `clean:${payload.roomId}`,
                    }
                ]]
            }
        })
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to notify cleaning crew: ${detail}`);
    }
};

export type CleaningCheckInNotificationPayload = {
    chatId?: string | null;
    hotelName: string;
    roomLabel: string;
    guestName?: string | null;
    checkOut?: string | null;
    timezone?: string;
    roomSnapshotLines?: string[];
};

export const notifyCleaningCrewAboutCheckIn = async (payload: CleaningCheckInNotificationPayload) => {
    if (!payload.chatId) {
        return;
    }

    const tz = payload.timezone;

    const text = [
        "🛎 Гость заселился",
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        payload.guestName ? `Гость: ${payload.guestName}` : null,
        `Планируемый выезд: ${formatDate(payload.checkOut, tz)}`,
        "Пожалуйста, уберите номер перед выездом гостя.",
        payload.roomSnapshotLines?.length ? '' : null,
        ...(payload.roomSnapshotLines ?? [])
    ]
        .filter(Boolean)
        .join("\n");

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: payload.chatId,
            text
        })
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Failed to notify cleaning crew about check-in: ${detail}`);
    }
};
