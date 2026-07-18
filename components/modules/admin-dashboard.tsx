"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { useToast } from '@/components/ui/toast';
import useSWR from "swr";
import {
    Activity,
    BarChart3,
    Building2,
    Check,
    ChevronDown,
    CircleDollarSign,
    Download,
    Globe2,
    Hotel,
    KeyRound,
    Link2,
    LogOut,
    Pencil,
    Plus,
    Settings2,
    SlidersHorizontal,
    TrendingDown,
    TrendingUp,
    Trash2,
    Trophy,
    Users,
    X,
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
import { Select } from "@/components/ui/select";
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

type ExpensePageMeta = {
    total: number;
    offset: number;
    returned: number;
    limit: number;
    hasMore: boolean;
    truncated: boolean;
};

type ExpensePageResponse = {
    recentExpenses: ExpenseEntry[];
    recentExpensesMeta: ExpensePageMeta;
};

type HotelRankingItem = {
    id: string;
    name: string;
    currency?: string | null;
    score: number;
    revenue: number;
    net: number;
    expenses: number;
    rooms: number;
    shifts: number;
    stays: number;
    roomNights: number;
    revenuePerRoom: number;
    averageStayRevenue: number;
    occupancyRate: number;
    expenseRatio: number;
};

type ManagerRankingItem = {
    id: string;
    name: string;
    score: number;
    revenue: number;
    net: number;
    expenses: number;
    shifts: number;
    stays: number;
    roomNights: number;
    revenuePerShift: number;
    averageStayRevenue: number;
    expenseRatio: number;
    hotels: string[];
};

type ManagersByHotelRankingGroup = {
    hotelId: string;
    hotelName: string;
    managers: ManagerRankingItem[];
};

type RankingDetailSelection =
    | { kind: "hotel"; item: HotelRankingItem }
    | { kind: "manager"; item: ManagerRankingItem; hotelName?: string };

type AdminHotelDirectoryItem = {
    id: string;
    name: string;
    address?: string | null;
    country?: string | null;
    usesExtranets?: boolean | null;
    extranetNames?: string[];
    hasMealPlan?: boolean | null;
    allowGroupStays?: boolean | null;
    allowPostpaidStays?: boolean | null;
    allowOnlinePayments?: boolean | null;
    guestQrEnabled?: boolean | null;
    showInGuestListing?: boolean | null;
    guestDescription?: string | null;
    guestAmenities?: string[];
    guestPhotoUrls?: string[];
    guestMapUrl?: string | null;
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
    managers: Array<{
        id: string;
        displayName: string | null;
        telegramId?: string | null;
        username?: string | null;
        role: string;
        hasPin?: boolean;
    }>;
};

type AdminHotelConfigurationItem = Omit<AdminHotelDirectoryItem, 'managers'>;

type AdminHotelSummary = AdminHotelDirectoryItem & {
    roomCount: number;
    occupiedRooms: number;
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
    breakdowns?: {
        shifts: Array<{
            id: string;
            number: number;
            openedAt: string;
            status: "OPEN" | "CLOSED";
            hotelId: string;
            hotelName: string;
            managerName: string;
            cashIn: number;
            cashOut: number;
            collections: number;
            payouts: number;
            adjustments: number;
            stays: number;
            net: number;
        }>;
    };
    rankings?: {
        period: {
            startAt: string;
            endAt: string;
            days: number;
        };
        hotels: HotelRankingItem[];
        managers: ManagerRankingItem[];
        managersByHotel?: ManagersByHotelRankingGroup[];
    };
    recentExpenses?: ExpenseEntry[];
    recentExpensesMeta?: ExpensePageMeta;
};

type AdminTab = "overview" | "hotels" | "guests" | "manage";

type OverviewFilters = {
    startDate: string;
    endDate: string;
    startAt: string;
    endAt: string;
    hotelIds: string[];
    managerId: string;
    shiftIds: string[];
};

type ShiftFilterOption = {
    id: string;
    number: number;
    status: "OPEN" | "CLOSED";
    openedAt: string;
    closedAt?: string | null;
    hotel: { id: string; name: string };
    manager: { id: string; displayName: string };
};

type PeriodPreset = "today" | "week" | "month" | "year";
type ManageSection = "general" | "features" | "listing" | "integrations" | "finance" | "access";

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
    allowGroupStays?: boolean;
    allowPostpaidStays?: boolean;
    allowOnlinePayments?: boolean;
    guestQrEnabled?: boolean;
    showInGuestListing?: boolean;
    guestDescription?: string | null;
    guestAmenities?: string[];
    guestPhotoUrls?: string[];
    guestMapUrl?: string | null;
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
    allowGroupStays: boolean;
    allowPostpaidStays: boolean;
    allowOnlinePayments: boolean;
    guestQrEnabled: boolean;
    showInGuestListing: boolean;
    guestDescription: string;
    guestAmenities: string;
    guestPhotoUrls: string;
    guestMapUrl: string;
    financialCycleStartDay: string;
    monthlyPayrollCost: string;
    monthlyRentCost: string;
    monthlyUtilitiesCost: string;
    monthlySuppliesCost: string;
    monthlyOtherCost: string;
};

type GuestVerificationStatus = "PENDING" | "VERIFIED" | "NEEDS_REVIEW";
type GuestProfileAuditAction = "PROFILE_CREATED" | "PROFILE_UPDATED" | "DOCUMENT_VERIFIED" | "CONSENT_ACCEPTED";

type AdminGuestProfile = {
    id: string;
    fullName: string;
    phone?: string | null;
    telegramId?: string | null;
    documentNumber?: string | null;
    verificationStatus: GuestVerificationStatus;
    verifiedAt?: string | null;
    verifiedByName?: string | null;
    verifiedHotelName?: string | null;
    consentAcceptedAt?: string | null;
    consentVersion?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
    hotel?: {
        id: string;
        name: string;
        timezone?: string | null;
        currency?: string | null;
    } | null;
    lastStay?: {
        id: string;
        status: string;
        hotelName: string;
        roomLabel: string;
        scheduledCheckIn: string;
        scheduledCheckOut: string;
        timezone?: string | null;
    } | null;
    auditLogs: Array<{
        id: string;
        action: GuestProfileAuditAction;
        actorType: "GUEST" | "MANAGER" | "ADMIN" | "SYSTEM";
        actorName?: string | null;
        hotelName?: string | null;
        changedFields: string[];
        createdAt: string;
    }>;
};

type GuestFormState = {
    id?: string;
    hotelId: string;
    fullName: string;
    phone: string;
    telegramId: string;
    documentNumber: string;
    verificationStatus: GuestVerificationStatus;
    notes: string;
    consentAccepted: boolean;
    consentVersion: string;
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
    allowGroupStays: true,
    allowPostpaidStays: false,
    allowOnlinePayments: true,
    guestQrEnabled: false,
    showInGuestListing: true,
    guestDescription: "",
    guestAmenities: "",
    guestPhotoUrls: "",
    guestMapUrl: "",
    financialCycleStartDay: "1",
    monthlyPayrollCost: "0",
    monthlyRentCost: "0",
    monthlyUtilitiesCost: "0",
    monthlySuppliesCost: "0",
    monthlyOtherCost: "0",
});

const createEmptyGuestForm = (): GuestFormState => ({
    hotelId: "",
    fullName: "",
    phone: "",
    telegramId: "",
    documentNumber: "",
    verificationStatus: "PENDING",
    notes: "",
    consentAccepted: true,
    consentVersion: "admin-manual-2026-06-25",
});

const guestToForm = (guest: AdminGuestProfile): GuestFormState => ({
    id: guest.id,
    hotelId: guest.hotel?.id ?? "",
    fullName: guest.fullName ?? "",
    phone: guest.phone ?? "",
    telegramId: guest.telegramId ?? "",
    documentNumber: guest.documentNumber ?? "",
    verificationStatus: guest.verificationStatus,
    notes: guest.notes ?? "",
    consentAccepted: Boolean(guest.consentAcceptedAt),
    consentVersion: guest.consentVersion ?? "admin-manual-2026-06-25",
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

const parseGuestShowcaseText = (value?: string | null, maxItems = 40) => {
    return (value ?? '')
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.toLocaleLowerCase('ru-RU') === item.toLocaleLowerCase('ru-RU')) === index)
        .slice(0, maxItems);
};

const fromMinorUnits = (value?: number | null) => {
    if (!value) return "0";
    return String(value / 100);
};

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatDT = (value?: string | null, tz?: string) => fdt(value, tz, undefined, "");
const guestVerificationMeta: Record<GuestVerificationStatus, { label: string; className: string }> = {
    PENDING: { label: "Не проверен", className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.06] dark:text-white/62" },
    VERIFIED: { label: "Проверен", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/55 dark:bg-[#123428] dark:text-emerald-100" },
    NEEDS_REVIEW: { label: "Уточнить", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/50 dark:bg-[#3b2b12] dark:text-amber-100" },
};
const guestAuditActionLabels: Record<GuestProfileAuditAction, string> = {
    PROFILE_CREATED: "Профиль создан",
    PROFILE_UPDATED: "Профиль изменен",
    DOCUMENT_VERIFIED: "Документ подтвержден",
    CONSENT_ACCEPTED: "Согласие принято",
};
const guestAuditFieldLabels: Record<string, string> = {
    fullName: "имя",
    phone: "телефон",
    documentNumber: "документ",
    verificationStatus: "статус",
    verifiedAt: "дата проверки",
    verifiedById: "кто проверил",
    verifiedHotelId: "объект проверки",
    notes: "заметка",
    consentAcceptedAt: "согласие",
    consentVersion: "версия согласия",
};
const formatGuestAuditFields = (fields: string[]) => fields.map((field) => guestAuditFieldLabels[field] ?? field).join(", ");
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

const selectClassName = "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-light-text transition-[border-color,box-shadow,background-color] focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 disabled:opacity-40 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-white dark:focus:border-blue-400/50 dark:focus:ring-blue-400/10";

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
        hotelIds: [],
        managerId: "",
        shiftIds: [],
    };
};

function SectionCard({ title, subtitle, actions, className, children }: { title: string; subtitle?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
    return (
        <Card className={`relative !overflow-visible !border-slate-200/80 !bg-white !shadow-sm p-4 dark:!border-white/[0.07] dark:!bg-[#171b21] dark:!shadow-none ${className ?? ""}`}>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
                    {subtitle ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">{subtitle}</p> : null}
                </div>
                {actions}
            </div>
            {children}
        </Card>
    );
}

function CollapsibleSection({
    title,
    subtitle,
    summary,
    defaultOpen = false,
    className,
    children,
}: {
    title: string;
    subtitle?: string;
    summary?: string;
    defaultOpen?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.04] ${className ?? ""}`}>
            <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.035]"
                onClick={() => setIsOpen((current) => !current)}
                aria-expanded={isOpen}
            >
                <span className="min-w-0">
                    {subtitle ? <span className="block text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-white/30">{subtitle}</span> : null}
                    <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                    {summary ? <span className="hidden text-xs text-slate-500 dark:text-white/38 sm:inline">{summary}</span> : null}
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/50">
                        <ChevronDown className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                    </span>
                </span>
            </button>
            {isOpen ? <div className="border-t border-slate-200/80 p-3 dark:border-white/[0.06] sm:p-4">{children}</div> : null}
        </section>
    );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400" htmlFor={htmlFor}>
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
        <Card className="col-span-1 overflow-hidden p-4 text-light-text dark:text-white lg:col-span-4 lg:p-5">
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
                    <div className={`w-full rounded-xl border px-4 py-3 text-left sm:max-w-xs sm:self-start sm:text-right ${target.onTrack ? "border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-400/10" : "border-amber-200/80 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-400/10"}`}>
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

                    <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.03]">
                        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <span className="text-slate-600 dark:text-white/55">Покрытие плана</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{formatPercentInt(target.coveredPct * 100)}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                            <div
                                className="h-full rounded-full bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.45)]"
                                style={{ width: target.coveredPct > 0 ? `${Math.max(4, Math.min(target.coveredPct * 100, 100))}%` : "0%" }}
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

                    <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">Состав месячного плана</summary>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                            {breakdown.map((item) => (
                                <div key={item.label} className="min-w-0 border-l-2 border-slate-200 px-3 py-1 dark:border-white/[0.08]">
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500">{item.label}</p>
                                    <p className="mt-1 break-words text-xs font-semibold leading-snug text-slate-900 dark:text-white">{formatCurrency(item.value, currency)}</p>
                                </div>
                            ))}
                        </div>
                    </details>
                </>
            ) : null}
        </Card>
    );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
    return <section className="space-y-4">{children}</section>;
}

function ToggleRow({
    title,
    description,
    name,
    checked,
    disabled,
    onChange,
}: {
    title: string;
    description: string;
    name: keyof HotelFormState;
    checked: boolean;
    disabled?: boolean;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
    return (
        <label className="flex cursor-pointer items-start justify-between gap-5 border-b border-slate-200/70 py-4 last:border-b-0 dark:border-white/[0.055]">
            <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 dark:text-white/90">{title}</span>
                <span className="mt-1 block max-w-xl text-xs leading-relaxed text-slate-500 dark:text-white/40">{description}</span>
            </span>
            <span className="relative mt-0.5 shrink-0">
                <input
                    type="checkbox"
                    name={name}
                    checked={checked}
                    disabled={disabled}
                    onChange={onChange}
                    className="peer sr-only"
                />
                <span className="block h-6 w-10 rounded-full bg-slate-200 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/35 peer-focus-visible:ring-offset-2 peer-disabled:opacity-40 dark:bg-white/10 dark:peer-checked:bg-blue-500" />
                <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </span>
        </label>
    );
}

function CheckboxPicker({ label, options, selected, onChange, emptyLabel }: {
    label: string;
    options: Array<{ id: string; label: string; description?: string }>;
    selected: string[];
    onChange: (ids: string[]) => void;
    emptyLabel: string;
}) {
    const selectedSet = new Set(selected);
    const buttonLabel = selected.length === 0 ? emptyLabel : selected.length === 1
        ? options.find((option) => option.id === selected[0])?.label ?? "Выбрано: 1"
        : `Выбрано: ${selected.length}`;

    return (
        <details className="group relative open:z-50">
            <summary className={`${selectClassName} flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}>
                <span className="truncate">{buttonLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-[100] mt-2 max-h-80 w-full min-w-[18rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] dark:border-white/[0.1] dark:bg-[#1a1f26]">
                <div className="mb-1 flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
                    {selected.length > 0 && <button type="button" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400" onClick={() => onChange([])}>Сбросить</button>}
                </div>
                {options.length === 0 ? <p className="px-2 py-3 text-sm text-slate-400">Нет доступных вариантов</p> : options.map((option) => {
                    const checked = selectedSet.has(option.id);
                    return (
                        <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.05]">
                            <input type="checkbox" className="sr-only" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== option.id) : [...selected, option.id])} />
                            <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                                {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0"><span className="block truncate text-sm text-slate-700 dark:text-slate-200">{option.label}</span>{option.description && <span className="block truncate text-xs text-slate-400">{option.description}</span>}</span>
                        </label>
                    );
                })}
            </div>
        </details>
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

function ExpenseReasonSummary({ entries, defaultCurrency, isComplete = true, className }: {
    entries: ExpenseEntry[];
    defaultCurrency?: string;
    isComplete?: boolean;
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
            .slice(0, 7);
    }, [entries]);
    const maxAmount = Math.max(...grouped.map((item) => item.amount), 0);

    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Структура расходов</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{isComplete ? "По категориям" : "По загруженным операциям"}</h3>
            <div className="mt-4 space-y-3">
                {grouped.length ? grouped.map((item) => {
                    const width = maxAmount > 0 ? Math.max(8, Math.round((item.amount / maxAmount) * 100)) : 0;
                    return (
                        <div key={item.label} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <p className="min-w-0 truncate font-medium text-slate-900 dark:text-white">{item.label}</p>
                                <p className="shrink-0 font-semibold text-slate-900 dark:text-white">{formatCurrency(item.amount, defaultCurrency)}</p>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                                <div
                                    className="h-full rounded-full bg-slate-800 dark:bg-slate-200"
                                    style={{ width: `${width}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-white/38">{item.count} {item.count === 1 ? "операция" : item.count < 5 ? "операции" : "операций"}</p>
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

function ExpenseTable({ entries, totalCount, defaultCurrency, defaultTimezone, showHotelName = false, className }: {
    entries: ExpenseEntry[];
    totalCount?: number;
    defaultCurrency?: string;
    defaultTimezone?: string;
    showHotelName?: boolean;
    className?: string;
}) {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
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
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Загруженные операции по фильтру</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-white/40">
                        Загружено {entries.length}{totalCount != null ? ` из ${totalCount}` : ""}; поиск нашёл {filteredEntries.length}.
                    </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row sm:items-center">
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Поиск по причине, менеджеру, объекту"
                    />
                    <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setIsOpen((value) => !value)}>
                        {isOpen ? "Скрыть" : "Показать"}
                    </Button>
                </div>
            </div>
            {isOpen ? (
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
            ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-white/40">
                    Журнал доступен по кнопке “Показать”. В сводке остаются только агрегаты и последние важные списания.
                </div>
            )}
        </Card>
    );
}

function EfficiencyRankingCard({ title, subtitle, kind, items, defaultCurrency, className, onSelect }: {
    title: string;
    subtitle: string;
    kind: "hotels" | "managers";
    items: Array<HotelRankingItem | ManagerRankingItem>;
    defaultCurrency?: string;
    className?: string;
    onSelect?: (item: HotelRankingItem | ManagerRankingItem) => void;
}) {
    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">{subtitle}</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
                </div>
                <Trophy className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-white/[0.06]">
                <div className="min-w-[680px]">
                <div className="hidden grid-cols-[2.2rem_minmax(170px,1fr)_4.5rem_7rem_7rem_7rem] gap-3 border-b border-slate-200/80 bg-slate-50 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-white/35 lg:grid">
                    <span>№</span>
                    <span>{kind === "hotels" ? "Объект" : "Менеджер"}</span>
                    <span className="text-right">Score</span>
                    <span className="text-right">Выручка</span>
                    <span className="text-right">Чистыми</span>
                    <span className="text-right">{kind === "hotels" ? "На номер" : "На смену"}</span>
                </div>
                {items.length ? items.map((item, index) => {
                    const currency = "currency" in item ? item.currency ?? defaultCurrency : defaultCurrency;
                    const scoreTone = item.score >= 75
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/12 dark:text-emerald-200"
                        : item.score >= 45
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-400/12 dark:text-amber-100"
                            : "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-white/55";
                    const primaryMetric = kind === "hotels"
                        ? `на номер ${formatCurrency((item as HotelRankingItem).revenuePerRoom, currency ?? undefined)}`
                        : `на смену ${formatCurrency((item as ManagerRankingItem).revenuePerShift, currency ?? undefined)}`;
                    const activityMetric = kind === "hotels"
                        ? `загрузка ${formatPercent((item as HotelRankingItem).occupancyRate)}`
                        : `${(item as ManagerRankingItem).shifts} смен · ${(item as ManagerRankingItem).stays} заездов`;
                    const contextLabel = kind === "managers"
                        ? (item as ManagerRankingItem).hotels.join(", ")
                        : `${(item as HotelRankingItem).rooms} номеров · ${(item as HotelRankingItem).roomNights} номеро-дней`;

                    return (
                        <button
                            key={item.id}
                            type="button"
                            className="block w-full border-b border-slate-200/70 px-3 py-3 text-left transition hover:bg-slate-50 last:border-b-0 dark:border-white/[0.05] dark:hover:bg-white/[0.035]"
                            onClick={() => onSelect?.(item)}
                        >
                            <div className="grid gap-3 lg:grid-cols-[2.2rem_minmax(170px,1fr)_4.5rem_7rem_7rem_7rem] lg:items-center">
                                <span className="hidden text-sm font-semibold text-slate-500 dark:text-white/45 lg:block">{index + 1}</span>
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-white/60 lg:hidden">
                                                {index + 1}
                                            </span>
                                            <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white" title={item.name}>{item.name}</p>
                                        </div>
                                        <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold lg:hidden ${scoreTone}`}>
                                            {item.score}
                                        </span>
                                    </div>
                                    <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-white/40">{contextLabel || "Без объекта"}</p>
                                </div>
                                <span className={`hidden justify-self-end rounded-lg px-2 py-1 text-xs font-semibold lg:inline-flex ${scoreTone}`}>
                                    {item.score}
                                </span>
                                <p className="hidden truncate text-right text-sm font-semibold text-slate-900 dark:text-white lg:block">{formatCurrency(item.revenue, currency ?? undefined)}</p>
                                <p className={`hidden truncate text-right text-sm font-semibold lg:block ${item.net < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>{formatCurrency(item.net, currency ?? undefined)}</p>
                                <p className="hidden truncate text-right text-sm font-semibold text-slate-900 dark:text-white lg:block">{kind === "hotels" ? formatCurrency((item as HotelRankingItem).revenuePerRoom, currency ?? undefined) : formatCurrency((item as ManagerRankingItem).revenuePerShift, currency ?? undefined)}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-white/42 sm:grid-cols-4 lg:hidden">
                                <span>
                                    <span className="block text-[10px] uppercase tracking-[0.12em]">Выручка</span>
                                    <strong className="text-slate-900 dark:text-white">{formatCurrency(item.revenue, currency ?? undefined)}</strong>
                                </span>
                                <span>
                                    <span className="block text-[10px] uppercase tracking-[0.12em]">Чистыми</span>
                                    <strong className={item.net < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}>{formatCurrency(item.net, currency ?? undefined)}</strong>
                                </span>
                                <span>
                                    <span className="block text-[10px] uppercase tracking-[0.12em]">Эффект</span>
                                    <strong className="text-slate-900 dark:text-white">{primaryMetric}</strong>
                                </span>
                                <span>
                                    <span className="block text-[10px] uppercase tracking-[0.12em]">Активность</span>
                                    <strong className="text-slate-900 dark:text-white">{activityMetric}</strong>
                                </span>
                            </div>
                            <div className="mt-2 hidden items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-white/38 lg:flex">
                                <span>{activityMetric}</span>
                                <span>средний чек {formatCurrency(item.averageStayRevenue, currency ?? undefined)} · расходы {formatCurrency(item.expenses, currency ?? undefined)}</span>
                            </div>
                        </button>
                    );
                }) : (
                    <p className="px-3 py-4 text-sm text-slate-500 dark:text-white/40">
                        Пока нет данных для рейтинга за выбранный период.
                    </p>
                )}
                </div>
            </div>
        </Card>
    );
}

function ManagersByHotelRankingCard({ groups, defaultCurrency, className, onSelectManager }: {
    groups: ManagersByHotelRankingGroup[];
    defaultCurrency?: string;
    className?: string;
    onSelectManager?: (manager: ManagerRankingItem, hotelName: string) => void;
}) {
    return (
        <Card className={`p-4 ${className ?? ""}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">По каждому объекту</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Лучшие менеджеры филиалов</h3>
                </div>
                <Users className="h-4 w-4 shrink-0 text-slate-500 dark:text-white/40" aria-hidden="true" />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {groups.length ? groups.map((group) => (
                    <div key={group.hotelId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                        <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">{group.hotelName}</p>
                            <span className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-white/50">
                                {group.managers.length}
                            </span>
                        </div>
                        <div className="mt-3 space-y-2">
                            {group.managers.map((manager, index) => {
                                const scoreTone = manager.score >= 75
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/12 dark:text-emerald-200"
                                    : manager.score >= 45
                                        ? "bg-amber-50 text-amber-700 dark:bg-amber-400/12 dark:text-amber-100"
                                        : "bg-white text-slate-600 dark:bg-white/[0.06] dark:text-white/55";

                                return (
                                    <button
                                        key={`${group.hotelId}-${manager.id}`}
                                        type="button"
                                        className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-left transition hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.075]"
                                        onClick={() => onSelectManager?.(manager, group.hotelName)}
                                    >
                                        <span className="text-xs font-semibold text-slate-400 dark:text-white/35">{index + 1}</span>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{manager.name}</p>
                                            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-white/38">
                                                {formatCurrency(manager.revenue, defaultCurrency)} · {manager.shifts} смен · {manager.stays} заездов
                                            </p>
                                        </div>
                                        <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${scoreTone}`}>{manager.score}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )) : (
                    <p className="rounded-2xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:text-white/40 lg:col-span-2">
                        Пока нет менеджеров с данными по объектам за выбранный период.
                    </p>
                )}
            </div>
        </Card>
    );
}

function RankingDetailModal({ selection, currency, onClose }: {
    selection: RankingDetailSelection;
    currency?: string;
    onClose: () => void;
}) {
    const item = selection.item;
    const isHotel = selection.kind === "hotel";
    const title = isHotel ? item.name : selection.hotelName ? `${item.name} · ${selection.hotelName}` : item.name;
    const subtitle = isHotel ? "Детали эффективности отеля" : "Детали эффективности менеджера";
    const context = isHotel
        ? `${(item as HotelRankingItem).rooms} номеров · ${(item as HotelRankingItem).roomNights} номеро-дней · ${(item as HotelRankingItem).stays} заездов`
        : `${(item as ManagerRankingItem).shifts} смен · ${(item as ManagerRankingItem).stays} заездов · ${(item as ManagerRankingItem).hotels.join(", ") || "объект не указан"}`;
    const efficiencyLabel = isHotel ? "Выручка на номер" : "Выручка на смену";
    const efficiencyValue = isHotel
        ? (item as HotelRankingItem).revenuePerRoom
        : (item as ManagerRankingItem).revenuePerShift;
    const activityLabel = isHotel ? "Загрузка" : "Средний чек";
    const activityValue = isHotel
        ? formatPercent((item as HotelRankingItem).occupancyRate)
        : formatCurrency((item as ManagerRankingItem).averageStayRevenue, currency);
    const expenseRatioLabel = item.revenue > 0 ? formatPercent(item.expenseRatio) : "0%";

    const rows = [
        { label: "Score", value: String(item.score) },
        { label: "Выручка", value: formatCurrency(item.revenue, currency) },
        { label: "Чистыми", value: formatCurrency(item.net, currency), tone: item.net < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300" },
        { label: "Расходы", value: formatCurrency(item.expenses, currency) },
        { label: efficiencyLabel, value: formatCurrency(efficiencyValue, currency) },
        { label: activityLabel, value: activityValue },
        { label: "Доля расходов", value: expenseRatioLabel },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm">
            <Card className="max-h-[88dvh] w-full max-w-xl overflow-y-auto p-0 text-slate-900 shadow-2xl dark:text-white">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/[0.06]">
                    <div className="min-w-0">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/35">{subtitle}</p>
                        <h3 className="mt-1 break-words text-lg font-semibold">{title}</h3>
                        <p className="mt-1 break-words text-xs text-slate-500 dark:text-white/40">{context}</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                        ×
                    </Button>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2">
                    {rows.map((row) => (
                        <div key={row.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-white/35">{row.label}</p>
                            <p className={`mt-1 text-sm font-semibold ${row.tone ?? "text-slate-900 dark:text-white"}`}>{row.value}</p>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
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
    const [activeTab, setActiveTab] = useState<AdminTab>("overview");
    const handleLogout = async () => {
        if (onLogout) {
            await onLogout();
            return;
        }
        await fetch(withCountry('/api/session/logout'), { method: 'POST', cache: 'no-store' });
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

    const { data: hotelDirectory, mutate } = useSWR<AdminHotelDirectoryItem[]>(
        ['admin-hotel-directory', country],
        () => fetchWithAuth('/api/hotels?view=directory')
    );
    const { data: hotelConfigurations, mutate: mutateHotelConfigurations } = useSWR<AdminHotelConfigurationItem[]>(
        activeTab === 'manage' ? ['admin-hotel-configurations', country] : null,
        () => fetchWithAuth('/api/hotels?view=configuration')
    );
    const [filters, setFilters] = useState<OverviewFilters>(() => createPeriodFilters("month", getDisplaySettings().timezone));
    const [periodPreset, setPeriodPreset] = useState<PeriodPreset | null>("month");
    const [guestFilters, setGuestFilters] = useState<{ hotelId: string; status: string; search: string }>({ hotelId: "", status: "", search: "" });
    const deferredGuestSearch = useDeferredValue(guestFilters.search);

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
        if (filters.hotelIds.length) {
            params.set("hotelId", filters.hotelIds.join(","));
        }
        if (filters.managerId) {
            params.set("managerId", filters.managerId);
        }
        if (filters.shiftIds.length) {
            params.set("shiftId", filters.shiftIds.join(","));
        }
        return params.toString();
    }, [filters]);

    const overviewUrl = overviewQuery ? `/api/admin/overview?${overviewQuery}` : "/api/admin/overview";
    const hotelSummariesUrl = `/api/hotels?view=full${overviewQuery ? `&${overviewQuery}` : ''}`;
    const shiftOptionsUrl = useMemo(() => {
        const params = new URLSearchParams();
        if (filters.startDate) params.set("startDate", filters.startDate);
        if (filters.endDate) params.set("endDate", filters.endDate);
        if (filters.hotelIds.length) params.set("hotelId", filters.hotelIds.join(","));
        if (filters.managerId) params.set("managerId", filters.managerId);
        return `/api/admin/shifts?${params.toString()}`;
    }, [filters.endDate, filters.hotelIds, filters.managerId, filters.startDate]);
    const guestsUrl = useMemo(() => {
        const params = new URLSearchParams();
        if (guestFilters.hotelId) {
            params.set("hotelId", guestFilters.hotelId);
        }
        if (guestFilters.status) {
            params.set("status", guestFilters.status);
        }
        if (deferredGuestSearch.trim()) {
            params.set("search", deferredGuestSearch.trim());
        }
        params.set("limit", "120");
        return `/api/admin/guest-profiles?${params.toString()}`;
    }, [deferredGuestSearch, guestFilters.hotelId, guestFilters.status]);
    const { data: overview } = useSWR<AdminOverview>(
        activeTab === 'overview' ? ['admin-overview', country, overviewUrl] : null,
        () => fetchWithAuth(overviewUrl)
    );
    const { data: shiftOptionsData } = useSWR<{ shifts: ShiftFilterOption[] }>(
        activeTab === 'overview' ? ['admin-shift-options', country, shiftOptionsUrl] : null,
        () => fetchWithAuth(shiftOptionsUrl)
    );
    const { data: periodHotelSummaries, isLoading: isLoadingHotelSummaries } = useSWR<AdminHotelSummary[]>(
        activeTab === 'hotels' ? ['admin-period-hotels', country, hotelSummariesUrl] : null,
        () => fetchWithAuth(hotelSummariesUrl)
    );
    const { data: guestProfilesData, isLoading: isLoadingGuests, mutate: mutateGuests } = useSWR<{ guests: AdminGuestProfile[] }>(
        activeTab === 'guests' ? ['admin-guest-profiles', country, guestsUrl] : null,
        () => fetchWithAuth(guestsUrl)
    );

    const hotels = useMemo(() => hotelDirectory ?? [], [hotelDirectory]);
    const shiftOptions = shiftOptionsData?.shifts ?? [];
    const hotelSummaries = useMemo(() => periodHotelSummaries ?? [], [periodHotelSummaries]);
    const guestProfiles = guestProfilesData?.guests ?? [];
    const overviewDisplay = useMemo(() => {
        if (overview?.display) {
            return overview.display;
        }
        const hotelCountry = hotels.length ? hotels[0]?.country : undefined;
        return getDisplaySettings(hotelCountry);
    }, [overview, hotels]);

    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [editForm, setEditForm] = useState<HotelFormState>(() => createEmptyHotelForm(getDisplaySettings()));
    const [manageSection, setManageSection] = useState<ManageSection>("general");
    const [isCreateHotelOpen, setIsCreateHotelOpen] = useState(false);

    const [isUpdatingHotel, setIsUpdatingHotel] = useState(false);
    const [isDeletingHotel, setIsDeletingHotel] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [rankingDetail, setRankingDetail] = useState<RankingDetailSelection | null>(null);
    const [expenseHistoryPage, setExpenseHistoryPage] = useState<{ scope: string; entries: ExpenseEntry[]; total: number } | null>(null);
    const [isLoadingMoreExpenses, setIsLoadingMoreExpenses] = useState(false);
    const [guestForm, setGuestForm] = useState<GuestFormState | null>(null);
    const [isSavingGuest, setIsSavingGuest] = useState(false);
    const [guestToDelete, setGuestToDelete] = useState<AdminGuestProfile | null>(null);
    const [isDeletingGuest, setIsDeletingGuest] = useState(false);
    const { toast: notify } = useToast();

    const expenseScope = `${country}:${overviewUrl}`;
    const expenseEntries = useMemo(() => {
        const combined = [
            ...(overview?.recentExpenses ?? []),
            ...(expenseHistoryPage?.scope === expenseScope ? expenseHistoryPage.entries : []),
        ];
        return Array.from(new Map(combined.map((entry) => [entry.id, entry])).values());
    }, [expenseHistoryPage, expenseScope, overview?.recentExpenses]);
    const expenseTotal = expenseHistoryPage?.scope === expenseScope
        ? expenseHistoryPage.total
        : overview?.recentExpensesMeta?.total ?? expenseEntries.length;
    const hasMoreExpenses = expenseEntries.length < expenseTotal;

    // Observer management state
    type ObserverItem = {
        id: string;
        displayName: string;
        loginName: string;
        hotels: Array<{ id: string; name: string }>;
    };
    const { data: observers, mutate: mutateObservers } = useSWR<ObserverItem[]>(
        activeTab === 'manage' ? ['admin-observers', country] : null,
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
            hotelIds: prev.hotelIds,
            managerId: prev.managerId,
            shiftIds: prev.shiftIds,
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

    const openCreateGuestForm = useCallback(() => {
        setGuestForm({
            ...createEmptyGuestForm(),
            hotelId: guestFilters.hotelId || hotels[0]?.id || "",
        });
    }, [guestFilters.hotelId, hotels]);

    const openEditGuestForm = useCallback((guest: AdminGuestProfile) => {
        setGuestForm(guestToForm(guest));
    }, []);

    const handleGuestFormChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = event.target;
        const nextValue = event.target instanceof HTMLInputElement && event.target.type === "checkbox"
            ? event.target.checked
            : value;
        setGuestForm((prev) => (prev ? { ...prev, [name]: nextValue } : prev));
    }, []);

    const handleSaveGuest = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        if (!guestForm) return;

        if (!guestForm.fullName.trim()) {
            notify("Укажите имя гостя", "error");
            return;
        }
        if (!guestForm.hotelId) {
            notify("Выберите объект", "error");
            return;
        }
        if (!guestForm.consentAccepted) {
            notify("Нужно отметить согласие на обработку данных", "error");
            return;
        }
        if (guestForm.verificationStatus === "VERIFIED" && !guestForm.documentNumber.trim()) {
            notify("Для статуса Проверен нужен номер документа", "error");
            return;
        }

        setIsSavingGuest(true);
        try {
            const isEdit = Boolean(guestForm.id);
            const response = await fetch(withCountry(isEdit ? `/api/admin/guest-profiles/${guestForm.id}` : "/api/admin/guest-profiles"), {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({
                    hotelId: guestForm.hotelId,
                    fullName: guestForm.fullName.trim(),
                    phone: guestForm.phone.trim() || null,
                    telegramId: guestForm.telegramId.trim() || null,
                    documentNumber: guestForm.documentNumber.trim() || null,
                    verificationStatus: guestForm.verificationStatus,
                    notes: guestForm.notes.trim() || null,
                    consentAccepted: guestForm.consentAccepted,
                    consentVersion: guestForm.consentVersion.trim() || undefined,
                }),
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }

            await mutateGuests();
            setGuestForm(null);
            notify(isEdit ? "Гость обновлен" : "Гость добавлен", "success");
        } catch (error) {
            notify(error instanceof Error ? error.message : "Не удалось сохранить гостя", "error");
        } finally {
            setIsSavingGuest(false);
        }
    }, [guestForm, mutateGuests, notify, withCountry]);

    const handleDeleteGuest = useCallback(async () => {
        if (!guestToDelete) return;

        setIsDeletingGuest(true);
        try {
            const response = await fetch(withCountry(`/api/admin/guest-profiles/${guestToDelete.id}`), {
                method: "DELETE",
                credentials: "include",
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }

            await mutateGuests();
            setGuestToDelete(null);
            notify("Гость удален", "success");
        } catch (error) {
            notify(error instanceof Error ? error.message : "Не удалось удалить гостя", "error");
        } finally {
            setIsDeletingGuest(false);
        }
    }, [guestToDelete, mutateGuests, notify, withCountry]);

    useEffect(() => {
        if (!selectedHotelId) {
            setEditForm(createEmptyHotelForm(overviewDisplay));
            return;
        }

        if (!hotelConfigurations) {
            return;
        }

        const target = hotelConfigurations.find((hotel) => hotel.id === selectedHotelId);
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
                allowGroupStays: target.allowGroupStays !== false,
                allowPostpaidStays: Boolean(target.allowPostpaidStays),
                allowOnlinePayments: target.allowOnlinePayments !== false,
                guestQrEnabled: Boolean(target.guestQrEnabled),
                showInGuestListing: target.showInGuestListing !== false,
                guestDescription: target.guestDescription ?? "",
                guestAmenities: (target.guestAmenities ?? []).join('\n'),
                guestPhotoUrls: (target.guestPhotoUrls ?? []).join('\n'),
                guestMapUrl: target.guestMapUrl ?? "",
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
    }, [hotelConfigurations, selectedHotelId, overviewDisplay]);

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
            payload.allowGroupStays = formData.get('allowGroupStays') === 'on';
            payload.allowPostpaidStays = formData.get('allowPostpaidStays') === 'on';
            payload.allowOnlinePayments = formData.get('allowOnlinePayments') === 'on';
            payload.guestQrEnabled = formData.get('guestQrEnabled') === 'on';
            payload.showInGuestListing = formData.get('showInGuestListing') === 'on';
            payload.guestDescription = ((formData.get('guestDescription') as string | null)?.trim() || undefined);
            payload.guestAmenities = parseGuestShowcaseText(formData.get('guestAmenities') as string | null, 40);
            payload.guestPhotoUrls = parseGuestShowcaseText(formData.get('guestPhotoUrls') as string | null, 12);
            payload.guestMapUrl = ((formData.get('guestMapUrl') as string | null)?.trim() || undefined);
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

                const createdHotel = await res.json() as { id?: string };
                await Promise.all([mutate(), mutateHotelConfigurations()]);
                if (createdHotel.id) {
                    setSelectedHotelId(createdHotel.id);
                }
                setManageSection("general");
                setIsCreateHotelOpen(false);
                notify("Отель добавлен", 'success');
            } catch (error) {
                console.error(error);
                notify("Ошибка создания", 'error');
            }
        },
        [mutate, mutateHotelConfigurations, notify, withCountry],
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
                    allowGroupStays: editForm.allowGroupStays,
                    allowPostpaidStays: editForm.allowPostpaidStays,
                    allowOnlinePayments: editForm.allowOnlinePayments,
                    guestQrEnabled: editForm.guestQrEnabled,
                    showInGuestListing: editForm.showInGuestListing,
                    guestDescription: editForm.guestDescription.trim() || null,
                    guestAmenities: parseGuestShowcaseText(editForm.guestAmenities, 40),
                    guestPhotoUrls: parseGuestShowcaseText(editForm.guestPhotoUrls, 12),
                    guestMapUrl: editForm.guestMapUrl.trim() || null,
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

                await Promise.all([mutate(), mutateHotelConfigurations()]);
                notify("Изменения сохранены", 'success');
            } catch (error) {
                console.error(error);
                notify("Ошибка обновления", 'error');
            } finally {
                setIsUpdatingHotel(false);
            }
        },
        [editForm, mutate, mutateHotelConfigurations, notify, selectedHotelId, withCountry],
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

            await Promise.all([mutate(), mutateHotelConfigurations()]);
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm(overviewDisplay));
            notify("Отель удалён", 'success');
        } catch (error) {
            console.error(error);
            notify("Ошибка удаления", 'error');
        } finally {
            setIsDeletingHotel(false);
        }
    }, [mutate, mutateHotelConfigurations, notify, overviewDisplay, selectedHotelId, withCountry]);

    const adminTabs: Array<{ id: AdminTab; label: string; hint?: string; description: string; icon: LucideIcon }> = [
        { id: "overview", label: "Сводка", description: "Финансы, загрузка и темп", icon: BarChart3 },
        { id: "hotels", label: "Объекты", hint: hotels.length ? String(hotels.length) : undefined, description: "Состояние филиалов", icon: Hotel },
        { id: "guests", label: "Гости", hint: guestProfiles.length ? String(guestProfiles.length) : undefined, description: "Клиенты и проверки", icon: Users },
        { id: "manage", label: "Управление", description: "Настройки и доступы", icon: Settings2 },
    ];
    const manageSections: Array<{ id: ManageSection; label: string; panelTitle: string; description: string; icon: LucideIcon }> = [
        { id: "general", label: "Основное", panelTitle: "Основные данные", description: "Название, адрес, локаль и служебные контакты", icon: Building2 },
        { id: "features", label: "Функции", panelTitle: "Функции объекта", description: "Включайте только возможности, которыми пользуется этот филиал", icon: SlidersHorizontal },
        { id: "listing", label: "Листинг", panelTitle: "Гостевой листинг", description: "Описание, удобства, фотографии и карта", icon: Globe2 },
        { id: "integrations", label: "Интеграции", panelTitle: "Экстранеты", description: "Каналы продаж и внешние площадки бронирования", icon: Link2 },
        { id: "finance", label: "Финансы", panelTitle: "Постоянные расходы", description: "Месячный финансовый ориентир для сводки", icon: CircleDollarSign },
        { id: "access", label: "Доступы", panelTitle: "Наблюдатели", description: "Доступ сотрудников только к просмотру", icon: Users },
    ];
    const activeManageSection = manageSections.find((section) => section.id === manageSection) ?? manageSections[0];

    const managerOptions = useMemo(() => {
        const sourceHotels = filters.hotelIds.length ? hotels.filter((hotel) => filters.hotelIds.includes(hotel.id)) : hotels;
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
    }, [filters.hotelIds, hotels]);

    const overviewCurrency = useMemo(() => {
        if (filters.hotelIds.length === 1) {
            const h = hotels.find((hotel) => hotel.id === filters.hotelIds[0]);
            return h?.currency ?? overviewDisplay.currency;
        }
        return hotels.length === 1 ? (hotels[0]?.currency ?? overviewDisplay.currency) : overviewDisplay.currency;
    }, [filters.hotelIds, hotels, overviewDisplay.currency]);

    const overviewTimezone = useMemo(() => {
        if (filters.hotelIds.length === 1) {
            const h = hotels.find((hotel) => hotel.id === filters.hotelIds[0]);
            return h?.timezone ?? overviewDisplay.timezone;
        }
        return hotels.length === 1 ? (hotels[0]?.timezone ?? overviewDisplay.timezone) : overviewDisplay.timezone;
    }, [filters.hotelIds, hotels, overviewDisplay.timezone]);

    const overviewHotelLabel = useMemo(() => {
        if (filters.hotelIds.length === 0) return "";
        if (filters.hotelIds.length > 1) return `${filters.hotelIds.length} выбранных объектов`;
        return hotels.find((hotel) => hotel.id === filters.hotelIds[0])?.name ?? "";
    }, [filters.hotelIds, hotels]);

    const handleFilterInput = (field: keyof OverviewFilters, value: string) => {
        setPeriodPreset(null);
        setFilters((prev) => ({
            ...prev,
            [field]: value,
            ...(field === "startDate" || field === "endDate" ? { startAt: "", endAt: "" } : {}),
        }));
    };

    const handleHotelFilterChange = (hotelIds: string[]) => {
        setFilters((prev) => ({ ...prev, hotelIds, managerId: "", shiftIds: [] }));
    };

    const handlePeriodPreset = (preset: PeriodPreset) => {
        setPeriodPreset(preset);
        setFilters((prev) => ({
            ...prev,
            ...createPeriodFilters(preset, overviewTimezone),
            hotelIds: prev.hotelIds,
            managerId: prev.managerId,
            shiftIds: prev.shiftIds,
        }));
    };

    const handleLoadMoreExpenses = useCallback(async () => {
        if (!overview || !hasMoreExpenses || isLoadingMoreExpenses) return;

        const requestedScope = expenseScope;
        const params = new URLSearchParams(overviewQuery);
        params.set("view", "expenses");
        params.set("expenseOffset", String(expenseEntries.length));
        params.set("expenseLimit", "50");
        setIsLoadingMoreExpenses(true);

        try {
            const page = await fetchWithAuth(`/api/admin/overview?${params.toString()}`) as ExpensePageResponse;
            setExpenseHistoryPage((current) => {
                const previousEntries = current?.scope === requestedScope ? current.entries : [];
                const entries = Array.from(
                    new Map([...previousEntries, ...page.recentExpenses].map((entry) => [entry.id, entry])).values()
                );
                return {
                    scope: requestedScope,
                    entries,
                    total: page.recentExpensesMeta.total,
                };
            });
        } catch (error) {
            notify(error instanceof Error ? error.message : "Не удалось загрузить историю расходов", "error");
        } finally {
            setIsLoadingMoreExpenses(false);
        }
    }, [expenseEntries.length, expenseScope, fetchWithAuth, hasMoreExpenses, isLoadingMoreExpenses, notify, overview, overviewQuery]);

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
    const formatPeriodDate = (value: string, fallback: string) => {
        if (!value) return fallback;
        const date = new Date(`${value}T12:00:00`);
        return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
    };
    const desktopPeriodLabel = `${formatPeriodDate(filters.startDate, "начало")} — ${formatPeriodDate(filters.endDate, "сегодня")}`;
    const desktopStats = [
        {
            label: "Баланс",
            value: overview ? formatCurrency(overview.totals.netCash, overviewCurrency) : "—",
            icon: CircleDollarSign,
            tone: overview && overview.totals.netCash < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300",
        },
        {
            label: "Поступления",
            value: overview ? formatCurrency(overview.totals.cashIn, overviewCurrency) : "—",
            icon: TrendingUp,
            tone: "text-emerald-700 dark:text-emerald-300",
        },
        {
            label: "Расходы",
            value: overview ? formatCurrency(overview.totals.cashOut + overview.totals.collections + overview.totals.payouts, overviewCurrency) : "—",
            icon: TrendingDown,
            tone: "text-rose-600 dark:text-rose-300",
        },
        {
            label: "Загрузка",
            value: overview ? formatPercent(overview.occupancy.rate) : "—",
            icon: Activity,
            tone: "text-slate-800 dark:text-white",
        },
    ];

    return (
        <div className="min-h-screen bg-[#f6f7f9] text-light-text dark:bg-[#0c0f13]">
            <div className="lg:grid lg:min-h-screen lg:grid-cols-[15rem_minmax(0,1fr)]">
                <aside className="hidden border-r border-slate-200/80 bg-white px-4 py-5 dark:border-white/[0.07] dark:bg-[#111418] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
                    <div className="flex items-center gap-3 border-b border-slate-200 pb-5 dark:border-white/[0.06]">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                            <Building2 className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-950 dark:text-white">Hotel Ops</p>
                            <p className="truncate text-xs text-slate-500 dark:text-white/42">{user.displayName}</p>
                        </div>
                    </div>

                    <nav className="mt-5 space-y-1">
                        {adminTabs.map((tab) => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active
                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                                        }`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{tab.label}</span>
                                        <span className={`block truncate text-[11px] ${active ? "text-blue-500/70 dark:text-blue-300/60" : "text-slate-400 dark:text-slate-600"}`}>{tab.description}</span>
                                    </span>
                                    {tab.hint ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? "bg-white/14 text-white dark:bg-slate-900/8 dark:text-slate-500" : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-white/38"}`}>{tab.hint}</span> : null}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-white/[0.06]">
                        <ThemeToggle />
                        <Button type="button" size="sm" variant="ghost" className="gap-2" onClick={handleLogout}>
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                            Выйти
                        </Button>
                    </div>
                </aside>

                <div className="min-w-0">
                    <header className="flex flex-col gap-4 border-b border-slate-200 bg-white px-4 py-4 shadow-[0_14px_34px_-32px_rgba(15,23,42,0.38)] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-none sm:px-5 lg:hidden">
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
                    <div className="sticky top-0 z-10 bg-[#f4f6f8]/94 px-4 py-2 backdrop-blur-md dark:bg-[#0f1218]/94 sm:px-5 lg:hidden">
                        <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.045]">
                            <div className="flex gap-1 text-sm font-medium text-slate-700 dark:text-white/50">
                                {adminTabs.map((tab) => {
                                    const Icon = tab.icon;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setActiveTab(tab.id)}
                                            aria-label={tab.label}
                                            className={`flex-1 rounded-md px-2.5 py-1.5 transition-all ${activeTab === tab.id
                                                ? "bg-white text-slate-950 shadow-sm dark:bg-white/[0.12] dark:text-white"
                                                : "hover:text-slate-950 dark:hover:text-white/70"
                                                }`}
                                        >
                                            <span className="relative flex min-h-8 items-center justify-center">
                                                <Icon className="h-4 w-4" aria-hidden="true" />
                                                {tab.hint ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-white/45" aria-hidden="true" /> : null}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <main className="workspace-page w-full pb-16 pt-3 lg:py-5">
                        <div className="mb-4 hidden items-center justify-between gap-4 lg:flex">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="min-w-0">
                                    <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-white">{activeTabConfig.label}</h1>
                                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">{activeTabConfig.description}</p>
                                </div>
                            </div>
                            {activeTab === "overview" ? <div className="flex min-w-0 items-center gap-2">
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
                            </div> : null}
                        </div>

                        {activeTab === "overview" && <div className="mb-4 hidden grid-cols-4 gap-2.5 lg:grid">
                            {desktopStats.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} className="min-w-0 rounded-lg border border-slate-200/80 bg-white px-3.5 py-3 shadow-sm dark:border-white/[0.07] dark:bg-[#171b21] dark:shadow-none">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/30">{item.label}</p>
                                            <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/32" aria-hidden="true" />
                                        </div>
                                        <p className={`mt-1.5 truncate text-base font-semibold ${item.tone}`}>{item.value}</p>
                                    </div>
                                );
                            })}
                        </div>}

                    {activeTab === "overview" && (
                        <div className="space-y-3">
                            <SectionCard
                                title="Период и фильтры"
                                className="z-40 lg:p-4"
                            >
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
                                    <div className="md:col-span-2 xl:col-span-5">
                                        <div className="flex flex-wrap gap-1.5">
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
                                                    className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${periodPreset === preset.id
                                                        ? "bg-blue-600 text-white dark:bg-blue-500"
                                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
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
                                                className="h-9 min-w-0 rounded-lg text-[13px] sm:h-9"
                                                value={filters.startDate}
                                                onChange={(event) => handleFilterInput("startDate", event.target.value)}
                                                placeholder="С даты"
                                            />
                                        </Field>
                                        <Field label="Период до" htmlFor="overview-end">
                                            <Input
                                                id="overview-end"
                                                type="date"
                                                className="h-9 min-w-0 rounded-lg text-[13px] sm:h-9"
                                                value={filters.endDate}
                                                min={filters.startDate || undefined}
                                                onChange={(event) => handleFilterInput("endDate", event.target.value)}
                                                placeholder="По дату"
                                            />
                                        </Field>
                                        <Field label="Объект" htmlFor="overview-hotel">
                                            <CheckboxPicker label="Объекты" emptyLabel="Все объекты" selected={filters.hotelIds} onChange={handleHotelFilterChange} options={hotels.map((hotel) => ({ id: hotel.id, label: hotel.name }))} />
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
                                        <Field label="Смены" hint={shiftOptions.length ? `${shiftOptions.length}` : undefined}>
                                            <CheckboxPicker
                                                label="Смены"
                                                emptyLabel="Все смены"
                                                selected={filters.shiftIds}
                                                onChange={(shiftIds) => setFilters((prev) => ({ ...prev, shiftIds }))}
                                                options={shiftOptions.map((shift) => ({
                                                    id: shift.id,
                                                    label: `${shift.hotel.name} · смена №${shift.number}`,
                                                    description: `${shift.manager.displayName} · ${new Date(shift.openedAt).toLocaleDateString("ru-RU")}${shift.status === "OPEN" ? " · открыта" : ""}`,
                                                }))}
                                            />
                                        </Field>
                                </div>
                            </SectionCard>
                            <section className="grid grid-cols-1 gap-3 lg:grid-cols-4 xl:gap-4">
                                {overview ? (
                                    <>
                                        <BusinessTargetCard
                                            target={overview.businessTarget}
                                            currency={overviewCurrency}
                                            hotelLabel={overviewHotelLabel}
                                        />
                                        {(filters.hotelIds.length > 0 || filters.shiftIds.length > 0) && (
                                            <Card className="lg:col-span-4 p-4 sm:p-5">
                                                <div className="mb-4">
                                                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">Сравнение выбранного</h3>
                                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Каждый объект и смена показаны отдельно</p>
                                                </div>
                                                {filters.hotelIds.length > 0 && (
                                                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                                        {(overview.rankings?.hotels ?? []).map((hotel) => (
                                                            <div key={hotel.id} className="rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.035]">
                                                                <div className="flex items-start justify-between gap-3"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{hotel.name}</p><span className="text-xs text-slate-400">{formatPercent(hotel.occupancyRate)}</span></div>
                                                                <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{formatCurrency(hotel.net, hotel.currency || overviewCurrency)}</p>
                                                                <p className="mt-1 text-xs text-slate-500">Выручка {formatCurrency(hotel.revenue, hotel.currency || overviewCurrency)} · смен {hotel.shifts}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {filters.shiftIds.length > 0 && (
                                                    <div className={`${filters.hotelIds.length > 0 ? "mt-4 border-t border-slate-200 pt-4 dark:border-white/[0.07]" : ""} grid gap-2 md:grid-cols-2 xl:grid-cols-3`}>
                                                        {(overview.breakdowns?.shifts ?? []).map((shift) => (
                                                            <div key={shift.id} className="rounded-xl border border-slate-200/80 p-3.5 dark:border-white/[0.07]">
                                                                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{shift.hotelName} · смена №{shift.number}</p><p className="truncate text-xs text-slate-400">{shift.managerName}</p></div><span className={`h-2 w-2 shrink-0 rounded-full ${shift.status === "OPEN" ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} /></div>
                                                                <p className={`mt-2 text-lg font-semibold ${shift.net < 0 ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-white"}`}>{formatCurrency(shift.net, overviewCurrency)}</p>
                                                                <p className="mt-1 text-xs text-slate-500">Вход {formatCurrency(shift.cashIn, overviewCurrency)} · выход {formatCurrency(shift.cashOut + shift.collections + shift.payouts, overviewCurrency)} · гостей {shift.stays}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </Card>
                                        )}
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
                                        <Card className="overflow-hidden p-4 text-light-text dark:text-white">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Баланс</p>
                                            <p className="mt-2 truncate text-lg font-semibold tracking-tight sm:text-xl">{formatCurrency(overview.totals.netCash, overviewCurrency)}</p>
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
                                        <Card className="overflow-hidden p-4 text-light-text dark:text-white">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600 dark:text-white/30">Загрузка</p>
                                            <p className="mt-2 text-base sm:text-lg font-semibold">
                                                {formatPercent(overview.occupancy.rate)}
                                            </p>
                                            <p className="mt-1 text-[12px] text-slate-500 dark:text-white/40">
                                                {overview.occupancy.occupiedRooms}/{overview.occupancy.rooms} · смен {overview.shifts.active}
                                            </p>
                                        </Card>
                                        </div>
                                        <div className="col-span-1 grid grid-cols-1 gap-3 lg:col-span-4 lg:grid-cols-4">
                                            {overview.dailySeries && overview.dailySeries.length > 0 ? (
                                                <DailyLineChart data={overview.dailySeries} timeZone={overviewTimezone} />
                                            ) : null}
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
                                        </div>
                                        <CollapsibleSection
                                            title="Рейтинг"
                                            subtitle="Отели и менеджеры"
                                            summary={`${overview.rankings?.hotels.length ?? 0} / ${overview.rankings?.managers.length ?? 0}`}
                                            className="col-span-1 lg:col-span-4"
                                        >
                                            <div className="grid grid-cols-1 gap-3">
                                                <EfficiencyRankingCard
                                                    title="Лучшие отели"
                                                    subtitle="Эффективность"
                                                    kind="hotels"
                                                    items={overview.rankings?.hotels ?? []}
                                                    defaultCurrency={overviewCurrency}
                                                    onSelect={(item) => setRankingDetail({ kind: "hotel", item: item as HotelRankingItem })}
                                                />
                                                <EfficiencyRankingCard
                                                    title="Лучшие менеджеры"
                                                    subtitle="Общий рейтинг"
                                                    kind="managers"
                                                    items={overview.rankings?.managers ?? []}
                                                    defaultCurrency={overviewCurrency}
                                                    onSelect={(item) => setRankingDetail({ kind: "manager", item: item as ManagerRankingItem })}
                                                />
                                                <ManagersByHotelRankingCard
                                                    groups={overview.rankings?.managersByHotel ?? []}
                                                    defaultCurrency={overviewCurrency}
                                                    onSelectManager={(manager, hotelName) => setRankingDetail({ kind: "manager", item: manager, hotelName })}
                                                />
                                            </div>
                                        </CollapsibleSection>
                                        <CollapsibleSection
                                            title="Расходы"
                                            subtitle="Списания и журнал"
                                            summary={`${expenseEntries.length} из ${expenseTotal}`}
                                            className="col-span-1 lg:col-span-4"
                                        >
                                            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-white/45 sm:flex-row sm:items-center sm:justify-between">
                                                <p>
                                                    {hasMoreExpenses
                                                        ? `Показаны последние ${expenseEntries.length} из ${expenseTotal}. Полная история доступна по кнопке.`
                                                        : `Загружены все операции по выбранному фильтру: ${expenseTotal}.`}
                                                </p>
                                                {hasMoreExpenses ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="secondary"
                                                        className="shrink-0"
                                                        disabled={isLoadingMoreExpenses}
                                                        onClick={handleLoadMoreExpenses}
                                                    >
                                                        {isLoadingMoreExpenses ? "Загрузка…" : `Загрузить ещё ${Math.min(50, expenseTotal - expenseEntries.length)}`}
                                                    </Button>
                                                ) : null}
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                                <ExpenseFeed
                                                    title="Последние списания по фильтру"
                                                    entries={expenseEntries.slice(0, 5)}
                                                    defaultCurrency={overviewCurrency}
                                                    defaultTimezone={overviewTimezone}
                                                    showHotelName={filters.hotelIds.length === 0}
                                                />
                                                <ExpenseReasonSummary
                                                    entries={expenseEntries}
                                                    defaultCurrency={overviewCurrency}
                                                    isComplete={!hasMoreExpenses}
                                                />
                                                <ExpenseTable
                                                    entries={expenseEntries}
                                                    totalCount={expenseTotal}
                                                    defaultCurrency={overviewCurrency}
                                                    defaultTimezone={overviewTimezone}
                                                    showHotelName={filters.hotelIds.length === 0}
                                                    className="xl:col-span-2"
                                                />
                                            </div>
                                        </CollapsibleSection>
                                    </>
                                ) : (
                                    <OverviewSkeleton />
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === "hotels" && (
                        <section className="space-y-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-3 lg:space-y-0">
                            {isLoadingHotelSummaries && <HotelsSkeleton />}
                            {!isLoadingHotelSummaries && hotelSummaries.length === 0 && (
                                <p className="px-1 text-sm text-slate-500 dark:text-white/40">Нет отелей</p>
                            )}
                            {!isLoadingHotelSummaries &&
                                hotelSummaries.map((hotel) => {
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
                                                            title={`${m.displayName} · PIN ${m.hasPin ? 'настроен' : 'не задан'}`}
                                                        >
                                                            {m.displayName?.slice(0, 2).toUpperCase() || "??"}
                                                        </span>
                                                    ))}
                                                    {hotel.managers.length > 4 && (
                                                        <span className="text-[10px] text-slate-500 dark:text-white/30">+{hotel.managers.length - 4}</span>
                                                    )}
                                                </div>
                                                <Link href={withCountry(`/admin/hotels/${hotel.id}`)}>
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

                    {activeTab === "guests" && (
                        <section className="space-y-3">
                            <Card className="p-4 lg:!rounded-lg">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                                    <Field label="Поиск" htmlFor="guest-search" hint="имя, телефон, документ">
                                        <Input
                                            id="guest-search"
                                            value={guestFilters.search}
                                            onChange={(event) => setGuestFilters((prev) => ({ ...prev, search: event.target.value }))}
                                            placeholder="Например, Азамат или +996"
                                        />
                                    </Field>
                                    <Field label="Объект" htmlFor="guest-hotel">
                                        <select
                                            id="guest-hotel"
                                            value={guestFilters.hotelId}
                                            onChange={(event) => setGuestFilters((prev) => ({ ...prev, hotelId: event.target.value }))}
                                            className={selectClassName}
                                        >
                                            <option value="">Все объекты</option>
                                            {hotels.map((hotel) => (
                                                <option key={`guest-filter-hotel-${hotel.id}`} value={hotel.id}>
                                                    {hotel.name}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="Статус" htmlFor="guest-status">
                                        <select
                                            id="guest-status"
                                            value={guestFilters.status}
                                            onChange={(event) => setGuestFilters((prev) => ({ ...prev, status: event.target.value }))}
                                            className={selectClassName}
                                        >
                                            <option value="">Все статусы</option>
                                            <option value="PENDING">Не проверен</option>
                                            <option value="VERIFIED">Проверен</option>
                                            <option value="NEEDS_REVIEW">Уточнить</option>
                                        </select>
                                    </Field>
                                    <Button type="button" className="shrink-0" onClick={openCreateGuestForm}>
                                        Добавить гостя
                                    </Button>
                                </div>
                            </Card>

                            {isLoadingGuests ? (
                                <div className="grid gap-3 lg:grid-cols-2">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <Card key={`guest-skeleton-${index}`} className="p-4 lg:!rounded-lg">
                                            <Skeleton className="h-5 w-44" />
                                            <Skeleton className="mt-3 h-4 w-full" />
                                            <Skeleton className="mt-2 h-4 w-2/3" />
                                        </Card>
                                    ))}
                                </div>
                            ) : guestProfiles.length === 0 ? (
                                <Card className="p-4 text-sm text-slate-500 dark:text-white/45 lg:!rounded-lg">
                                    Гостей пока нет или фильтр ничего не нашел.
                                </Card>
                            ) : (
                                <>
                                    <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_46px_-38px_rgba(15,23,42,0.45)] dark:border-white/[0.06] dark:bg-white/[0.03] lg:block">
                                        <table className="min-w-full divide-y divide-slate-200/80 text-sm dark:divide-white/[0.06]">
                                            <thead className="bg-slate-50/90 text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:bg-white/[0.03] dark:text-white/32">
                                                <tr>
                                                    <th className="px-4 py-3 text-left font-medium">Гость</th>
                                                    <th className="px-4 py-3 text-left font-medium">Объект</th>
                                                    <th className="px-4 py-3 text-left font-medium">Документ</th>
                                                    <th className="px-4 py-3 text-left font-medium">Статус</th>
                                                    <th className="px-4 py-3 text-left font-medium">Последний визит</th>
                                                    <th className="px-4 py-3 text-left font-medium">Последнее действие</th>
                                                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.05]">
                                                {guestProfiles.map((guest) => {
                                                    const statusMeta = guestVerificationMeta[guest.verificationStatus];
                                                    const guestTz = guest.hotel?.timezone ?? overviewDisplay.timezone;
                                                    const lastAudit = guest.auditLogs[0];
                                                    return (
                                                        <tr key={guest.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.035]">
                                                            <td className="max-w-[240px] px-4 py-3">
                                                                <p className="truncate font-semibold text-slate-950 dark:text-white">{guest.fullName}</p>
                                                                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/40">
                                                                    {[guest.phone, guest.telegramId ? `tg ${guest.telegramId}` : null].filter(Boolean).join(" · ") || "контакты не указаны"}
                                                                </p>
                                                            </td>
                                                            <td className="max-w-[180px] px-4 py-3 text-slate-600 dark:text-white/55">
                                                                <p className="truncate">{guest.hotel?.name ?? "—"}</p>
                                                            </td>
                                                            <td className="max-w-[160px] px-4 py-3">
                                                                <p className="truncate font-medium text-slate-800 dark:text-white/75">{guest.documentNumber || "—"}</p>
                                                                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/35">
                                                                    согласие {guest.consentAcceptedAt ? formatDT(guest.consentAcceptedAt, guestTz) : "—"}
                                                                </p>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`inline-flex rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.className}`}>
                                                                    {statusMeta.label}
                                                                </span>
                                                                {guest.verifiedAt ? (
                                                                    <p className="mt-1 max-w-[160px] truncate text-xs text-slate-500 dark:text-white/35">
                                                                        {guest.verifiedByName || "—"} · {formatDT(guest.verifiedAt, guestTz)}
                                                                    </p>
                                                                ) : null}
                                                            </td>
                                                            <td className="max-w-[190px] px-4 py-3 text-slate-600 dark:text-white/55">
                                                                {guest.lastStay ? (
                                                                    <>
                                                                        <p className="truncate">№{guest.lastStay.roomLabel} · {guest.lastStay.hotelName}</p>
                                                                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/35">{formatDT(guest.lastStay.scheduledCheckIn, guest.lastStay.timezone ?? guestTz)}</p>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-slate-400 dark:text-white/28">—</span>
                                                                )}
                                                            </td>
                                                            <td className="max-w-[230px] px-4 py-3 text-slate-600 dark:text-white/55">
                                                                {lastAudit ? (
                                                                    <>
                                                                        <p className="truncate">{guestAuditActionLabels[lastAudit.action] ?? lastAudit.action}{lastAudit.actorName ? ` · ${lastAudit.actorName}` : ""}</p>
                                                                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/35">
                                                                            {formatDT(lastAudit.createdAt, guestTz)}
                                                                            {lastAudit.changedFields.length ? ` · ${formatGuestAuditFields(lastAudit.changedFields)}` : ""}
                                                                        </p>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-slate-400 dark:text-white/28">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex justify-end gap-2">
                                                                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="Редактировать гостя" aria-label="Редактировать гостя" onClick={() => openEditGuestForm(guest)}>
                                                                        <Pencil className="h-4 w-4" />
                                                                    </Button>
                                                                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Удалить гостя" aria-label="Удалить гостя" onClick={() => setGuestToDelete(guest)}>
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="grid gap-2 lg:hidden">
                                        {guestProfiles.map((guest) => {
                                            const statusMeta = guestVerificationMeta[guest.verificationStatus];
                                            const guestTz = guest.hotel?.timezone ?? overviewDisplay.timezone;
                                            const lastAudit = guest.auditLogs[0];
                                            return (
                                                <Card key={guest.id} className="p-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">{guest.fullName}</h3>
                                                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-white/40">{guest.hotel?.name ?? "Объект не указан"}{guest.phone ? ` · ${guest.phone}` : ""}</p>
                                                        </div>
                                                        <span className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusMeta.className}`}>
                                                            {statusMeta.label}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-white/50">
                                                        <p className="truncate">Документ: <span className="font-medium text-slate-900 dark:text-white/75">{guest.documentNumber || "—"}</span></p>
                                                        <p className="truncate">Согласие: {guest.consentAcceptedAt ? formatDT(guest.consentAcceptedAt, guestTz) : "—"}</p>
                                                    </div>
                                                    {lastAudit ? (
                                                        <p className="mt-2 truncate text-xs text-slate-500 dark:text-white/35">
                                                            {guestAuditActionLabels[lastAudit.action] ?? lastAudit.action} · {formatDT(lastAudit.createdAt, guestTz)}
                                                        </p>
                                                    ) : null}
                                                    <div className="mt-3 flex justify-end gap-1">
                                                        <Button type="button" size="icon" variant="ghost" className="h-9 w-9" title="Редактировать гостя" aria-label="Редактировать гостя" onClick={() => openEditGuestForm(guest)}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Удалить гостя" aria-label="Удалить гостя" onClick={() => setGuestToDelete(guest)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </section>
                    )}

                    {activeTab === "manage" && (
                        <section className="w-full space-y-3">
                            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-white/[0.07] dark:bg-[#171b21]">
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)_auto] lg:items-end">
                                    <div className="min-w-0 lg:self-center">
                                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-white/30">Конфигурация</p>
                                        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Управление объектами</h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-white/42">Выберите филиал и настройте только нужные ему возможности.</p>
                                    </div>
                                    <Field label="Текущий объект" htmlFor="manage-hotel-select">
                                        <Select
                                            id="manage-hotel-select"
                                            className="h-10 bg-slate-50 font-medium dark:bg-white/[0.045]"
                                            value={selectedHotelId}
                                            onChange={(event) => setSelectedHotelId(event.target.value)}
                                        >
                                            <option value="">Выберите объект</option>
                                            {hotels.map((hotel) => (
                                                <option key={`manage-${hotel.id}`} value={hotel.id}>{hotel.name}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Button type="button" className="h-10 w-full shrink-0 gap-2 lg:w-auto" onClick={() => setIsCreateHotelOpen(true)}>
                                        <Plus className="h-4 w-4" aria-hidden="true" />
                                        Добавить объект
                                    </Button>
                                </div>
                            </div>

                            <div className="grid items-start gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]">
                            <nav className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-sm dark:border-white/[0.07] dark:bg-[#171b21] sm:grid-cols-6 lg:sticky lg:top-5 lg:grid-cols-1 lg:p-2" aria-label="Разделы настроек объекта">
                                {manageSections.map((section) => {
                                    const active = section.id === manageSection;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            className={`flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-center transition-colors lg:flex-row lg:gap-3 lg:px-3 lg:text-left ${active ? "bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-300" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-white/40 dark:hover:bg-white/[0.04] dark:hover:text-white/75"}`}
                                            onClick={() => setManageSection(section.id)}
                                            aria-current={active ? "page" : undefined}
                                        >
                                            <section.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span className="min-w-0">
                                                <span className="block w-full truncate text-xs font-medium">{section.label}</span>
                                                <span className="mt-0.5 hidden truncate text-[10px] opacity-60 lg:block">{section.description}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </nav>
                            <div className="min-w-0">

                            {isCreateHotelOpen ? (
                            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-8 backdrop-blur-sm" onMouseDown={() => setIsCreateHotelOpen(false)}>
                                <div className="relative w-full max-w-2xl" onMouseDown={(event) => event.stopPropagation()}>
                                    <button type="button" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/[0.07] dark:hover:text-white" onClick={() => setIsCreateHotelOpen(false)} title="Закрыть" aria-label="Закрыть">
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </button>
                            <SectionCard title="Новый объект" subtitle="Основные данные">
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
                                    <div className="hidden">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <Field label="Начало расчетного месяца" htmlFor="financialCycleStartDay" hint="1-31">
                                            <Input id="financialCycleStartDay" name="financialCycleStartDay" type="number" min="1" max="31" step="1" defaultValue="1" placeholder="1" />
                                        </Field>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="hasMealPlan" className="accent-emerald-500" />
                                            Показывать питание в заселениях
                                        </label>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="allowGroupStays" defaultChecked className="accent-emerald-500" />
                                            Групповые заезды и бронирования
                                        </label>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="allowPostpaidStays" className="accent-emerald-500" />
                                            Разрешить постоплату и уточнение тарифа
                                        </label>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-white/45">
                                            Для групп, где компания платит после проживания или тариф подтверждает админ.
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="allowOnlinePayments" defaultChecked className="accent-emerald-500" />
                                            Оплата на сайте и ожидаемые переводы
                                        </label>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="guestQrEnabled" className="accent-emerald-500" />
                                            GuestPass / QR для гостей
                                        </label>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-white/45">
                                            Включить QR-профили и QR-заселение у менеджера.
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input type="checkbox" name="showInGuestListing" defaultChecked className="accent-emerald-500" />
                                            Показывать объект в гостевом листинге
                                        </label>
                                    </div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                            <Field label="Описание для гостей" htmlFor="guestDescription" hint="коротко">
                                                <TextArea
                                                    id="guestDescription"
                                                    name="guestDescription"
                                                    rows={3}
                                                    maxLength={800}
                                                    placeholder="Тихий объект рядом с центром, удобный заезд, парковка."
                                                />
                                            </Field>
                                            <Field label="Удобства" htmlFor="guestAmenities" hint="по одному в строке">
                                                <TextArea
                                                    id="guestAmenities"
                                                    name="guestAmenities"
                                                    rows={3}
                                                    placeholder="Wi-Fi&#10;Парковка&#10;Завтрак"
                                                />
                                            </Field>
                                        </div>
                                        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                                            <Field label="Фото" htmlFor="guestPhotoUrls" hint="URL по одному в строке">
                                                <TextArea
                                                    id="guestPhotoUrls"
                                                    name="guestPhotoUrls"
                                                    rows={3}
                                                    placeholder="https://..."
                                                />
                                            </Field>
                                            <Field label="Ссылка на карту" htmlFor="guestMapUrl" hint="Google / 2GIS">
                                                <Input
                                                    id="guestMapUrl"
                                                    name="guestMapUrl"
                                                    type="url"
                                                    placeholder="https://maps.google.com/..."
                                                />
                                            </Field>
                                        </div>
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
                                    </div>
                                    <Button type="submit" className="w-full">
                                        Создать объект
                                    </Button>
                                </form>
                            </SectionCard>
                                </div>
                            </div>
                            ) : null}

                            {manageSection !== "access" ? (
                            <SectionCard title={activeManageSection.panelTitle} subtitle={activeManageSection.description} className="lg:p-5">
                                {hotels.length === 0 ? (
                                    <p className="text-sm text-slate-500 dark:text-white/60">Пока нет отелей для изменения</p>
                                ) : (
                                    <>
                                        {selectedHotelId ? (
                                        <form className="space-y-3" onSubmit={handleUpdateHotel}>
                                            {manageSection === "general" ? (
                                            <SettingsGroup>
                                            <div className="grid gap-4 sm:grid-cols-2">
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
                                            </div>
                                            <div className="grid gap-4 sm:grid-cols-2">
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
                                            </div>
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
                                            </SettingsGroup>
                                            ) : null}
                                            {manageSection === "features" ? (
                                            <SettingsGroup>
                                                <div className="rounded-xl border border-slate-200/80 px-4 dark:border-white/[0.06]">
                                                    <ToggleRow title="Питание" description="Показывать варианты питания при заселении и бронировании." name="hasMealPlan" checked={editForm.hasMealPlan} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                    <ToggleRow title="Групповые заезды" description="Разрешить менеджерам создавать групповые бронирования и заселения." name="allowGroupStays" checked={editForm.allowGroupStays} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                    <ToggleRow title="Постоплата" description="Заселять без прихода в кассу, когда компания оплачивает проживание позже." name="allowPostpaidStays" checked={editForm.allowPostpaidStays} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                    <ToggleRow title="Онлайн-оплата" description="Учитывать оплату на сайте и ожидаемые банковские переводы." name="allowOnlinePayments" checked={editForm.allowOnlinePayments} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                    <ToggleRow title="GuestPass и QR" description="Включить QR-профили гостей и быстрое заселение по QR-коду." name="guestQrEnabled" checked={editForm.guestQrEnabled} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                    <ToggleRow title="Публичный листинг" description="Показывать этот объект на гостевой странице выбора филиала." name="showInGuestListing" checked={editForm.showInGuestListing} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                </div>
                                            </SettingsGroup>
                                            ) : null}
                                            {manageSection === "listing" ? (
                                            <SettingsGroup>
                                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                                    <Field label="Описание для гостей" htmlFor="edit-guestDescription" hint="коротко">
                                                        <TextArea
                                                            id="edit-guestDescription"
                                                            name="guestDescription"
                                                            rows={3}
                                                            maxLength={800}
                                                            value={editForm.guestDescription}
                                                            onChange={handleEditFieldChange}
                                                            placeholder="Тихий объект рядом с центром, удобный заезд, парковка."
                                                            disabled={!selectedHotelId || isUpdatingHotel}
                                                        />
                                                    </Field>
                                                    <Field label="Удобства" htmlFor="edit-guestAmenities" hint="по одному в строке">
                                                        <TextArea
                                                            id="edit-guestAmenities"
                                                            name="guestAmenities"
                                                            rows={3}
                                                            value={editForm.guestAmenities}
                                                            onChange={handleEditFieldChange}
                                                            placeholder="Wi-Fi&#10;Парковка&#10;Завтрак"
                                                            disabled={!selectedHotelId || isUpdatingHotel}
                                                        />
                                                    </Field>
                                                </div>
                                                <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                                                    <Field label="Фото" htmlFor="edit-guestPhotoUrls" hint="URL по одному в строке">
                                                        <TextArea
                                                            id="edit-guestPhotoUrls"
                                                            name="guestPhotoUrls"
                                                            rows={3}
                                                            value={editForm.guestPhotoUrls}
                                                            onChange={handleEditFieldChange}
                                                            placeholder="https://..."
                                                            disabled={!selectedHotelId || isUpdatingHotel}
                                                        />
                                                    </Field>
                                                    <Field label="Ссылка на карту" htmlFor="edit-guestMapUrl" hint="Google / 2GIS">
                                                        <Input
                                                            id="edit-guestMapUrl"
                                                            name="guestMapUrl"
                                                            type="url"
                                                            value={editForm.guestMapUrl}
                                                            onChange={handleEditFieldChange}
                                                            placeholder="https://maps.google.com/..."
                                                            disabled={!selectedHotelId || isUpdatingHotel}
                                                        />
                                                    </Field>
                                                </div>
                                            </div>
                                            </SettingsGroup>
                                            ) : null}
                                            {manageSection === "integrations" ? (
                                            <SettingsGroup>
                                                <div className="rounded-xl border border-slate-200/80 px-4 dark:border-white/[0.06]">
                                                    <ToggleRow title="Использовать экстранеты" description="Показывать источники внешних площадок в бронированиях и отчетах." name="usesExtranets" checked={editForm.usesExtranets} onChange={handleEditFieldChange} disabled={isUpdatingHotel} />
                                                </div>
                                                {editForm.usesExtranets ? <div className="max-w-xl rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/[0.06] dark:bg-white/[0.025]">
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
                                                </div> : null}
                                            </SettingsGroup>
                                            ) : null}
                                            {manageSection === "finance" ? (
                                            <SettingsGroup>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                                            </SettingsGroup>
                                            ) : null}
                                            <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="danger"
                                                    disabled={!selectedHotelId || isDeletingHotel}
                                                    onClick={() => setConfirmDelete(true)}
                                                    className="h-10 w-10 shrink-0"
                                                    title="Удалить объект"
                                                    aria-label="Удалить объект"
                                                >
                                                    {isDeletingHotel ? "…" : <Trash2 className="h-4 w-4" />}
                                                </Button>
                                                <Button type="submit" className="w-full sm:w-auto" disabled={!selectedHotelId || isUpdatingHotel}>
                                                    {isUpdatingHotel ? "Сохраняем..." : "Сохранить изменения"}
                                                </Button>
                                            </div>
                                        </form>
                                        ) : (
                                            <div className="mt-4 grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-5 text-center dark:border-white/[0.07] dark:bg-white/[0.02]">
                                                <div>
                                                    <Building2 className="mx-auto h-5 w-5 text-slate-400 dark:text-white/30" aria-hidden="true" />
                                                    <p className="mt-2 text-sm font-medium text-slate-700 dark:text-white/70">Выберите объект из списка</p>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-white/40">После выбора откроются его настройки и доступные функции.</p>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </SectionCard>
                            ) : null}

                            {/* Observer management */}
                            {manageSection === "access" ? (
                            <SectionCard title="Наблюдатели" subtitle="Доступ только к просмотру">

                                {/* Existing observers list */}
                                {observers && observers.length > 0 && (
                                    <div className="mb-5 overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.06]">
                                        {observers.map((obs) => (
                                            <div key={obs.id} className="flex flex-col gap-3 border-b border-slate-200/70 px-4 py-3 last:border-b-0 dark:border-white/[0.055] sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-light-text dark:text-white truncate">{obs.displayName}</p>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-white/40">Логин: {obs.loginName} · {obs.hotels.map((h) => h.name).join(', ') || '—'}</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white"
                                                        onClick={() => { setResetPasswordId(obs.id); setResetPasswordValue(''); }}
                                                        title="Сменить пароль"
                                                        aria-label="Сменить пароль"
                                                    >
                                                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/12"
                                                        disabled={deletingObserverId === obs.id}
                                                        onClick={() => handleDeleteObserver(obs.id)}
                                                        title="Удалить наблюдателя"
                                                        aria-label="Удалить наблюдателя"
                                                    >
                                                        {deletingObserverId === obs.id ? '…' : <Trash2 className="h-4 w-4" />}
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
                                                size="icon"
                                                variant="ghost"
                                                className="h-9 w-9"
                                                onClick={() => setResetPasswordId(null)}
                                                title="Отмена"
                                                aria-label="Отмена"
                                            >
                                                <X className="h-4 w-4" aria-hidden="true" />
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
                                            <Select
                                                value={newObserver.hotelId}
                                                onChange={(e) => setNewObserver((prev) => ({ ...prev, hotelId: e.target.value }))}
                                                className={selectClassName}
                                                required
                                            >
                                                <option value="">Выберите объект</option>
                                                {hotels.map((hotel) => (
                                                    <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
                                                ))}
                                            </Select>
                                        </Field>
                                    </div>
                                    <Button type="submit" className="w-full sm:w-auto" disabled={creatingObserver}>
                                        {creatingObserver ? 'Создаём…' : 'Создать наблюдателя'}
                                    </Button>
                                </form>
                            </SectionCard>
                            ) : null}
                            </div>
                            </div>
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
                    {guestForm && (
                        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-3 py-4 backdrop-blur-sm">
                            <Card className="mx-auto w-full max-w-xl space-y-4 p-5 text-light-text dark:text-white">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-base font-semibold">{guestForm.id ? "Редактировать гостя" : "Добавить гостя"}</p>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-white/45">Профиль, документ, согласие и статус проверки.</p>
                                    </div>
                                    <Button type="button" size="sm" variant="ghost" disabled={isSavingGuest} onClick={() => setGuestForm(null)}>
                                        ×
                                    </Button>
                                </div>
                                <form className="space-y-3" onSubmit={handleSaveGuest}>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="Объект" htmlFor="guest-form-hotel">
                                            <select
                                                id="guest-form-hotel"
                                                name="hotelId"
                                                value={guestForm.hotelId}
                                                onChange={handleGuestFormChange}
                                                className={selectClassName}
                                                disabled={isSavingGuest}
                                            >
                                                <option value="">Без объекта</option>
                                                {hotels.map((hotel) => (
                                                    <option key={`guest-form-hotel-${hotel.id}`} value={hotel.id}>
                                                        {hotel.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </Field>
                                        <Field label="Статус" htmlFor="guest-form-status">
                                            <select
                                                id="guest-form-status"
                                                name="verificationStatus"
                                                value={guestForm.verificationStatus}
                                                onChange={handleGuestFormChange}
                                                className={selectClassName}
                                                disabled={isSavingGuest}
                                            >
                                                <option value="PENDING">Не проверен</option>
                                                <option value="VERIFIED">Проверен</option>
                                                <option value="NEEDS_REVIEW">Уточнить</option>
                                            </select>
                                        </Field>
                                    </div>
                                    <Field label="Имя и фамилия" htmlFor="guest-form-fullName">
                                        <Input
                                            id="guest-form-fullName"
                                            name="fullName"
                                            value={guestForm.fullName}
                                            onChange={handleGuestFormChange}
                                            disabled={isSavingGuest}
                                            required
                                        />
                                    </Field>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="Телефон" htmlFor="guest-form-phone">
                                            <Input id="guest-form-phone" name="phone" value={guestForm.phone} onChange={handleGuestFormChange} disabled={isSavingGuest} />
                                        </Field>
                                        <Field label="Telegram ID" htmlFor="guest-form-telegramId">
                                            <Input id="guest-form-telegramId" name="telegramId" value={guestForm.telegramId} onChange={handleGuestFormChange} disabled={isSavingGuest} />
                                        </Field>
                                    </div>
                                    <Field label="Номер документа" htmlFor="guest-form-documentNumber" hint={guestForm.verificationStatus === "VERIFIED" ? "обязательно для статуса Проверен" : undefined}>
                                        <Input id="guest-form-documentNumber" name="documentNumber" value={guestForm.documentNumber} onChange={handleGuestFormChange} disabled={isSavingGuest} />
                                    </Field>
                                    <Field label="Заметка" htmlFor="guest-form-notes" hint="необязательно">
                                        <TextArea id="guest-form-notes" name="notes" rows={3} value={guestForm.notes} onChange={handleGuestFormChange} disabled={isSavingGuest} />
                                    </Field>
                                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-white/75">
                                            <input
                                                type="checkbox"
                                                name="consentAccepted"
                                                checked={guestForm.consentAccepted}
                                                onChange={handleGuestFormChange}
                                                disabled={isSavingGuest}
                                                className="mt-1 accent-emerald-500"
                                            />
                                            <span>Согласие на обработку персональных данных получено</span>
                                        </label>
                                        <Input
                                            name="consentVersion"
                                            value={guestForm.consentVersion}
                                            onChange={handleGuestFormChange}
                                            disabled={isSavingGuest || !guestForm.consentAccepted}
                                            className="mt-3"
                                            placeholder="Версия согласия"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                        <Button type="button" variant="secondary" disabled={isSavingGuest} onClick={() => setGuestForm(null)}>
                                            Отмена
                                        </Button>
                                        <Button type="submit" disabled={isSavingGuest}>
                                            {isSavingGuest ? "Сохраняем..." : "Сохранить"}
                                        </Button>
                                    </div>
                                </form>
                            </Card>
                        </div>
                    )}
                    {guestToDelete && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                            <Card className="w-full max-w-sm space-y-4 p-5 text-center text-light-text dark:text-white">
                                <p className="text-base font-semibold">Удалить гостя?</p>
                                <p className="text-sm text-slate-500 dark:text-white/50">
                                    Профиль {guestToDelete.fullName} будет удален вместе с QR и историей профиля. Проживания останутся в системе.
                                </p>
                                <div className="flex gap-2">
                                    <Button type="button" variant="secondary" className="flex-1" disabled={isDeletingGuest} onClick={() => setGuestToDelete(null)}>
                                        Отмена
                                    </Button>
                                    <Button type="button" variant="danger" className="flex-1" disabled={isDeletingGuest} onClick={() => void handleDeleteGuest()}>
                                        {isDeletingGuest ? "Удаляем..." : "Удалить"}
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}
                    {rankingDetail && (
                        <RankingDetailModal
                            selection={rankingDetail}
                            currency={overviewCurrency}
                            onClose={() => setRankingDetail(null)}
                        />
                    )}

                    </main>
                </div>
            </div>
        </div>
    );
}
