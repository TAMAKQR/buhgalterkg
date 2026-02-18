"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { useToast } from '@/components/ui/toast';
import useSWR from "swr";

import type { SessionUser } from "@/lib/types";
import { formatDateTime as fdt, formatMoney } from "@/lib/timezone";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type PaymentSplit = {
    cash: number;
    card: number;
};

type AdminHotelSummary = {
    id: string;
    name: string;
    address?: string | null;
    managerSharePct?: number | null;
    notes?: string | null;
    cleaningChatId?: string | null;
    timezone?: string | null;
    currency?: string | null;
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
    };
};

type AdminOverview = {
    totals: {
        cashIn: number;
        cashInBreakdown: PaymentSplit;
        cashOut: number;
        cashOutBreakdown: PaymentSplit;
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
    dailySeries?: Array<{ date: string; cashIn: number; cashOut: number }>;
};

type AdminTab = "overview" | "hotels" | "manage";

type OverviewFilters = {
    startDate: string;
    endDate: string;
    hotelId: string;
    managerId: string;
};

interface AdminDashboardProps {
    user: SessionUser;
    onLogout?: () => void;
}

interface CreateHotelPayload {
    name: string;
    address: string;
    notes?: string;
    cleaningChatId?: string;
    timezone?: string;
    currency?: string;
}

type HotelFormState = {
    name: string;
    address: string;
    notes: string;
    cleaningChatId: string;
    timezone: string;
    currency: string;
};

// notify is replaced by useToast() inside the component

const formatCurrency = (value: number, currency?: string) => formatMoney(value, currency);

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatDT = (value?: string | null, tz?: string) => fdt(value, tz, undefined, "");

function HotelsSkeleton() {
    return (
        <>
            {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
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
                <Card key={index} className="bg-white/5 p-4">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="mt-3 h-8 w-1/2" />
                    <Skeleton className="mt-2 h-4 w-2/3" />
                </Card>
            ))}
        </>
    );
}

/* ── Donut helper ───────────────────────────────────── */

type DonutSegment = { value: number; color: string; label: string; textColor: string };

const DonutChart = ({ segments, centerLabel, centerValue, centerColor, colSpan }: {
    segments: DonutSegment[];
    centerLabel: string;
    centerValue: string;
    centerColor: string;
    colSpan?: string;
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
        <Card className={`p-3 ${colSpan ?? "col-span-2 lg:col-span-4"}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div
                    className="relative mx-auto h-40 w-40 shrink-0 overflow-hidden rounded-full bg-white/[0.04]"
                    style={chartStyle}
                >
                    <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-night text-center">
                        <span className="text-[10px] uppercase tracking-widest text-white/35">{centerLabel}</span>
                        <span className={`text-lg font-semibold ${centerColor}`}>{centerValue}</span>
                    </div>
                </div>
                <div className="flex-1 space-y-3 text-sm">
                    {segments.map((seg) => (
                        <div key={seg.label} className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white/50">
                                <span className="h-2 w-5 rounded-full" style={{ backgroundColor: seg.color }} />
                                <span>{seg.label}</span>
                            </div>
                            <p className={`text-sm font-semibold ${seg.textColor}`}>
                                {formatCurrency(seg.value)}
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
};

const AnalyticsFlowChart = ({ inflow, outflow, net }: AnalyticsFlowChartProps) => {
    const safeNet = net || 0;
    const netPositive = safeNet >= 0;
    const segments: DonutSegment[] = [
        { value: inflow || 0, color: "#34d399", label: "Вход", textColor: "text-emerald-300" },
        { value: outflow || 0, color: "#f87171", label: "Выход", textColor: "text-rose-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel={netPositive ? "Профицит" : "Дефицит"}
            centerValue={formatCurrency(safeNet)}
            centerColor={netPositive ? "text-emerald-200" : "text-rose-200"}
        />
    );
};

/* ── Chart 2: Нал / Карта ──────────────────────────── */

type PaymentMethodChartProps = { cashTotal: number; cardTotal: number };

const PaymentMethodChart = ({ cashTotal, cardTotal }: PaymentMethodChartProps) => {
    const total = (cashTotal || 0) + (cardTotal || 0);
    const segments: DonutSegment[] = [
        { value: cashTotal || 0, color: "#60a5fa", label: "Наличные", textColor: "text-blue-300" },
        { value: cardTotal || 0, color: "#a78bfa", label: "Карта", textColor: "text-violet-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel="Всего"
            centerValue={formatCurrency(total)}
            centerColor="text-white"
            colSpan="col-span-2"
        />
    );
};

/* ── Chart 3: Структура расходов ───────────────────── */

type ExpenseStructureChartProps = {
    cashOut: number;
    payouts: number;
    adjustments: number;
};

const ExpenseStructureChart = ({ cashOut, payouts, adjustments }: ExpenseStructureChartProps) => {
    const total = (cashOut || 0) + (payouts || 0) + Math.abs(adjustments || 0);
    const segments: DonutSegment[] = [
        { value: cashOut || 0, color: "#f87171", label: "Расходы", textColor: "text-rose-300" },
        { value: payouts || 0, color: "#fb923c", label: "Выплаты", textColor: "text-orange-300" },
        { value: Math.abs(adjustments || 0), color: "#facc15", label: "Корректировки", textColor: "text-yellow-300" },
    ];
    return (
        <DonutChart
            segments={segments}
            centerLabel="Итого"
            centerValue={formatCurrency(total)}
            centerColor="text-rose-200"
            colSpan="col-span-2"
        />
    );
};

/* ── Line Chart: Доход / Расход по дням ──────────────── */

type DailyPoint = { date: string; cashIn: number; cashOut: number };

const DailyLineChart = ({ data }: { data: DailyPoint[] }) => {
    if (!data.length) return null;

    const W = 600;
    const H = 200;
    const PX = 44;
    const PY = 24;
    const PB = 32;
    const chartW = W - PX * 2;
    const chartH = H - PY - PB;

    const allValues = data.flatMap((d) => [d.cashIn, d.cashOut]);
    const maxVal = Math.max(...allValues, 100);
    const minVal = 0;
    const range = maxVal - minVal || 1;

    const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;

    const toX = (i: number) => PX + (data.length > 1 ? i * xStep : chartW / 2);
    const toY = (v: number) => PY + chartH - ((v - minVal) / range) * chartH;

    const makePath = (key: 'cashIn' | 'cashOut') =>
        data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d[key]).toFixed(1)}`).join(' ');

    const pathIn = makePath('cashIn');
    const pathOut = makePath('cashOut');

    const gridLines = 4;
    const gridSteps = Array.from({ length: gridLines + 1 }, (_, i) => minVal + (range / gridLines) * i);

    const formatShort = (v: number) => {
        const abs = v / 100;
        if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
        if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
        return abs.toFixed(0);
    };

    const labelEvery = Math.max(1, Math.ceil(data.length / 7));

    return (
        <Card className="col-span-2 lg:col-span-4 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-white/35">Доход / Расход по дням</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
                {/* grid */}
                {gridSteps.map((v) => (
                    <g key={v}>
                        <line x1={PX} y1={toY(v)} x2={W - PX} y2={toY(v)} stroke="rgba(255,255,255,0.06)" />
                        <text x={PX - 6} y={toY(v) + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9">{formatShort(v)}</text>
                    </g>
                ))}
                {/* area fills */}
                <path
                    d={`${pathIn} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(52,211,153,0.10)"
                />
                <path
                    d={`${pathOut} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(248,113,113,0.08)"
                />
                {/* lines */}
                <path d={pathIn} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" />
                <path d={pathOut} fill="none" stroke="#f87171" strokeWidth="2" strokeLinejoin="round" strokeDasharray="6 3" />
                {/* dots */}
                {data.map((d, i) => (
                    <g key={d.date}>
                        <circle cx={toX(i)} cy={toY(d.cashIn)} r="3" fill="#34d399" />
                        <circle cx={toX(i)} cy={toY(d.cashOut)} r="3" fill="#f87171" />
                    </g>
                ))}
                {/* x labels */}
                {data.map((d, i) =>
                    i % labelEvery === 0 ? (
                        <text key={`lbl-${d.date}`} x={toX(i)} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
                            {d.date.slice(5)}
                        </text>
                    ) : null,
                )}
            </svg>
            <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-white/50">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm bg-emerald-400" />
                    Доход
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm bg-rose-400" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 5px)' }} />
                    Расход
                </span>
            </div>
        </Card>
    );
};

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
    const handleLogout = async () => {
        await fetch('/api/session/logout', { method: 'POST' });
        if (onLogout) {
            onLogout();
        }
    };

    const fetchWithAuth = useCallback(async (url: string) => {
        const response = await fetch(url, {
            credentials: 'include' // Include cookies
        });

        if (!response.ok) {
            throw new Error("Не удалось загрузить данные");
        }

        return response.json();
    }, []);

    const { data, mutate, isLoading } = useSWR<AdminHotelSummary[]>('/api/hotels', fetchWithAuth);

    const [filters, setFilters] = useState<OverviewFilters>({ startDate: "", endDate: "", hotelId: "", managerId: "" });

    const overviewQuery = useMemo(() => {
        const params = new URLSearchParams();
        if (filters.startDate) {
            params.set("startDate", filters.startDate);
        }
        if (filters.endDate) {
            params.set("endDate", filters.endDate);
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
    const { data: overview } = useSWR<AdminOverview>(overviewUrl, fetchWithAuth);

    const createEmptyHotelForm = (): HotelFormState => ({
        name: "",
        address: "",
        notes: "",
        cleaningChatId: "",
        timezone: "Asia/Bishkek",
        currency: "KGS",
    });

    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [editForm, setEditForm] = useState<HotelFormState>(() => createEmptyHotelForm());
    const [isUpdatingHotel, setIsUpdatingHotel] = useState(false);
    const [isDeletingHotel, setIsDeletingHotel] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>("overview");
    const { toast: notify } = useToast();

    useEffect(() => {
        if (!selectedHotelId) {
            setEditForm(createEmptyHotelForm());
            return;
        }

        if (!data) {
            return;
        }

        const target = data.find((hotel) => hotel.id === selectedHotelId);
        if (target) {
            setEditForm({
                name: target.name ?? "",
                address: target.address ?? "",
                notes: target.notes ?? "",
                cleaningChatId: target.cleaningChatId ?? "",
                timezone: target.timezone ?? "Asia/Bishkek",
                currency: target.currency ?? "KGS",
            });
        } else {
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm());
        }
    }, [data, selectedHotelId]);

    const handleEditFieldChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = event.target;
        setEditForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleCreateHotel = useCallback(
        async (formData: FormData) => {
            const payload: CreateHotelPayload = {
                name: formData.get("name") as string,
                address: formData.get("address") as string,
                notes: (formData.get("notes") as string) || undefined,
            };

            const rawCleaningChatId = (formData.get("cleaningChatId") as string | null)?.trim();
            if (rawCleaningChatId) {
                payload.cleaningChatId = rawCleaningChatId;
            }
            const rawTimezone = (formData.get("timezone") as string | null)?.trim();
            if (rawTimezone) payload.timezone = rawTimezone;
            const rawCurrency = (formData.get("currency") as string | null)?.trim();
            if (rawCurrency) payload.currency = rawCurrency;

            if (!payload.name?.trim()) {
                notify("Название обязательно", 'error');
                return;
            }

            if (!payload.address?.trim()) {
                notify("Адрес обязателен", 'error');
                return;
            }

            try {
                const res = await fetch("/api/hotels", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
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
        [mutate],
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
                    timezone: editForm.timezone || "Asia/Bishkek",
                    currency: editForm.currency || "KGS",
                };

                const res = await fetch(`/api/hotels/${selectedHotelId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
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
        [editForm, mutate, selectedHotelId],
    );

    const handleDeleteHotel = useCallback(async () => {
        if (!selectedHotelId) {
            notify("Выберите отель", 'error');
            return;
        }

        setIsDeletingHotel(true);

        try {
            const res = await fetch(`/api/hotels/${selectedHotelId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
            });

            if (!res.ok) {
                throw new Error("Не удалось удалить отель");
            }

            await mutate();
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm());
            notify("Отель удалён", 'success');
        } catch (error) {
            console.error(error);
            notify("Ошибка удаления", 'error');
        } finally {
            setIsDeletingHotel(false);
        }
    }, [mutate, selectedHotelId]);

    const hotels = useMemo(() => data ?? [], [data]);

    const adminTabs: Array<{ id: AdminTab; label: string; hint?: string }> = [
        { id: "overview", label: "Сводка" },
        { id: "hotels", label: "Объекты", hint: hotels.length ? String(hotels.length) : undefined },
        { id: "manage", label: "Управление" },
    ];

    const managerOptions = useMemo(() => {
        const sourceHotels = filters.hotelId ? hotels.filter((hotel) => hotel.id === filters.hotelId) : hotels;
        const unique = new Map<string, string>();
        for (const hotel of sourceHotels) {
            for (const manager of hotel.managers) {
                const label =
                    manager.displayName?.trim() ||
                    manager.username?.trim() ||
                    (manager.pinCode ? `PIN ${manager.pinCode}` : 'Менеджер');
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
            return h?.currency ?? "KGS";
        }
        return hotels.length === 1 ? (hotels[0]?.currency ?? "KGS") : undefined;
    }, [filters.hotelId, hotels]);

    const handleFilterInput = (field: keyof OverviewFilters, value: string) => {
        setFilters((prev) => ({ ...prev, [field]: value }));
    };

    const handleHotelFilterChange = (value: string) => {
        setFilters((prev) => ({ ...prev, hotelId: value, managerId: "" }));
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
            ["Выход (всего)", fc(t.cashOut)],
            ["  выход нал", fc(t.cashOutBreakdown.cash)],
            ["  выход карта", fc(t.cashOutBreakdown.card)],
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

    return (
        <div className="flex min-h-screen flex-col gap-3 px-3 pb-16 pt-4 sm:px-5">
            <header className="flex items-center justify-between">
                <h1 className="text-lg font-semibold text-white">{user.displayName}</h1>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleLogout}
                >
                    Выйти
                </Button>
            </header>
            <div className="sticky top-0 z-10 -mx-3 bg-night/95 px-3 py-2 backdrop-blur-md sm:-mx-5 sm:px-5">
                <div className="flex gap-1 rounded-xl bg-white/[0.05] p-1 text-sm font-medium text-white/50">
                    {adminTabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 rounded-lg px-3 py-1.5 transition-all ${activeTab === tab.id ? "bg-white/[0.12] text-white shadow-sm" : "hover:text-white/70"
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === "overview" && (
                <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Input
                            type="date"
                            value={filters.startDate}
                            onChange={(event) => handleFilterInput("startDate", event.target.value)}
                            placeholder="С даты"
                        />
                        <Input
                            type="date"
                            value={filters.endDate}
                            min={filters.startDate || undefined}
                            onChange={(event) => handleFilterInput("endDate", event.target.value)}
                            placeholder="По дату"
                        />
                        <select
                            value={filters.hotelId}
                            onChange={(event) => handleHotelFilterChange(event.target.value)}
                            className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                        >
                            <option value="">Все объекты</option>
                            {hotels.map((hotel) => (
                                <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
                            ))}
                        </select>
                        <select
                            value={filters.managerId}
                            onChange={(event) => handleFilterInput("managerId", event.target.value)}
                            disabled={!managerOptions.length}
                            className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-white/20"
                        >
                            <option value="">{managerOptions.length ? "Все менеджеры" : "—"}</option>
                            {managerOptions.map((manager) => (
                                <option key={manager.id} value={manager.id}>{manager.label}</option>
                            ))}
                        </select>
                    </div>
                    {overview && (
                        <div className="flex justify-end">
                            <Button type="button" size="sm" variant="ghost" className="text-[11px]" onClick={handleExportCSV}>
                                Скачать CSV
                            </Button>
                        </div>
                    )}
                    <section className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                        {overview ? (
                            <>
                                <Card className="p-3 text-white">
                                    <p className="text-[11px] uppercase tracking-widest text-white/35">Баланс</p>
                                    <p className="mt-1 text-xl font-semibold">{formatCurrency(overview.totals.netCash, overviewCurrency)}</p>
                                </Card>
                                <Card className="p-3 text-white">
                                    <p className="text-[11px] uppercase tracking-widest text-white/35">Вход</p>
                                    <p className="mt-1 text-lg font-semibold text-emerald-400">
                                        {formatCurrency(overview.totals.cashIn, overviewCurrency)}
                                    </p>
                                    <p className="text-[11px] text-white/40">нал {formatCurrency(overview.totals.cashInBreakdown.cash, overviewCurrency)} · карта {formatCurrency(overview.totals.cashInBreakdown.card, overviewCurrency)}</p>
                                </Card>
                                <Card className="p-3 text-white">
                                    <p className="text-[11px] uppercase tracking-widest text-white/35">Выход</p>
                                    <p className="mt-1 text-lg font-semibold text-rose-400">
                                        {formatCurrency(overview.totals.cashOut, overviewCurrency)}
                                    </p>
                                    <p className="text-[11px] text-white/40">нал {formatCurrency(overview.totals.cashOutBreakdown.cash, overviewCurrency)} · карта {formatCurrency(overview.totals.cashOutBreakdown.card, overviewCurrency)}</p>
                                </Card>
                                <Card className="p-3 text-white">
                                    <p className="text-[11px] uppercase tracking-widest text-white/35">Загрузка</p>
                                    <p className="mt-1 text-lg font-semibold">
                                        {formatPercent(overview.occupancy.rate)}
                                    </p>
                                    <p className="text-[11px] text-white/40">
                                        {overview.occupancy.occupiedRooms}/{overview.occupancy.rooms} · смен {overview.shifts.active}
                                    </p>
                                </Card>
                                {overview.dailySeries && overview.dailySeries.length > 0 && (
                                    <DailyLineChart data={overview.dailySeries} />
                                )}
                                <AnalyticsFlowChart
                                    inflow={overview.totals.cashIn}
                                    outflow={overview.totals.cashOut}
                                    net={overview.totals.netCash}
                                />
                                <PaymentMethodChart
                                    cashTotal={overview.totals.cashInBreakdown.cash + overview.totals.cashOutBreakdown.cash}
                                    cardTotal={overview.totals.cashInBreakdown.card + overview.totals.cashOutBreakdown.card}
                                />
                                <ExpenseStructureChart
                                    cashOut={overview.totals.cashOut}
                                    payouts={overview.totals.payouts}
                                    adjustments={overview.totals.adjustments}
                                />
                            </>
                        ) : (
                            <OverviewSkeleton />
                        )}
                    </section>
                </>
            )}

            {activeTab === "hotels" && (
                <section className="space-y-2">
                    {isLoading && <HotelsSkeleton />}
                    {!isLoading && hotels.length === 0 && (
                        <p className="text-sm text-white/40 px-1">Нет отелей</p>
                    )}
                    {!isLoading &&
                        hotels.map((hotel) => {
                            const inflow = hotel.ledger?.cashIn ?? 0;
                            const outflow = hotel.ledger?.cashOut ?? 0;

                            return (
                                <Card
                                    key={hotel.id}
                                    className="p-4"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="text-base font-semibold text-white truncate">{hotel.name}</h3>
                                            <p className="text-xs text-white/40">{hotel.address || "—"}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-lg font-semibold text-white">{hotel.occupiedRooms}/{hotel.roomCount}</p>
                                            <p className="text-[11px] text-white/35">номеров</p>
                                        </div>
                                    </div>
                                    {hotel.activeShift && (
                                        <p className="mt-1.5 text-xs text-white/40">
                                            №{hotel.activeShift.number} · {hotel.activeShift.manager} · {formatDT(hotel.activeShift.openedAt, hotel.timezone ?? undefined)}
                                        </p>
                                    )}
                                    <div className="mt-3 flex items-center gap-4 text-xs text-white/50">
                                        <span className="text-emerald-400">+{formatCurrency(inflow, hotel.currency ?? undefined)}</span>
                                        <span className="text-rose-400">-{formatCurrency(outflow, hotel.currency ?? undefined)}</span>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            {hotel.managers.slice(0, 4).map((m) => (
                                                <span
                                                    key={m.id}
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-[10px] font-semibold text-white/70"
                                                    title={`${m.displayName} · PIN ${m.pinCode || '—'}`}
                                                >
                                                    {m.displayName?.slice(0, 2).toUpperCase() || "??"}
                                                </span>
                                            ))}
                                            {hotel.managers.length > 4 && (
                                                <span className="text-[10px] text-white/30">+{hotel.managers.length - 4}</span>
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
                    <Card className="p-3">
                        <h2 className="mb-3 text-sm font-semibold text-white">Новый отель</h2>
                        <form action={handleCreateHotel} className="space-y-3">
                            <div className="space-y-2">
                                <label className="text-xs text-white/40" htmlFor="name">
                                    Название
                                </label>
                                <Input
                                    id="name"
                                    name="name"
                                    placeholder={"Например, \"Парк Инн\""}
                                    required

                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-white/40" htmlFor="address">
                                    Адрес
                                </label>
                                <Input
                                    id="address"
                                    name="address"
                                    placeholder="Город, улица, дом"
                                    required

                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-white/40" htmlFor="notes">
                                    Заметки
                                </label>
                                <Input
                                    id="notes"
                                    name="notes"
                                    placeholder="Особенности"

                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-white/40" htmlFor="cleaningChatId">
                                    ID чата уборки
                                </label>
                                <Input
                                    id="cleaningChatId"
                                    name="cleaningChatId"
                                    placeholder="Например, -1001234567890"

                                />
                                <p className="text-xs text-white/50">Используется для уведомлений горничных в Telegram.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs text-white/40" htmlFor="timezone">Часовой пояс</label>
                                    <select id="timezone" name="timezone" defaultValue="Asia/Bishkek" className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20">
                                        <option value="Asia/Bishkek">Бишкек (UTC+6)</option>
                                        <option value="Asia/Almaty">Алматы (UTC+5)</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-white/40" htmlFor="currency">Валюта</label>
                                    <select id="currency" name="currency" defaultValue="KGS" className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20">
                                        <option value="KGS">KGS (сом)</option>
                                        <option value="KZT">KZT (тенге)</option>
                                    </select>
                                </div>
                            </div>
                            <Button type="submit" className="w-full">
                                Сохранить
                            </Button>
                        </form>
                    </Card>

                    <Card className="p-3">
                        <h2 className="mb-3 text-sm font-semibold text-white">Редактировать</h2>
                        {hotels.length === 0 ? (
                            <p className="text-sm text-white/60">Пока нет отелей для изменения</p>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <label className="text-xs text-white/40" htmlFor="edit-hotel">
                                        Выберите отель
                                    </label>
                                    <select
                                        id="edit-hotel"
                                        className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
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
                                </div>
                                <form className="mt-4 space-y-3" onSubmit={handleUpdateHotel}>
                                    <div className="space-y-2">
                                        <label className="text-xs text-white/40" htmlFor="edit-name">
                                            Название
                                        </label>
                                        <Input
                                            id="edit-name"
                                            name="name"
                                            value={editForm.name}
                                            onChange={handleEditFieldChange}
                                            placeholder="Название"
                                            disabled={!selectedHotelId || isUpdatingHotel}

                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs text-white/40" htmlFor="edit-address">
                                            Адрес
                                        </label>
                                        <Input
                                            id="edit-address"
                                            name="address"
                                            value={editForm.address}
                                            onChange={handleEditFieldChange}
                                            placeholder="Город, улица, дом"
                                            disabled={!selectedHotelId || isUpdatingHotel}

                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs text-white/40" htmlFor="edit-notes">
                                            Заметки
                                        </label>
                                        <Input
                                            id="edit-notes"
                                            name="notes"
                                            value={editForm.notes}
                                            onChange={handleEditFieldChange}
                                            placeholder="Особенности"
                                            disabled={!selectedHotelId || isUpdatingHotel}

                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-white/40" htmlFor="edit-cleaningChatId">
                                            ID чата уборки
                                        </label>
                                        <Input
                                            id="edit-cleaningChatId"
                                            name="cleaningChatId"
                                            value={editForm.cleaningChatId}
                                            onChange={handleEditFieldChange}
                                            placeholder="Например, -1001234567890"
                                            disabled={!selectedHotelId || isUpdatingHotel}

                                        />
                                        <p className="text-xs text-white/50">
                                            Укажите Telegram-группу, куда отправлять задачи уборки.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <label className="text-xs text-white/40" htmlFor="edit-timezone">Часовой пояс</label>
                                            <select id="edit-timezone" name="timezone" value={editForm.timezone} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-white/20">
                                                <option value="Asia/Bishkek">Бишкек (UTC+6)</option>
                                                <option value="Asia/Almaty">Алматы (UTC+5)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-white/40" htmlFor="edit-currency">Валюта</label>
                                            <select id="edit-currency" name="currency" value={editForm.currency} onChange={handleEditFieldChange} disabled={!selectedHotelId || isUpdatingHotel} className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-white/20">
                                                <option value="KGS">KGS (сом)</option>
                                                <option value="KZT">KZT (тенге)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <Button type="submit" className="w-full" disabled={!selectedHotelId || isUpdatingHotel}>
                                        {isUpdatingHotel ? "Сохраняем..." : "Обновить отель"}
                                    </Button>
                                </form>
                                <Button
                                    type="button"
                                    variant="danger"
                                    disabled={!selectedHotelId || isDeletingHotel}
                                    onClick={() => setConfirmDelete(true)}
                                    className="mt-2 w-full"
                                >
                                    {isDeletingHotel ? "Удаляем..." : "Удалить отель"}
                                </Button>
                            </>
                        )}
                    </Card>
                </section>
            )
            }

            {/* Delete hotel confirm modal */}
            {confirmDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                    <Card className="w-full max-w-sm space-y-4 p-5 text-center text-white">
                        <p className="text-base font-semibold">Удалить отель?</p>
                        <p className="text-sm text-white/50">Действие необратимо. Все данные отеля будут удалены.</p>
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

        </div>
    );
}
