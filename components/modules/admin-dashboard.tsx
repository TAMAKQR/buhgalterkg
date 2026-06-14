"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { useToast } from '@/components/ui/toast';
import useSWR from "swr";
import {
    Activity,
    BarChart3,
    Building2,
    CircleDollarSign,
    Download,
    Hotel,
    LogOut,
    Settings2,
    SlidersHorizontal,
    Users,
    type LucideIcon,
} from "lucide-react";
import { useCountryContext } from '@/hooks/useCountryContext';

import { getCountryConfig, type CountryCode } from "@/lib/country";
import type { SessionUser } from "@/lib/types";
import { formatDateTime as fdt, formatMoney } from "@/lib/timezone";
import { isCollectionLedgerEntry } from "@/lib/ledger";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, TextArea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type PaymentSplit = {
    cash: number;
    card: number;
};

type ExpenseEntry = {
    id: string;
    amount: number;
    method: "CASH" | "CARD";
    note?: string | null;
    categoryName?: string | null;
    recordedAt: string;
    entryType: "CASH_OUT" | "MANAGER_PAYOUT" | "ADJUSTMENT";
    managerName?: string | null;
    hotelId?: string;
    hotelName?: string;
    currency?: string | null;
    timezone?: string | null;
};

type AdminHotelSummary = {
    id: string;
    name: string;
    address?: string | null;
    country?: string | null;
    usesExtranets?: boolean | null;
    extranetNames?: string[];
    hasMealPlan?: boolean | null;
    financialCycleStartDay?: number | null;
    managerSharePct?: number | null;
    notes?: string | null;
    cleaningChatId?: string | null;
    timezone?: string | null;
    currency?: string | null;
    monthlyPayrollCost?: number | null;
    monthlyRentCost?: number | null;
    monthlyUtilitiesCost?: number | null;
    monthlySuppliesCost?: number | null;
    monthlyOtherCost?: number | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        id: string;
        displayName: string | null;
        telegramId?: string | null;
        username?: string | null;
        role: string;
        pinCode?: string | null;
    }>;
    activeShift: null | {
        manager?: string | null;
        openedAt: string;
        openingCash?: number | null;
        number?: number | null;
    };
    ledger: {
        cashIn: number;
        cashInBreakdown: PaymentSplit;
        cashOut: number;
        cashOutBreakdown: PaymentSplit;
        collections?: number;
    };
    recentExpenses?: ExpenseEntry[];
};

type AdminOverview = {
    display: {
        country: CountryCode;
        timezone: string;
        currency: string;
    };
    totals: {
        cashIn: number;
        cashInBreakdown: PaymentSplit;
        cashOut: number;
        cashOutBreakdown: PaymentSplit;
        collections: number;
        collectionsBreakdown: PaymentSplit;
        payouts: number;
        payoutsBreakdown: PaymentSplit;
        adjustments: number;
        adjustmentsBreakdown: PaymentSplit;
        netCash: number;
    };
    occupancy: {
        hotels: number;
        rooms: number;
        occupiedRooms: number;
        rate: number;
    };
    shifts: {
        active: number;
        lastOpenedAt: string | null;
    };
    businessTarget?: {
        hotelsInScope: number;
        periodLabel: string;
        cycleStartDay: number | null;
        mixedCycleDays: boolean;
        costs: {
            payroll: number;
            rent: number;
            utilities: number;
            supplies: number;
            other: number;
        };
        monthlyRequiredRevenue: number;
        monthRevenue: number;
        remainingToTarget: number;
        coveredPct: number;
        elapsedDays: number | null;
        totalDays: number | null;
        remainingDays: number | null;
        currentDailyAverage: number;
        requiredDailyAverage: number;
        projectedRevenue: number;
        onTrack: boolean;
    };
    dailySeries?: Array<{ date: string; cashIn: number; cashOut: number; collections: number }>;
    recentExpenses?: ExpenseEntry[];
};

type AdminTab = "overview" | "hotels" | "manage";

type OverviewFilters = {
    startDate: string;
    endDate: string;
    startAt: string;
    endAt: string;
    hotelId: string;
    managerId: string;
};

type PeriodPreset = "today" | "week" | "month" | "year";

interface AdminDashboardProps {
    user: SessionUser;
    onLogout?: () => void;
}

interface CreateHotelPayload {
    name: string;
    address: string;
    country?: string;
    notes?: string;
    cleaningChatId?: string;
    timezone?: string;
    currency?: string;
    usesExtranets?: boolean;
    extranetNames?: string[];
    hasMealPlan?: boolean;
    financialCycleStartDay?: number;
    monthlyPayrollCost?: number;
    monthlyRentCost?: number;
    monthlyUtilitiesCost?: number;
    monthlySuppliesCost?: number;
    monthlyOtherCost?: number;
}

type HotelFormState = {
    name: string;
    address: string;
    notes: string;
    cleaningChatId: string;
    timezone: string;
    currency: string;
    usesExtranets: boolean;
    extranetNames: string;
    hasMealPlan: boolean;
    financialCycleStartDay: string;
    monthlyPayrollCost: string;
    monthlyRentCost: string;
    monthlyUtilitiesCost: string;
    monthlySuppliesCost: string;
    monthlyOtherCost: string;
};

// notify is replaced by useToast() inside the component

const DEFAULT_COUNTRY: CountryCode = "KG";

const getDisplaySettings = (country?: string | null) => {
    const countryCode: CountryCode = country === "KZ" || country === "KG" ? country : DEFAULT_COUNTRY;
    const config = getCountryConfig(countryCode);
    return {
        country: countryCode,
        timezone: config.timezone,
        currency: config.currency,
    };
};

const createEmptyHotelForm = (display: { timezone: string; currency: string }): HotelFormState => ({
    name: "",
    address: "",
    notes: "",
    cleaningChatId: "",
    timezone: display.timezone,
    currency: display.currency,
    usesExtranets: false,
    extranetNames: "",
    hasMealPlan: false,
    financialCycleStartDay: "1",
    monthlyPayrollCost: "0",
    monthlyRentCost: "0",
    monthlyUtilitiesCost: "0",
    monthlySuppliesCost: "0",
    monthlyOtherCost: "0",
});

const formatCurrency = (value: number, currency?: string) => formatMoney(value, currency);
const formatPercentInt = (value: number) => `${Math.round(value)}%`;

const toMinorUnits = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return Math.round(parsed * 100);
};

const toCycleDay = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) return undefined;
    return parsed;
};

const parseExtranetNamesText = (value?: string | null) => {
    return (value ?? '')
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.toLocaleLowerCase('ru-RU') === item.toLocaleLowerCase('ru-RU')) === index)
        .slice(0, 30);
};

const fromMinorUnits = (value?: number | null) => {
    if (!value) return "0";
    return String(value / 100);
};

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatDT = (value?: string | null, tz?: string) => fdt(value, tz, undefined, "");
const paymentMethodLabel = (method: "CASH" | "CARD") => (method === "CASH" ? "нал" : "карта");
const expenseTypeLabel = (entry: ExpenseEntry) => {
    if (isCollectionLedgerEntry(entry)) return "Инкассация";
    if (entry.entryType === "MANAGER_PAYOUT") return "выплата";
    if (entry.entryType === "ADJUSTMENT") return "корректировка";
    return "расход";
};
const expenseReasonLabel = (entry: ExpenseEntry) => {
    if (entry.categoryName?.trim()) return entry.categoryName.trim();
    if (entry.note?.trim()) return entry.note.trim();
    if (isCollectionLedgerEntry(entry)) return "Инкассация";
    if (entry.entryType === "MANAGER_PAYOUT") return "Выплата менеджеру";
    if (entry.entryType === "ADJUSTMENT") return "Корректировка";
    return "Без категории";
};
const expenseNoteLabel = (entry: ExpenseEntry) => entry.note?.trim() || null;
const expenseAmountPrefix = (entry: ExpenseEntry) => (entry.entryType === "ADJUSTMENT" ? "+" : "-");
const expenseAmountTone = (entry: ExpenseEntry) =>
    isCollectionLedgerEntry(entry)
        ? "text-cyan-600 dark:text-cyan-300"
        : entry.entryType === "ADJUSTMENT"
        ? "text-sky-600 dark:text-sky-300"
        : "text-rose-500 dark:text-rose-300";

const selectClassName = "h-10 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-light-text shadow-[0_8px_22px_-22px_rgba(15,23,42,0.32)] transition-[border-color,box-shadow,background-color] focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:opacity-40 sm:h-11 sm:rounded-2xl sm:px-3.5 dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white dark:focus:border-white/15 dark:focus:bg-white/[0.08] dark:focus:ring-white/[0.06]";

const toDateInputValue = (value: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

const createPeriodFilters = (preset: PeriodPreset, timeZone: string): OverviewFilters => {
    const endDate = new Date();
    const startDate = new Date(endDate);

    if (preset === "today") {
        // same-day range in selected timezone
    } else if (preset === "week") {
        startDate.setDate(startDate.getDate() - 6);
    } else if (preset === "month") {
        startDate.setMonth(startDate.getMonth() - 1);
    } else if (preset === "year") {
        startDate.setFullYear(startDate.getFullYear() - 1);
    }

    return {
        startDate: toDateInputValue(startDate, timeZone),
        endDate: toDateInputValue(endDate, timeZone),
        startAt: "",
        endAt: "",
        hotelId: "",
        managerId: "",
    };
};

function SectionCard({ title, subtitle, actions, className, children }: { title: string; subtitle?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
    return (
        <Card className={`!border-slate-200 !bg-white !shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] p-3.5 sm:p-5 lg:!rounded-lg lg:p-4 dark:!border-white/[0.055] dark:!bg-white/[0.04] dark:!shadow-none ${className ?? ""}`}>
            <div className="mb-3 flex flex-col gap-3 sm:mb-4 sm:flex-row sm:items-start sm:justify-between lg:mb-3">
                <div className="min-w-0">
                    {subtitle ? <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">{subtitle}</p> : null}
                    <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white sm:text-lg lg:text-base">{title}</h2>
                </div>
                {actions}
            </div>
            {children}
        </Card>
    );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600 dark:text-white/35" htmlFor={htmlFor}>
                    {label}
                </label>
                {hint ? <span className="text-[11px] text-slate-600 dark:text-white/28">{hint}</span> : null}
            </div>
            {children}
        </div>
    );
}

function StatPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.055] dark:bg-white/[0.03] sm:rounded-2xl lg:rounded-md">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-600 dark:text-white/28">{label}</p>
            <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-800 dark:text-white">{value}</p>
        </div>
    );
}

function BusinessTargetCard({
    target,
    currency,
    hotelLabel,
}: {
    target?: AdminOverview["businessTarget"];
    currency?: string;
    hotelLabel?: string;
}) {
    const [helpOpen, setHelpOpen] = useState(false);

    if (!target) return null;

    const breakdown = [
        { label: "Зарплаты", value: target.costs.payroll },
        { label: "Аренда", value: target.costs.rent },
        { label: "Ком услуги", value: target.costs.utilities },
        { label: "Хоз товары", value: target.costs.supplies },
        { label: "Прочее", value: target.costs.other },
    ];
    const hasPlan = target.monthlyRequiredRevenue > 0;
    const helpText = hasPlan
        ? `Показывает, сколько нужно заработать за ${target.periodLabel}, чтобы закрыть основные ежемесячные затраты.`
        : "Заполни в управлении объектом ежемесячные ориентиры по зарплатам, аренде, коммуналке, хозтоварам и прочим тратам. Тогда сводка начнет показывать, сколько выручки нужно в месяц и какой темп нужен до конца месяца.";

    return (
        <Card className="col-span-1 lg:col-span-4 overflow-hidden p-4 text-light-text dark:text-white lg:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 max-w-3xl">
                    <div className="flex items-start gap-2">
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Финансовый ориентир</p>
                            <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                                {hotelLabel ? `План для ${hotelLabel}` : `План по объектам: ${target.hotelsInScope}`}
                            </h3>
                        </div>
                        <button
                            type="button"
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/45 dark:hover:bg-white/[0.08] dark:hover:text-white"
                            onClick={() => setHelpOpen((current) => !current)}
                            aria-label="Пояснение финансового ориентира"
                            aria-expanded={helpOpen}
                        >
                            ?
                        </button>
                    </div>
                    {helpOpen ? (
                        <p className="mt-2 max-w-2xl rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-white/45">
                            {helpText}
                        </p>
                    ) : null}
                    {hasPlan && helpOpen ? (
                        <p className="mt-2 text-xs text-slate-500 dark:text-white/40">
                            {target.mixedCycleDays
                                ? "У объектов разные даты начала расчетного месяца. Сводка считает каждый филиал по его собственному периоду."
                                : `Расчетный месяц начинается ${target.cycleStartDay} числа.`}
                        </p>
                    ) : null}
                </div>
                {hasPlan ? (
                    <div className={`w-full rounded-2xl border px-4 py-3 text-left sm:max-w-xs sm:self-start sm:text-right ${target.onTrack ? "border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-400/10" : "border-amber-200/80 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-400/10"}`}>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/45">Статус периода</p>
                        <p className={`mt-1 text-base font-semibold ${target.onTrack ? "text-emerald-700 dark:text-emerald-200" : "text-amber-700 dark:text-amber-200"}`}>
                            {target.onTrack ? "Идем по темпу" : "Нужно ускориться"}
                        </p>
                        <p className="mt-1 break-words text-xs text-slate-500 dark:text-white/45">
                            Прогноз: {formatCurrency(target.projectedRevenue, currency)}
                        </p>
                    </div>
                ) : null}
            </div>

            {hasPlan ? (
                <>
                    <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-5">
                        <StatPill label="Нужно за месяц" value={formatCurrency(target.monthlyRequiredRevenue, currency)} />
                        <StatPill label="Уже заработано" value={formatCurrency(target.monthRevenue, currency)} />
                        <StatPill label="Осталось добрать" value={formatCurrency(target.remainingToTarget, currency)} />
                        <StatPill label="Средний темп" value={`${formatCurrency(target.currentDailyAverage, currency)}/день`} />
                        <StatPill label="Нужно дальше" value={target.requiredDailyAverage > 0 ? `${formatCurrency(target.requiredDailyAverage, currency)}/день` : "цель закрыта"} />
                    </div>

                    <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <span className="text-slate-600 dark:text-white/55">Покрытие плана</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{formatPercentInt(target.coveredPct * 100)}</span>
                        </div>
                        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                            <div
                                className={`h-full rounded-full ${target.onTrack ? "bg-emerald-500" : "bg-amber-500"}`}
                                style={{ width: `${Math.max(4, Math.min(target.coveredPct * 100, 100))}%` }}
                            />
                        </div>
                        {target.elapsedDays != null && target.totalDays != null && target.remainingDays != null ? (
                            <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500 dark:text-white/40 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <span>Прошло дней: {target.elapsedDays}/{target.totalDays}</span>
                                <span>Осталось дней: {target.remainingDays}</span>
                            </div>
                        ) : (
                            <div className="mt-2 text-xs text-slate-500 dark:text-white/40">
                                Сроки различаются по объектам, поэтому темп считается отдельно по каждому филиалу.
                            </div>
                        )}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-5">
                        {breakdown.map((item) => (
                            <div key={item.label} className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600 dark:text-white/35">{item.label}</p>
                                <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-900 dark:text-white">{formatCurrency(item.value, currency)}</p>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}
        </Card>
    );
}

function ExpenseFeed({
    title,
    entries,
    defaultCurrency,
    defaultTimezone,
    showHotelName = false,
    className,
}: {
    title: string;
    entries: ExpenseEntry[];
    defaultCurrency?: string;
    defaultTimezone?: string;
    showHotelName?: boolean;
    className?: string;
}) {
    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Операции</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-white/35">{entries.length}</span>
            </div>
            <div className="mt-4 space-y-2.5">
                {entries.length ? entries.map((entry) => {
                    const currency = entry.currency ?? defaultCurrency;
                    const timezone = entry.timezone ?? defaultTimezone;
                    const note = expenseReasonLabel(entry);
                    const noteDetails = expenseNoteLabel(entry);

                    return (
                        <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{note}</p>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-white/40">
                                        {expenseTypeLabel(entry)} · {paymentMethodLabel(entry.method)}
                                        {entry.managerName ? ` · ${entry.managerName}` : ""}
                                        {showHotelName && entry.hotelName ? ` · ${entry.hotelName}` : ""}
                                    </p>
                                    {noteDetails && entry.categoryName ? <p className="mt-1 text-[11px] text-slate-500 dark:text-white/35">{noteDetails}</p> : null}
                                </div>
                                <div className="text-right">
                                    <p className={`text-sm font-semibold ${expenseAmountTone(entry)}`}>{expenseAmountPrefix(entry)}{formatCurrency(entry.amount, currency ?? undefined)}</p>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-white/35">{formatDT(entry.recordedAt, timezone ?? undefined)}</p>
                                </div>
                            </div>
                        </div>
                    );
                }) : (
                    <p className="rounded-2xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:text-white/40">
                        Нет операций за выбранный период.
                    </p>
                )}
            </div>
        </Card>
    );
}

function ExpenseReasonSummary({ entries, defaultCurrency, className }: {
    entries: ExpenseEntry[];
    defaultCurrency?: string;
    className?: string;
}) {
    const grouped = useMemo(() => {
        const buckets = new Map<string, { label: string; count: number; amount: number }>();

        for (const entry of entries) {
            const label = expenseReasonLabel(entry);
            const normalized = label.toLocaleLowerCase("ru-RU");
            const bucket = buckets.get(normalized) ?? { label, count: 0, amount: 0 };
            bucket.count += 1;
            bucket.amount += entry.amount;
            buckets.set(normalized, bucket);
        }

        return Array.from(buckets.values())
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);
    }, [entries]);

    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Структура расходов</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">По категориям</h3>
            <div className="mt-4 space-y-2.5">
                {grouped.length ? grouped.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{item.label}</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/40">{item.count} {item.count === 1 ? "операция" : item.count < 5 ? "операции" : "операций"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">{formatCurrency(item.amount, defaultCurrency)}</p>
                    </div>
                )) : (
                    <p className="rounded-2xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:text-white/40">
                        Нет операций за выбранный период.
                    </p>
                )}
            </div>
        </Card>
    );
}

function ExpenseTable({ entries, defaultCurrency, defaultTimezone, showHotelName = false, className }: {
    entries: ExpenseEntry[];
    defaultCurrency?: string;
    defaultTimezone?: string;
    showHotelName?: boolean;
    className?: string;
}) {
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);

    const filteredEntries = useMemo(() => {
        const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("ru-RU");
        if (!normalizedQuery) {
            return entries;
        }

        return entries.filter((entry) => {
            const note = expenseReasonLabel(entry);
            const haystack = [
                note,
                entry.note,
                entry.managerName,
                entry.hotelName,
                paymentMethodLabel(entry.method),
                expenseTypeLabel(entry),
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("ru-RU");

            return haystack.includes(normalizedQuery);
        });
    }, [deferredQuery, entries]);

    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Журнал операций</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Все операции по фильтру</h3>
                </div>
                <div className="w-full sm:max-w-xs">
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Поиск по причине, менеджеру, объекту"
                    />
                </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.06]">
                <div className="max-h-[28rem] overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200/80 text-sm dark:divide-white/[0.06]">
                        <thead className="bg-slate-50 dark:bg-white/[0.03]">
                            <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/35">
                                <th className="px-3 py-2.5 font-medium">Причина</th>
                                <th className="px-3 py-2.5 font-medium">Детали</th>
                                <th className="px-3 py-2.5 font-medium">Когда</th>
                                <th className="px-3 py-2.5 text-right font-medium">Сумма</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 bg-white dark:divide-white/[0.05] dark:bg-transparent">
                            {filteredEntries.length ? filteredEntries.map((entry) => {
                                const currency = entry.currency ?? defaultCurrency;
                                const timezone = entry.timezone ?? defaultTimezone;
                                const note = expenseReasonLabel(entry);
                                const noteDetails = expenseNoteLabel(entry);
                                return (
                                    <tr key={entry.id} className="align-top text-slate-700 dark:text-white/80">
                                        <td className="px-3 py-3">
                                            <p className="font-medium text-slate-900 dark:text-white">{note}</p>
                                            {noteDetails && entry.categoryName ? <p className="mt-1 text-[12px] text-slate-500 dark:text-white/45">{noteDetails}</p> : null}
                                        </td>
                                        <td className="px-3 py-3 text-[12px] text-slate-500 dark:text-white/45">
                                            <p>{expenseTypeLabel(entry)} · {paymentMethodLabel(entry.method)}</p>
                                            {entry.managerName ? <p className="mt-1">{entry.managerName}</p> : null}
                                            {showHotelName && entry.hotelName ? <p className="mt-1">{entry.hotelName}</p> : null}
                                        </td>
                                        <td className="px-3 py-3 text-[12px] text-slate-500 dark:text-white/45">
                                            {formatDT(entry.recordedAt, timezone ?? undefined)}
                                        </td>
                                        <td className={`px-3 py-3 text-right font-semibold ${expenseAmountTone(entry)}`}>
                                            {expenseAmountPrefix(entry)}{formatCurrency(entry.amount, currency)}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500 dark:text-white/40">
                                        Ничего не найдено.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </Card>
    );
}

function HotelsSkeleton() {
    return (
        <>
            {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-white/[0.02] p-3">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="mt-2 h-4 w-1/3" />
                    <Skeleton className="mt-4 h-10 w-full" />
                </div>
            ))}
        </>
    );
}

function OverviewSkeleton() {
    return (
        <>
            {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-4">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="mt-3 h-8 w-1/2" />
                    <Skeleton className="mt-2 h-4 w-2/3" />
                </Card>
            ))}
        </>
    );
}

/* ── Summary card with collapsible detail on mobile ── */

function SummaryCard({ label, value, valueColor, detail }: {
    label: string;
    value: string;
    valueColor: string;
    detail: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Card className="overflow-hidden p-4 text-light-text transition-colors hover:border-slate-300 dark:text-white dark:hover:border-white/10 lg:!rounded-lg">
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[10px] uppercase leading-tight tracking-[0.16em] text-slate-600 dark:text-white/30 sm:text-[11px] sm:tracking-[0.22em]">{label}</p>
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="sm:hidden flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 text-[11px] font-bold leading-none dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-white/40"
                    aria-label="Подробнее"
                >
                    {open ? '✕' : 'ⓘ'}
                </button>
            </div>
            <p className={`mt-2 text-base sm:text-xl font-semibold ${valueColor} truncate`}>{value}</p>
            <p className={`mt-1 text-[12px] text-slate-600 dark:text-white/40 break-words ${open ? '' : 'hidden'} sm:block`}>{detail}</p>
        </Card>
    );
}

/* ── Donut helper ───────────────────────────────────── */

type DonutSegment = { value: number; color: string; label: string; textColor: string };

const DonutChart = ({ segments, centerLabel, centerValue, centerColor, colSpan, currency }: {
    segments: DonutSegment[];
    centerLabel: string;
    centerValue: string;
    centerColor: string;
    colSpan?: string;
    currency?: string;
}) => {
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0) || 1;
    let cumDeg = 0;
    const stops: string[] = [];
    for (const seg of segments) {
        const deg = ((seg.value || 0) / total) * 360;
        stops.push(`${seg.color} ${cumDeg}deg ${cumDeg + deg}deg`);
        cumDeg += deg;
    }
    const chartStyle: CSSProperties = { backgroundImage: `conic-gradient(${stops.join(", ")})` };

    return (
        <Card className={`p-4 ${colSpan ?? "col-span-1 lg:col-span-4"}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div
                    className="relative mx-auto h-40 w-40 shrink-0 overflow-hidden rounded-full shadow-[0_20px_45px_-26px_rgba(15,23,42,0.35)]"
                    style={chartStyle}
                >
                    <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full border border-slate-200/80 bg-white/95 dark:border-white/[0.06] dark:bg-night text-center">
                        <span className="text-[9px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/35">{centerLabel}</span>
                        <span className={`text-sm font-semibold leading-tight ${centerColor}`}>{centerValue}</span>
                    </div>
                </div>
                <div className="flex-1 space-y-2.5 text-sm">
                    {segments.map((seg) => (
                        <div key={seg.label} className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-slate-700 dark:text-white/50">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
                                <span>{seg.label}</span>
                            </div>
                            <p className={`text-sm font-semibold ${seg.textColor}`}>
                                {formatCurrency(seg.value, currency)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
};

/* ── Chart 1: Вход / Выход / Баланс ───────────────── */

type AnalyticsFlowChartProps = {
    inflow: number;
    outflow: number;
    net: number;
    currency?: string;
};

const AnalyticsFlowChart = ({ inflow, outflow, net, currency }: AnalyticsFlowChartProps) => {
    const safeNet = net || 0;
    const netPositive = safeNet >= 0;
    const segments: DonutSegment[] = [
        { value: inflow || 0, color: "#34d399", label: "Вход", textColor: "text-emerald-600 dark:text-emerald-300" },
        { value: outflow || 0, color: "#f87171", label: "Выход", textColor: "text-rose-600 dark:text-rose-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel={netPositive ? "Профицит" : "Дефицит"}
            centerValue={formatCurrency(safeNet, currency)}
            centerColor={netPositive ? "text-emerald-600 dark:text-emerald-200" : "text-rose-600 dark:text-rose-200"}
            currency={currency}
        />
    );
};

/* ── Chart 2: Нал / Карта ──────────────────────────── */

type PaymentMethodChartProps = { cashTotal: number; cardTotal: number; currency?: string };

const PaymentMethodChart = ({ cashTotal, cardTotal, currency }: PaymentMethodChartProps) => {
    const total = (cashTotal || 0) + (cardTotal || 0);
    const segments: DonutSegment[] = [
        { value: cashTotal || 0, color: "#60a5fa", label: "Наличные", textColor: "text-blue-600 dark:text-blue-300" },
        { value: cardTotal || 0, color: "#a78bfa", label: "Карта", textColor: "text-violet-600 dark:text-violet-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel="Всего"
            centerValue={formatCurrency(total, currency)}
            centerColor="text-light-text dark:text-white"
            colSpan="col-span-1 lg:col-span-2"
            currency={currency}
        />
    );
};

/* ── Chart 3: Структура расходов ───────────────────── */

type ExpenseStructureChartProps = {
    cashOut: number;
    collections: number;
    payouts: number;
    adjustments: number;
    currency?: string;
};

const ExpenseStructureChart = ({ cashOut, collections, payouts, adjustments, currency }: ExpenseStructureChartProps) => {
    const total = (cashOut || 0) + (collections || 0) + (payouts || 0) + Math.abs(adjustments || 0);
    const segments: DonutSegment[] = [
        { value: cashOut || 0, color: "#f87171", label: "Расходы", textColor: "text-rose-600 dark:text-rose-300" },
        { value: collections || 0, color: "#22d3ee", label: "Инкассация", textColor: "text-cyan-600 dark:text-cyan-300" },
        { value: payouts || 0, color: "#fb923c", label: "Выплаты", textColor: "text-orange-600 dark:text-orange-300" },
        { value: Math.abs(adjustments || 0), color: "#facc15", label: "Корректировки", textColor: "text-yellow-600 dark:text-yellow-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel="Итого"
            centerValue={formatCurrency(total, currency)}
            centerColor="text-rose-600 dark:text-rose-200"
            colSpan="col-span-1 lg:col-span-2"
            currency={currency}
        />
    );
};

/* ── Line Chart: Доход / Расход по дням ──────────────── */

type DailyPoint = { date: string; cashIn: number; cashOut: number; collections: number };

const DailyLineChart = ({ data, timeZone }: { data: DailyPoint[]; timeZone: string }) => {
    if (!data.length) return null;

    const dailyAxisDateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        timeZone,
    });

    const W = 600;
    const H = 200;
    const PX = 44;
    const PY = 24;
    const PB = 32;
    const chartW = W - PX * 2;
    const chartH = H - PY - PB;

    const allValues = data.flatMap((d) => [d.cashIn, d.cashOut, d.collections]);
    const maxVal = Math.max(...allValues, 100);
    const minVal = 0;
    const range = maxVal - minVal || 1;

    const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;

    const toX = (i: number) => PX + (data.length > 1 ? i * xStep : chartW / 2);
    const toY = (v: number) => PY + chartH - ((v - minVal) / range) * chartH;

    const pointsIn = data.map((d, i) => ({ x: toX(i), y: toY(d.cashIn) }));
    const pointsOut = data.map((d, i) => ({ x: toX(i), y: toY(d.cashOut) }));
    const pointsCollections = data.map((d, i) => ({ x: toX(i), y: toY(d.collections) }));

    const makeSmoothPath = (points: { x: number; y: number }[]) => {
        if (!points.length) return '';
        if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

        const tension = 0.18;
        let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

        for (let i = 0; i < points.length - 1; i += 1) {
            const prev = points[i - 1] ?? points[i];
            const current = points[i];
            const next = points[i + 1];
            const after = points[i + 2] ?? next;

            const cp1x = current.x + (next.x - prev.x) * tension;
            const cp1y = current.y + (next.y - prev.y) * tension;
            const cp2x = next.x - (after.x - current.x) * tension;
            const cp2y = next.y - (after.y - current.y) * tension;

            path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
        }

        return path;
    };

    const pathIn = makeSmoothPath(pointsIn);
    const pathOut = makeSmoothPath(pointsOut);
    const pathCollections = makeSmoothPath(pointsCollections);

    const gridLines = 4;
    const gridSteps = Array.from({ length: gridLines + 1 }, (_, i) => minVal + (range / gridLines) * i);

    const formatShort = (v: number) => {
        const abs = v / 100;
        if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
        if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
        return abs.toFixed(0);
    };

    const formatAxisDate = (value: string) => {
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return dailyAxisDateFormatter.format(date).replace('.', '');
    };

    const labelEvery = Math.max(1, Math.ceil(data.length / 6));

    return (
        <Card className="col-span-1 lg:col-span-4 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-slate-500 dark:text-white/35">Доход / Расход по дням</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
                {/* grid */}
                {gridSteps.map((v) => (
                    <g key={v}>
                        <line x1={PX} y1={toY(v)} x2={W - PX} y2={toY(v)} stroke="var(--border-color)" strokeDasharray="2 5" opacity="0.7" />
                        <text x={PX - 6} y={toY(v) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="8.5" opacity="0.9">{formatShort(v)}</text>
                    </g>
                ))}
                {/* area fills */}
                <path
                    d={`${pathIn} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(52,211,153,0.08)"
                />
                <path
                    d={`${pathOut} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(248,113,113,0.05)"
                />
                {/* lines */}
                <path d={pathIn} fill="none" stroke="#34d399" strokeWidth="1.15" strokeLinejoin="round" strokeLinecap="round" />
                <path d={pathOut} fill="none" stroke="#f87171" strokeWidth="1.05" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" />
                <path d={pathCollections} fill="none" stroke="#22d3ee" strokeWidth="1.05" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2 3" />
                {/* dots */}
                {data.map((d, i) => (
                    <g key={d.date}>
                        <circle cx={toX(i)} cy={toY(d.cashIn)} r="1.9" fill="#34d399" stroke="rgba(15,23,42,0.35)" strokeWidth="0.45" />
                        <circle cx={toX(i)} cy={toY(d.cashOut)} r="1.9" fill="#f87171" stroke="rgba(15,23,42,0.28)" strokeWidth="0.45" />
                        {d.collections > 0 && <circle cx={toX(i)} cy={toY(d.collections)} r="1.9" fill="#22d3ee" stroke="rgba(15,23,42,0.28)" strokeWidth="0.45" />}
                    </g>
                ))}
                {/* x labels */}
                {data.map((d, i) =>
                    i % labelEvery === 0 ? (
                        <text key={`lbl-${d.date}`} x={toX(i)} y={H - 6} textAnchor="middle" fill="var(--text-tertiary)" fontSize="8.5" opacity="0.9">
                            {formatAxisDate(d.date)}
                        </text>
                    ) : null,
                )}
            </svg>
            <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-slate-600 dark:text-white/50">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm bg-emerald-400" />
                    Доход
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm bg-rose-400" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(100,116,139,0.45) 3px, rgba(100,116,139,0.45) 5px)' }} />
                    Расход
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm bg-cyan-300" />
                    Инкассация
                </span>
            </div>
        </Card>
    );
};

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
    const { country, withCountry } = useCountryContext();
    const handleLogout = async () => {
        await fetch(withCountry('/api/session/logout'), { method: 'POST', cache: 'no-store' });
        if (onLogout) {
            onLogout();
        }
    };

    const fetchWithAuth = useCallback(async (url: string) => {
        const response = await fetch(withCountry(url), {
            credentials: 'include', // Include cookies
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error("Не удалось загрузить данные");
        }

        return response.json();
    }, [withCountry]);

    const { data: hotelDirectory, mutate, isLoading } = useSWR<AdminHotelSummary[]>(['admin-hotels', country], () => fetchWithAuth('/api/hotels'));
    const [filters, setFilters] = useState<OverviewFilters>(() => createPeriodFilters("month", getDisplaySettings().timezone));
    const [periodPreset, setPeriodPreset] = useState<PeriodPreset | null>("month");

    const overviewQuery = useMemo(() => {
        const params = new URLSearchParams();
        if (filters.startDate) {
            params.set("startDate", filters.startDate);
        }
        if (filters.endDate) {
            params.set("endDate", filters.endDate);
        }
        if (filters.startAt) {
            params.set("startAt", filters.startAt);
        }
        if (filters.endAt) {
            params.set("endAt", filters.endAt);
        }
        if (filters.hotelId) {
            params.set("hotelId", filters.hotelId);
        }
        if (filters.managerId) {
            params.set("managerId", filters.managerId);
        }
        return params.toString();
    }, [filters]);

    const overviewUrl = overviewQuery ? `/api/admin/overview?${overviewQuery}` : "/api/admin/overview";
    const filteredHotelsUrl = overviewQuery ? `/api/hotels?${overviewQuery}` : '/api/hotels';
    const { data: overview } = useSWR<AdminOverview>(['admin-overview', country, overviewUrl], () => fetchWithAuth(overviewUrl));
    const { data: filteredHotelSummaries } = useSWR<AdminHotelSummary[]>(['admin-filtered-hotels', country, filteredHotelsUrl], () => fetchWithAuth(filteredHotelsUrl));

    const hotels = useMemo(() => hotelDirectory ?? [], [hotelDirectory]);
    const overviewHotels = useMemo(() => filteredHotelSummaries ?? hotels, [filteredHotelSummaries, hotels]);
    const overviewDisplay = useMemo(() => {
        if (overview?.display) {
            return overview.display;
        }
        const hotelCountry = hotels.length ? hotels[0]?.country : undefined;
        return getDisplaySettings(hotelCountry);
    }, [overview, hotels]);

    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [editForm, setEditForm] = useState<HotelFormState>(() => createEmptyHotelForm(getDisplaySettings()));

    const [isUpdatingHotel, setIsUpdatingHotel] = useState(false);
    const [isDeletingHotel, setIsDeletingHotel] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>("overview");
    const { toast: notify } = useToast();

    // Observer management state
    type ObserverItem = {
        id: string;
        displayName: string;
        loginName: string;
        hotels: Array<{ id: string; name: string }>;
    };
    const { data: observers, mutate: mutateObservers } = useSWR<ObserverItem[]>(
        ['admin-observers', country],
        () => fetchWithAuth('/api/admin/observers')
    );
    const [newObserver, setNewObserver] = useState({ displayName: '', loginName: '', password: '', hotelId: '' });
    const [creatingObserver, setCreatingObserver] = useState(false);
    const [deletingObserverId, setDeletingObserverId] = useState<string | null>(null);
    const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
    const [resetPasswordValue, setResetPasswordValue] = useState('');
    const [resettingPassword, setResettingPassword] = useState(false);

    useEffect(() => {
        if (!periodPreset) {
            return;
        }

        setFilters((prev) => ({
            ...prev,
            ...createPeriodFilters(periodPreset, overviewDisplay.timezone),
            hotelId: prev.hotelId,
            managerId: prev.managerId,
        }));
    }, [overviewDisplay.timezone, periodPreset]);

    const handleCreateObserver = async (event: FormEvent) => {
        event.preventDefault();
        if (!newObserver.displayName || !newObserver.loginName || !newObserver.password || !newObserver.hotelId) return;
        setCreatingObserver(true);
        try {
            const response = await fetch(withCountry('/api/admin/observers'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify(newObserver),
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Ошибка');
            }
            setNewObserver({ displayName: '', loginName: '', password: '', hotelId: '' });
            mutateObservers();
            notify('Наблюдатель создан', 'success');
        } catch (error) {
            notify(error instanceof Error ? error.message : 'Не удалось создать', 'error');
        } finally {
            setCreatingObserver(false);
        }
    };

    const handleDeleteObserver = async (observerId: string) => {
        setDeletingObserverId(observerId);
        try {
            await fetch(withCountry(`/api/admin/observers/${observerId}`), {
                method: 'DELETE',
                cache: 'no-store',
            });
            mutateObservers();
            notify('Наблюдатель удалён', 'success');
        } catch {
            notify('Не удалось удалить', 'error');
        } finally {
            setDeletingObserverId(null);
        }
    };

    const handleResetObserverPassword = async () => {
        if (!resetPasswordId || resetPasswordValue.length < 6) return;
        setResettingPassword(true);
        try {
            const response = await fetch(withCountry(`/api/admin/observers/${resetPasswordId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ password: resetPasswordValue }),
            });
            if (!response.ok) throw new Error('Ошибка');
            setResetPasswordId(null);
            setResetPasswordValue('');
            notify('Пароль обновлён', 'success');
        } catch {
            notify('Не удалось обновить пароль', 'error');
        } finally {
            setResettingPassword(false);
        }
    };

    useEffect(() => {
        if (!selectedHotelId) {
            setEditForm(createEmptyHotelForm(overviewDisplay));
            return;
        }

        if (!hotelDirectory) {
            return;
        }

        const target = hotelDirectory.find((hotel) => hotel.id === selectedHotelId);
        if (target) {
            setEditForm({
                name: target.name ?? "",
                address: target.address ?? "",
                notes: target.notes ?? "",
                cleaningChatId: target.cleaningChatId ?? "",
                timezone: target.timezone ?? overviewDisplay.timezone,
                currency: target.currency ?? overviewDisplay.currency,
                usesExtranets: Boolean(target.usesExtranets),
                extranetNames: (target.extranetNames ?? []).join('\n'),
                hasMealPlan: Boolean(target.hasMealPlan),
                financialCycleStartDay: String(target.financialCycleStartDay ?? 1),
                monthlyPayrollCost: fromMinorUnits(target.monthlyPayrollCost),
                monthlyRentCost: fromMinorUnits(target.monthlyRentCost),
                monthlyUtilitiesCost: fromMinorUnits(target.monthlyUtilitiesCost),
                monthlySuppliesCost: fromMinorUnits(target.monthlySuppliesCost),
                monthlyOtherCost: fromMinorUnits(target.monthlyOtherCost),
            });
        } else {
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm(overviewDisplay));
        }
    }, [hotelDirectory, selectedHotelId, overviewDisplay]);

    const handleEditFieldChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = event.target;
        const nextValue = event.target instanceof HTMLInputElement && event.target.type === 'checkbox'
            ? event.target.checked
            : value;
        setEditForm((prev) => ({ ...prev, [name]: nextValue }));
    }, []);

    const handleCreateHotel = useCallback(
        async (formData: FormData) => {
            const payload: CreateHotelPayload = {
                name: formData.get("name") as string,
                address: formData.get("address") as string,
                country: formData.get("country") as string,
                timezone: formData.get("timezone") as string,
                currency: formData.get("currency") as string,
                notes: (formData.get("notes") as string) || undefined,
            };

            const rawCleaningChatId = (formData.get("cleaningChatId") as string | null)?.trim();
            if (rawCleaningChatId) {
                payload.cleaningChatId = rawCleaningChatId;
            }
            payload.usesExtranets = formData.get('usesExtranets') === 'on';
            payload.extranetNames = parseExtranetNamesText(formData.get('extranetNames') as string | null);
            payload.hasMealPlan = formData.get('hasMealPlan') === 'on';
            payload.financialCycleStartDay = toCycleDay(formData.get("financialCycleStartDay") as string | null) ?? 1;
            payload.monthlyPayrollCost = toMinorUnits(formData.get("monthlyPayrollCost") as string | null);
            payload.monthlyRentCost = toMinorUnits(formData.get("monthlyRentCost") as string | null);
            payload.monthlyUtilitiesCost = toMinorUnits(formData.get("monthlyUtilitiesCost") as string | null);
            payload.monthlySuppliesCost = toMinorUnits(formData.get("monthlySuppliesCost") as string | null);
            payload.monthlyOtherCost = toMinorUnits(formData.get("monthlyOtherCost") as string | null);

            if (!payload.name?.trim()) {
                notify("Название обязательно", 'error');
                return;
            }

            if (!payload.address?.trim()) {
                notify("Адрес обязателен", 'error');
                return;
            }

            try {
                const res = await fetch(withCountry("/api/hotels"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
                    cache: 'no-store',
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    throw new Error("Не удалось создать отель");
                }

                await mutate();
                notify("Отель добавлен", 'success');
            } catch (error) {
                console.error(error);
                notify("Ошибка создания", 'error');
            }
        },
        [mutate, notify, withCountry],
    );

    const handleUpdateHotel = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();

            if (!selectedHotelId) {
                notify("Выберите отель", 'error');
                return;
            }

            if (!editForm.name.trim()) {
                notify("Название обязательно", 'error');
                return;
            }

            if (!editForm.address.trim()) {
                notify("Адрес обязателен", 'error');
                return;
            }

            setIsUpdatingHotel(true);

            try {
                const payload = {
                    name: editForm.name.trim(),
                    address: editForm.address.trim(),
                    notes: editForm.notes.trim(),
                    cleaningChatId: editForm.cleaningChatId.trim() ? editForm.cleaningChatId.trim() : null,
                    timezone: editForm.timezone || "Asia/Almaty",
                    currency: editForm.currency || "KZT",
                    usesExtranets: editForm.usesExtranets,
                    extranetNames: parseExtranetNamesText(editForm.extranetNames),
                    hasMealPlan: editForm.hasMealPlan,
                    financialCycleStartDay: toCycleDay(editForm.financialCycleStartDay) ?? 1,
                    monthlyPayrollCost: toMinorUnits(editForm.monthlyPayrollCost) ?? 0,
                    monthlyRentCost: toMinorUnits(editForm.monthlyRentCost) ?? 0,
                    monthlyUtilitiesCost: toMinorUnits(editForm.monthlyUtilitiesCost) ?? 0,
                    monthlySuppliesCost: toMinorUnits(editForm.monthlySuppliesCost) ?? 0,
                    monthlyOtherCost: toMinorUnits(editForm.monthlyOtherCost) ?? 0,
                };

                const res = await fetch(withCountry(`/api/hotels/${selectedHotelId}`), {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
                    cache: 'no-store',
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    throw new Error("Не удалось обновить отель");
                }

                await mutate();
                notify("Изменения сохранены", 'success');
            } catch (error) {
                console.error(error);
                notify("Ошибка обновления", 'error');
            } finally {
                setIsUpdatingHotel(false);
            }
        },
        [editForm, mutate, notify, selectedHotelId, withCountry],
    );

    const handleDeleteHotel = useCallback(async () => {
        if (!selectedHotelId) {
            notify("Выберите отель", 'error');
            return;
        }

        setIsDeletingHotel(true);

        try {
            const res = await fetch(withCountry(`/api/hotels/${selectedHotelId}`), {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
                cache: 'no-store',
            });

            if (!res.ok) {
                throw new Error("Не удалось удалить отель");
            }

            await mutate();
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm(overviewDisplay));
            notify("Отель удалён", 'success');
        } catch (error) {
            console.error(error);
            notify("Ошибка удаления", 'error');
        } finally {
            setIsDeletingHotel(false);
        }
    }, [mutate, notify, overviewDisplay, selectedHotelId, withCountry]);

    const adminTabs: Array<{ id: AdminTab; label: string; hint?: string; description: string; icon: LucideIcon }> = [
        { id: "overview", label: "Сводка", description: "Финансы, загрузка и темп", icon: BarChart3 },
        { id: "hotels", label: "Объекты", hint: hotels.length ? String(hotels.length) : undefined, description: "Состояние филиалов", icon: Hotel },
        { id: "manage", label: "Управление", description: "Настройки и доступы", icon: Settings2 },
    ];

    const managerOptions = useMemo(() => {
        const sourceHotels = filters.hotelId ? hotels.filter((hotel) => hotel.id === filters.hotelId) : hotels;
        const unique = new Map<string, string>();
        for (const hotel of sourceHotels) {
            for (const manager of hotel.managers) {
                const label =
                    manager.displayName?.trim() ||
                    manager.username?.trim() ||
                    'Менеджер';
                if (!unique.has(manager.id)) {
                    unique.set(manager.id, label);
                }
            }
        }
        return Array.from(unique.entries()).map(([id, label]) => ({ id, label }));
    }, [filters.hotelId, hotels]);

    const overviewCurrency = useMemo(() => {
        if (filters.hotelId) {
            const h = hotels.find((hotel) => hotel.id === filters.hotelId);
            return h?.currency ?? overviewDisplay.currency;
        }
        return overviewHotels.length === 1 ? (overviewHotels[0]?.currency ?? overviewDisplay.currency) : overviewDisplay.currency;
    }, [filters.hotelId, hotels, overviewDisplay.currency, overviewHotels]);

    const overviewTimezone = useMemo(() => {
        if (filters.hotelId) {
            const h = hotels.find((hotel) => hotel.id === filters.hotelId);
            return h?.timezone ?? overviewDisplay.timezone;
        }
        return overviewHotels.length === 1 ? (overviewHotels[0]?.timezone ?? overviewDisplay.timezone) : overviewDisplay.timezone;
    }, [filters.hotelId, hotels, overviewDisplay.timezone, overviewHotels]);

    const overviewHotelLabel = useMemo(() => {
        if (!filters.hotelId) return "";
        return hotels.find((hotel) => hotel.id === filters.hotelId)?.name ?? "";
    }, [filters.hotelId, hotels]);

    const handleFilterInput = (field: keyof OverviewFilters, value: string) => {
        setPeriodPreset(null);
        setFilters((prev) => ({
            ...prev,
            [field]: value,
            ...(field === "startDate" || field === "endDate" ? { startAt: "", endAt: "" } : {}),
        }));
    };

    const handleHotelFilterChange = (value: string) => {
        setFilters((prev) => ({ ...prev, hotelId: value, managerId: "" }));
    };

    const handlePeriodPreset = (preset: PeriodPreset) => {
        setPeriodPreset(preset);
        setFilters((prev) => ({
            ...prev,
            ...createPeriodFilters(preset, overviewTimezone),
            hotelId: prev.hotelId,
            managerId: prev.managerId,
        }));
    };

    const handleExportCSV = useCallback(() => {
        if (!overview) return;
        const t = overview.totals;
        const o = overview.occupancy;
        const fc = (v: number) => formatCurrency(v, overviewCurrency);
        const rows = [
            ["Показатель", "Значение"],
            ["Баланс", fc(t.netCash)],
            ["Вход (всего)", fc(t.cashIn)],
            ["  вход нал", fc(t.cashInBreakdown.cash)],
            ["  вход карта", fc(t.cashInBreakdown.card)],
            ["Выход (всего)", fc(t.cashOut + t.collections)],
            ["  выход нал", fc(t.cashOutBreakdown.cash)],
            ["  выход карта", fc(t.cashOutBreakdown.card)],
            ["Инкассация", fc(t.collections)],
            ["Выплаты", fc(t.payouts)],
            ["Корректировки", fc(t.adjustments)],
            ["Загрузка", formatPercent(o.rate)],
            ["Занято номеров", `${o.occupiedRooms} / ${o.rooms}`],
            ["Активных смен", String(overview.shifts.active)],
        ];
        const csv = rows.map((r) => r.join(";")).join("\n");
        const bom = "\uFEFF";
        const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `overview_${filters.startDate || "all"}_${filters.endDate || "all"}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [overview, filters.startDate, filters.endDate, overviewCurrency]);

    const activeTabConfig = adminTabs.find((tab) => tab.id === activeTab) ?? adminTabs[0];
    const ActiveTabIcon = activeTabConfig.icon;
    const visibleHotelCount = filters.hotelId ? 1 : overviewHotels.length;
    const desktopPeriodLabel = [filters.startDate || "начало", filters.endDate || "сегодня"].join(" - ");
    const desktopStats = [
        {
            label: "Баланс",
            value: overview ? formatCurrency(overview.totals.netCash, overviewCurrency) : "—",
            icon: CircleDollarSign,
            tone: overview && overview.totals.netCash < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300",
        },
        {
            label: "Загрузка",
            value: overview ? formatPercent(overview.occupancy.rate) : "—",
            icon: Activity,
            tone: "text-slate-800 dark:text-white",
        },
        {
            label: "Объекты",
            value: String(visibleHotelCount),
            icon: Building2,
            tone: "text-slate-800 dark:text-white",
        },
        {
            label: "Менеджеры",
            value: String(managerOptions.length),
            icon: Users,
            tone: "text-slate-800 dark:text-white",
        },
    ];

    return (
        <div className="min-h-screen bg-[#f4f6f8] text-light-text dark:bg-[#0f1218]">
            <div className="lg:grid lg:min-h-screen lg:grid-cols-[17rem_minmax(0,1fr)]">
                <aside className="hidden border-r border-slate-200 bg-white/94 px-4 py-5 shadow-[12px_0_34px_-34px_rgba(15,23,42,0.48)] dark:border-white/[0.065] dark:bg-[#11151d]/96 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
                    <div className="flex items-center gap-3 border-b border-slate-200 pb-5 dark:border-white/[0.06]">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                            <Building2 className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-950 dark:text-white">Hotel Ops</p>
                            <p className="truncate text-xs text-slate-500 dark:text-white/42">{user.displayName}</p>
                        </div>
                    </div>

                    <nav className="mt-5 space-y-1.5">
                        {adminTabs.map((tab) => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${active
                                        ? "bg-slate-950 text-white shadow-[0_14px_30px_-22px_rgba(15,23,42,0.7)] dark:bg-white dark:text-slate-950"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-white/58 dark:hover:bg-white/[0.055] dark:hover:text-white"
                                        }`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{tab.label}</span>
                                        <span className={`block truncate text-[11px] ${active ? "text-white/62 dark:text-slate-500" : "text-slate-400 dark:text-white/30"}`}>{tab.description}</span>
                                    </span>
                                    {tab.hint ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? "bg-white/14 text-white dark:bg-slate-900/8 dark:text-slate-500" : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-white/38"}`}>{tab.hint}</span> : null}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="mt-6 space-y-2 border-t border-slate-200 pt-5 dark:border-white/[0.06]">
                        {desktopStats.slice(0, 3).map((item) => {
                            const Icon = item.icon;
                            return (
                                <div key={item.label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.055] dark:bg-white/[0.035]">
                                    <Icon className="h-4 w-4 text-slate-400 dark:text-white/32" aria-hidden="true" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-white/28">{item.label}</p>
                                        <p className={`truncate text-sm font-semibold ${item.tone}`}>{item.value}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-white/[0.06]">
                        <ThemeToggle />
                        <Button type="button" size="sm" variant="ghost" className="gap-2" onClick={handleLogout}>
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                            Выйти
                        </Button>
                    </div>
                </aside>

                <div className="min-w-0">
                    <header className="flex flex-col gap-4 border-b border-slate-200 bg-white px-3 py-4 shadow-[0_14px_34px_-32px_rgba(15,23,42,0.38)] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-none sm:px-5 lg:hidden">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-600 dark:text-white/30">Администрирование</p>
                                <h1 className="mt-1 truncate text-xl font-semibold text-light-text dark:text-white">{user.displayName}</h1>
                                <p className="mt-1 text-sm text-slate-600 dark:text-white/45">Сводка, объекты и доступы.</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <ThemeToggle />
                                <Button type="button" size="icon" variant="ghost" aria-label="Выйти" onClick={handleLogout}>
                                    <LogOut className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            </div>
                        </div>
                    </header>
                    <div className="sticky top-0 z-10 bg-[#f4f6f8]/94 px-3 py-2 backdrop-blur-md dark:bg-[#0f1218]/94 sm:px-5 lg:hidden">
                        <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.045]">
                            <div className="flex gap-1 text-sm font-medium text-slate-700 dark:text-white/50">
                                {adminTabs.map((tab) => {
                                    const Icon = tab.icon;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`flex-1 rounded-md px-2.5 py-1.5 transition-all ${activeTab === tab.id
                                                ? "bg-white text-slate-950 shadow-sm dark:bg-white/[0.12] dark:text-white"
                                                : "hover:text-slate-950 dark:hover:text-white/70"
                                                }`}
                                        >
                                            <span className="flex items-center justify-center gap-1.5">
                                                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                                <span>{tab.label}</span>
                                                {tab.hint ? <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-white/[0.06] dark:text-white/40">{tab.hint}</span> : null}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <main className="px-3 pb-16 pt-3 sm:px-5 lg:px-6 lg:py-6 xl:px-8">
                        <div className="mb-5 hidden items-center justify-between gap-4 lg:flex">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.045] dark:text-white">
                                    <ActiveTabIcon className="h-5 w-5" aria-hidden="true" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/32">{activeTabConfig.description}</p>
                                    <h1 className="truncate text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">{activeTabConfig.label}</h1>
                                </div>
                            </div>
                            <div className="flex min-w-0 items-center gap-2">
                                <div className="hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-right dark:border-white/[0.06] dark:bg-white/[0.035] xl:block">
                                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/30">Период</p>
                                    <p className="text-xs font-medium text-slate-700 dark:text-white/62">{desktopPeriodLabel}</p>
                                </div>
                                {overview ? (
                                    <Button type="button" size="sm" variant="secondary" className="gap-2" onClick={handleExportCSV}>
                                        <Download className="h-4 w-4" aria-hidden="true" />
                                        CSV
                                    </Button>
                                ) : null}
                            </div>
                        </div>

                        <div className="mb-5 hidden grid-cols-4 gap-3 lg:grid">
                            {desktopStats.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} className="min-w-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_28px_-26px_rgba(15,23,42,0.36)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:shadow-none">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/30">{item.label}</p>
                                            <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/32" aria-hidden="true" />
                                        </div>
                                        <p className={`mt-2 truncate text-lg font-semibold ${item.tone}`}>{item.value}</p>
                                    </div>
                                );
                            })}
                        </div>

                    {activeTab === "overview" && (
                        <div className="space-y-3">
                            <SectionCard
                                title="Фильтры обзора"
                                subtitle="Overview"
                                className="lg:!rounded-lg lg:p-4"
                                actions={overview ? (
                                    <Button type="button" size="sm" variant="secondary" className="w-full gap-2 sm:w-auto" onClick={handleExportCSV}>
                                        <Download className="h-4 w-4" aria-hidden="true" />
                                        Скачать CSV
                                    </Button>
                                ) : undefined}
                            >
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(12rem,auto)_repeat(4,minmax(0,1fr))] lg:items-end">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/[0.055] dark:bg-white/[0.03] dark:text-white/45">
                                            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{desktopPeriodLabel}</span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {([
                                                { id: "today", label: "Сегодня" },
                                                { id: "week", label: "Неделя" },
                                                { id: "month", label: "Месяц" },
                                                { id: "year", label: "Год" },
                                            ] as Array<{ id: PeriodPreset; label: string }>).map((preset) => (
                                                <button
                                                    key={preset.id}
                                                    type="button"
                                                    onClick={() => handlePeriodPreset(preset.id)}
                                                    className={`h-9 rounded-md border px-2 text-xs font-medium transition ${periodPreset === preset.id
                                                        ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/65 dark:hover:border-white/20 dark:hover:text-white"
                                                        }`}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <Field label="Период от" htmlFor="overview-start">
                                            <Input
                                                id="overview-start"
                                                type="date"
                                                className="min-w-0"
                                                value={filters.startDate}
                                                onChange={(event) => handleFilterInput("startDate", event.target.value)}
                                                placeholder="С даты"
                                            />
                                        </Field>
                                        <Field label="Период до" htmlFor="overview-end">
                                            <Input
                                                id="overview-end"
                                                type="date"
                                                className="min-w-0"
                                                value={filters.endDate}
                                                min={filters.startDate || undefined}
                                                onChange={(event) => handleFilterInput("endDate", event.target.value)}
                                                placeholder="По дату"
                                            />
                                        </Field>
                                        <Field label="Объект" htmlFor="overview-hotel">
                                            <select
                                                id="overview-hotel"
                                                value={filters.hotelId}
                                                onChange={(event) => handleHotelFilterChange(event.target.value)}
                                                className={selectClassName}
                                            >
                                                <option value="">Все объекты</option>
                                                {hotels.map((hotel) => (
                                                    <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
                                                ))}
                                            </select>
                                        </Field>
                                        <Field label="Менеджер" htmlFor="overview-manager" hint={managerOptions.length ? `${managerOptions.length}` : undefined}>
                                            <select
                                                id="overview-manager"
                                                value={filters.managerId}
                                                onChange={(event) => handleFilterInput("managerId", event.target.value)}
                                                disabled={!managerOptions.length}
                                                className={selectClassName}
                                            >
                                                <option value="">{managerOptions.length ? "Все менеджеры" : "—"}</option>
                                                {managerOptions.map((manager) => (
                                                    <option key={manager.id} value={manager.id}>{manager.label}</option>
                                                ))}
                                            </select>
                                        </Field>
                                </div>
                            </SectionCard>
                            <section className="grid grid-cols-1 gap-2 lg:grid-cols-4 lg:gap-3 xl:gap-4">
                                {overview ? (
                                    <>
                                        <BusinessTargetCard
                                            target={overview.businessTarget}
                                            currency={overviewCurrency}
                                            hotelLabel={overviewHotelLabel}
                                        />
                                        <Card className="overflow-hidden p-4 text-light-text dark:text-white lg:!rounded-lg lg:p-4">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Баланс</p>
                                            <p className="mt-2 text-lg sm:text-2xl lg:text-[1.75rem] font-semibold tracking-tight truncate">{formatCurrency(overview.totals.netCash, overviewCurrency)}</p>
                                            <div className="mt-4 grid grid-cols-2 gap-2">
                                                <StatPill label="Загрузка" value={formatPercent(overview.occupancy.rate)} />
                                                <StatPill label="Смены" value={String(overview.shifts.active)} />
                                            </div>
                                        </Card>
                                        <SummaryCard
                                            label="Вход"
                                            value={formatCurrency(overview.totals.cashIn, overviewCurrency)}
                                            valueColor="text-emerald-600 dark:text-emerald-400"
                                            detail={`нал ${formatCurrency(overview.totals.cashInBreakdown.cash, overviewCurrency)} · карта ${formatCurrency(overview.totals.cashInBreakdown.card, overviewCurrency)}`}
                                        />
                                        <SummaryCard
                                            label="Выход"
                                            value={formatCurrency(overview.totals.cashOut + overview.totals.collections, overviewCurrency)}
                                            valueColor="text-rose-600 dark:text-rose-400"
                                            detail={`расход ${formatCurrency(overview.totals.cashOut, overviewCurrency)} · инкас ${formatCurrency(overview.totals.collections, overviewCurrency)}`}
                                        />
                                        <Card className="overflow-hidden p-4 text-light-text dark:text-white lg:!rounded-lg">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Загрузка</p>
                                            <p className="mt-2 text-base sm:text-lg font-semibold">
                                                {formatPercent(overview.occupancy.rate)}
                                            </p>
                                            <p className="mt-1 text-[12px] text-slate-500 dark:text-white/40">
                                                {overview.occupancy.occupiedRooms}/{overview.occupancy.rooms} · смен {overview.shifts.active}
                                            </p>
                                        </Card>
                                        {overview.dailySeries && overview.dailySeries.length > 0 && (
                                            <DailyLineChart data={overview.dailySeries} timeZone={overviewTimezone} />
                                        )}
                                        <AnalyticsFlowChart
                                            inflow={overview.totals.cashIn}
                                            outflow={overview.totals.cashOut + overview.totals.collections}
                                            net={overview.totals.netCash}
                                            currency={overviewCurrency}
                                        />
                                        <PaymentMethodChart
                                            cashTotal={overview.totals.cashInBreakdown.cash + overview.totals.cashOutBreakdown.cash + overview.totals.collectionsBreakdown.cash}
                                            cardTotal={overview.totals.cashInBreakdown.card + overview.totals.cashOutBreakdown.card + overview.totals.collectionsBreakdown.card}
                                            currency={overviewCurrency}
                                        />
                                        <ExpenseStructureChart
                                            cashOut={overview.totals.cashOut}
                                            collections={overview.totals.collections}
                                            payouts={overview.totals.payouts}
                                            adjustments={overview.totals.adjustments}
                                            currency={overviewCurrency}
                                        />
                                        <ExpenseFeed
                                            title="Последние списания по фильтру"
                                            entries={(overview.recentExpenses ?? []).slice(0, 8)}
                                            defaultCurrency={overviewCurrency}
                                            defaultTimezone={overviewTimezone}
                                            showHotelName={!filters.hotelId}
                                            className="col-span-1 lg:col-span-2"
                                        />
                                        <ExpenseReasonSummary
                                            entries={overview.recentExpenses ?? []}
                                            defaultCurrency={overviewCurrency}
                                            className="col-span-1 lg:col-span-2"
                                        />
                                        <ExpenseTable
                                            entries={overview.recentExpenses ?? []}
                                            defaultCurrency={overviewCurrency}
                                            defaultTimezone={overviewTimezone}
                                            showHotelName={!filters.hotelId}
                                            className="col-span-1 lg:col-span-4"
                                        />
                                    </>
                                ) : (
                                    <OverviewSkeleton />
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === "hotels" && (
                        <section className="space-y-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-3 lg:space-y-0">
                            {isLoading && <HotelsSkeleton />}
                            {!isLoading && overviewHotels.length === 0 && (
                                <p className="px-1 text-sm text-slate-500 dark:text-white/40">Нет отелей</p>
                            )}
                            {!isLoading &&
                                overviewHotels.map((hotel) => {
                                    const inflow = hotel.ledger?.cashIn ?? 0;
                                    const outflow = (hotel.ledger?.cashOut ?? 0) + (hotel.ledger?.collections ?? 0);

                                    return (
                                        <Card
                                            key={hotel.id}
                                            className="p-4 transition-colors hover:border-slate-300 dark:hover:border-white/10 lg:!rounded-lg lg:flex lg:h-full lg:flex-col lg:p-4"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <h3 className="text-base font-semibold text-light-text dark:text-white truncate">{hotel.name}</h3>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-white/40">{hotel.address || "—"}</p>
                                                </div>
                                                <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <p className="text-lg font-semibold text-light-text dark:text-white">{hotel.occupiedRooms}/{hotel.roomCount}</p>
                                                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-600 dark:text-white/30">занято</p>
                                                </div>
                                            </div>
                                            {hotel.activeShift && (
                                                <p className="mt-1.5 text-xs text-slate-500 dark:text-white/40">
                                                    №{hotel.activeShift.number} · {hotel.activeShift.manager} · {formatDT(hotel.activeShift.openedAt, hotel.timezone ?? undefined)}
                                                </p>
                                            )}
                                            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                                <StatPill label="Доход" value={`+${formatCurrency(inflow, hotel.currency ?? undefined)}`} />
                                                <StatPill label="Расход" value={`-${formatCurrency(outflow, hotel.currency ?? undefined)}`} />
                                            </div>
                                            <div className="mt-4 flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    {hotel.managers.slice(0, 4).map((m) => (
                                                        <span
                                                            key={m.id}
                                                            className="flex h-8 w-8 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-[10px] font-semibold text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.08] dark:text-white/70"
                                                            title={`${m.displayName} · PIN ${m.pinCode || '—'}`}
                                                        >
                                                            {m.displayName?.slice(0, 2).toUpperCase() || "??"}
                                                        </span>
                                                    ))}
                                                    {hotel.managers.length > 4 && (
                                                        <span className="text-[10px] text-slate-500 dark:text-white/30">+{hotel.managers.length - 4}</span>
                                                    )}
                                                </div>
                                                <Link href={`/admin/hotels/${hotel.id}`}>
                                                    <Button size="sm" variant="secondary">
                                                        Открыть
                                                    </Button>
                                                </Link>
                                            </div>
                                        </Card>
                                    );
                                })}
                        </section>
                    )
                    }

                    {activeTab === "manage" && (
                        <section className="grid gap-3 lg:grid-cols-2">
                            <SectionCard title="Новый объект" subtitle="Create hotel">
                                <form action={handleCreateHotel} className="space-y-3">
                                    <Field label="Название" htmlFor="name">
                                        <Input
                                            id="name"
                                            name="name"
                                            placeholder={"Например, \"Парк Инн\""}
                                            required

                                        />
                                    </Field>
                                    <Field label="Адрес" htmlFor="address">
                                        <Input
                                            id="address"
                                            name="address"
                                            placeholder="Город, улица, дом"
                                            required

                                        />
                                    </Field>
                                    <Field label="Заметки" htmlFor="notes" hint="необязательно">
                                        <TextArea
                                            id="notes"
                                            name="notes"
                                            placeholder="Особенности"
                                            rows={4}
                                        />
                                    </Field>
                                    <Field label="ID чата уборки" htmlFor="cleaningChatId" hint="Telegram">
                                        <Input
                                            id="cleaningChatId"
                                            name="cleaningChatId"
                                            placeholder="Например, -1001234567890"

                                        />
                                        <p className="text-xs text-slate-500 dark:text-white/50">Используется для уведомлений горничных в Telegram.</p>
                                    </Field>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        <Field label="Страна" htmlFor="country">
                                            <select id="country" name="country" defaultValue={overviewDisplay.country} className={selectClassName}>
                                                <option value="KG">Кыргызстан</option>
                                                <option value="KZ">Казахстан</option>
                                            </select>
                                        </Field>
                                        <Field label="Часовой пояс" htmlFor="timezone">
                                            <select id="timezone" name="timezone" defaultValue={overviewDisplay.timezone} className={selectClassName}>
                                                <option value="Asia/Bishkek">Бишкек (UTC+6)</option>
                                                <option value="Asia/Almaty">Алматы (UTC+5)</option>
                                            </select>
                                        </Field>
                                        <Field label="Валюта" htmlFor="currency">
                                            <select id="currency" name="currency" defaultValue={overviewDisplay.currency} className={selectClassName}>
                                                <option value="KGS">KGS</option>
                                                <option value="KZT">KZT</option>
                                            </select>
                                        </Field>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <Field label="Начало расчетного месяца" htmlFor="financialCycleStartDay" hint="1-31">
                                            <Input id="financialCycleStartDay" name="financialCycleStartDay" type="number" min="1" max="31" step="1" defaultValue="1" placeholder="1" />
                                        </Field>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="hasMealPlan" className="accent-emerald-500" />
                                            Показывать питание в заселениях
                                        </label>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="usesExtranets" className="accent-emerald-500" />
                                            Использовать экстранеты для этой точки
                                        </label>
                                        <div className="mt-3">
                                            <Field label="Список экстранетов" htmlFor="extranetNames" hint="Booking, Agoda, Ostrovok">
                                                <TextArea
                                                    id="extranetNames"
                                                    name="extranetNames"
                                                    rows={4}
                                                    placeholder="По одному в строке или через запятую"
                                                />
                                            </Field>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                        <Field label={`Зарплаты / мес (${overviewDisplay.currency})`} htmlFor="monthlyPayrollCost">
                                            <Input id="monthlyPayrollCost" name="monthlyPayrollCost" type="number" step="0.01" min="0" defaultValue="0" placeholder="0" />
                                        </Field>
                                        <Field label={`Аренда / мес (${overviewDisplay.currency})`} htmlFor="monthlyRentCost">
                                            <Input id="monthlyRentCost" name="monthlyRentCost" type="number" step="0.01" min="0" defaultValue="0" placeholder="0" />
                                        </Field>
                                        <Field label={`Ком услуги / мес (${overviewDisplay.currency})`} htmlFor="monthlyUtilitiesCost">
                                            <Input id="monthlyUtilitiesCost" name="monthlyUtilitiesCost" type="number" step="0.01" min="0" defaultValue="0" placeholder="0" />
                                        </Field>
                                        <Field label={`Хоз товары / мес (${overviewDisplay.currency})`} htmlFor="monthlySuppliesCost">
                                            <Input id="monthlySuppliesCost" name="monthlySuppliesCost" type="number" step="0.01" min="0" defaultValue="0" placeholder="0" />
                                        </Field>
                                        <Field label={`Прочее / мес (${overviewDisplay.currency})`} htmlFor="monthlyOtherCost">
                                            <Input id="monthlyOtherCost" name="monthlyOtherCost" type="number" step="0.01" min="0" defaultValue="0" placeholder="0" />
                                        </Field>
                                    </div>
                                    <Button type="submit" className="w-full">
                                        Сохранить
                                    </Button>
                                </form>
                            </SectionCard>

                            <SectionCard title="Редактировать объект" subtitle="Update hotel">
                                {hotels.length === 0 ? (
                                    <p className="text-sm text-slate-500 dark:text-white/60">Пока нет отелей для изменения</p>
                                ) : (
                                    <>
                                        <Field label="Выберите объект" htmlFor="edit-hotel">
                                            <select
                                                id="edit-hotel"
                                                className={selectClassName}
                                                value={selectedHotelId}
                                                onChange={(event) => setSelectedHotelId(event.target.value)}
                                            >
                                                <option value="" >
                                                    Не выбрано
                                                </option>
                                                {hotels.map((hotel) => (
                                                    <option key={hotel.id} value={hotel.id} >
                                                        {hotel.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </Field>
                                        <form className="mt-4 space-y-3" onSubmit={handleUpdateHotel}>
                                            <Field label="Название" htmlFor="edit-name">
                                                <Input
                                                    id="edit-name"
                                                    name="name"
                                                    value={editForm.name}
                                                    onChange={handleEditFieldChange}
                                                    placeholder="Название"
                                                    disabled={!selectedHotelId || isUpdatingHotel}

                                                />
                                            </Field>
                                            <Field label="Адрес" htmlFor="edit-address">
                                                <Input
                                                    id="edit-address"
                                                    name="address"
                                                    value={editForm.address}
                                                    onChange={handleEditFieldChange}
                                                    placeholder="Город, улица, дом"
                                                    disabled={!selectedHotelId || isUpdatingHotel}

                                                />
                                            </Field>
                                            <Field label="Заметки" htmlFor="edit-notes" hint="необязательно">
                                                <TextArea
                                                    id="edit-notes"
                                                    name="notes"
                                                    value={editForm.notes}
                                                    onChange={handleEditFieldChange}
                                                    placeholder="Особенности"
                                                    disabled={!selectedHotelId || isUpdatingHotel}
                                                    rows={4}
                                                />
                                            </Field>
                                            <Field label="ID чата уборки" htmlFor="edit-cleaningChatId" hint="Telegram">
                                                <Input
                                                    id="edit-cleaningChatId"
                                                    name="cleaningChatId"
                                                    value={editForm.cleaningChatId}
                                                    onChange={handleEditFieldChange}
                                                    placeholder="Например, -1001234567890"
                                                    disabled={!selectedHotelId || isUpdatingHotel}

                                                />
                                                <p className="text-xs text-slate-500 dark:text-white/50">
                                                    Укажите Telegram-группу, куда отправлять задачи уборки.
                                                </p>
                                            </Field>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                <Field label="Часовой пояс" htmlFor="edit-timezone">
                                                    <select id="edit-timezone" name="timezone" value={editForm.timezone} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} className={selectClassName}>
                                                        <option value="Asia/Bishkek">Бишкек (UTC+6)</option>
                                                        <option value="Asia/Almaty">Алматы (UTC+5)</option>
                                                    </select>
                                                </Field>
                                                <Field label="Валюта" htmlFor="edit-currency">
                                                    <select id="edit-currency" name="currency" value={editForm.currency} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} className={selectClassName}>
                                                        <option value="KGS">KGS</option>
                                                        <option value="KZT">KZT</option>
                                                    </select>
                                                </Field>
                                                <Field label="Начало расчетного месяца" htmlFor="edit-financialCycleStartDay" hint="1-31">
                                                    <Input id="edit-financialCycleStartDay" name="financialCycleStartDay" type="number" min="1" max="31" step="1" value={editForm.financialCycleStartDay} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                                    <input
                                                        type="checkbox"
                                                        name="hasMealPlan"
                                                        checked={editForm.hasMealPlan}
                                                        onChange={handleEditFieldChange}
                                                        disabled={!selectedHotelId || isUpdatingHotel}
                                                        className="accent-emerald-500"
                                                    />
                                                    Показывать питание в заселениях
                                                </label>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                                    <input
                                                        type="checkbox"
                                                        name="usesExtranets"
                                                        checked={editForm.usesExtranets}
                                                        onChange={handleEditFieldChange}
                                                        disabled={!selectedHotelId || isUpdatingHotel}
                                                        className="accent-emerald-500"
                                                    />
                                                    Использовать экстранеты для этой точки
                                                </label>
                                                <div className="mt-3">
                                                    <Field label="Список экстранетов" htmlFor="edit-extranetNames" hint="По одному в строке">
                                                        <TextArea
                                                            id="edit-extranetNames"
                                                            name="extranetNames"
                                                            rows={4}
                                                            value={editForm.extranetNames}
                                                            onChange={handleEditFieldChange}
                                                            placeholder="Booking&#10;Agoda&#10;Ostrovok"
                                                            disabled={!selectedHotelId || isUpdatingHotel}
                                                        />
                                                    </Field>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                                <Field label={`Зарплаты / мес (${editForm.currency || overviewDisplay.currency})`} htmlFor="edit-monthlyPayrollCost">
                                                    <Input id="edit-monthlyPayrollCost" name="monthlyPayrollCost" type="number" step="0.01" min="0" value={editForm.monthlyPayrollCost} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                                <Field label={`Аренда / мес (${editForm.currency || overviewDisplay.currency})`} htmlFor="edit-monthlyRentCost">
                                                    <Input id="edit-monthlyRentCost" name="monthlyRentCost" type="number" step="0.01" min="0" value={editForm.monthlyRentCost} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                                <Field label={`Ком услуги / мес (${editForm.currency || overviewDisplay.currency})`} htmlFor="edit-monthlyUtilitiesCost">
                                                    <Input id="edit-monthlyUtilitiesCost" name="monthlyUtilitiesCost" type="number" step="0.01" min="0" value={editForm.monthlyUtilitiesCost} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                                <Field label={`Хоз товары / мес (${editForm.currency || overviewDisplay.currency})`} htmlFor="edit-monthlySuppliesCost">
                                                    <Input id="edit-monthlySuppliesCost" name="monthlySuppliesCost" type="number" step="0.01" min="0" value={editForm.monthlySuppliesCost} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                                <Field label={`Прочее / мес (${editForm.currency || overviewDisplay.currency})`} htmlFor="edit-monthlyOtherCost">
                                                    <Input id="edit-monthlyOtherCost" name="monthlyOtherCost" type="number" step="0.01" min="0" value={editForm.monthlyOtherCost} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} />
                                                </Field>
                                            </div>
                                            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                                                <Button type="submit" className="w-full" disabled={!selectedHotelId || isUpdatingHotel}>
                                                    {isUpdatingHotel ? "Сохраняем..." : "Обновить отель"}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="danger"
                                                    disabled={!selectedHotelId || isDeletingHotel}
                                                    onClick={() => setConfirmDelete(true)}
                                                    className="w-full sm:w-auto"
                                                >
                                                    {isDeletingHotel ? "Удаляем..." : "Удалить"}
                                                </Button>
                                            </div>
                                        </form>
                                    </>
                                )}
                            </SectionCard>

                            {/* Observer management */}
                            <SectionCard title="Наблюдатели" subtitle="Observer access" className="lg:col-span-2">

                                {/* Existing observers list */}
                                {observers && observers.length > 0 && (
                                    <div className="mb-5 space-y-2">
                                        {observers.map((obs) => (
                                            <div key={obs.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-light-text dark:text-white truncate">{obs.displayName}</p>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-white/40">Логин: {obs.loginName} · {obs.hotels.map((h) => h.name).join(', ') || '—'}</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        className="rounded-xl px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-200 hover:text-slate-800 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white"
                                                        onClick={() => { setResetPasswordId(obs.id); setResetPasswordValue(''); }}
                                                    >
                                                        Пароль
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="rounded-xl px-2.5 py-1.5 text-xs text-rose-500 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/12"
                                                        disabled={deletingObserverId === obs.id}
                                                        onClick={() => handleDeleteObserver(obs.id)}
                                                    >
                                                        {deletingObserverId === obs.id ? '…' : 'Удалить'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Reset password inline */}
                                {resetPasswordId && (
                                    <div className="mb-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <p className="text-xs text-slate-600 dark:text-white/60">Новый пароль (мин. 6 символов)</p>
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Input
                                                type="text"
                                                placeholder="Новый пароль"
                                                value={resetPasswordValue}
                                                onChange={(e) => setResetPasswordValue(e.target.value)}
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={resetPasswordValue.length < 6 || resettingPassword}
                                                onClick={handleResetObserverPassword}
                                            >
                                                {resettingPassword ? '…' : 'OK'}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setResetPasswordId(null)}
                                            >
                                                ✕
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Create observer form */}
                                <form className="space-y-3" onSubmit={handleCreateObserver}>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Новый доступ</p>
                                    <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                                        <Field label="Имя">
                                            <Input
                                                placeholder="Имя"
                                                value={newObserver.displayName}
                                                onChange={(e) => setNewObserver((prev) => ({ ...prev, displayName: e.target.value }))}
                                                required
                                            />
                                        </Field>
                                        <Field label="Логин">
                                            <Input
                                                placeholder="Логин (латиница)"
                                                value={newObserver.loginName}
                                                onChange={(e) => setNewObserver((prev) => ({ ...prev, loginName: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))}
                                                required
                                            />
                                        </Field>
                                        <Field label="Пароль" hint="мин. 6 символов">
                                            <Input
                                                placeholder="Пароль"
                                                type="password"
                                                value={newObserver.password}
                                                onChange={(e) => setNewObserver((prev) => ({ ...prev, password: e.target.value }))}
                                                required
                                                minLength={6}
                                            />
                                        </Field>
                                        <Field label="Объект">
                                            <select
                                                value={newObserver.hotelId}
                                                onChange={(e) => setNewObserver((prev) => ({ ...prev, hotelId: e.target.value }))}
                                                className={selectClassName}
                                                required
                                            >
                                                <option value="">Выберите объект</option>
                                                {hotels.map((hotel) => (
                                                    <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
                                                ))}
                                            </select>
                                        </Field>
                                    </div>
                                    <Button type="submit" className="w-full sm:w-auto" disabled={creatingObserver}>
                                        {creatingObserver ? 'Создаём…' : 'Создать наблюдателя'}
                                    </Button>
                                </form>
                            </SectionCard>
                        </section>
                    )
                    }

                    {/* Delete hotel confirm modal */}
                    {confirmDelete && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                            <Card className="w-full max-w-sm space-y-4 p-5 text-center text-light-text dark:text-white">
                                <p className="text-base font-semibold">Удалить отель?</p>
                                <p className="text-sm text-slate-500 dark:text-white/50">Действие необратимо. Все данные отеля будут удалены.</p>
                                <div className="flex gap-2">
                                    <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
                                        Отмена
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="danger"
                                        className="flex-1"
                                        disabled={isDeletingHotel}
                                        onClick={() => { setConfirmDelete(false); handleDeleteHotel(); }}
                                    >
                                        Удалить
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                    </main>
                </div>
            </div>
        </div>
    );
}
