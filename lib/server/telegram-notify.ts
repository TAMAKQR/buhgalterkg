import { PaymentMethod } from "@prisma/client";

import { env } from "@/lib/env";
import { formatDateTime, formatMoney } from "@/lib/timezone";

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

const formatDate = (value?: string | null, tz?: string) => formatDateTime(value, tz, undefined, "не указано");

const formatAmount = (value: number, currency?: string) => formatMoney(value, currency);

export type CheckInNotificationPayload = {
    hotelName: string;
    roomLabel: string;
    checkIn: string;
    checkOut?: string | null;
    amount: number;
    paymentMethod?: PaymentMethod | null;
    paymentDetails?: {
        cashAmount?: number;
        cardAmount?: number;
    };
    timezone?: string;
    currency?: string;
};

export const notifyAdminAboutCheckIn = async (payload: CheckInNotificationPayload) => {
    if (!env.ADMIN_TELEGRAM_CHAT_ID) {
        return;
    }

    const tz = payload.timezone;
    const cur = payload.currency;

    const paymentLines = (() => {
        const cash = payload.paymentDetails?.cashAmount ?? (payload.paymentMethod === PaymentMethod.CASH ? payload.amount : 0);
        const card = payload.paymentDetails?.cardAmount ?? (payload.paymentMethod === PaymentMethod.CARD ? payload.amount : 0);

        if (cash && card) {
            return `Оплата: наличные ${formatAmount(cash, cur)} + безнал ${formatAmount(card, cur)}`;
        }
        if (cash) {
            return `Оплата: наличные (${formatAmount(cash, cur)})`;
        }
        if (card) {
            return `Оплата: карта (${formatAmount(card, cur)})`;
        }
        return payload.paymentMethod ? `Оплата: ${payload.paymentMethod}` : 'Оплата: не указано';
    })();

    const text = [
        "🛎 Новое заселение",
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        `Заезд: ${formatDate(payload.checkIn, tz)}`,
        `Выезд: ${formatDate(payload.checkOut, tz)}`,
        `Сумма: ${formatAmount(payload.amount, cur)}`,
        paymentLines,
    ].join("\n");

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

export type CleaningNotificationPayload = {
    chatId?: string | null;
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
        "🧹 Требуется уборка",
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        payload.managerName ? `Менеджер: ${payload.managerName}` : null,
        "Просьба подтвердить уборку после завершения.",
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
