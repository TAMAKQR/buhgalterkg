'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
        cashOut: number;
        payouts: number;
        adjustments: number;
        net: number;
    };
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

/* ── Component ── */

export function ObserverScreen({ user, onLogout }: ObserverScreenProps) {
    const { get } = useCookieApi();
    const [tab, setTab] = useState<Tab>('overview');

    const { data, isLoading } = useSWR<ObserverStateResponse>(
        '/api/observer/state',
        get,
        { refreshInterval: 30_000 },
    );

    const tz = data?.hotel?.timezone;
    const cur = data?.hotel?.currency;
    const fmt = (v: number) => formatMoney(v, cur);
    const fmtDate = (iso: string) => formatDateTime(iso, tz);

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
                {tab === 'overview' && <OverviewTab data={data} fmt={fmt} />}
                {tab === 'stays' && <StaysTab stays={data.stays} fmtDate={fmtDate} fmt={fmt} />}
                {tab === 'ledger' && <LedgerTab ledger={data.ledger} fmtDate={fmtDate} fmt={fmt} />}
                {tab === 'shifts' && <ShiftsTab shifts={data.shifts} fmtDate={fmtDate} fmt={fmt} />}
            </main>
        </div>
    );
}

/* ── Overview Tab ── */

function OverviewTab({ data, fmt }: { data: ObserverStateResponse; fmt: (v: number) => string }) {
    return (
        <>
            {/* Totals */}
            <div className="grid grid-cols-2 gap-2 xs:grid-cols-3">
                <MiniCard label="Приход" value={fmt(data.totals.cashIn)} className="text-emerald-400" />
                <MiniCard label="Расход" value={fmt(data.totals.cashOut)} className="text-rose-400" />
                <MiniCard label="Выплаты" value={fmt(data.totals.payouts)} className="text-amber-400" />
                <MiniCard label="Коррект." value={fmt(data.totals.adjustments)} className="text-sky-400" />
                <MiniCard label="Итого" value={fmt(data.totals.net)} className="text-white" />
            </div>

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
