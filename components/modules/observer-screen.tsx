'use client';

import useSWR from 'swr';
import { useState, useMemo, CSSProperties } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { SessionUser } from '@/lib/types';
import { useCookieApi } from '@/hooks/useCookieApi';
import { formatDateTime, formatMoney } from '@/lib/timezone';

/* ── Types ── */

interface ObserverStateResponse {
    hotel: {
        id: string;
        name: string;
        address: string;
        timezone?: string;
        currency?: string;
    };
    totals: {
        cashIn: number;
        cashInBreakdown: { cash: number; card: number };
        cashOut: number;
        cashOutBreakdown: { cash: number; card: number };
        payouts: number;
        adjustments: number;
        net: number;
    };
    dailySeries: Array<{ date: string; cashIn: number; cashOut: number }>;
    shiftNumbers: Array<{ number: number; status: string; openedAt: string }>;
    occupancy: {
        total: number;
        occupied: number;
        rate: number;
    };
    rooms: Array<{
        id: string;
        label: string;
        status: string;
        floor: number | null;
    }>;
    shifts: Array<{
        id: string;
        number: number;
        status: string;
        manager: string;
        openedAt: string;
        closedAt: string | null;
        openingCash: number;
        closingCash: number | null;
    }>;
    stays: Array<{
        id: string;
        guestName: string | null;
        room: string;
        scheduledCheckIn: string;
        scheduledCheckOut: string;
        actualCheckIn: string | null;
        actualCheckOut: string | null;
        status: string;
        amountPaid: number;
        paymentMethod: string | null;
        cashPaid: number | null;
        cardPaid: number | null;
    }>;
    ledger: Array<{
        id: string;
        entryType: string;
        method: string;
        amount: number;
        note: string | null;
        recordedAt: string;
        shiftNumber: number | null;
    }>;
}

type Tab = 'overview' | 'stays' | 'ledger' | 'shifts';

interface ObserverScreenProps {
    user: SessionUser;
    onLogout: () => void;
}

interface Filters {
    startDate: string;
    endDate: string;
    shiftNumber: string;
}

/* ── Helpers ── */

const STATUS_LABELS: Record<string, string> = {
    AVAILABLE: 'Свободен',
    OCCUPIED: 'Занят',
    MAINTENANCE: 'Ремонт',
    BOOKED: 'Бронь',
    CHECKED_IN: 'Заселён',
    CHECKED_OUT: 'Выселен',
    CANCELLED: 'Отменён',
    NO_SHOW: 'Неявка',
    OPEN: 'Открыта',
    CLOSED: 'Закрыта',
};

const ENTRY_LABELS: Record<string, string> = {
    CASH_IN: 'Приход',
    CASH_OUT: 'Расход',
    MANAGER_PAYOUT: 'Выплата',
    ADJUSTMENT: 'Корректировка',
};

const ENTRY_COLORS: Record<string, string> = {
    CASH_IN: 'text-emerald-400',
    CASH_OUT: 'text-rose-400',
    MANAGER_PAYOUT: 'text-amber-400',
    ADJUSTMENT: 'text-sky-400',
};

const fc = (v: number, cur?: string) => formatMoney(v, cur);

/* ── Component ── */

export function ObserverScreen({ user, onLogout }: ObserverScreenProps) {
    const { get } = useCookieApi();
    const [tab, setTab] = useState<Tab>('overview');
    const [filters, setFilters] = useState<Filters>({ startDate: '', endDate: '', shiftNumber: '' });

    const swrKey = useMemo(() => {
        const params = new URLSearchParams();
        if (filters.startDate) params.set('startDate', filters.startDate);
        if (filters.endDate) params.set('endDate', filters.endDate);
        if (filters.shiftNumber) params.set('shiftNumber', filters.shiftNumber);
        const qs = params.toString();
        return `/api/observer/state${qs ? `?${qs}` : ''}`;
    }, [filters]);

    const { data, isLoading } = useSWR<ObserverStateResponse>(
        swrKey,
        get,
        { refreshInterval: 30_000 },
    );

    const tz = data?.hotel?.timezone;
    const cur = data?.hotel?.currency;
    const fmt = (v: number) => formatMoney(v, cur);
    const fmtDate = (iso: string) => formatDateTime(iso, tz);

    const hasFilters = !!(filters.startDate || filters.endDate || filters.shiftNumber);

    const tabs: { key: Tab; label: string }[] = [
        { key: 'overview', label: 'Обзор' },
        { key: 'stays', label: 'Заселения' },
        { key: 'ledger', label: 'Журнал' },
        { key: 'shifts', label: 'Смены' },
    ];

    /* ── Loading ── */
    if (isLoading || !data) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-night text-white/40 text-sm">
                Загрузка…
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-night text-white">
            {/* Header */}
            <header className="sticky top-0 z-30 flex items-center justify-between bg-night/90 backdrop-blur px-4 py-3 border-b border-white/[0.06]">
                <div className="min-w-0">
                    <h1 className="text-base font-semibold truncate">{data.hotel.name}</h1>
                    <p className="text-[11px] text-white/40 truncate">{user.displayName} · наблюдатель</p>
                </div>
                <Button size="sm" variant="ghost" onClick={onLogout}>
                    Выход
                </Button>
            </header>

            {/* Filters */}
            <div className="px-4 pt-3 pb-1 space-y-2">
                <div className="grid grid-cols-2 gap-2 xs:grid-cols-3">
                    <Input
                        type="date"
                        value={filters.startDate}
                        onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                        placeholder="С даты"
                        className="text-xs"
                    />
                    <Input
                        type="date"
                        value={filters.endDate}
                        onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                        placeholder="По дату"
                        className="text-xs"
                    />
                    <Select
                        value={filters.shiftNumber}
                        onChange={(e) => setFilters((f) => ({ ...f, shiftNumber: e.target.value }))}
                        className="text-xs"
                    >
                        <option value="">Все смены</option>
                        {data.shiftNumbers.map((s) => (
                            <option key={s.number} value={String(s.number)}>
                                Смена #{s.number}
                            </option>
                        ))}
                    </Select>
                </div>
                {hasFilters && (
                    <button
                        onClick={() => setFilters({ startDate: '', endDate: '', shiftNumber: '' })}
                        className="text-[11px] text-white/40 hover:text-white/70 transition"
                    >
                        ✕ Сбросить фильтры
                    </button>
                )}
            </div>

            {/* Tabs */}
            <nav className="flex gap-1 px-4 py-2 overflow-x-auto">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${tab === t.key
                            ? 'bg-white/10 text-white'
                            : 'text-white/40 hover:text-white/70'
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            {/* Content */}
            <main className="px-4 pb-8 space-y-3">
                {tab === 'overview' && <OverviewTab data={data} fmt={fmt} cur={cur} />}
                {tab === 'stays' && <StaysTab stays={data.stays} fmtDate={fmtDate} fmt={fmt} />}
                {tab === 'ledger' && <LedgerTab ledger={data.ledger} fmtDate={fmtDate} fmt={fmt} />}
                {tab === 'shifts' && <ShiftsTab shifts={data.shifts} fmtDate={fmtDate} fmt={fmt} />}
            </main>
        </div>
    );
}

/* ── Donut Chart ── */

type DonutSegment = { value: number; color: string; label: string; textColor: string };

function DonutChart({ segments, centerLabel, centerValue, centerColor }: {
    segments: DonutSegment[];
    centerLabel: string;
    centerValue: string;
    centerColor: string;
}) {
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0) || 1;
    let cumDeg = 0;
    const stops: string[] = [];
    for (const seg of segments) {
        const deg = ((seg.value || 0) / total) * 360;
        stops.push(`${seg.color} ${cumDeg}deg ${cumDeg + deg}deg`);
        cumDeg += deg;
    }
    const chartStyle: CSSProperties = { backgroundImage: `conic-gradient(${stops.join(', ')})` };

    return (
        <Card className="p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div
                    className="relative mx-auto h-36 w-36 shrink-0 overflow-hidden rounded-full"
                    style={chartStyle}
                >
                    <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-night text-center">
                        <span className="text-[9px] uppercase tracking-widest text-white/35">{centerLabel}</span>
                        <span className={`text-xs font-semibold leading-tight ${centerColor}`}>{centerValue}</span>
                    </div>
                </div>
                <div className="flex-1 space-y-2 text-sm">
                    {segments.map((seg) => (
                        <div key={seg.label} className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white/50">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                                <span className="text-xs">{seg.label}</span>
                            </div>
                            <span className={`text-xs font-semibold ${seg.textColor}`}>
                                {fc(seg.value)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

/* ── Daily Line Chart ── */

type DailyPoint = { date: string; cashIn: number; cashOut: number };

function DailyLineChart({ data }: { data: DailyPoint[] }) {
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
        <Card className="p-3">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-white/35">Доход / Расход по дням</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
                {gridSteps.map((v) => (
                    <g key={v}>
                        <line x1={PX} y1={toY(v)} x2={W - PX} y2={toY(v)} stroke="rgba(255,255,255,0.06)" />
                        <text x={PX - 6} y={toY(v) + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9">{formatShort(v)}</text>
                    </g>
                ))}
                <path
                    d={`${pathIn} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(52,211,153,0.10)"
                />
                <path
                    d={`${pathOut} L${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`}
                    fill="rgba(248,113,113,0.08)"
                />
                <path d={pathIn} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                <path d={pathOut} fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 3" />
                {data.map((d, i) => (
                    <g key={d.date}>
                        <circle cx={toX(i)} cy={toY(d.cashIn)} r="2.5" fill="#34d399" />
                        <circle cx={toX(i)} cy={toY(d.cashOut)} r="2.5" fill="#f87171" />
                    </g>
                ))}
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
}

/* ── Overview Tab ── */

function OverviewTab({ data, fmt, cur }: { data: ObserverStateResponse; fmt: (v: number) => string; cur?: string }) {
    const t = data.totals;
    const netPositive = t.net >= 0;

    return (
        <>
            {/* Summary cards */}
            <Card className="p-3 space-y-1">
                <p className="text-[11px] uppercase tracking-widest text-white/35">Баланс</p>
                <p className={`text-xl font-semibold ${netPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fmt(t.net)}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/40">
                    <span>
                        <span className="text-emerald-400">▲</span> {fmt(t.cashIn)}
                    </span>
                    <span>
                        <span className="text-rose-400">▼</span> {fmt(t.cashOut)}
                    </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/30">
                    <span>нал {fc(t.cashInBreakdown.cash, cur)} · карта {fc(t.cashInBreakdown.card, cur)}</span>
                </div>
            </Card>

            {/* Totals grid */}
            <div className="grid grid-cols-2 gap-2 xs:grid-cols-4">
                <MiniCard label="Приход" value={fmt(t.cashIn)} className="text-emerald-400" />
                <MiniCard label="Расход" value={fmt(t.cashOut)} className="text-rose-400" />
                <MiniCard label="Выплаты" value={fmt(t.payouts)} className="text-amber-400" />
                <MiniCard label="Коррект." value={fmt(t.adjustments)} className="text-sky-400" />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Flow donut */}
                <DonutChart
                    segments={[
                        { value: t.cashIn, color: '#34d399', label: 'Вход', textColor: 'text-emerald-300' },
                        { value: t.cashOut + t.payouts, color: '#f87171', label: 'Выход', textColor: 'text-rose-300' },
                    ]}
                    centerLabel={netPositive ? 'Профицит' : 'Дефицит'}
                    centerValue={fmt(t.net)}
                    centerColor={netPositive ? 'text-emerald-200' : 'text-rose-200'}
                />

                {/* Payment method donut */}
                <DonutChart
                    segments={[
                        { value: t.cashInBreakdown.cash + t.cashOutBreakdown.cash, color: '#60a5fa', label: 'Наличные', textColor: 'text-blue-300' },
                        { value: t.cashInBreakdown.card + t.cashOutBreakdown.card, color: '#a78bfa', label: 'Карта', textColor: 'text-violet-300' },
                    ]}
                    centerLabel="Всего"
                    centerValue={fmt(t.cashIn + t.cashOut)}
                    centerColor="text-white"
                />

                {/* Expense structure donut */}
                <DonutChart
                    segments={[
                        { value: t.cashOut, color: '#f87171', label: 'Расходы', textColor: 'text-rose-300' },
                        { value: t.payouts, color: '#fb923c', label: 'Выплаты', textColor: 'text-orange-300' },
                        { value: Math.abs(t.adjustments), color: '#facc15', label: 'Корректировки', textColor: 'text-yellow-300' },
                    ]}
                    centerLabel="Расходы"
                    centerValue={fmt(t.cashOut + t.payouts + Math.abs(t.adjustments))}
                    centerColor="text-rose-200"
                />
            </div>

            {/* Daily line chart */}
            <DailyLineChart data={data.dailySeries} />

            {/* Occupancy */}
            <Card className="p-3">
                <h2 className="mb-2 text-sm font-semibold">Загрузка</h2>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{data.occupancy.rate}%</span>
                    <span className="text-xs text-white/40">
                        {data.occupancy.occupied} из {data.occupancy.total} номеров
                    </span>
                </div>
            </Card>

            {/* Room grid */}
            <Card className="p-3">
                <h2 className="mb-2 text-sm font-semibold">Номера</h2>
                <div className="grid grid-cols-3 gap-2 xs:grid-cols-4 sm:grid-cols-6">
                    {data.rooms.map((r) => (
                        <div
                            key={r.id}
                            className={`rounded-lg px-2 py-1.5 text-center text-xs font-medium ${r.status === 'OCCUPIED'
                                ? 'bg-rose-500/20 text-rose-300'
                                : r.status === 'MAINTENANCE'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-white/[0.06] text-white/60'
                                }`}
                        >
                            {r.label}
                        </div>
                    ))}
                </div>
            </Card>
        </>
    );
}

/* ── Stays Tab ── */

function StaysTab({
    stays,
    fmtDate,
    fmt,
}: {
    stays: ObserverStateResponse['stays'];
    fmtDate: (iso: string) => string;
    fmt: (v: number) => string;
}) {
    return (
        <div className="space-y-2">
            {stays.length === 0 && <p className="text-sm text-white/30 py-4 text-center">Нет записей</p>}
            {stays.map((s) => (
                <Card key={s.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                            {s.guestName || 'Без имени'}{' '}
                            <span className="text-white/30">· {s.room}</span>
                        </span>
                        <Badge label={STATUS_LABELS[s.status] || s.status} tone={s.status === 'CHECKED_IN' ? 'success' : 'default'} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/40">
                        <span>Заезд: {fmtDate(s.scheduledCheckIn)}</span>
                        <span>Выезд: {fmtDate(s.scheduledCheckOut)}</span>
                    </div>
                    <div className="text-xs text-white/60">
                        {fmt(s.amountPaid)}
                        {s.paymentMethod && (
                            <span className="text-white/30"> · {s.paymentMethod === 'CASH' ? 'Нал' : 'Карта'}</span>
                        )}
                        {(s.cashPaid != null && s.cashPaid > 0) && (
                            <span className="text-white/30"> · нал {fmt(s.cashPaid)}</span>
                        )}
                        {(s.cardPaid != null && s.cardPaid > 0) && (
                            <span className="text-white/30"> · карта {fmt(s.cardPaid)}</span>
                        )}
                    </div>
                </Card>
            ))}
        </div>
    );
}

/* ── Ledger Tab ── */

function LedgerTab({
    ledger,
    fmtDate,
    fmt,
}: {
    ledger: ObserverStateResponse['ledger'];
    fmtDate: (iso: string) => string;
    fmt: (v: number) => string;
}) {
    return (
        <div className="space-y-1">
            {ledger.length === 0 && <p className="text-sm text-white/30 py-4 text-center">Нет записей</p>}
            {ledger.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                        <p className={`text-sm font-medium ${ENTRY_COLORS[e.entryType] || 'text-white'}`}>
                            {ENTRY_LABELS[e.entryType] || e.entryType}
                            {e.shiftNumber != null && (
                                <span className="text-white/30 text-xs ml-1">#{e.shiftNumber}</span>
                            )}
                        </p>
                        {e.note && <p className="text-[11px] text-white/30 truncate">{e.note}</p>}
                        <p className="text-[11px] text-white/20">{fmtDate(e.recordedAt)} · {e.method === 'CASH' ? 'Нал' : 'Карта'}</p>
                    </div>
                    <span className={`text-sm font-medium shrink-0 ${ENTRY_COLORS[e.entryType] || 'text-white'}`}>
                        {fmt(e.amount)}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* ── Shifts Tab ── */

function ShiftsTab({
    shifts,
    fmtDate,
    fmt,
}: {
    shifts: ObserverStateResponse['shifts'];
    fmtDate: (iso: string) => string;
    fmt: (v: number) => string;
}) {
    return (
        <div className="space-y-2">
            {shifts.length === 0 && <p className="text-sm text-white/30 py-4 text-center">Нет записей</p>}
            {shifts.map((s) => (
                <Card key={s.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                            Смена #{s.number}
                            <span className="text-white/30 ml-1">· {s.manager}</span>
                        </span>
                        <Badge label={STATUS_LABELS[s.status] || s.status} tone={s.status === 'OPEN' ? 'success' : 'default'} />
                    </div>
                    <div className="text-[11px] text-white/40 space-y-0.5">
                        <p>Открыта: {fmtDate(s.openedAt)}</p>
                        {s.closedAt && <p>Закрыта: {fmtDate(s.closedAt)}</p>}
                    </div>
                    <div className="text-xs text-white/60">
                        Касса: {fmt(s.openingCash)}
                        {s.closingCash != null && <span> → {fmt(s.closingCash)}</span>}
                    </div>
                </Card>
            ))}
        </div>
    );
}

/* ── Mini Card Helper ── */

function MiniCard({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <Card className="p-2.5">
            <p className="text-[11px] text-white/40 mb-0.5">{label}</p>
            <p className={`text-sm font-semibold ${className ?? ''}`}>{value}</p>
        </Card>
    );
}
