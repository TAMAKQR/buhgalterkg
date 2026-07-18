'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, Plus, Settings2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, TextArea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/hooks/useApi';
import { formatDateKey, formatInputValue, formatMoney, parseInputValue } from '@/lib/timezone';

type EconomicsMode = 'actual' | 'planned';
type SettingsTab = 'expense' | 'plan';
const MAX_BULK_ROOM_SELECTION = 200;

type EconomicsRoom = {
    id: string;
    label: string;
    floor?: string | null;
    isActive: boolean;
    activeDays: number;
    occupiedNights: number;
    stayCount: number;
    earnedRevenue: number;
    cashReceived: number;
    directActualCost: number;
    sharedActualCost: number;
    actualCost: number;
    plannedCost: number;
    actualProfit: number;
    plannedProfit: number;
    margin: number;
    incompleteStays: number;
};

type RoomEconomicsPayload = {
    period: {
        from: string;
        to: string;
        days: number;
    };
    hotel: {
        monthlyPayrollCost: number;
        monthlyRentCost: number;
        monthlyUtilitiesCost: number;
        monthlySuppliesCost: number;
        monthlyOtherCost: number;
    };
    totals: {
        earnedRevenue: number;
        cashReceived: number;
        actualCost: number;
        plannedCost: number;
        actualProfit: number;
        plannedProfit: number;
        margin: number;
        occupiedNights: number;
        incompleteStays: number;
        occupancyConflictRooms?: number;
        estimatedActivityRooms?: number;
        unallocatedActualCost?: number;
        unallocatedPlannedCost?: number;
    };
    rooms: EconomicsRoom[];
};

type PlanFormState = {
    payroll: string;
    rent: string;
    utilities: string;
    supplies: string;
    other: string;
};

type ExpenseFormState = {
    scope: 'hotel' | 'room';
    roomIds: string[];
    allocationMode: 'SPLIT_TOTAL' | 'PER_ROOM';
    categoryId: string;
    amount: string;
    method: 'CASH' | 'CARD';
    date: string;
    note: string;
};

interface RoomEconomicsPanelProps {
    hotelId: string;
    currency: string;
    timezone: string;
    rooms: Array<{
        id: string;
        label: string;
        floor?: string | null;
        isActive: boolean;
    }>;
    expenseCategories: Array<{
        id: string;
        name: string;
    }>;
    onChanged?: () => void;
}

const emptyExpenseForm: ExpenseFormState = {
    scope: 'hotel',
    roomIds: [],
    allocationMode: 'SPLIT_TOTAL',
    categoryId: '',
    amount: '',
    method: 'CASH',
    date: '',
    note: '',
};

const emptyPlanForm: PlanFormState = {
    payroll: '0',
    rent: '0',
    utilities: '0',
    supplies: '0',
    other: '0',
};

const shiftDateKey = (value: string, dayDelta: number) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + dayDelta));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const createPresetRange = (days: number, timezone: string) => {
    const to = formatDateKey(new Date(), timezone);
    return { from: shiftDateKey(to, -(days - 1)), to };
};

const fromMinorUnits = (value?: number | null) => {
    const major = (value ?? 0) / 100;
    return Number.isInteger(major) ? String(major) : major.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const toMinorUnits = (value: string, allowZero = true) => {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return allowZero ? 0 : null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) return null;
    return Math.round(parsed * 100);
};

const planFormFromReport = (report?: RoomEconomicsPayload | null): PlanFormState => {
    if (!report) return emptyPlanForm;
    return {
        payroll: fromMinorUnits(report.hotel.monthlyPayrollCost),
        rent: fromMinorUnits(report.hotel.monthlyRentCost),
        utilities: fromMinorUnits(report.hotel.monthlyUtilitiesCost),
        supplies: fromMinorUnits(report.hotel.monthlySuppliesCost),
        other: fromMinorUnits(report.hotel.monthlyOtherCost),
    };
};

const formatPercent = (value: number) => `${Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}%`;

const profitTone = (value: number) => value < 0
    ? 'text-rose-600 dark:text-rose-300'
    : 'text-emerald-700 dark:text-emerald-300';

const marginTone = (value: number) => value < 0
    ? 'danger' as const
    : value < 20
        ? 'warning' as const
        : 'success' as const;

const perOccupiedNight = (value: number, occupiedNights: number) =>
    occupiedNights > 0 ? Math.round(value / occupiedNights) : null;

const formatPerNight = (value: number, occupiedNights: number, currency: string) => {
    const result = perOccupiedNight(value, occupiedNights);
    return result == null ? '—' : `${formatMoney(result, currency)} / ночь`;
};

export const RoomEconomicsPanel = ({
    hotelId,
    currency,
    timezone,
    rooms,
    expenseCategories,
    onChanged,
}: RoomEconomicsPanelProps) => {
    const { get, request } = useApi();
    const { toast } = useToast();
    const initialRange = useMemo(() => createPresetRange(30, timezone), [timezone]);
    const [isOpen, setIsOpen] = useState(false);
    const [preset, setPreset] = useState<'7' | '30' | 'custom'>('30');
    const [from, setFrom] = useState(initialRange.from);
    const [to, setTo] = useState(initialRange.to);
    const [mode, setMode] = useState<EconomicsMode>('actual');
    const [lastReport, setLastReport] = useState<RoomEconomicsPayload | null>(null);
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('expense');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isSavingExpense, setIsSavingExpense] = useState(false);
    const [isSavingPlan, setIsSavingPlan] = useState(false);
    const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(() => ({
        ...emptyExpenseForm,
        date: formatDateKey(new Date(), timezone),
    }));
    const [expenseOperationId, setExpenseOperationId] = useState(() => crypto.randomUUID());
    const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
    const [selectedReportRoomIds, setSelectedReportRoomIds] = useState<string[]>([]);

    const activeRooms = useMemo(() => rooms.filter((room) => room.isActive), [rooms]);

    const dateError = !from || !to
        ? 'Укажите начало и конец периода'
        : from > to
            ? 'Начало периода не может быть позже конца'
            : null;
    const reportKey = isOpen && !dateError
        ? `/api/admin/hotels/${hotelId}/room-economics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        : null;
    const { data: report, error, isLoading, isValidating, mutate } = useSWR<RoomEconomicsPayload>(
        reportKey,
        (url: string) => get<RoomEconomicsPayload>(url),
        { revalidateOnFocus: false }
    );

    useEffect(() => {
        if (report) setLastReport(report);
    }, [report]);

    useEffect(() => {
        setLastReport(null);
        const range = createPresetRange(30, timezone);
        setPreset('30');
        setFrom(range.from);
        setTo(range.to);
        setExpenseForm({ ...emptyExpenseForm, date: range.to });
        setExpenseOperationId(crypto.randomUUID());
        setSelectedReportRoomIds([]);
    }, [hotelId, timezone]);

    useEffect(() => {
        const activeRoomIds = new Set(activeRooms.map((room) => room.id));
        setSelectedReportRoomIds((current) => current.filter((roomId) => activeRoomIds.has(roomId)));
        setExpenseForm((current) => ({
            ...current,
            roomIds: current.roomIds.filter((roomId) => activeRoomIds.has(roomId)),
        }));
    }, [activeRooms]);

    useEffect(() => {
        if (!isSettingsOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSavingExpense && !isSavingPlan) {
                setIsSettingsOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isSavingExpense, isSavingPlan, isSettingsOpen]);

    const displayedReport = report ?? lastReport;
    const selectedTotals = displayedReport
        ? {
            cost: mode === 'actual' ? displayedReport.totals.actualCost : displayedReport.totals.plannedCost,
            profit: mode === 'actual' ? displayedReport.totals.actualProfit : displayedReport.totals.plannedProfit,
            margin: mode === 'actual'
                ? displayedReport.totals.margin
                : displayedReport.totals.earnedRevenue > 0
                    ? (displayedReport.totals.plannedProfit / displayedReport.totals.earnedRevenue) * 100
                    : 0,
        }
        : null;
    const reportActiveRoomIds = displayedReport?.rooms.filter((room) => room.isActive).map((room) => room.id) ?? [];
    const selectableReportRoomIds = reportActiveRoomIds.slice(0, MAX_BULK_ROOM_SELECTION);
    const allReportRoomsSelected = selectableReportRoomIds.length > 0
        && selectableReportRoomIds.every((roomId) => selectedReportRoomIds.includes(roomId));
    const expenseAmountMinor = toMinorUnits(expenseForm.amount, false);
    const expenseRoomCount = expenseForm.roomIds.length;
    const expenseBatchTotalMinor = expenseAmountMinor == null
        ? null
        : expenseForm.allocationMode === 'PER_ROOM'
            ? expenseAmountMinor * expenseRoomCount
            : expenseAmountMinor;
    const expensePerRoomMinor = expenseAmountMinor == null || expenseRoomCount === 0
        ? null
        : expenseForm.allocationMode === 'PER_ROOM'
            ? expenseAmountMinor
            : Math.floor(expenseAmountMinor / expenseRoomCount);

    const applyPreset = (days: 7 | 30) => {
        const range = createPresetRange(days, timezone);
        setPreset(String(days) as '7' | '30');
        setFrom(range.from);
        setTo(range.to);
    };

    const openSettings = (tab: SettingsTab, preselectedRoomIds: string[] = []) => {
        setSettingsTab(tab);
        setPlanForm(planFormFromReport(displayedReport));
        if (tab === 'expense') {
            const today = formatDateKey(new Date(), timezone);
            const defaultInstant = to < today
                ? parseInputValue(`${to}T12:00`, timezone)
                : new Date();
            setExpenseForm((current) => ({
                ...current,
                date: formatInputValue(defaultInstant ?? new Date(), timezone),
                scope: preselectedRoomIds.length ? 'room' : current.scope,
                roomIds: preselectedRoomIds.length ? preselectedRoomIds : current.roomIds,
            }));
            setExpenseOperationId(crypto.randomUUID());
        }
        setIsSettingsOpen(true);
    };

    const closeSettings = () => {
        if (isSavingExpense || isSavingPlan) return;
        setIsSettingsOpen(false);
    };

    const toggleExpenseRoom = (roomId: string) => {
        if (!expenseForm.roomIds.includes(roomId) && expenseForm.roomIds.length >= MAX_BULK_ROOM_SELECTION) {
            toast(`За один раз можно выбрать не более ${MAX_BULK_ROOM_SELECTION} номеров`, 'error');
            return;
        }
        setExpenseForm((current) => ({
            ...current,
            roomIds: current.roomIds.includes(roomId)
                ? current.roomIds.filter((id) => id !== roomId)
                : [...current.roomIds, roomId],
        }));
    };

    const toggleReportRoom = (roomId: string) => {
        if (!selectedReportRoomIds.includes(roomId) && selectedReportRoomIds.length >= MAX_BULK_ROOM_SELECTION) {
            toast(`За один раз можно выбрать не более ${MAX_BULK_ROOM_SELECTION} номеров`, 'error');
            return;
        }
        setSelectedReportRoomIds((current) => current.includes(roomId)
            ? current.filter((id) => id !== roomId)
            : [...current, roomId]);
    };

    const handleExpenseSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const amount = toMinorUnits(expenseForm.amount, false);
        if (amount == null) {
            toast('Укажите сумму расхода больше нуля', 'error');
            return;
        }
        if (expenseForm.scope === 'room' && !expenseForm.roomIds.length) {
            toast('Выберите хотя бы один номер', 'error');
            return;
        }
        const recordedAt = parseInputValue(expenseForm.date, timezone);
        if (!recordedAt) {
            toast('Укажите дату расхода', 'error');
            return;
        }

        setIsSavingExpense(true);
        try {
            const commonBody = {
                categoryId: expenseForm.categoryId || undefined,
                amount,
                method: expenseForm.method,
                recordedAt: recordedAt.toISOString(),
                note: expenseForm.note.trim() || undefined,
            };
            if (expenseForm.scope === 'room') {
                await request(`/api/admin/hotels/${hotelId}/room-expenses`, {
                    method: 'POST',
                    headers: { 'Idempotency-Key': expenseOperationId },
                    body: {
                        ...commonBody,
                        roomIds: expenseForm.roomIds,
                        allocationMode: expenseForm.allocationMode,
                    },
                });
                toast(`Расход сохранён для ${expenseForm.roomIds.length} ${expenseForm.roomIds.length === 1 ? 'номера' : 'номеров'}`, 'success');
            } else {
                await request('/api/expenses', {
                    method: 'POST',
                    headers: { 'Idempotency-Key': expenseOperationId },
                    body: {
                        ...commonBody,
                        hotelId,
                        entryType: 'CASH_OUT',
                    },
                });
                toast('Расход добавлен', 'success');
            }
            setExpenseForm({ ...emptyExpenseForm, date: formatInputValue(new Date(), timezone) });
            setExpenseOperationId(crypto.randomUUID());
            setSelectedReportRoomIds([]);
            setIsSettingsOpen(false);
            void mutate();
            onChanged?.();
        } catch (submitError) {
            toast(submitError instanceof Error ? submitError.message : 'Не удалось добавить расход', 'error');
        } finally {
            setIsSavingExpense(false);
        }
    };

    const handlePlanSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payroll = toMinorUnits(planForm.payroll);
        const rent = toMinorUnits(planForm.rent);
        const utilities = toMinorUnits(planForm.utilities);
        const supplies = toMinorUnits(planForm.supplies);
        const other = toMinorUnits(planForm.other);
        if ([payroll, rent, utilities, supplies, other].some((value) => value == null)) {
            toast('Проверьте суммы плановых затрат', 'error');
            return;
        }

        setIsSavingPlan(true);
        try {
            await request(`/api/hotels/${hotelId}`, {
                method: 'PATCH',
                body: {
                    monthlyPayrollCost: payroll,
                    monthlyRentCost: rent,
                    monthlyUtilitiesCost: utilities,
                    monthlySuppliesCost: supplies,
                    monthlyOtherCost: other,
                },
            });
            toast('Плановые затраты сохранены', 'success');
            setIsSettingsOpen(false);
            void mutate();
            onChanged?.();
        } catch (submitError) {
            toast(submitError instanceof Error ? submitError.message : 'Не удалось сохранить план', 'error');
        } finally {
            setIsSavingPlan(false);
        }
    };

    const reportSummary = displayedReport && selectedTotals
        ? `${displayedReport.period.days} дн. · ${mode === 'actual' ? 'факт' : 'план'} ${formatMoney(selectedTotals.profit, currency)}`
        : 'Себестоимость и прибыль каждого номера';

    return (
        <Card className="p-0">
            <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.035] sm:px-5 sm:py-4"
                onClick={() => setIsOpen((current) => !current)}
                aria-expanded={isOpen}
                aria-controls={`room-economics-${hotelId}`}
            >
                <span className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/35">Финансовый результат</span>
                    <span className="mt-0.5 block text-base font-semibold text-slate-900 dark:text-white">Экономика номеров</span>
                </span>
                <span className="flex min-w-0 shrink-0 items-center gap-3">
                    <span className={`hidden max-w-[22rem] truncate text-xs sm:block ${selectedTotals?.profit != null ? profitTone(selectedTotals.profit) : 'text-slate-500 dark:text-white/40'}`}>
                        {reportSummary}
                    </span>
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-white/55">
                        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </span>
                </span>
            </button>

            {isOpen ? (
                <div id={`room-economics-${hotelId}`} className="space-y-4 border-t border-slate-200/80 p-4 dark:border-white/[0.06] sm:p-5">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-white/[0.07] dark:bg-white/[0.03]">
                                {([['7', '7 дней'], ['30', '30 дней']] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`h-8 rounded-md px-3 text-xs font-medium transition ${preset === value ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.1] dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-white/45 dark:hover:text-white/75'}`}
                                        onClick={() => applyPreset(Number(value) as 7 | 30)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <label className="min-w-0 space-y-1">
                                <span className="block text-[11px] font-medium text-slate-500 dark:text-white/40">От</span>
                                <Input
                                    type="date"
                                    className="h-9 sm:w-40"
                                    value={from}
                                    onChange={(event) => {
                                        setPreset('custom');
                                        setFrom(event.target.value);
                                    }}
                                />
                            </label>
                            <label className="min-w-0 space-y-1">
                                <span className="block text-[11px] font-medium text-slate-500 dark:text-white/40">До</span>
                                <Input
                                    type="date"
                                    className="h-9 sm:w-40"
                                    value={to}
                                    onChange={(event) => {
                                        setPreset('custom');
                                        setTo(event.target.value);
                                    }}
                                />
                            </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-white/[0.07] dark:bg-white/[0.03]" aria-label="Режим расчёта">
                                {([['actual', 'Факт'], ['planned', 'План']] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`h-8 rounded-md px-3 text-xs font-medium transition ${mode === value ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-800 dark:text-white/45 dark:hover:text-white/75'}`}
                                        onClick={() => setMode(value)}
                                        aria-pressed={mode === value}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => openSettings('plan')} disabled={!displayedReport}>
                                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                                План затрат
                            </Button>
                            <Button type="button" size="sm" className="gap-1.5" onClick={() => openSettings('expense', selectedReportRoomIds)}>
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                Добавить расход
                            </Button>
                        </div>
                    </div>

                    {dateError ? (
                        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">{dateError}</p>
                    ) : error ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
                            <span>{error instanceof Error ? error.message : 'Не удалось загрузить экономику номеров'}</span>
                            <Button type="button" size="sm" variant="ghost" onClick={() => void mutate()}>Повторить</Button>
                        </div>
                    ) : isLoading || !displayedReport ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
                            </div>
                            <Skeleton className="h-40 rounded-lg" />
                        </div>
                    ) : selectedTotals ? (
                        <>
                            <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-slate-200/70 dark:border-white/[0.07] dark:bg-white/[0.07]">
                                <div className="grid grid-cols-2 gap-px xl:grid-cols-4">
                                    <div className="min-w-0 bg-white px-3 py-3 dark:bg-[#171b21]">
                                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/35">Начислено</p>
                                        <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{formatMoney(displayedReport.totals.earnedRevenue, currency)}</p>
                                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/42" title="Фактически проведённые оплаты за выбранный период">Получено {formatMoney(displayedReport.totals.cashReceived, currency)}</p>
                                    </div>
                                    <div className="min-w-0 bg-white px-3 py-3 dark:bg-[#171b21]">
                                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/35">{mode === 'actual' ? 'Факт. расходы' : 'План. расходы'}</p>
                                        <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{formatMoney(selectedTotals.cost, currency)}</p>
                                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/42">{formatPerNight(selectedTotals.cost, displayedReport.totals.occupiedNights, currency).replace(' / ночь', ' / занятую ночь')}</p>
                                    </div>
                                    <div className="min-w-0 bg-white px-3 py-3 dark:bg-[#171b21]">
                                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/35">Чистыми</p>
                                        <p className={`mt-1 text-base font-semibold ${profitTone(selectedTotals.profit)}`}>{formatMoney(selectedTotals.profit, currency)}</p>
                                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/42">Начислено минус {mode === 'actual' ? 'факт' : 'план'}</p>
                                    </div>
                                    <div className="min-w-0 bg-white px-3 py-3 dark:bg-[#171b21]">
                                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/35">Маржа</p>
                                        <p className={`mt-1 text-base font-semibold ${displayedReport.totals.earnedRevenue > 0 ? profitTone(selectedTotals.margin) : 'text-slate-500 dark:text-white/45'}`}>{displayedReport.totals.earnedRevenue > 0 ? formatPercent(selectedTotals.margin) : '—'}</p>
                                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/42">{displayedReport.totals.occupiedNights} занятых ночей</p>
                                    </div>
                                </div>
                            </div>

                            {displayedReport.totals.incompleteStays > 0 ? (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
                                    {displayedReport.totals.incompleteStays} проживаний без полной суммы не вошли в начисленную выручку. Уточните тариф, чтобы расчёт был точным.
                                </p>
                            ) : null}

                            {(displayedReport.totals.occupancyConflictRooms ?? 0) > 0 ? (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
                                    В {displayedReport.totals.occupancyConflictRooms} номерах найдены пересекающиеся проживания. Загрузка ограничена одной занятой ночью в сутки; проверьте историю этих номеров.
                                </p>
                            ) : null}

                            {(displayedReport.totals.estimatedActivityRooms ?? 0) > 0 ? (
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white/55">
                                    Даты включения и архива до обновления у части номеров восстановлены приблизительно. Таких номеров: {displayedReport.totals.estimatedActivityRooms}. Новые изменения сохраняются точно.
                                </p>
                            ) : null}

                            {(mode === 'actual' ? displayedReport.totals.unallocatedActualCost : displayedReport.totals.unallocatedPlannedCost) ? (
                                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-100">
                                    {formatMoney((mode === 'actual' ? displayedReport.totals.unallocatedActualCost : displayedReport.totals.unallocatedPlannedCost) ?? 0, currency)} не распределено: в соответствующие даты в объекте не было активных номеров.
                                </p>
                            ) : null}

                            {selectedReportRoomIds.length ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-400/20 dark:bg-blue-500/10">
                                    <div>
                                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Выбрано номеров: {selectedReportRoomIds.length}</p>
                                        <p className="text-[11px] text-blue-700/70 dark:text-blue-100/55">Добавьте один расход сразу на отмеченные комнаты.</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedReportRoomIds([])}>Сбросить</Button>
                                        <Button type="button" size="sm" className="gap-1.5" onClick={() => openSettings('expense', selectedReportRoomIds)}>
                                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                            Добавить расход
                                        </Button>
                                    </div>
                                </div>
                            ) : null}

                            <div className={`overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/[0.07] ${isValidating ? 'opacity-70' : ''}`}>
                                <div className="hidden overflow-x-auto lg:block">
                                    <table className="min-w-full text-sm">
                                        <thead className="border-b border-slate-200/80 bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-white/35">
                                            <tr>
                                                <th className="w-10 px-3 py-2.5 text-center font-medium">
                                                    <input
                                                        type="checkbox"
                                                        checked={allReportRoomsSelected}
                                                        onChange={() => setSelectedReportRoomIds(allReportRoomsSelected ? [] : selectableReportRoomIds)}
                                                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                                                        aria-label={allReportRoomsSelected ? 'Снять выбор со всех номеров' : 'Выбрать все активные номера'}
                                                    />
                                                </th>
                                                <th className="px-4 py-2.5 text-left font-medium">Номер</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Загрузка</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Начислено</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Расходы</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Чистыми</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Маржа</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.055]">
                                            {displayedReport.rooms.map((room) => {
                                                const cost = mode === 'actual' ? room.actualCost : room.plannedCost;
                                                const profit = mode === 'actual' ? room.actualProfit : room.plannedProfit;
                                                const margin = mode === 'actual'
                                                    ? room.margin
                                                    : room.earnedRevenue > 0
                                                        ? (room.plannedProfit / room.earnedRevenue) * 100
                                                        : 0;
                                                return (
                                                    <tr key={room.id} className="bg-white transition hover:bg-slate-50/80 dark:bg-transparent dark:hover:bg-white/[0.025]">
                                                        <td className="px-3 py-3 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedReportRoomIds.includes(room.id)}
                                                                disabled={!room.isActive}
                                                                onChange={() => toggleReportRoom(room.id)}
                                                                className="h-4 w-4 rounded border-slate-300 accent-blue-600 disabled:opacity-30"
                                                                aria-label={`Выбрать номер ${room.label}`}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-slate-900 dark:text-white">№ {room.label}</span>
                                                                {!room.isActive ? <Badge label="Выкл" /> : null}
                                                            </div>
                                                            {room.floor ? <p className="mt-0.5 text-[11px] text-slate-500 dark:text-white/35">{room.floor}</p> : null}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-700 dark:text-white/70">
                                                            <p>{room.occupiedNights} ноч.</p>
                                                            <p className="text-[11px] text-slate-500 dark:text-white/35">{room.stayCount} заезд.</p>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                                                            <p>{formatMoney(room.earnedRevenue, currency)}</p>
                                                            <p className="text-[11px] font-normal text-slate-500 dark:text-white/35" title="Фактически получено">получено {formatMoney(room.cashReceived, currency)}</p>
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-700 dark:text-white/70">
                                                            <p>{formatMoney(cost, currency)}</p>
                                                            <p className="text-[11px] text-slate-500 dark:text-white/35">{formatPerNight(cost, room.occupiedNights, currency)}{mode === 'actual' ? ` · прямые ${formatMoney(room.directActualCost, currency)}` : ''}</p>
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-semibold ${profitTone(profit)}`}>
                                                            <p>{formatMoney(profit, currency)}</p>
                                                            <p className="text-[11px] font-normal opacity-70">{formatPerNight(profit, room.occupiedNights, currency)}</p>
                                                        </td>
                                                        <td className="px-4 py-3 text-right"><Badge label={room.earnedRevenue > 0 ? formatPercent(margin) : '—'} tone={room.earnedRevenue > 0 ? marginTone(margin) : 'default'} /></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="divide-y divide-slate-200/70 dark:divide-white/[0.055] lg:hidden">
                                    {displayedReport.rooms.map((room) => {
                                        const cost = mode === 'actual' ? room.actualCost : room.plannedCost;
                                        const profit = mode === 'actual' ? room.actualProfit : room.plannedProfit;
                                        const margin = mode === 'actual'
                                            ? room.margin
                                            : room.earnedRevenue > 0
                                                ? (room.plannedProfit / room.earnedRevenue) * 100
                                                : 0;
                                        return (
                                            <div key={room.id} className="bg-white p-3 dark:bg-transparent">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex min-w-0 items-start gap-2.5">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedReportRoomIds.includes(room.id)}
                                                            disabled={!room.isActive}
                                                            onChange={() => toggleReportRoom(room.id)}
                                                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600 disabled:opacity-30"
                                                            aria-label={`Выбрать номер ${room.label}`}
                                                        />
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-slate-900 dark:text-white">№ {room.label}{room.floor ? ` · ${room.floor}` : ''}</p>
                                                            <p className="mt-0.5 text-xs text-slate-500 dark:text-white/40">{room.occupiedNights} ночей · {room.stayCount} заездов</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        {!room.isActive ? <Badge label="Выкл" /> : null}
                                                        <Badge label={room.earnedRevenue > 0 ? formatPercent(margin) : '—'} tone={room.earnedRevenue > 0 ? marginTone(margin) : 'default'} />
                                                    </div>
                                                </div>
                                                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                                    <div className="col-span-2 border-t border-slate-200/70 pt-2 dark:border-white/[0.055]">
                                                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/35">Начислено</p>
                                                        <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatMoney(room.earnedRevenue, currency)}</p>
                                                        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-white/35">получено {formatMoney(room.cashReceived, currency)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/35">Расходы</p>
                                                        <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatMoney(cost, currency)}</p>
                                                        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-white/35">{formatPerNight(cost, room.occupiedNights, currency)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/35">Чистыми</p>
                                                        <p className={`mt-1 font-semibold ${profitTone(profit)}`}>{formatMoney(profit, currency)}</p>
                                                        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-white/35">{formatPerNight(profit, room.occupiedNights, currency)}</p>
                                                    </div>
                                                </div>
                                                {room.incompleteStays > 0 ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-200">Без суммы: {room.incompleteStays}</p> : null}
                                            </div>
                                        );
                                    })}
                                </div>

                                {displayedReport.rooms.length === 0 ? (
                                    <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-white/40">Номеров для расчёта пока нет.</p>
                                ) : null}
                            </div>
                            {isValidating ? <p className="text-right text-[11px] text-slate-500 dark:text-white/35">Обновляем расчёт…</p> : null}
                        </>
                    ) : null}
                </div>
            ) : null}

            {isSettingsOpen ? (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-3 py-4 backdrop-blur-sm" onMouseDown={closeSettings}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="room-economics-settings-title"
                        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-white/[0.08] dark:bg-[#11161d] sm:p-5"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/35">Экономика номеров</p>
                                <h3 id="room-economics-settings-title" className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Настройка затрат</h3>
                            </div>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={closeSettings} aria-label="Закрыть">
                                <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-white/[0.07] dark:bg-white/[0.03]">
                            <button
                                type="button"
                                className={`h-9 rounded-md px-3 text-xs font-medium transition ${settingsTab === 'expense' ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.1] dark:text-white' : 'text-slate-500 dark:text-white/45'}`}
                                onClick={() => setSettingsTab('expense')}
                            >
                                Фактический расход
                            </button>
                            <button
                                type="button"
                                className={`h-9 rounded-md px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${settingsTab === 'plan' ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.1] dark:text-white' : 'text-slate-500 dark:text-white/45'}`}
                                disabled={!displayedReport}
                                onClick={() => {
                                    setPlanForm(planFormFromReport(displayedReport));
                                    setSettingsTab('plan');
                                }}
                            >
                                Месячный план
                            </button>
                        </div>

                        {settingsTab === 'expense' ? (
                            <form className="mt-4 space-y-4" onSubmit={handleExpenseSubmit}>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1.5">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">Куда отнести</span>
                                        <Select value={expenseForm.scope} onChange={(event) => setExpenseForm((current) => ({ ...current, scope: event.target.value as ExpenseFormState['scope'], roomIds: [] }))}>
                                            <option value="hotel">Весь объект</option>
                                            <option value="room">Выбранные номера</option>
                                        </Select>
                                    </label>
                                    {expenseForm.scope === 'room' ? (
                                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-400/20 dark:bg-blue-500/10">
                                            <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Выбрано: {expenseForm.roomIds.length}</p>
                                            <p className="mt-0.5 text-[11px] text-blue-700/70 dark:text-blue-100/55">Расход будет записан отдельно в экономику каждой комнаты.</p>
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white/45">
                                            Общий расход распределится между номерами, активными на указанную дату.
                                        </div>
                                    )}
                                </div>
                                {expenseForm.scope === 'room' ? (
                                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <p className="text-xs font-semibold text-slate-800 dark:text-white/85">Выберите номера</p>
                                                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-white/40">Только активные комнаты доступны для нового расхода.</p>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setExpenseForm((current) => ({ ...current, roomIds: activeRooms.slice(0, MAX_BULK_ROOM_SELECTION).map((room) => room.id) }))}
                                                >
                                                    Выбрать все
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={!expenseForm.roomIds.length}
                                                    onClick={() => setExpenseForm((current) => ({ ...current, roomIds: [] }))}
                                                >
                                                    Очистить
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                                            {activeRooms.map((room) => {
                                                const checked = expenseForm.roomIds.includes(room.id);
                                                return (
                                                    <label
                                                        key={room.id}
                                                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${checked ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-white/65 dark:hover:border-white/15'}`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleExpenseRoom(room.id)}
                                                            className="h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600"
                                                        />
                                                        <span className="min-w-0 truncate" title={`№ ${room.label}${room.floor ? ` · ${room.floor}` : ''}`}>№ {room.label}{room.floor ? ` · ${room.floor}` : ''}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        {activeRooms.length === 0 ? (
                                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">Нет активных номеров для распределения расхода.</p>
                                        ) : null}

                                        <div>
                                            <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-white/45">Как применить сумму</p>
                                            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-white/[0.07] dark:bg-white/[0.025]">
                                                <button
                                                    type="button"
                                                    className={`min-h-9 rounded-md px-2 py-1.5 text-xs font-medium transition ${expenseForm.allocationMode === 'SPLIT_TOTAL' ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-950' : 'text-slate-500 dark:text-white/45'}`}
                                                    onClick={() => setExpenseForm((current) => ({ ...current, allocationMode: 'SPLIT_TOTAL' }))}
                                                >
                                                    Общую — разделить
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`min-h-9 rounded-md px-2 py-1.5 text-xs font-medium transition ${expenseForm.allocationMode === 'PER_ROOM' ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-950' : 'text-slate-500 dark:text-white/45'}`}
                                                    onClick={() => setExpenseForm((current) => ({ ...current, allocationMode: 'PER_ROOM' }))}
                                                >
                                                    На каждый номер
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1.5">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">Категория</span>
                                        <Select value={expenseForm.categoryId} onChange={(event) => setExpenseForm((current) => ({ ...current, categoryId: event.target.value }))}>
                                            <option value="">Без категории</option>
                                            {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                                        </Select>
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">
                                            {expenseForm.scope === 'room' && expenseForm.allocationMode === 'PER_ROOM' ? 'Сумма на номер' : 'Общая сумма'} ({currency})
                                        </span>
                                        <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0" required />
                                        {expenseForm.scope === 'room' && expenseBatchTotalMinor != null && expensePerRoomMinor != null && expenseRoomCount > 0 ? (
                                            <span className="block text-[11px] text-slate-500 dark:text-white/40">
                                                {expenseForm.allocationMode === 'PER_ROOM'
                                                    ? `${formatMoney(expensePerRoomMinor, currency)} × ${expenseRoomCount} = ${formatMoney(expenseBatchTotalMinor, currency)}`
                                                    : `${formatMoney(expenseBatchTotalMinor, currency)} ÷ ${expenseRoomCount} ≈ ${formatMoney(expensePerRoomMinor, currency)} / номер`}
                                            </span>
                                        ) : null}
                                    </label>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1.5">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">Дата и время расхода</span>
                                        <Input
                                            type="datetime-local"
                                            max={formatInputValue(new Date(), timezone)}
                                            value={expenseForm.date}
                                            onChange={(event) => setExpenseForm((current) => ({ ...current, date: event.target.value }))}
                                            required
                                        />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">Способ</span>
                                        <Select value={expenseForm.method} onChange={(event) => setExpenseForm((current) => ({ ...current, method: event.target.value as ExpenseFormState['method'] }))}>
                                            <option value="CASH">Наличные</option>
                                            <option value="CARD">Безналично</option>
                                        </Select>
                                    </label>
                                    <label className="space-y-1.5 sm:col-span-2">
                                        <span className="text-xs font-medium text-slate-500 dark:text-white/45">Комментарий</span>
                                        <TextArea rows={2} value={expenseForm.note} onChange={(event) => setExpenseForm((current) => ({ ...current, note: event.target.value }))} placeholder="Аренда, обслуживание, ремонт…" />
                                    </label>
                                </div>
                                <div className="flex justify-end gap-2 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
                                    <Button type="button" variant="ghost" onClick={closeSettings}>Отмена</Button>
                                    <Button type="submit" disabled={isSavingExpense || (expenseForm.scope === 'room' && !expenseForm.roomIds.length)}>
                                        {isSavingExpense
                                            ? 'Сохраняем…'
                                            : expenseForm.scope === 'room'
                                                ? `Добавить для ${expenseForm.roomIds.length}`
                                                : 'Добавить расход'}
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <form className="mt-4 space-y-4" onSubmit={handlePlanSubmit}>
                                <p className="text-xs leading-5 text-slate-500 dark:text-white/45">Текущий месячный план распределяется по календарным дням активности номеров как сценарий. Фактическая история расходов при этом не меняется.</p>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {([
                                        ['payroll', 'Зарплаты'],
                                        ['rent', 'Аренда'],
                                        ['utilities', 'Коммунальные услуги'],
                                        ['supplies', 'Обслуживание и хозтовары'],
                                        ['other', 'Прочее'],
                                    ] as Array<[keyof PlanFormState, string]>).map(([key, label]) => (
                                        <label key={key} className="space-y-1.5">
                                            <span className="text-xs font-medium text-slate-500 dark:text-white/45">{label} / мес.</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                inputMode="decimal"
                                                value={planForm[key]}
                                                onChange={(event) => setPlanForm((current) => ({ ...current, [key]: event.target.value }))}
                                                aria-label={`${label}, ${currency} в месяц`}
                                            />
                                        </label>
                                    ))}
                                </div>
                                <div className="flex justify-end gap-2 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
                                    <Button type="button" variant="ghost" onClick={closeSettings}>Отмена</Button>
                                    <Button type="submit" disabled={isSavingPlan}>{isSavingPlan ? 'Сохраняем…' : 'Сохранить план'}</Button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            ) : null}
        </Card>
    );
};
