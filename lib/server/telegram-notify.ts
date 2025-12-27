import { PaymentMethod } from "@prisma/client";

import { env } from "@/lib/env";

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

const paymentLabels: Record<PaymentMethod, string> = {
    CARD: "Банковская карта",
    CASH: "Наличные",
};

const formatDate = (value?: string | null) => {
    if (!value) {
        return "не указано";
    }
    try {
        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(value));
    } catch (error) {
        console.error("Failed to format date", error);
        return value;
    }
};

const formatAmount = (value: number) => `${(value / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} KGS`;

export type CheckInNotificationPayload = {
    hotelName: string;
    roomLabel: string;
    checkIn: string;
    checkOut?: string | null;
    amount: number;
    paymentMethod: PaymentMethod;
};

export const notifyAdminAboutCheckIn = async (payload: CheckInNotificationPayload) => {
    if (!env.ADMIN_TELEGRAM_CHAT_ID) {
        return;
    }

    const text = [
        "🛎 Новое заселение",
        `Отель: ${payload.hotelName}`,
        `Номер: ${payload.roomLabel}`,
        `Заезд: ${formatDate(payload.checkIn)}`,
        `Выезд: ${formatDate(payload.checkOut)}`,
        `Сумма: ${formatAmount(payload.amount)}`,
        `Оплата: ${paymentLabels[payload.paymentMethod] ?? payload.paymentMethod}`,
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
