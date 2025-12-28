const BISHKEK_TIMEZONE = "Asia/Bishkek";
const BISHKEK_OFFSET = "+06:00";

const defaultDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BISHKEK_TIMEZONE,
});

const inputFormatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BISHKEK_TIMEZONE,
});

const ensureDate = (value: Date | string | number) => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const appendTimezone = (value: string) => {
    if (!value) {
        return value;
    }
    return value.includes("+") || value.endsWith("Z") ? value : `${value}${BISHKEK_OFFSET}`;
};

export const formatBishkekDateTime = (
    value?: Date | string | number | null,
    options?: Intl.DateTimeFormatOptions,
    fallback = "—",
) => {
    if (value == null) {
        return fallback;
    }
    const date = ensureDate(value);
    if (!date) {
        return fallback;
    }
    if (!options) {
        return defaultDateTimeFormatter.format(date);
    }
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: BISHKEK_TIMEZONE }).format(date);
};

export const formatBishkekInputValue = (value?: Date | string | number | null) => {
    if (value == null) {
        return "";
    }
    const date = ensureDate(value);
    if (!date) {
        return "";
    }
    const parts = inputFormatter.formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
};

export const parseBishkekInputValue = (value?: string | null) => {
    if (!value?.trim()) {
        return undefined;
    }
    const normalized = value.includes(":") && value.length >= 16 ? value : `${value}:00`;
    const date = new Date(appendTimezone(normalized));
    return Number.isNaN(date.getTime()) ? undefined : date;
};

export const parseBishkekDateOnly = (value?: string | null, endOfDay = false) => {
    if (!value?.trim()) {
        return undefined;
    }
    const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
    const date = new Date(`${value}${suffix}${BISHKEK_OFFSET}`);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

export { BISHKEK_TIMEZONE };
