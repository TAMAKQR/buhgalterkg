'use client';

import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, TextArea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { SessionUser } from '@/lib/types';
import { useCookieApi } from '@/hooks/useCookieApi';
import { formatDateKey, formatDateTime, formatInputValue, parseInputValue, formatMoney } from '@/lib/timezone';
import { isCollectionLedgerEntry } from '@/lib/ledger';
import { MEAL_PLAN_OPTIONS, mealPlanLabels } from '@/lib/meal-plan';
import {
    cacheManagerState,
    enqueueManagerOfflineOperation,
    flushManagerOfflineQueue,
    getManagerQueueChangeEvent,
    isLikelyOfflineError,
    readCachedManagerState,
    readManagerOfflineQueue,
    type OfflineOperation
} from '@/lib/offline';
import { ArrowRightLeft, Banknote, CalendarPlus, CheckCircle2, LogIn, LogOut, Pencil, Sparkles, Users } from 'lucide-react';

type ManagerRoomStay = {
    id: string;
    guestName?: string | null;
    guestPhone?: string | null;
    companyName?: string | null;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    status: string;
    amountPaid?: number | null;
    totalAmount?: number | null;
    paymentMethod?: 'CASH' | 'CARD' | null;
    cashPaid?: number | null;
    cardPaid?: number | null;
    onlinePaid?: number | null;
    groupRef?: string | null;
    bookingSource?: string | null;
    bookingNumber?: string | null;
    mealPlan?: string[] | null;
    notes?: string | null;
};

interface ManagerStateResponse {
    hotel: {
        id: string;
        name: string;
        address: string;
        timezone?: string;
        currency?: string;
        usesExtranets?: boolean;
        extranetNames?: string[];
    };
    shift?: {
        id: string;
        openedAt: string;
        openingCash: number;
        handoverCash?: number | null;
        closingCash?: number | null;
        number: number;
    } | null;
    shiftCash?: number | null;
    shiftBalances?: {
        cash: number;
        card: number;
        total: number;
    } | null;
    shiftExpenses?: {
        total: number;
        cash: number;
        card: number;
    } | null;
    shiftPayments?: {
        cash: number;
        card: number;
        total: number;
    } | null;
    shiftStayRevenue?: number | null;
    shiftLedger?: Array<{
        id: string;
        entryType: 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
        method: 'CASH' | 'CARD';
        amount: number;
        note?: string | null;
        category?: {
            id: string;
            name: string;
        } | null;
        recordedAt: string;
    }> | null;
    expenseCategories?: Array<{
        id: string;
        name: string;
    }>;
    rooms: Array<{
        id: string;
        label: string;
        floor?: string | null;
        status: string;
        stay?: ManagerRoomStay | null;
        stays?: ManagerRoomStay[];
    }>;
    compensation?: {
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
        canEditStayPayments?: boolean | null;
        expectedPayout?: number | null;
        paidPayout?: number | null;
        pendingPayout?: number | null;
        bonus?: number | null;
        bonusThreshold?: number | null;
    } | null;
}

interface ManagerProfileResponse {
    manager: {
        id: string;
        displayName: string;
        username?: string | null;
    };
    assignment: {
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
        createdAt?: string;
        pinCode?: string | null;
    } | null;
    shifts: Array<{
        id: string;
        number: number;
        status: 'OPEN' | 'CLOSED';
        openedAt: string;
        closedAt?: string | null;
        openingCash: number;
        closingCash?: number | null;
        handoverCash?: number | null;
        payout: {
            expected: number;
            paid: number;
            pending: number;
        };
    }>;
}

interface ExpenseForm {
    amount: number;
    method: 'CASH' | 'CARD';
    note?: string;
    categoryId?: string;
    entryType: 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
}

interface ShiftOpenForm {
    pinCode: string;
    openingCash: number;
    note?: string;
}

interface ShiftHandoverForm {
    note?: string;
    pinCode: string;
}

interface CheckInModalState {
    mode: 'book' | 'checkin' | 'extend' | 'transfer' | 'edit';
    stayId?: string;
    roomId: string;
    label: string;
    guestName: string;
    guestPhone: string;
    companyName: string;
    bookingSource: string;
    bookingNumber: string;
    totalAmount: string;
    mealPlan: string[];
    notes: string;
    targetRoomId: string;
    transferNote: string;
    checkIn: string;
    currentCheckOut?: string;
    checkOut: string;
    cashAmount: string;
    cardAmount: string;
    onlineAmount: string;
    existingPaid: number;
}

interface GroupCheckInState {
    mode: 'checkin' | 'booking' | 'edit';
    groupRef?: string;
    guestName: string;
    guestCount: string;
    bookingSource: string;
    bookingNumber: string;
    checkIn: string;
    checkOut: string;
    tariffAmount: string;
    totalAmount: string;
    paymentMode: 'CARD' | 'CASH' | 'PENDING_TRANSFER';
    mealPlan: string[];
    notes: string;
    roomIds: string[];
}

interface PaymentAdjustState {
    roomId: string;
    roomLabel: string;
    stayId: string;
    guestName: string;
    totalAmount?: number | null;
    cashAmount: string;
    cardAmount: string;
    onlineAmount: string;
}

interface ConfirmTransfersState {
    stayIds: string[];
}

type PanelKey = 'rooms' | 'shift' | 'cash' | 'history';
type RoomViewMode = 'cards' | 'board';
type BoardListPopupKind = 'scheduled' | 'checkedIn' | 'overdue' | 'freeDates';

const managerBoardDayCount = 14;

const formatShareDate = (value: string, timeZone?: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
    }).format(date);
};

const isSameDayInTimeZone = (first: string | Date, second: string | Date, timeZone?: string) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
    });

    return formatter.format(new Date(first)) === formatter.format(new Date(second));
};

const isPastDate = (value?: string | null, now = new Date()) => {
    if (!value) {
        return false;
    }

    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date < now;
};

const startOfLocalDay = (value: Date) => {
    const copy = new Date(value);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const addDays = (value: Date, days: number) => {
    const copy = new Date(value);
    copy.setDate(copy.getDate() + days);
    return copy;
};

const formatBoardDay = (value: Date) =>
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(value).replace('.', '');

const formatBoardWeekday = (value: Date) =>
    new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(value).replace('.', '');

const boardStatusClass = (status: string, isOverdue = false) => {
    if (isOverdue) {
        return 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-300/50 dark:bg-rose-500/20 dark:text-rose-100';
    }
    if (status === 'CHECKED_IN') {
        return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-300/35 dark:bg-amber-400/15 dark:text-amber-100';
    }
    if (status === 'SCHEDULED') {
        return 'border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-300/35 dark:bg-cyan-400/15 dark:text-cyan-100';
    }
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/55';
};

const stayStatusLabel = (status: string) => {
    if (status === 'CHECKED_IN') return 'Заселён';
    if (status === 'SCHEDULED') return 'Бронь';
    if (status === 'CHECKED_OUT') return 'Выселен';
    return 'Отменён';
};

const boardSectionKey = (floor?: string | null) => floor?.trim() || '__without_floor';

const boardSectionLabel = (floor?: string | null) => {
    const value = floor?.trim();
    if (!value) return 'Без этажа';
    return /этаж/i.test(value) ? value : `${value} этаж`;
};

export const ManagerScreen = ({ user, onLogout }: { user: SessionUser; onLogout?: () => void }) => {
    const { get, request } = useCookieApi();
    const hotelId = user.hotels[0]?.id;
    const syncInFlightRef = useRef(false);
    const [cachedState, setCachedState] = useState<ManagerStateResponse | null>(null);
    const [cachedAt, setCachedAt] = useState<string | null>(null);
    const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
    const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
    const [isSyncingOffline, setIsSyncingOffline] = useState(false);
    const [offlineSyncError, setOfflineSyncError] = useState<string | null>(null);

    const handleLogout = async () => {
        await fetch('/api/session/logout', { method: 'POST' });
        if (onLogout) {
            // Pass null to immediately clear the cache
            onLogout();
        }
    };

    const { data: liveData, mutate, isLoading, error, isValidating } = useSWR<ManagerStateResponse>(
        hotelId ? ['manager-state', hotelId] : null,
        ([, hotelId]) => get(`/api/manager/state?hotelId=${hotelId}`),
        { refreshInterval: isOnline ? 30_000 : 0, revalidateOnReconnect: true }
    );

    const data = liveData ?? cachedState;
    const isUsingCachedState = !liveData && Boolean(cachedState);

    const hotelTz = data?.hotel?.timezone;
    const hotelCur = data?.hotel?.currency;
    const formatKgs = useCallback((amount?: number | null) => formatMoney(typeof amount === 'number' ? amount : 0, hotelCur), [hotelCur]);
    const formatDateInputValue = (date: Date) => formatInputValue(date, hotelTz);

    const expenseForm = useForm<ExpenseForm>({ defaultValues: { method: 'CASH', entryType: 'CASH_OUT', categoryId: '' } });
    const openShiftForm = useForm<ShiftOpenForm>({ defaultValues: { openingCash: 0, pinCode: '', note: '' } });
    const handoverForm = useForm<ShiftHandoverForm>({ defaultValues: { pinCode: '', note: '' } });
    const [checkInModal, setCheckInModal] = useState<CheckInModalState | null>(null);
    const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false);
    const [checkInError, setCheckInError] = useState<string | null>(null);
    const [activePanel, setActivePanel] = useState<PanelKey>('rooms');
    const [roomViewMode, setRoomViewMode] = useState<RoomViewMode>('cards');
    const [roomBoardStartOffset, setRoomBoardStartOffset] = useState(0);
    const [collapsedBoardSections, setCollapsedBoardSections] = useState<Record<string, boolean>>({});
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [selectedShiftId, setSelectedShiftId] = useState<string>('');
    const [historyStatus, setHistoryStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
    const [historyFromDate, setHistoryFromDate] = useState('');
    const [historyToDate, setHistoryToDate] = useState('');
    const [isCashLedgerOpen, setIsCashLedgerOpen] = useState(false);
    const [boardDayAction, setBoardDayAction] = useState<{
        room: ManagerStateResponse['rooms'][number];
        selectedDay: Date;
    } | null>(null);
    const [boardListPopup, setBoardListPopup] = useState<BoardListPopupKind | null>(null);
    const [groupCheckIn, setGroupCheckIn] = useState<GroupCheckInState | null>(null);
    const [isSubmittingGroupCheckIn, setIsSubmittingGroupCheckIn] = useState(false);
    const [groupCheckInError, setGroupCheckInError] = useState<string | null>(null);
    const [paymentAdjust, setPaymentAdjust] = useState<PaymentAdjustState | null>(null);
    const [isSubmittingPaymentAdjust, setIsSubmittingPaymentAdjust] = useState(false);
    const [paymentAdjustError, setPaymentAdjustError] = useState<string | null>(null);
    const [confirmTransfers, setConfirmTransfers] = useState<ConfirmTransfersState | null>(null);
    const [isConfirmingTransfers, setIsConfirmingTransfers] = useState(false);
    const [confirmTransfersError, setConfirmTransfersError] = useState<string | null>(null);
    const [bookingDetails, setBookingDetails] = useState<{
        roomId: string;
        roomLabel: string;
        stay: ManagerRoomStay;
    } | null>(null);
    const [isCancellingBooking, setIsCancellingBooking] = useState(false);
    const [updatingCleaningRoomId, setUpdatingCleaningRoomId] = useState<string | null>(null);
    const [checkoutConfirm, setCheckoutConfirm] = useState<{ roomId: string; roomLabel: string; guestName: string } | null>(null);
    const { toast } = useToast();
    const refreshOfflineQueueCount = useCallback(() => {
        setPendingOfflineCount(readManagerOfflineQueue().length);
    }, []);

    useEffect(() => {
        if (!hotelId) return;
        const cached = readCachedManagerState<ManagerStateResponse>(hotelId);
        if (cached) {
            setCachedState(cached.state);
            setCachedAt(cached.cachedAt);
        }
    }, [hotelId]);

    useEffect(() => {
        if (!hotelId || !liveData) return;
        cacheManagerState(hotelId, liveData);
        setCachedState(liveData);
        setCachedAt(new Date().toISOString());
    }, [hotelId, liveData]);

    useEffect(() => {
        refreshOfflineQueueCount();

        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        const handleQueueChange = () => refreshOfflineQueueCount();

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener(getManagerQueueChangeEvent(), handleQueueChange);
        window.addEventListener('storage', handleQueueChange);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener(getManagerQueueChangeEvent(), handleQueueChange);
            window.removeEventListener('storage', handleQueueChange);
        };
    }, [refreshOfflineQueueCount]);

    const {
        data: profileData,
        mutate: refreshProfile,
        isLoading: isProfileLoading,
        error: profileError
    } = useSWR<ManagerProfileResponse>(
        isProfileOpen || activePanel === 'history' ? 'manager-profile' : null,
        () => get<ManagerProfileResponse>('/api/manager/profile')
    );

    const flushOfflineOperations = useCallback(async () => {
        if (!isOnline || syncInFlightRef.current || readManagerOfflineQueue().length === 0) {
            return;
        }

        syncInFlightRef.current = true;
        setIsSyncingOffline(true);
        setOfflineSyncError(null);

        try {
            const result = await flushManagerOfflineQueue((operation: OfflineOperation) =>
                request(operation.path, operation.options)
            );
            refreshOfflineQueueCount();

            if (result.synced > 0) {
                toast(`Синхронизировано операций: ${result.synced}`, 'success');
                await mutate();
            }

            if (result.remaining > 0) {
                setOfflineSyncError(result.firstError ?? 'Часть операций не синхронизирована');
            }
        } finally {
            syncInFlightRef.current = false;
            setIsSyncingOffline(false);
        }
    }, [isOnline, mutate, refreshOfflineQueueCount, request, toast]);

    useEffect(() => {
        if (isOnline && pendingOfflineCount > 0) {
            void flushOfflineOperations();
        }
    }, [flushOfflineOperations, isOnline, pendingOfflineCount]);

    const sendManagerRequest = useCallback(
        async <T,>(path: string, options: { method?: string; body?: unknown } | undefined, label: string) => {
            if (!isOnline) {
                enqueueManagerOfflineOperation({ path, options, label });
                refreshOfflineQueueCount();
                toast(`${label}: сохранено локально`, 'success');
                return null as T | null;
            }

            try {
                return await request<T>(path, options);
            } catch (requestError) {
                if (isLikelyOfflineError(requestError)) {
                    setIsOnline(false);
                    enqueueManagerOfflineOperation({ path, options, label });
                    refreshOfflineQueueCount();
                    toast(`${label}: сохранено локально`, 'success');
                    return null as T | null;
                }
                throw requestError;
            }
        },
        [isOnline, refreshOfflineQueueCount, request, toast]
    );

    const refreshManagerState = useCallback(async () => {
        try {
            await mutate();
        } catch (refreshError) {
            if (isLikelyOfflineError(refreshError)) {
                setIsOnline(false);
                return;
            }
            throw refreshError;
        }
    }, [mutate]);

    const ExitButton = () => (
        <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-500 shadow-sm backdrop-blur transition hover:border-slate-300 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/20 dark:bg-ink dark:text-white/70 dark:shadow-lg dark:hover:border-white dark:hover:text-white"
            aria-label="Выйти к экрану PIN"
        >
            <span className="text-lg leading-none">×</span>
        </button>
    );

    const primaryHotel = data?.hotel ?? user.hotels[0];
    const hasOpenShift = Boolean(data?.shift);
    const shiftExpenses = data?.shiftExpenses ?? null;
    const shiftExpensesTotal = shiftExpenses?.total ?? 0;
    const shiftExpensesCash = shiftExpenses?.cash ?? 0;
    const shiftExpensesCard = shiftExpenses?.card ?? 0;
    const shiftPayments = data?.shiftPayments ?? null;
    const shiftRevenueTotal = shiftPayments?.total ?? 0;
    const shiftRevenueCash = shiftPayments?.cash ?? 0;
    const shiftRevenueCard = shiftPayments?.card ?? 0;
    const shiftStayRevenue = data?.shiftStayRevenue ?? 0;
    const shiftOtherReceipts = Math.max(shiftRevenueTotal - shiftStayRevenue, 0);
    const shiftBalances = data?.shiftBalances ?? null;
    const shiftCashValue = shiftBalances?.cash ?? data?.shiftCash ?? data?.shift?.openingCash ?? 0;
    const computedCardFallback = shiftRevenueCard - shiftExpensesCard;
    const shiftCardValue = shiftBalances?.card ?? computedCardFallback;
    const shiftTotalBalance = shiftBalances?.total ?? shiftCashValue + shiftCardValue;
    const shiftNetIncome = shiftRevenueTotal - shiftExpensesTotal;
    const shiftLedger = data?.shiftLedger ?? [];
    const expenseCategories = data?.expenseCategories ?? [];
    const selectedExpenseEntryType = expenseForm.watch('entryType');
    const compensation = data?.compensation ?? null;
    const canEditStayPayments = Boolean(compensation?.canEditStayPayments);
    const managerName = user.displayName?.trim() || user.username?.trim() || 'Менеджер';
    const shiftPayDisplay = typeof compensation?.shiftPayAmount === 'number' ? formatKgs(compensation.shiftPayAmount) : null;
    const shareDisplay = typeof compensation?.revenueSharePct === 'number' ? `${compensation.revenueSharePct}%` : null;
    const payoutSummary = data?.shift && compensation
        ? {
            expected: compensation.expectedPayout ?? null,
            paid: compensation.paidPayout ?? null,
            pending: compensation.pendingPayout ?? null
        }
        : null;
    const cachedAtLabel = cachedAt ? formatDateTime(cachedAt, hotelTz) : null;
    const showOfflineStatus = !isOnline || isUsingCachedState || pendingOfflineCount > 0 || Boolean(offlineSyncError) || isSyncingOffline;
    const offlineStatusTitle = !isOnline
        ? 'Офлайн-режим'
        : isSyncingOffline
            ? 'Синхронизация'
            : pendingOfflineCount > 0
                ? 'Ожидает синхронизации'
                : isUsingCachedState
                    ? 'Локальный снимок'
                    : 'Синхронизировано';
    const offlineStatusDetail = [
        isUsingCachedState && cachedAtLabel ? `данные от ${cachedAtLabel}` : null,
        pendingOfflineCount > 0 ? `${pendingOfflineCount} операций в очереди` : null,
        offlineSyncError ? `ошибка: ${offlineSyncError}` : null,
    ].filter(Boolean).join(' · ');
    const OfflineStatusBanner = () => {
        if (!showOfflineStatus) {
            return null;
        }

        return (
            <div className={`rounded-xl border px-3 py-2 text-xs shadow-sm ${offlineSyncError
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200'
                : !isOnline || isUsingCachedState
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100'
                    : 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100'
                }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="font-semibold">{offlineStatusTitle}</p>
                        {offlineStatusDetail ? (
                            <p className="mt-0.5 break-words opacity-80">{offlineStatusDetail}</p>
                        ) : null}
                    </div>
                    {isOnline && pendingOfflineCount > 0 ? (
                        <button
                            type="button"
                            onClick={() => void flushOfflineOperations()}
                            disabled={isSyncingOffline}
                            className="min-w-0 max-w-full shrink-0 rounded-lg border border-current/20 px-2 py-1 text-center font-semibold leading-tight break-words transition [overflow-wrap:anywhere] hover:bg-white/30 disabled:opacity-50"
                        >
                            {isSyncingOffline ? 'Синхронизация...' : 'Синхронизировать'}
                        </button>
                    ) : null}
                </div>
            </div>
        );
    };
    const pendingPayoutMajor = typeof payoutSummary?.pending === 'number' ? payoutSummary.pending / 100 : 0;
    const isAutoManagerPayout = selectedExpenseEntryType === 'MANAGER_PAYOUT';
    const handleOpenProfile = () => setIsProfileOpen(true);
    const handleCloseProfile = () => setIsProfileOpen(false);

    useEffect(() => {
        if (selectedExpenseEntryType !== 'CASH_OUT') {
            expenseForm.setValue('categoryId', '');
        }
        if (selectedExpenseEntryType === 'MANAGER_PAYOUT') {
            expenseForm.setValue('amount', pendingPayoutMajor);
        }
    }, [expenseForm, pendingPayoutMajor, selectedExpenseEntryType]);

    const handlePrintShiftReceipt = () => {
        if (typeof window === 'undefined' || !data?.shift || !primaryHotel) {
            return;
        }

        const receiptWindow = window.open('', '_blank', 'width=600,height=800');
        if (!receiptWindow) {
            return;
        }

        const printTimestamp = new Date().toISOString();
        const body = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Смена №${data.shift.number}</title>
<style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; color: #0f172a; margin: 0; padding: 24px; }
    .ticket { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(15,23,42,.25); padding: 32px; }
    h1 { margin: 0 0 8px 0; font-size: 20px; letter-spacing: .1em; text-transform: uppercase; color: #475569; }
    h2 { margin: 0 0 16px 0; font-size: 28px; color: #0f172a; }
    ul { list-style: none; padding: 0; margin: 24px 0 0 0; }
    li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; }
    li strong { color: #0f172a; }
    .expenses { margin: 0; border-left: 3px solid #fecdd3; margin-left: 4px; }
    .expenses li { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .footer { margin-top: 24px; font-size: 13px; color: #475569; }
    .brand { font-weight: 600; font-size: 16px; }
</style>
</head>
<body>
<div class="ticket">
    <h1>Итог смены</h1>
    <h2>№${data.shift.number}</h2>
    <p class="brand">${primaryHotel.name}</p>
    <p>${primaryHotel.address}</p>
    <ul>
        <li><span>На смене</span><strong>${managerName}</strong></li>
        <li><span>Открыта</span><strong>${formatDateTime(data.shift.openedAt, hotelTz)}</strong></li>
        <li><span>Печать</span><strong>${formatDateTime(printTimestamp, hotelTz)}</strong></li>
        <li><span>На начало смены</span><strong>${formatKgs(data.shift.openingCash)}</strong></li>
        <li><span>Поступления за смену</span><strong>${formatKgs(shiftRevenueTotal)}</strong></li>
        <li><span>Из заселений</span><strong>${formatKgs(shiftStayRevenue)}</strong></li>
        <li><span>Прочие поступления</span><strong>${formatKgs(shiftOtherReceipts)}</strong></li>
        <li><span>Поступило наличными</span><strong>${formatKgs(shiftRevenueCash)}</strong></li>
        <li><span>Поступило безналом</span><strong>${formatKgs(shiftRevenueCard)}</strong></li>
        <li><span>Расходы за смену</span><strong>${formatKgs(shiftExpensesTotal)} (${formatKgs(shiftExpensesCash)} / ${formatKgs(shiftExpensesCard)})</strong></li>
    </ul>
    ${shiftLedger.filter(e => e.entryType === 'CASH_OUT' && !isCollectionLedgerEntry(e)).length > 0 ? `
    <ul class="expenses">
        ${shiftLedger.filter(e => e.entryType === 'CASH_OUT' && !isCollectionLedgerEntry(e)).map(e =>
            `<li><span style="padding-left:16px;color:#64748b">↳ ${[e.category?.name?.trim(), e.note?.trim()].filter(Boolean).join(' · ') || 'Расход'} (${e.method === 'CASH' ? 'нал' : 'безнал'})</span><strong style="color:#dc2626">-${formatKgs(e.amount)}</strong></li>`
        ).join('')}
    </ul>` : ''}
    <ul>
        <li><span>Чистый доход</span><strong>${formatKgs(shiftNetIncome)}</strong></li>
        <li><span>Сейчас в кассе</span><strong>${formatKgs(shiftCashValue)}</strong></li>
        <li><span>Сейчас безналом</span><strong>${formatKgs(shiftCardValue)}</strong></li>
        <li><span>Сейчас всего</span><strong>${formatKgs(shiftTotalBalance)}</strong></li>
    </ul>
    <p class="footer">Сохраните в PDF через диалог печати браузера.</p>
</div>
</body>
</html>`;

        receiptWindow.document.open();
        receiptWindow.document.write(body);
        receiptWindow.document.close();
        receiptWindow.focus();
        receiptWindow.print();
    };

    const managerInfoBlock = (
        <div className="rounded-xl bg-white/[0.03] px-4 py-3 text-white">
            <div className="flex flex-wrap items-center gap-4 text-sm text-white/70">
                <button
                    type="button"
                    onClick={handleOpenProfile}
                    className="min-w-0 text-left text-base font-semibold text-white underline decoration-dotted decoration-white/40 underline-offset-4 transition break-words [overflow-wrap:anywhere] hover:text-amber-200 focus:outline-none"
                >
                    {managerName}
                </button>
                <span className="text-white/80">Ставка: {shiftPayDisplay ?? '—'}</span>
                <span className="text-white/80">Процент: {shareDisplay ?? '—'}</span>
                {data?.shift && payoutSummary && (
                    <span className="font-semibold text-amber-100">
                        Начислено: {formatKgs(payoutSummary.expected ?? 0)}
                    </span>
                )}
                {compensation?.bonus != null && compensation.bonus > 0 && (
                    <span className="font-semibold text-emerald-300">
                        Бонус: +{formatKgs(compensation.bonus)}
                    </span>
                )}
            </div>
        </div>
    );
    const sortedRooms = useMemo(() => {
        if (!data?.rooms) {
            return [] as ManagerStateResponse['rooms'];
        }
        return [...data.rooms].sort((first, second) =>
            first.label.localeCompare(second.label, 'ru', { numeric: true, sensitivity: 'base' })
        );
    }, [data?.rooms]);

    const roomBoardDays = useMemo(() => {
        const firstDay = addDays(startOfLocalDay(new Date()), roomBoardStartOffset);
        return Array.from({ length: managerBoardDayCount }, (_, index) => addDays(firstDay, index));
    }, [roomBoardStartOffset]);

    const roomBoardRange = useMemo(() => {
        const start = roomBoardDays[0] ?? startOfLocalDay(new Date());
        return { start, end: addDays(start, managerBoardDayCount) };
    }, [roomBoardDays]);

    const roomBoardRows = useMemo(() => {
        const rangeStart = roomBoardRange.start.getTime();
        const rangeEnd = roomBoardRange.end.getTime();
        const now = new Date();

        return sortedRooms.map((room) => {
            const items = (room.stays ?? (room.stay ? [room.stay] : []))
                .filter((stay) => stay.status === 'SCHEDULED' || stay.status === 'CHECKED_IN')
                .map((stay) => {
                    const stayStart = Date.parse(stay.scheduledCheckIn);
                    const stayEnd = Date.parse(stay.scheduledCheckOut);
                    if (!Number.isFinite(stayStart) || !Number.isFinite(stayEnd) || stayEnd <= rangeStart || stayStart >= rangeEnd) {
                        return null;
                    }

                    const clampedStart = Math.max(stayStart, rangeStart);
                    const clampedEnd = Math.min(stayEnd, rangeEnd);
                    const startIndex = Math.max(0, Math.floor((clampedStart - rangeStart) / 86400000));
                    const endIndex = Math.min(managerBoardDayCount, Math.ceil((clampedEnd - rangeStart) / 86400000));
                    const span = Math.max(1, endIndex - startIndex);
                    const isOverdue = stay.status === 'CHECKED_IN' && isPastDate(stay.scheduledCheckOut, now);
                    const guestLabel = stay.guestName?.trim() || (stay.status === 'CHECKED_IN' ? 'Гость' : 'Бронь');
                    const detailLabel = [
                        stay.bookingNumber?.trim() ? `№ ${stay.bookingNumber.trim()}` : null,
                        stay.totalAmount != null ? `тариф ${formatKgs(stay.totalAmount)}` : null,
                        ...mealPlanLabels(stay.mealPlan),
                        stay.bookingSource?.trim(),
                        stay.companyName?.trim(),
                        stay.guestPhone?.trim()
                    ].filter(Boolean).join(' · ');

                    return { stay, startIndex, span, isOverdue, guestLabel, detailLabel };
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
                .sort((first, second) => first.startIndex - second.startIndex || second.span - first.span);
            const laneEnds: number[] = [];
            const itemsWithLanes = items.map((item) => {
                const endIndex = item.startIndex + item.span;
                const lane = laneEnds.findIndex((currentEnd) => currentEnd <= item.startIndex);
                const nextLane = lane >= 0 ? lane : laneEnds.length;
                laneEnds[nextLane] = endIndex;
                return { ...item, lane: nextLane };
            });
            const laneCount = Math.max(1, laneEnds.length);

            return { room, items: itemsWithLanes, laneCount };
        });
    }, [formatKgs, roomBoardRange, sortedRooms]);

    const roomBoardSections = useMemo(() => {
        const sections = new Map<string, {
            key: string;
            label: string;
            rows: typeof roomBoardRows;
        }>();

        for (const row of roomBoardRows) {
            const key = boardSectionKey(row.room.floor);
            const current = sections.get(key);
            if (current) {
                current.rows.push(row);
                continue;
            }

            sections.set(key, {
                key,
                label: boardSectionLabel(row.room.floor),
                rows: [row],
            });
        }

        return Array.from(sections.values()).sort((first, second) => {
            if (first.key === '__without_floor') return 1;
            if (second.key === '__without_floor') return -1;
            return first.label.localeCompare(second.label, 'ru', { numeric: true, sensitivity: 'base' });
        });
    }, [roomBoardRows]);

    const boardGridTemplate = `82px repeat(${managerBoardDayCount}, minmax(118px, 1fr))`;

    const boardStayListItems = useMemo(() => {
        return roomBoardRows.flatMap((row) =>
            row.items.map((item) => ({
                room: row.room,
                stay: item.stay,
                isOverdue: item.isOverdue,
                guestLabel: item.guestLabel,
                detailLabel: item.detailLabel,
            }))
        );
    }, [roomBoardRows]);

    const boardScheduledItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'SCHEDULED'),
        [boardStayListItems]
    );

    const boardCheckedInItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'CHECKED_IN' && !item.isOverdue),
        [boardStayListItems]
    );

    const boardOverdueItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'CHECKED_IN' && item.isOverdue),
        [boardStayListItems]
    );

    const boardFreeDateItems = useMemo(() => {
        return roomBoardRows.flatMap((row) => {
            const occupiedRanges = row.items
                .map((item) => ({
                    startIndex: item.startIndex,
                    endIndex: Math.min(managerBoardDayCount, item.startIndex + item.span),
                }))
                .sort((first, second) => first.startIndex - second.startIndex);

            let cursor = 0;
            const gaps: Array<{ room: typeof row.room; startIndex: number; endIndex: number; startDate: Date; endDate: Date }> = [];

            for (const range of occupiedRanges) {
                if (range.startIndex > cursor) {
                    gaps.push({
                        room: row.room,
                        startIndex: cursor,
                        endIndex: range.startIndex,
                        startDate: addDays(roomBoardRange.start, cursor),
                        endDate: addDays(roomBoardRange.start, range.startIndex),
                    });
                }
                cursor = Math.max(cursor, range.endIndex);
            }

            if (cursor < managerBoardDayCount) {
                gaps.push({
                    room: row.room,
                    startIndex: cursor,
                    endIndex: managerBoardDayCount,
                    startDate: addDays(roomBoardRange.start, cursor),
                    endDate: addDays(roomBoardRange.start, managerBoardDayCount),
                });
            }

            return gaps;
        });
    }, [roomBoardRange.start, roomBoardRows]);

    const toggleBoardSection = (key: string) => {
        setCollapsedBoardSections((current) => ({
            ...current,
            [key]: !current[key],
        }));
    };

    const availableTransferRooms = useMemo(
        () => sortedRooms.filter((room) => room.status === 'AVAILABLE'),
        [sortedRooms]
    );

    const availableGroupRooms = useMemo(
        () => sortedRooms.filter((room) => room.status === 'AVAILABLE' && !room.stay),
        [sortedRooms]
    );

    const pendingTransferRooms = useMemo(
        () => sortedRooms.filter((room) => room.status === 'OCCUPIED' && (room.stay?.onlinePaid ?? 0) > 0),
        [sortedRooms]
    );

    const pendingTransferTotal = useMemo(
        () => pendingTransferRooms.reduce((total, room) => total + (room.stay?.onlinePaid ?? 0), 0),
        [pendingTransferRooms]
    );

    const groupSelectableRooms = groupCheckIn?.mode === 'edit'
        ? sortedRooms.filter((room) => groupCheckIn.roomIds.includes(room.id))
        : groupCheckIn?.mode === 'booking'
            ? sortedRooms
            : availableGroupRooms;

    const selectedGroupRooms = useMemo(
        () => groupCheckIn ? groupSelectableRooms.filter((room) => groupCheckIn.roomIds.includes(room.id)) : [],
        [groupSelectableRooms, groupCheckIn]
    );

    const groupTotalMinor = useMemo(() => {
        const total = Number(groupCheckIn?.totalAmount || 0);
        return Number.isFinite(total) && total > 0 ? Math.round(total * 100) : 0;
    }, [groupCheckIn?.totalAmount]);

    const groupPerRoomMinor = selectedGroupRooms.length ? Math.floor(groupTotalMinor / selectedGroupRooms.length) : 0;

    const occupiedCount = useMemo(() => sortedRooms.filter((r) => r.status === 'OCCUPIED').length, [sortedRooms]);
    const availableCount = useMemo(() => sortedRooms.filter((r) => r.status === 'AVAILABLE').length, [sortedRooms]);
    const overdueCount = useMemo(() => {
        const now = new Date();
        return sortedRooms.filter((room) => room.status === 'OCCUPIED' && isPastDate(room.stay?.scheduledCheckOut, now)).length;
    }, [sortedRooms]);

    const panelTabs: Array<{ id: PanelKey; label: string; hint?: string }> = [
        { id: 'rooms', label: 'Номера', hint: `${occupiedCount}/${sortedRooms.length}` },
        { id: 'shift', label: data?.shift ? `Смена №${data.shift.number}` : 'Принять смену' },
        { id: 'cash', label: 'Касса' },
        { id: 'history', label: 'История' }
    ];

    const shareMessage = useMemo(() => {
        if (!data) {
            return '';
        }

        const sectionMap = new Map<string, string[]>();
        const floorOrder: string[] = [];
        const now = new Date();

        for (const room of sortedRooms) {
            const statusText = (() => {
                if (room.status !== 'OCCUPIED' || !room.stay?.scheduledCheckOut) {
                    if (room.status === 'DIRTY') return 'уборка';
                    if (room.status === 'HOLD') return 'удержание';
                    return 'свободно';
                }

                const checkoutLabel = isSameDayInTimeZone(room.stay.scheduledCheckOut, now, hotelTz)
                    ? new Intl.DateTimeFormat('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                        timeZone: hotelTz,
                    }).format(new Date(room.stay.scheduledCheckOut))
                    : formatShareDate(room.stay.scheduledCheckOut, hotelTz);

                const guestName = room.stay.guestName?.trim();
                const mealLabel = mealPlanLabels(room.stay.mealPlan).join('/');
                const prefix = isPastDate(room.stay.scheduledCheckOut, now) ? 'просрочено с' : 'до';
                const guestPart = [guestName, mealLabel].filter(Boolean).join(' · ');
                return guestPart ? `${prefix} ${checkoutLabel} - ${guestPart}` : `${prefix} ${checkoutLabel}`;
            })();

            const line = `${room.label} ${statusText}`;
            const shareLine = room.status === 'AVAILABLE' || room.status === 'DIRTY'
                ? `*${line}*`
                : line;
            const floorName = room.floor?.trim() || 'Общий список';
            if (!sectionMap.has(floorName)) {
                sectionMap.set(floorName, []);
                floorOrder.push(floorName);
            }
            sectionMap.get(floorName)?.push(shareLine);
        }

        const blocks = floorOrder.map((floorName) => {
            const lines = sectionMap.get(floorName) ?? [];
            if (!lines.length) return null;
            return [floorName, ...lines].join('\n');
        }).filter(Boolean) as string[];

        return [
            ...blocks,
            '',
            `На начало смены: ${formatKgs(data.shift?.openingCash ?? 0)}`,
            `Поступления за смену: ${formatKgs(shiftRevenueTotal)}`,
            `Из заселений: ${formatKgs(shiftStayRevenue)}`,
            `Прочие поступления: ${formatKgs(shiftOtherReceipts)}`,
            `Поступило безналом: ${formatKgs(shiftRevenueCard)}`,
            `Поступило наличными: ${formatKgs(shiftRevenueCash)}`,
            `Сейчас в кассе: ${formatKgs(shiftCashValue)}`,
            '',
            `На смене: ${managerName}`,
        ].join('\n');
    }, [data, formatKgs, hotelTz, managerName, shiftCashValue, shiftOtherReceipts, shiftRevenueCard, shiftRevenueCash, shiftRevenueTotal, shiftStayRevenue, sortedRooms]);

    const handleCopyState = async () => {
        if (!shareMessage || typeof navigator === 'undefined' || !navigator.clipboard) {
            toast('Не удалось скопировать сообщение', 'error');
            return;
        }

        try {
            await navigator.clipboard.writeText(shareMessage);
            toast('Состояние скопировано', 'success');
        } catch {
            toast('Не удалось скопировать сообщение', 'error');
        }
    };

    const filteredProfileShifts = useMemo(() => {
        if (!profileData?.shifts) {
            return [] as ManagerProfileResponse['shifts'];
        }
        const fromDate = historyFromDate ? new Date(`${historyFromDate}T00:00:00`) : null;
        const toDate = historyToDate ? new Date(`${historyToDate}T23:59:59.999`) : null;

        return profileData.shifts.filter((shift) => {
            if (historyStatus === 'OPEN' && shift.status !== 'OPEN') {
                return false;
            }
            if (historyStatus === 'CLOSED' && shift.status !== 'CLOSED') {
                return false;
            }

            const openedAt = new Date(shift.openedAt);
            if (fromDate && openedAt < fromDate) {
                return false;
            }
            if (toDate && openedAt > toDate) {
                return false;
            }
            return true;
        });
    }, [profileData?.shifts, historyStatus, historyFromDate, historyToDate]);

    const selectedShift = useMemo(() => {
        if (!filteredProfileShifts.length) {
            return null;
        }
        return filteredProfileShifts.find((shift) => shift.id === selectedShiftId) ?? filteredProfileShifts[0];
    }, [filteredProfileShifts, selectedShiftId]);

    useEffect(() => {
        if (data?.shift) {
            handoverForm.reset({
                note: '',
                pinCode: ''
            });
        }
    }, [data?.shift, handoverForm]);

    useEffect(() => {
        setIsCashLedgerOpen(false);
    }, [data?.shift?.id]);

    useEffect(() => {
        if (!filteredProfileShifts.length) {
            if (selectedShiftId) {
                setSelectedShiftId('');
            }
            return;
        }
        if (!filteredProfileShifts.some((shift) => shift.id === selectedShiftId)) {
            setSelectedShiftId(filteredProfileShifts[0].id);
        }
    }, [filteredProfileShifts, selectedShiftId]);

    const toMinor = (value?: number) => {
        const safe = Number.isFinite(value) ? (value as number) : 0;
        return Math.round(safe * 100);
    };

    const handleOpenShift = openShiftForm.handleSubmit(async (values) => {
        if (!primaryHotel) return;
        await request('/api/shifts', {
            body: {
                hotelId: primaryHotel.id,
                openingCash: toMinor(values.openingCash),
                note: values.note,
                action: 'open'
            }
        });
        openShiftForm.reset({ openingCash: 0, note: '' });
        void refreshManagerState();
    });

    const handleCloseShift = handoverForm.handleSubmit(async (values) => {
        if (!data?.shift) return;
        await request(`/api/shifts/${data.shift.id}/handover`, {
            body: {
                note: values.note,
                pinCode: values.pinCode
            }
        });
        handoverForm.reset({
            note: '',
            pinCode: ''
        });

        if (onLogout) {
            await onLogout();
            return;
        }

        await fetch('/api/session/logout', { method: 'POST' });
    });

    const handleExpense = expenseForm.handleSubmit(async (values) => {
        if (!data?.shift) {
            throw new Error('Сначала откройте смену');
        }
        await sendManagerRequest('/api/expenses', {
            body: {
                hotelId: data.hotel.id,
                shiftId: data.shift.id,
                amount: Number.isFinite(values.amount) ? toMinor(values.amount) : undefined,
                method: values.method,
                categoryId: values.entryType === 'CASH_OUT' && values.categoryId ? values.categoryId : undefined,
                note: values.note,
                entryType: values.entryType
            }
        }, 'Операция кассы');
        await refreshManagerState();
        expenseForm.reset({
            amount: values.entryType === 'MANAGER_PAYOUT' ? pendingPayoutMajor : 0,
            method: values.method,
            entryType: values.entryType,
            categoryId: values.entryType === 'CASH_OUT' ? values.categoryId ?? '' : '',
            note: ''
        });
    });

    const handleCheckout = async (roomId: string) => {
        if (!data?.shift) return;
        await sendManagerRequest(`/api/rooms/${roomId}/stay`, {
            body: {
                shiftId: data.shift.id,
                intent: 'checkout'
            }
        }, 'Выселение');
        toast('Гость выселен', 'success');
        void refreshManagerState();
    };

    const showGroupCheckInModal = () => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы сделать групповой заезд', 'error');
            return;
        }
        if (!sortedRooms.length) {
            toast('Нет номеров для групповой операции', 'error');
            return;
        }

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + 12 * 60 * 60 * 1000);

        setGroupCheckIn({
            mode: 'checkin',
            guestName: '',
            guestCount: '',
            bookingSource: '',
            bookingNumber: '',
            checkIn: formatDateInputValue(startDate),
            checkOut: formatDateInputValue(endDate),
            tariffAmount: '',
            totalAmount: '',
            paymentMode: 'PENDING_TRANSFER',
            mealPlan: [],
            notes: '',
            roomIds: [],
        });
        setGroupCheckInError(null);
    };

    const toggleGroupRoom = (roomId: string) => {
        setGroupCheckIn((prev) => {
            if (!prev) return prev;
            if (prev.mode === 'edit') return prev;
            const roomIds = prev.roomIds.includes(roomId)
                ? prev.roomIds.filter((id) => id !== roomId)
                : [...prev.roomIds, roomId];
            return { ...prev, roomIds };
        });
    };

    const toggleGroupMealPlan = (meal: string) => {
        setGroupCheckIn((prev) => {
            if (!prev) return prev;
            const mealPlan = prev.mealPlan.includes(meal)
                ? prev.mealPlan.filter((item) => item !== meal)
                : [...prev.mealPlan, meal];
            return { ...prev, mealPlan };
        });
    };

    const toggleCheckInMealPlan = (meal: string) => {
        setCheckInModal((prev) => {
            if (!prev) return prev;
            const mealPlan = prev.mealPlan.includes(meal)
                ? prev.mealPlan.filter((item) => item !== meal)
                : [...prev.mealPlan, meal];
            return { ...prev, mealPlan };
        });
    };

    const handleGroupCheckIn = async () => {
        if (!groupCheckIn || !data?.shift || !data.hotel.id) return;

        const scheduledCheckIn = parseInputValue(groupCheckIn.checkIn, hotelTz);
        const scheduledCheckOut = parseInputValue(groupCheckIn.checkOut, hotelTz);
        const totalValue = Number(groupCheckIn.totalAmount || 0);
        const tariffValue = Number(groupCheckIn.tariffAmount || 0);
        const guestCount = groupCheckIn.guestCount ? Number(groupCheckIn.guestCount) : undefined;
        const bookingNumber = groupCheckIn.bookingNumber.trim();

        if (!groupCheckIn.roomIds.length) {
            setGroupCheckInError('Выберите номера для группы');
            return;
        }
        if (!scheduledCheckIn || !scheduledCheckOut || scheduledCheckOut <= scheduledCheckIn) {
            setGroupCheckInError('Проверьте даты заезда и выезда');
            return;
        }
        if (groupCheckIn.bookingSource.trim() && !bookingNumber) {
            setGroupCheckInError('Укажите номер бронирования');
            return;
        }
        if (!Number.isFinite(tariffValue) || tariffValue <= 0) {
            setGroupCheckInError('Укажите общую сумму тарифа');
            return;
        }
        if (!Number.isFinite(totalValue) || totalValue < 0 || (groupCheckIn.mode === 'checkin' && totalValue <= 0)) {
            setGroupCheckInError(groupCheckIn.mode === 'booking' ? 'Проверьте сумму предоплаты' : 'Укажите общую сумму оплаты');
            return;
        }
        if (totalValue > tariffValue) {
            setGroupCheckInError(groupCheckIn.mode === 'booking' ? 'Предоплата не может быть больше тарифа' : 'Оплата не может быть больше тарифа');
            return;
        }
        if (guestCount !== undefined && (!Number.isInteger(guestCount) || guestCount <= 0)) {
            setGroupCheckInError('Количество гостей должно быть целым числом');
            return;
        }

        setIsSubmittingGroupCheckIn(true);
        try {
            await sendManagerRequest('/api/rooms/group-stay', {
                body: {
                    action: groupCheckIn.mode === 'edit' ? 'edit-group' : groupCheckIn.mode === 'booking' ? 'group-booking' : 'group-checkin',
                    hotelId: data.hotel.id,
                    shiftId: data.shift.id,
                    groupRef: groupCheckIn.mode === 'edit' ? groupCheckIn.groupRef : undefined,
                    roomIds: groupCheckIn.roomIds,
                    guestName: groupCheckIn.guestName.trim() || undefined,
                    guestCount,
                    bookingSource: data.hotel.usesExtranets ? groupCheckIn.bookingSource || undefined : undefined,
                    bookingNumber,
                    scheduledCheckIn: scheduledCheckIn.toISOString(),
                    scheduledCheckOut: scheduledCheckOut.toISOString(),
                    tariffAmount: toMinor(tariffValue),
                    totalAmount: toMinor(totalValue),
                    paymentMode: groupCheckIn.paymentMode,
                    mealPlan: groupCheckIn.mealPlan,
                    notes: groupCheckIn.notes.trim() || undefined,
                },
            }, groupCheckIn.mode === 'edit' ? 'Редактирование группы' : groupCheckIn.mode === 'booking' ? 'Групповая бронь' : 'Групповой заезд');
            toast(groupCheckIn.mode === 'edit' ? 'Групповая бронь сохранена' : groupCheckIn.mode === 'booking' ? 'Групповая бронь создана' : 'Групповой заезд создан', 'success');
            setGroupCheckIn(null);
            setGroupCheckInError(null);
            void refreshManagerState();
        } catch (error) {
            console.error(error);
            setGroupCheckInError(error instanceof Error ? error.message : 'Не удалось создать групповой заезд');
        } finally {
            setIsSubmittingGroupCheckIn(false);
        }
    };

    const showConfirmTransfersModal = () => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы подтвердить перевод', 'error');
            return;
        }
        if (!canEditStayPayments) {
            toast('Нет права редактировать суммы. Обратитесь к администратору', 'error');
            return;
        }
        const stayIds = pendingTransferRooms.map((room) => room.stay?.id).filter((id): id is string => Boolean(id));
        if (!stayIds.length) {
            toast('Нет ожидающих переводов', 'error');
            return;
        }
        setConfirmTransfers({ stayIds });
        setConfirmTransfersError(null);
    };

    const handleConfirmTransfers = async () => {
        if (!confirmTransfers || !data?.shift || !data.hotel.id) return;
        if (!canEditStayPayments) {
            setConfirmTransfersError('Нет права редактировать суммы. Обратитесь к администратору');
            return;
        }
        setIsConfirmingTransfers(true);
        try {
            await sendManagerRequest('/api/rooms/group-stay', {
                body: {
                    action: 'confirm-transfer',
                    hotelId: data.hotel.id,
                    shiftId: data.shift.id,
                    stayIds: confirmTransfers.stayIds,
                },
            }, 'Подтверждение переводов');
            toast('Переводы подтверждены', 'success');
            setConfirmTransfers(null);
            setConfirmTransfersError(null);
            void refreshManagerState();
        } catch (error) {
            console.error(error);
            setConfirmTransfersError(error instanceof Error ? error.message : 'Не удалось подтвердить переводы');
        } finally {
            setIsConfirmingTransfers(false);
        }
    };

    const showCheckInModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы заселить гостя', 'error');
            return;
        }
        if (room.status !== 'AVAILABLE') {
            toast(room.status === 'DIRTY' ? 'Сначала отметьте номер убранным' : 'Номер сейчас не свободен для заселения', 'error');
            return;
        }

        const startDate = room.stay?.scheduledCheckIn ? new Date(room.stay.scheduledCheckIn) : new Date();
        const endDate = room.stay?.scheduledCheckOut
            ? new Date(room.stay.scheduledCheckOut)
            : new Date(startDate.getTime() + 12 * 60 * 60 * 1000);

        setCheckInModal({
            mode: 'checkin',
            roomId: room.id,
            label: room.label,
            guestName: '',
            guestPhone: '',
            companyName: '',
            bookingSource: '',
            bookingNumber: '',
            totalAmount: '',
            mealPlan: [],
            notes: '',
            targetRoomId: '',
            transferNote: '',
            checkIn: formatDateInputValue(startDate),
            currentCheckOut: undefined,
            checkOut: formatDateInputValue(endDate),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: 0
        });
        setCheckInError(null);
    };

    const showBookingModal = (room: ManagerStateResponse['rooms'][number], selectedDay?: Date) => {
        const now = new Date();
        const startDate = selectedDay ? new Date(selectedDay) : new Date();
        const isSelectedToday = selectedDay
            ? startOfLocalDay(selectedDay).getTime() === startOfLocalDay(now).getTime()
            : false;
        startDate.setHours(14, 0, 0, 0);
        if (isSelectedToday && startDate.getTime() <= now.getTime()) {
            startDate.setTime(now.getTime());
            startDate.setMinutes(Math.ceil(startDate.getMinutes() / 15) * 15, 0, 0);
        } else if (!selectedDay && startDate.getTime() <= now.getTime()) {
            startDate.setDate(startDate.getDate() + 1);
        }
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(12, 0, 0, 0);

        setCheckInModal({
            mode: 'book',
            roomId: room.id,
            label: room.label,
            guestName: '',
            guestPhone: '',
            companyName: '',
            bookingSource: '',
            bookingNumber: '',
            totalAmount: '',
            mealPlan: [],
            notes: '',
            targetRoomId: '',
            transferNote: '',
            checkIn: formatDateInputValue(startDate),
            currentCheckOut: undefined,
            checkOut: formatDateInputValue(endDate),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: 0
        });
        setCheckInError(null);
    };

    const handleBoardCellClick = (room: ManagerStateResponse['rooms'][number], selectedDay: Date) => {
        const isToday = startOfLocalDay(new Date()).getTime() === startOfLocalDay(selectedDay).getTime();
        if (isToday) {
            setBoardDayAction({ room, selectedDay });
            return;
        }

        showBookingModal(room, selectedDay);
    };

    const showBookingDetails = (room: ManagerStateResponse['rooms'][number], stay: ManagerRoomStay) => {
        setBookingDetails({
            roomId: room.id,
            roomLabel: room.label,
            stay
        });
    };

    const canCheckInScheduledStay = useCallback((stay: ManagerRoomStay) => {
        const todayKey = formatDateKey(new Date(), hotelTz);
        const checkInKey = formatDateKey(stay.scheduledCheckIn, hotelTz);
        return Boolean(todayKey && checkInKey && checkInKey <= todayKey);
    }, [hotelTz]);

    const showScheduledCheckInModal = (details: { roomId: string; roomLabel: string; stay: ManagerRoomStay }) => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы заселить гостя', 'error');
            return;
        }
        if (!canCheckInScheduledStay(details.stay)) {
            toast('Эта бронь на будущую дату. Заселение будет доступно в день заезда', 'error');
            return;
        }

        setCheckInModal({
            mode: 'checkin',
            stayId: details.stay.id,
            roomId: details.roomId,
            label: details.roomLabel,
            guestName: details.stay.guestName?.trim() || '',
            guestPhone: details.stay.guestPhone?.trim() || '',
            companyName: details.stay.companyName?.trim() || '',
            bookingSource: details.stay.bookingSource?.trim() || '',
            bookingNumber: details.stay.bookingNumber?.trim() || '',
            totalAmount: String((details.stay.totalAmount ?? 0) / 100 || ''),
            mealPlan: details.stay.mealPlan ?? [],
            notes: details.stay.notes?.trim() || '',
            targetRoomId: '',
            transferNote: '',
            checkIn: formatDateInputValue(new Date(details.stay.scheduledCheckIn)),
            currentCheckOut: undefined,
            checkOut: formatDateInputValue(new Date(details.stay.scheduledCheckOut)),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: details.stay.amountPaid ?? 0
        });
        setBookingDetails(null);
        setCheckInError(null);
    };

    const showEditStayModal = (room: ManagerStateResponse['rooms'][number], stay = room.stay) => {
        if (!stay) {
            toast('Нет брони или проживания для редактирования', 'error');
            return;
        }
        if (!canEditStayPayments) {
            toast('Редактирование доступно только менеджеру с правом исправлений', 'error');
            return;
        }

        setCheckInModal({
            mode: 'edit',
            stayId: stay.id,
            roomId: room.id,
            label: room.label,
            guestName: stay.guestName?.trim() || '',
            guestPhone: stay.guestPhone?.trim() || '',
            companyName: stay.companyName?.trim() || '',
            bookingSource: stay.bookingSource?.trim() || '',
            bookingNumber: stay.bookingNumber?.trim() || '',
            totalAmount: String((stay.totalAmount ?? 0) / 100 || ''),
            mealPlan: stay.mealPlan ?? [],
            notes: stay.notes?.trim() || '',
            targetRoomId: '',
            transferNote: '',
            checkIn: formatDateInputValue(new Date(stay.scheduledCheckIn)),
            currentCheckOut: stay.status === 'CHECKED_IN' ? formatDateInputValue(new Date(stay.scheduledCheckOut)) : undefined,
            checkOut: formatDateInputValue(new Date(stay.scheduledCheckOut)),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: stay.amountPaid ?? 0
        });
        setBookingDetails(null);
        setCheckInError(null);
    };

    const showEditBookingDetails = () => {
        if (!bookingDetails) {
            return;
        }

        const room = sortedRooms.find((candidate) => candidate.id === bookingDetails.roomId);
        if (!room) {
            toast('Номер не найден в текущем списке', 'error');
            return;
        }

        showEditStayModal(room, bookingDetails.stay);
    };

    const showEditGroupBookingDetails = () => {
        if (!bookingDetails?.stay.groupRef) {
            showEditBookingDetails();
            return;
        }
        if (!canEditStayPayments) {
            toast('Редактирование доступно только менеджеру с правом исправлений', 'error');
            return;
        }

        const groupRooms = sortedRooms
            .map((room) => {
                const stay = (room.stays ?? []).find((candidate) =>
                    candidate.groupRef === bookingDetails.stay.groupRef &&
                    candidate.status === 'SCHEDULED'
                );
                return stay ? { room, stay } : null;
            })
            .filter((item): item is { room: ManagerStateResponse['rooms'][number]; stay: ManagerRoomStay } => Boolean(item));

        if (groupRooms.length < 2) {
            showEditBookingDetails();
            return;
        }

        const totalTariff = groupRooms.reduce((sum, item) => sum + (item.stay.totalAmount ?? 0), 0);
        const totalPaid = groupRooms.reduce((sum, item) => sum + (item.stay.amountPaid ?? 0), 0);
        const totalCash = groupRooms.reduce((sum, item) => sum + (item.stay.cashPaid ?? 0), 0);
        const totalCard = groupRooms.reduce((sum, item) => sum + (item.stay.cardPaid ?? 0), 0);
        const totalOnline = groupRooms.reduce((sum, item) => sum + (item.stay.onlinePaid ?? 0), 0);
        const first = groupRooms[0].stay;
        const cleanedNotes = first.notes?.replace(/\s*·?\s*Группа\s+[a-f0-9-]+/i, '').trim() ?? '';

        setGroupCheckIn({
            mode: 'edit',
            groupRef: bookingDetails.stay.groupRef,
            guestName: first.guestName?.trim() || '',
            guestCount: '',
            bookingSource: first.bookingSource?.trim() || '',
            bookingNumber: first.bookingNumber?.trim() || '',
            checkIn: formatDateInputValue(new Date(first.scheduledCheckIn)),
            checkOut: formatDateInputValue(new Date(first.scheduledCheckOut)),
            tariffAmount: String(totalTariff / 100 || ''),
            totalAmount: String(totalPaid / 100 || ''),
            paymentMode: totalOnline > 0 ? 'PENDING_TRANSFER' : totalCash > 0 && totalCard <= 0 ? 'CASH' : 'CARD',
            mealPlan: first.mealPlan ?? [],
            notes: cleanedNotes,
            roomIds: groupRooms.map((item) => item.room.id),
        });
        setBookingDetails(null);
        setGroupCheckInError(null);
    };

    const handleCancelBooking = async () => {
        if (!bookingDetails) {
            return;
        }
        if (!canEditStayPayments) {
            toast('Отмена доступна только менеджеру с правом исправлений', 'error');
            return;
        }
        if (typeof window !== 'undefined' && !window.confirm(`Отменить бронь № ${bookingDetails.roomLabel}?`)) {
            return;
        }

        setIsCancellingBooking(true);
        try {
            await sendManagerRequest(`/api/rooms/${bookingDetails.roomId}/stay`, {
                body: {
                    intent: 'cancel-booking',
                    stayId: bookingDetails.stay.id,
                }
            }, 'Отмена брони');
            toast('Бронь отменена', 'success');
            setBookingDetails(null);
            void refreshManagerState();
        } catch (error) {
            console.error(error);
            toast('Не удалось отменить бронь', 'error');
        } finally {
            setIsCancellingBooking(false);
        }
    };

    const handleToggleCleaningStatus = async (room: ManagerStateResponse['rooms'][number]) => {
        if (room.status !== 'DIRTY') {
            toast('Отметить убранным можно только номер в статусе уборки', 'error');
            return;
        }

        setUpdatingCleaningRoomId(room.id);
        try {
            await sendManagerRequest(`/api/rooms/${room.id}/cleaning`, {
                method: 'PATCH',
                body: { status: 'AVAILABLE' }
            }, `Уборка № ${room.label}`);
            toast(`№ ${room.label} отмечен убранным`, 'success');
            await refreshManagerState();
        } catch (error) {
            console.error(error);
            toast(error instanceof Error ? error.message : 'Не удалось обновить уборку', 'error');
        } finally {
            setUpdatingCleaningRoomId(null);
        }
    };

    const showExtendModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы продлить проживание', 'error');
            return;
        }
        if (!room.stay) {
            toast('Нет активного проживания для продления', 'error');
            return;
        }

        setCheckInModal({
            mode: 'extend',
            roomId: room.id,
            label: room.label,
            guestName: room.stay.guestName?.trim() || 'Гость',
            guestPhone: room.stay.guestPhone?.trim() || '',
            companyName: room.stay.companyName?.trim() || '',
            bookingSource: room.stay.bookingSource?.trim() || '',
            bookingNumber: room.stay.bookingNumber?.trim() || '',
            totalAmount: String((room.stay.totalAmount ?? 0) / 100 || ''),
            mealPlan: room.stay.mealPlan ?? [],
            notes: room.stay.notes?.trim() || '',
            targetRoomId: '',
            transferNote: '',
            checkIn: formatDateInputValue(new Date(room.stay.scheduledCheckIn)),
            currentCheckOut: formatDateInputValue(new Date(room.stay.scheduledCheckOut)),
            checkOut: formatDateInputValue(new Date(room.stay.scheduledCheckOut)),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: 0
        });
        setCheckInError(null);
    };

    const showTransferModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы переселить гостя', 'error');
            return;
        }
        if (!room.stay) {
            toast('Нет активного проживания для переселения', 'error');
            return;
        }

        const targetRoom = sortedRooms.find((candidate) => candidate.status === 'AVAILABLE' && candidate.id !== room.id);
        if (!targetRoom) {
            toast('Нет свободных комнат для переселения', 'error');
            return;
        }

        setCheckInModal({
            mode: 'transfer',
            roomId: room.id,
            label: room.label,
            guestName: room.stay.guestName?.trim() || 'Гость',
            guestPhone: room.stay.guestPhone?.trim() || '',
            companyName: room.stay.companyName?.trim() || '',
            bookingSource: room.stay.bookingSource?.trim() || '',
            bookingNumber: room.stay.bookingNumber?.trim() || '',
            totalAmount: String((room.stay.totalAmount ?? 0) / 100 || ''),
            mealPlan: room.stay.mealPlan ?? [],
            notes: room.stay.notes?.trim() || '',
            targetRoomId: targetRoom.id,
            transferNote: '',
            checkIn: formatDateInputValue(new Date(room.stay.scheduledCheckIn)),
            currentCheckOut: formatDateInputValue(new Date(room.stay.scheduledCheckOut)),
            checkOut: formatDateInputValue(new Date(room.stay.scheduledCheckOut)),
            cashAmount: '',
            cardAmount: '',
            onlineAmount: '',
            existingPaid: 0
        });
        setCheckInError(null);
    };

    const showPaymentAdjustModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!canEditStayPayments) {
            toast('Корректировка доступна только менеджеру с правом исправлений', 'error');
            return;
        }
        if (!room.stay) {
            toast('Нет проживания для корректировки', 'error');
            return;
        }

        setPaymentAdjust({
            roomId: room.id,
            roomLabel: room.label,
            stayId: room.stay.id,
            guestName: room.stay.guestName?.trim() || 'Гость',
            totalAmount: room.stay.totalAmount ?? null,
            cashAmount: String((room.stay.cashPaid ?? 0) / 100 || ''),
            cardAmount: String((room.stay.cardPaid ?? 0) / 100 || ''),
            onlineAmount: String((room.stay.onlinePaid ?? 0) / 100 || '')
        });
        setPaymentAdjustError(null);
    };

    const showBookingPaymentAdjust = () => {
        if (!bookingDetails) {
            return;
        }
        if (!canEditStayPayments) {
            toast('Корректировка доступна только менеджеру с правом исправлений', 'error');
            return;
        }

        setPaymentAdjust({
            roomId: bookingDetails.roomId,
            roomLabel: bookingDetails.roomLabel,
            stayId: bookingDetails.stay.id,
            guestName: bookingDetails.stay.guestName?.trim() || 'Гость',
            totalAmount: bookingDetails.stay.totalAmount ?? null,
            cashAmount: String((bookingDetails.stay.cashPaid ?? 0) / 100 || ''),
            cardAmount: String((bookingDetails.stay.cardPaid ?? 0) / 100 || ''),
            onlineAmount: String((bookingDetails.stay.onlinePaid ?? 0) / 100 || '')
        });
        setBookingDetails(null);
        setPaymentAdjustError(null);
    };

    const handlePaymentAdjust = async () => {
        if (!paymentAdjust) {
            return;
        }

        const cashValue = Number(paymentAdjust.cashAmount || 0);
        const cardValue = Number(paymentAdjust.cardAmount || 0);
        const onlineValue = Number(paymentAdjust.onlineAmount || 0);

        if (!Number.isFinite(cashValue) || cashValue < 0 || !Number.isFinite(cardValue) || cardValue < 0 || !Number.isFinite(onlineValue) || onlineValue < 0) {
            setPaymentAdjustError('Сумма не может быть отрицательной или пустой');
            return;
        }

        if (cashValue === 0 && cardValue === 0 && onlineValue === 0) {
            setPaymentAdjustError('Укажите сумму оплаты');
            return;
        }

        const nextPaymentTotal = toMinor(cashValue) + toMinor(cardValue) + toMinor(onlineValue);
        if (typeof paymentAdjust.totalAmount === 'number' && nextPaymentTotal > paymentAdjust.totalAmount) {
            setPaymentAdjustError('Оплата не может быть больше тарифа');
            return;
        }

        setIsSubmittingPaymentAdjust(true);
        try {
            await sendManagerRequest(`/api/rooms/${paymentAdjust.roomId}/stay`, {
                body: {
                    shiftId: data?.shift?.id,
                    stayId: paymentAdjust.stayId,
                    intent: 'adjust-payments',
                    cashAmount: toMinor(cashValue),
                    cardAmount: toMinor(cardValue),
                    onlineAmount: toMinor(onlineValue)
                }
            }, `Корректировка оплаты № ${paymentAdjust.roomLabel}`);
            toast('Суммы обновлены', 'success');
            setPaymentAdjust(null);
            setPaymentAdjustError(null);
            void refreshManagerState();
        } catch (error) {
            console.error(error);
            setPaymentAdjustError(error instanceof Error ? error.message : 'Не удалось обновить суммы');
        } finally {
            setIsSubmittingPaymentAdjust(false);
        }
    };

    const handleConfirmCheckIn = async () => {
        if (!checkInModal) {
            return;
        }

        const activeShiftId = data?.shift?.id;
        if (checkInModal.mode !== 'book' && checkInModal.mode !== 'edit' && !activeShiftId) {
            return;
        }

        if (checkInModal.mode === 'transfer') {
            if (!checkInModal.targetRoomId) {
                setCheckInError('Выберите комнату для переселения');
                return;
            }

            setIsSubmittingCheckIn(true);
            try {
                await sendManagerRequest(`/api/rooms/${checkInModal.roomId}/stay`, {
                    body: {
                        shiftId: activeShiftId,
                        intent: 'transfer',
                        targetRoomId: checkInModal.targetRoomId,
                        transferNote: checkInModal.transferNote.trim() || undefined,
                    }
                }, `Переселение № ${checkInModal.label}`);
                setCheckInModal(null);
                setCheckInError(null);
                toast('Гость переселён', 'success');
                void refreshManagerState();
            } catch (modalError) {
                console.error(modalError);
                setCheckInError('Не удалось переселить гостя');
            } finally {
                setIsSubmittingCheckIn(false);
            }

            return;
        }

        const scheduledCheckIn = parseInputValue(checkInModal.checkIn, hotelTz);
        const scheduledCheckOut = parseInputValue(checkInModal.checkOut, hotelTz);

        if (!scheduledCheckOut || ((checkInModal.mode === 'checkin' || checkInModal.mode === 'book' || checkInModal.mode === 'edit') && !scheduledCheckIn)) {
            setCheckInError(checkInModal.mode === 'extend' ? 'Укажите корректную новую дату выезда' : 'Укажите корректные даты заезда и выезда');
            return;
        }

        if (checkInModal.mode === 'checkin' || checkInModal.mode === 'book' || checkInModal.mode === 'edit') {
            if (scheduledCheckOut <= scheduledCheckIn!) {
                setCheckInError('Время выезда должно быть позже заселения');
                return;
            }
        } else {
            const currentCheckOut = checkInModal.currentCheckOut ? parseInputValue(checkInModal.currentCheckOut, hotelTz) : null;
            if (!currentCheckOut) {
                setCheckInError('Не удалось определить текущую дату выезда');
                return;
            }
            if (scheduledCheckOut <= currentCheckOut) {
                setCheckInError('Новая дата выезда должна быть позже текущей');
                return;
            }
        }

        const cashValue = Number(checkInModal.cashAmount || 0);
        const cardValue = Number(checkInModal.cardAmount || 0);
        const onlineValue = Number(checkInModal.onlineAmount || 0);
        const tariffValue = Number(checkInModal.totalAmount || 0);
        const bookingNumber = checkInModal.bookingNumber.trim();

        if (!Number.isFinite(cashValue) || cashValue < 0 || !Number.isFinite(cardValue) || cardValue < 0 || !Number.isFinite(onlineValue) || onlineValue < 0) {
            setCheckInError('Сумма не может быть отрицательной или пустой');
            return;
        }

        if ((checkInModal.mode === 'checkin' || checkInModal.mode === 'book' || checkInModal.mode === 'edit') && checkInModal.bookingSource.trim() && !bookingNumber) {
            setCheckInError('Укажите номер бронирования');
            return;
        }

        if ((checkInModal.mode === 'checkin' || checkInModal.mode === 'book' || checkInModal.mode === 'edit') && (!Number.isFinite(tariffValue) || tariffValue <= 0)) {
            setCheckInError('Укажите общую сумму тарифа');
            return;
        }

        if (checkInModal.mode === 'checkin' && cashValue === 0 && cardValue === 0 && onlineValue === 0 && checkInModal.existingPaid <= 0) {
            setCheckInError('Укажите оплату наличными, безналичными и/или на сайте');
            return;
        }

        if (checkInModal.mode === 'book' && (cashValue > 0 || cardValue > 0) && !activeShiftId) {
            setCheckInError('Для наличной или безналичной предоплаты откройте смену');
            return;
        }

        const cashMinor = toMinor(cashValue);
        const cardMinor = toMinor(cardValue);
        const onlineMinor = toMinor(onlineValue);
        const tariffMinor = toMinor(tariffValue);
        const currentPaymentMinor = checkInModal.mode === 'checkin'
            ? checkInModal.existingPaid + cashMinor + cardMinor + onlineMinor
            : cashMinor + cardMinor + onlineMinor;

        if (checkInModal.mode === 'edit') {
            if (!checkInModal.stayId) {
                setCheckInError('Не удалось определить бронь или проживание');
                return;
            }
            if (checkInModal.existingPaid > tariffMinor) {
                setCheckInError('Оплата не может быть больше тарифа');
                return;
            }

            setIsSubmittingCheckIn(true);
            try {
                await sendManagerRequest(`/api/rooms/${checkInModal.roomId}/stay`, {
                    body: {
                        intent: 'edit-stay',
                        stayId: checkInModal.stayId,
                        guestName: checkInModal.guestName.trim() || undefined,
                        guestPhone: checkInModal.guestPhone.trim() || undefined,
                        companyName: checkInModal.companyName.trim() || undefined,
                        bookingSource: data?.hotel.usesExtranets ? checkInModal.bookingSource || undefined : undefined,
                        bookingNumber,
                        totalAmount: tariffMinor,
                        mealPlan: checkInModal.mealPlan,
                        notes: checkInModal.notes.trim() || undefined,
                        scheduledCheckIn: scheduledCheckIn!.toISOString(),
                        scheduledCheckOut: scheduledCheckOut.toISOString()
                    }
                }, `Редактирование № ${checkInModal.label}`);
                setCheckInModal(null);
                setCheckInError(null);
                toast('Данные сохранены', 'success');
                void refreshManagerState();
            } catch (modalError) {
                console.error(modalError);
                setCheckInError(modalError instanceof Error ? modalError.message : 'Не удалось сохранить данные');
            } finally {
                setIsSubmittingCheckIn(false);
            }

            return;
        }

        if ((checkInModal.mode === 'checkin' || checkInModal.mode === 'book') && currentPaymentMinor > tariffMinor) {
            setCheckInError(checkInModal.mode === 'book' ? 'Предоплата не может быть больше тарифа' : 'Оплата не может быть больше тарифа');
            return;
        }

        setIsSubmittingCheckIn(true);
        try {
            await sendManagerRequest(`/api/rooms/${checkInModal.roomId}/stay`, {
                body: {
                    shiftId: checkInModal.mode === 'book' ? (cashMinor > 0 || cardMinor > 0 ? activeShiftId : undefined) : activeShiftId,
                    stayId: checkInModal.stayId,
                    intent: checkInModal.mode,
                    guestName: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? checkInModal.guestName.trim() || undefined : undefined,
                    guestPhone: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? checkInModal.guestPhone.trim() || undefined : undefined,
                    companyName: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? checkInModal.companyName.trim() || undefined : undefined,
                    bookingSource: (checkInModal.mode === 'checkin' || checkInModal.mode === 'book') && data?.hotel.usesExtranets ? checkInModal.bookingSource || undefined : undefined,
                    bookingNumber: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? bookingNumber : undefined,
                    totalAmount: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? tariffMinor : undefined,
                    mealPlan: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? checkInModal.mealPlan : undefined,
                    notes: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? checkInModal.notes.trim() || undefined : undefined,
                    scheduledCheckIn: checkInModal.mode === 'checkin' || checkInModal.mode === 'book' ? scheduledCheckIn!.toISOString() : undefined,
                    scheduledCheckOut: scheduledCheckOut.toISOString(),
                    cashAmount: cashMinor,
                    cardAmount: cardMinor,
                    onlineAmount: onlineMinor
                }
            }, checkInModal.mode === 'book' ? `Бронь № ${checkInModal.label}` : checkInModal.mode === 'extend' ? `Продление № ${checkInModal.label}` : `Заселение № ${checkInModal.label}`);
            setCheckInModal(null);
            setCheckInError(null);
            toast(checkInModal.mode === 'book' ? 'Бронь создана' : checkInModal.mode === 'extend' ? 'Проживание продлено' : 'Гость заселён', 'success');
            void refreshManagerState();
        } catch (modalError) {
            console.error(modalError);
            setCheckInError(checkInModal.mode === 'book' ? 'Не удалось создать бронь' : checkInModal.mode === 'extend' ? 'Не удалось продлить проживание' : 'Не удалось заселить гостя');
        } finally {
            setIsSubmittingCheckIn(false);
        }
    };

    const handleCloseModal = () => {
        if (isSubmittingCheckIn) return;
        setCheckInModal(null);
        setCheckInError(null);
    };

    const handleProfileCloseShift = () => {
        setActivePanel('shift');
        handleCloseProfile();
    };

    const isStayDataModalMode = checkInModal?.mode === 'checkin' || checkInModal?.mode === 'book' || checkInModal?.mode === 'edit';
    const showPaymentInputsInModal = Boolean(checkInModal && checkInModal.mode !== 'transfer' && checkInModal.mode !== 'edit');

    if (!primaryHotel) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-light-bg px-2 py-4 text-center dark:bg-night sm:px-6">
                    <Card className="max-w-md text-center">
                        <p className="text-light-text dark:text-white/80">Администратор ещё не назначил вас на точку.</p>
                    </Card>
                </div>
            </>
        );
    }

    if (!data && isLoading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-light-bg px-2 py-4 text-center dark:bg-night sm:px-6">
                <div className="flex w-full max-w-md justify-end">
                    <ExitButton />
                </div>
                <Card className="max-w-md text-center">
                    <p className="text-slate-600 dark:text-white/70">Загружаем данные точки…</p>
                </Card>
            </div>
        );
    }

    if (!data && error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-light-bg px-2 py-4 text-center sm:px-6">
                <div className="flex w-full max-w-md justify-end">
                    <ExitButton />
                </div>
                <Card className="max-w-md text-center">
                    <p className="text-rose-600 dark:text-rose-300">Не удалось загрузить состояние менеджера</p>
                    <p className="text-sm text-slate-500 dark:text-white/60">{String(error)}</p>
                </Card>
            </div>
        );
    }

    if (data && !data.shift) {
        return (
            <div className="flex min-h-screen flex-col gap-4 px-3 pb-16 pt-4 sm:px-5">
                <div className="flex justify-end">
                    <ExitButton />
                </div>
                <OfflineStatusBanner />
                <Card>
                    <CardHeader title="Принять смену" />
                    <form className="space-y-3" onSubmit={handleOpenShift}>
                        <Input
                            type="password"
                            placeholder="PIN (6 цифр)"
                            maxLength={6}
                            inputMode="numeric"
                            {...openShiftForm.register('pinCode', {
                                required: 'Введите PIN менеджера',
                                minLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                maxLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                pattern: { value: /^\d{6}$/, message: 'Допустимы только цифры' }
                            })}
                        />
                        {openShiftForm.formState.errors.pinCode && (
                            <p className="text-xs text-rose-300">{openShiftForm.formState.errors.pinCode.message}</p>
                        )}
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="Наличные в кассе"
                            inputMode="decimal"
                            min={0}
                            {...openShiftForm.register('openingCash', {
                                valueAsNumber: true,
                                required: 'Введите фактический остаток наличных',
                                min: { value: 0, message: 'Сумма не может быть отрицательной' }
                            })}
                        />
                        {openShiftForm.formState.errors.openingCash && (
                            <p className="text-xs text-rose-300">{openShiftForm.formState.errors.openingCash.message}</p>
                        )}
                        <TextArea rows={2} placeholder="Комментарий" {...openShiftForm.register('note')} />
                        <Button type="submit" className="w-full">
                            Начать смену
                        </Button>
                    </form>
                </Card>
            </div>
        );
    }

    return (
        <div>
            <div className="min-h-screen bg-light-bg dark:bg-night">
                <div className="desktop-container">
                    <div className="flex min-h-screen flex-col gap-2.5 px-3 pb-16 pt-3 sm:gap-3 sm:px-5 sm:pt-4 lg:px-8">
                        <header>
                            {data?.shift ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <h1 className="text-base font-semibold text-light-text dark:text-white lg:text-xl">Смена №{data.shift.number}</h1>
                                            <p className="text-[11px] text-slate-600 dark:text-white/40 lg:text-xs">{formatDateTime(data.shift.openedAt, hotelTz)}</p>
                                        </div>
                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 rounded-xl"
                                                onClick={handleCopyState}
                                                disabled={!shareMessage}
                                                aria-label="Скопировать состояние"
                                                title="Скопировать состояние"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                </svg>
                                            </Button>
                                            <Button type="button" size="sm" variant="ghost" className="h-8 rounded-xl px-2.5 text-[11px] text-amber-600 dark:text-amber-200/70" onClick={() => setActivePanel('shift')}>
                                                Закрыть смену
                                            </Button>
                                            <ThemeToggle />
                                            <button
                                                type="button"
                                                onClick={() => void refreshManagerState()}
                                                className={`rounded-xl p-1.5 text-slate-500 dark:text-white/40 transition hover:text-slate-700 dark:hover:text-white/70 ${isValidating ? 'animate-spin' : ''}`}
                                                aria-label="Обновить"
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
                                            </button>
                                            <ExitButton />
                                        </div>
                                    </div>
                                    <OfflineStatusBanner />
                                    <div className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-5 sm:gap-2 sm:text-xs">
                                        <span className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 leading-snug text-slate-700 shadow-sm dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">Касса <span className="block break-words font-semibold text-light-text dark:text-white sm:inline">{formatKgs(shiftCashValue)}</span></span>
                                        <span className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 leading-snug text-slate-700 shadow-sm dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">Б/н <span className="block break-words font-semibold text-light-text dark:text-white sm:inline">{formatKgs(shiftCardValue)}</span></span>
                                        <span className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 leading-snug text-slate-700 shadow-sm dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">Расход <span className="block break-words font-semibold text-light-text dark:text-white sm:inline">{formatKgs(shiftExpensesTotal)}</span></span>
                                        <span className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 leading-snug text-slate-700 shadow-sm dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">Занято <span className="block font-semibold text-light-text dark:text-white sm:inline">{occupiedCount}/{sortedRooms.length}</span></span>
                                        <span className={`min-w-0 rounded-xl border px-2 py-1.5 leading-snug shadow-sm ${overdueCount ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/15 dark:bg-rose-500/15 dark:text-rose-300' : 'border-slate-200 bg-white text-slate-700 dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50'}`}>Просрочено <span className="block font-semibold sm:inline">{overdueCount}</span></span>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <p className="mt-3 text-sm text-amber-200/80">Смена не открыта</p>
                                    {managerInfoBlock}
                                </>
                            )}
                        </header>
                        <div className="sticky top-0 z-40 -mx-3 border-b border-slate-300 bg-light-bg px-3 py-2 shadow-[0_14px_32px_-30px_rgba(15,23,42,0.7)] dark:border-white/[0.06] dark:bg-night sm:-mx-5 sm:px-5">
                            <div className="flex gap-1 rounded-xl border border-slate-300 bg-white p-1 text-sm font-medium text-slate-800 shadow-[0_14px_30px_-26px_rgba(15,23,42,0.55)] dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">
                                {panelTabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActivePanel(tab.id)}
                                        className={`min-w-0 flex-1 rounded-lg px-3 py-1.5 text-center leading-tight transition-all break-words [overflow-wrap:anywhere] ${activePanel === tab.id ? 'bg-blue-600 text-white shadow-sm dark:bg-white/[0.12] dark:text-white' : 'hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-transparent dark:hover:text-white/70'
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {activePanel === 'rooms' && (
                            <section className="space-y-2.5 sm:space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h2 className="text-lg font-semibold text-light-text dark:text-white">Номера</h2>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            className="gap-1.5"
                                            disabled={!hasOpenShift || !sortedRooms.length}
                                            onClick={showGroupCheckInModal}
                                        >
                                            <Users className="h-4 w-4" aria-hidden="true" />
                                            Групповой заезд
                                        </Button>
                                        {pendingTransferRooms.length ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                className="gap-1.5 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200"
                                                disabled={!hasOpenShift || !canEditStayPayments}
                                                onClick={showConfirmTransfersModal}
                                            >
                                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                                Подтвердить {formatKgs(pendingTransferTotal)}
                                            </Button>
                                        ) : null}
                                        <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-medium text-slate-700 shadow-sm dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white/50">
                                            <button
                                                type="button"
                                                className={`min-w-0 rounded-lg px-2.5 py-1 text-center leading-tight transition break-words [overflow-wrap:anywhere] ${roomViewMode === 'cards' ? 'bg-blue-600 text-white shadow-sm dark:bg-white/[0.12] dark:text-white' : 'hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-transparent dark:hover:text-white'}`}
                                                onClick={() => setRoomViewMode('cards')}
                                            >
                                                Карточки
                                            </button>
                                            <button
                                                type="button"
                                                className={`min-w-0 rounded-lg px-2.5 py-1 text-center leading-tight transition break-words [overflow-wrap:anywhere] ${roomViewMode === 'board' ? 'bg-blue-600 text-white shadow-sm dark:bg-white/[0.12] dark:text-white' : 'hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-transparent dark:hover:text-white'}`}
                                                onClick={() => setRoomViewMode('board')}
                                            >
                                                Шахматка
                                            </button>
                                        </div>
                                        <Badge label={`${sortedRooms.length} в учёте`} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.035]">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-white/30">Свободно</p>
                                        <p className="mt-1 text-base font-semibold text-light-text dark:text-white">{availableCount}</p>
                                    </div>
                                    <button
                                        type="button"
                                        className={`rounded-2xl border px-3 py-2 text-left shadow-[0_10px_24px_-22px_rgba(15,23,42,0.34)] transition ${pendingTransferRooms.length ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200' : 'border-slate-200 bg-white text-slate-500 dark:border-white/[0.055] dark:bg-white/[0.035] dark:text-white/40'}`}
                                        disabled={!pendingTransferRooms.length || !canEditStayPayments}
                                        onClick={showConfirmTransfersModal}
                                    >
                                        <p className="text-[10px] uppercase tracking-[0.18em]">Ожидает перевода</p>
                                        <p className="mt-1 text-base font-semibold">{pendingTransferRooms.length ? formatKgs(pendingTransferTotal) : '0'}</p>
                                    </button>
                                    <div className={`rounded-2xl border px-3 py-2 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.34)] ${overdueCount ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/15 dark:bg-rose-500/15 dark:text-rose-300' : 'border-slate-200 bg-white text-slate-500 dark:border-white/[0.055] dark:bg-white/[0.035] dark:text-white/40'}`}>
                                        <p className="text-[10px] uppercase tracking-[0.18em]">Просрочено</p>
                                        <p className="mt-1 text-base font-semibold">{overdueCount}</p>
                                    </div>
                                </div>
                                {roomViewMode === 'board' ? (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap gap-1.5">
                                                <button
                                                    type="button"
                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-cyan-900 transition break-words [overflow-wrap:anywhere] hover:bg-cyan-100 dark:border-cyan-300/35 dark:bg-cyan-400/15 dark:text-cyan-100 dark:hover:bg-cyan-400/20"
                                                    onClick={() => setBoardListPopup('scheduled')}
                                                >
                                                    Бронь <span className="font-semibold">{boardScheduledItems.length}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-amber-700 transition break-words [overflow-wrap:anywhere] hover:bg-amber-100 dark:border-amber/15 dark:bg-amber/15 dark:text-amber dark:hover:bg-amber/20"
                                                    onClick={() => setBoardListPopup('checkedIn')}
                                                >
                                                    Заселён <span className="font-semibold">{boardCheckedInItems.length}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-rose-700 transition break-words [overflow-wrap:anywhere] hover:bg-rose-100 dark:border-rose-500/15 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/20"
                                                    onClick={() => setBoardListPopup('overdue')}
                                                >
                                                    Просрочено <span className="font-semibold">{boardOverdueItems.length}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-slate-600 transition break-words [overflow-wrap:anywhere] hover:bg-slate-100 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/55 dark:hover:bg-white/[0.08]"
                                                    onClick={() => setBoardListPopup('freeDates')}
                                                >
                                                    Свободные даты <span className="font-semibold">{boardFreeDateItems.length}</span>
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="border border-slate-200/80 dark:border-white/15"
                                                    onClick={() => setRoomBoardStartOffset((current) => current - managerBoardDayCount)}
                                                >
                                                    Назад
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="border border-slate-200/80 dark:border-white/15"
                                                    onClick={() => setRoomBoardStartOffset(0)}
                                                >
                                                    Сегодня
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="border border-slate-200/80 dark:border-white/15"
                                                    onClick={() => setRoomBoardStartOffset((current) => current + managerBoardDayCount)}
                                                >
                                                    Вперёд
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <div className="scrollbar-none max-h-[calc(100dvh-15rem)] overflow-auto bg-transparent overscroll-contain">
                                                <div className="w-max min-w-full">
                                                    <div
                                                        className="sticky top-0 z-30 grid border-y border-slate-200 bg-light-bg text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:border-white/[0.06] dark:bg-night dark:text-white/55"
                                                        style={{ gridTemplateColumns: boardGridTemplate }}
                                                    >
                                                        <div className="sticky left-0 z-40 border-r border-slate-200 bg-light-bg px-3 py-2 dark:border-white/[0.06] dark:bg-night">Номер</div>
                                                        {roomBoardDays.map((day) => (
                                                            <div key={`manager-board-day-${day.toISOString()}`} className="border-l border-slate-200 bg-light-bg px-2 py-2 text-center dark:border-white/[0.06] dark:bg-night">
                                                                <p>{formatBoardDay(day)}</p>
                                                                <p className="mt-0.5 font-normal normal-case tracking-normal">{formatBoardWeekday(day)}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {roomBoardSections.map((section) => {
                                                        const isCollapsed = Boolean(collapsedBoardSections[section.key]);
                                                        return (
                                                            <div key={`manager-board-section-${section.key}`}>
                                                                <div
                                                                    className="grid border-b border-slate-200 bg-slate-100/70 text-xs dark:border-white/[0.06] dark:bg-white/[0.035]"
                                                                    style={{ gridTemplateColumns: boardGridTemplate }}
                                                                >
                                                                    <button
                                                                        type="button"
                                                                        className="sticky left-0 z-30 flex items-center gap-2 border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 dark:border-white/[0.06] dark:bg-[#151923] dark:text-white/75"
                                                                        onClick={() => toggleBoardSection(section.key)}
                                                                    >
                                                                        <span className="text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
                                                                        <span className="truncate">{section.label}</span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="col-start-2 flex items-center justify-between px-3 py-2 text-left text-slate-500 transition hover:bg-slate-200/60 dark:text-white/45 dark:hover:bg-white/[0.04]"
                                                                        style={{ gridColumn: `2 / span ${managerBoardDayCount}` }}
                                                                        onClick={() => toggleBoardSection(section.key)}
                                                                    >
                                                                        <span>{section.rows.length} номеров</span>
                                                                        <span className="text-[11px]">{isCollapsed ? 'Развернуть' : 'Свернуть'}</span>
                                                                    </button>
                                                                </div>
                                                                {!isCollapsed && section.rows.map(({ room, items, laneCount }) => (
                                                                    <div
                                                                        key={`manager-board-room-${room.id}`}
                                                                        className="grid min-h-[56px] border-b border-slate-200/80 dark:border-white/[0.05]"
                                                                        style={{
                                                                            gridTemplateColumns: boardGridTemplate,
                                                                            gridTemplateRows: `repeat(${laneCount}, minmax(52px, auto))`
                                                                        }}
                                                                    >
                                                                        <div className="sticky left-0 z-20 flex items-center border-r border-slate-200 bg-light-bg px-3 py-2 dark:border-white/[0.06] dark:bg-night" style={{ gridRow: `1 / span ${laneCount}` }}>
                                                                            <div className="min-w-0">
                                                                                <p className="truncate text-sm font-semibold text-light-text dark:text-white">№ {room.label}</p>
                                                                                {room.floor ? <p className="truncate text-[11px] text-slate-500 dark:text-white/35">{room.floor}</p> : null}
                                                                            </div>
                                                                        </div>
                                                                        {roomBoardDays.map((day, dayIndex) => {
                                                                            const isToday = startOfLocalDay(new Date()).getTime() === startOfLocalDay(day).getTime();
                                                                            return (
                                                                                <button
                                                                                    type="button"
                                                                                    key={`manager-board-cell-${room.id}-${dayIndex}`}
                                                                                    className={`group relative border-l border-slate-200/70 text-left transition hover:bg-cyan-50/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/25 dark:border-white/[0.04] dark:hover:bg-cyan-400/[0.05] dark:focus:ring-white/15 ${isToday ? 'bg-amber-50/80 dark:bg-amber-400/[0.05]' : ''}`}
                                                                                    style={{ gridColumn: dayIndex + 2, gridRow: `1 / span ${laneCount}` }}
                                                                                    onClick={() => handleBoardCellClick(room, day)}
                                                                                    title={isToday ? `Выбрать действие для № ${room.label}` : `Поставить бронь на № ${room.label}`}
                                                                                    aria-label={isToday ? `Выбрать действие для номера ${room.label}` : `Поставить бронь на номер ${room.label}`}
                                                                                >
                                                                                    <span className="pointer-events-none absolute left-1/2 top-1/2 hidden h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-200 bg-white/95 text-sm font-semibold leading-none text-cyan-700 shadow-sm group-hover:flex group-focus-visible:flex dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-100">
                                                                                        +
                                                                                    </span>
                                                                                </button>
                                                                            );
                                                                        })}
                                                                        {items.map((item) => (
                                                                            <button
                                                                                key={`manager-board-stay-${item.stay.id}`}
                                                                                type="button"
                                                                                className={`z-10 m-1 min-w-0 rounded-xl border px-2 py-1.5 text-left text-[11px] leading-tight shadow-sm ${boardStatusClass(item.stay.status, item.isOverdue)}`}
                                                                                style={{ gridColumn: `${item.startIndex + 2} / span ${item.span}`, gridRow: item.lane + 1 }}
                                                                                title={[item.guestLabel, stayStatusLabel(item.stay.status), item.detailLabel, item.stay.notes?.trim()].filter(Boolean).join(' · ')}
                                                                                 onClick={() => {
                                                                                     if (item.stay.status === 'CHECKED_IN') {
                                                                                         if (canEditStayPayments) {
                                                                                             showEditStayModal(room, item.stay);
                                                                                         } else {
                                                                                             showExtendModal(room);
                                                                                         }
                                                                                     } else {
                                                                                         showBookingDetails(room, item.stay);
                                                                                     }
                                                                                 }}
                                                                            >
                                                                                <span className="block truncate font-semibold">{item.guestLabel}</span>
                                                                                <span className="mt-0.5 block truncate opacity-80">{item.detailLabel || stayStatusLabel(item.stay.status)}</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-slate-300/70 dark:bg-white/15" />
                                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-slate-300/70 dark:bg-white/15" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {sortedRooms.map((room) => {
                                        const isOccupied = room.status === 'OCCUPIED';
                                        const isOverdue = isOccupied && isPastDate(room.stay?.scheduledCheckOut);
                                        const guestLabel = room.stay?.guestName?.trim() || (isOccupied ? 'Гость' : 'Свободен');
                                        const cashPortion = room.stay?.cashPaid ?? 0;
                                        const cardPortion = room.stay?.cardPaid ?? 0;
                                        const onlinePortion = room.stay?.onlinePaid ?? 0;
                                        const paymentLabel = (() => {
                                            const segments = [] as string[];
                                            if (cashPortion) segments.push(`нал ${formatKgs(cashPortion)}`);
                                            if (cardPortion) segments.push(`безнал ${formatKgs(cardPortion)}`);
                                            if (onlinePortion) segments.push(`ожидает ${formatKgs(onlinePortion)}`);
                                            if (!segments.length && room.stay?.paymentMethod) {
                                                return room.stay.paymentMethod === 'CARD' ? 'Безнал' : 'Наличные';
                                            }
                                            return segments.join(' · ') || null;
                                        })();
                                        const bookingSourceLabel = room.stay?.bookingSource?.trim() ? `источник ${room.stay.bookingSource.trim()}` : null;
                                        const bookingNumberLabel = room.stay?.bookingNumber?.trim() ? `бронь № ${room.stay.bookingNumber.trim()}` : null;
                                        const totalTariff = room.stay?.totalAmount ?? null;
                                        const paidTotal = room.stay?.amountPaid ?? 0;
                                        const remainingTotal = totalTariff != null ? Math.max(totalTariff - paidTotal, 0) : null;
                                        const contactLabel = [room.stay?.companyName?.trim(), room.stay?.guestPhone?.trim()].filter(Boolean).join(' · ');
                                        const roomMealLabels = mealPlanLabels(room.stay?.mealPlan);

                                        return (
                                            <article key={room.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] transition hover:border-slate-300 hover:shadow-md dark:border-white/[0.055] dark:bg-white/[0.035] dark:shadow-none">
                                                <div className="flex flex-col gap-2.5">
                                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                        <span className="min-w-0 break-words text-sm font-semibold text-light-text dark:text-white">№ {room.label}</span>
                                                        {room.status === 'DIRTY' ? (
                                                            <button
                                                                type="button"
                                                                className="inline-flex items-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:pointer-events-none disabled:opacity-50 dark:border-rose-500/15 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-300"
                                                                disabled={updatingCleaningRoomId === room.id}
                                                                onClick={() => handleToggleCleaningStatus(room)}
                                                                title="Нажмите, чтобы отметить номер убранным"
                                                                aria-label={`Отметить номер ${room.label} убранным`}
                                                            >
                                                                <Sparkles className="h-3 w-3" aria-hidden="true" />
                                                                {updatingCleaningRoomId === room.id ? '...' : 'Уборка'}
                                                            </button>
                                                        ) : (
                                                            <Badge
                                                                label={isOverdue ? 'Просрочено' : isOccupied ? 'Занят' : 'Свободен'}
                                                                tone={isOverdue ? 'danger' : isOccupied ? 'warning' : 'success'}
                                                            />
                                                        )}
                                                    </div>
                                                    {isOccupied ? (
                                                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                             <Button
                                                                 type="button"
                                                                 size="icon"
                                                                 variant="secondary"
                                                                 className="h-8 w-8 rounded-xl"
                                                                disabled={!hasOpenShift || !availableTransferRooms.length}
                                                                onClick={() => showTransferModal(room)}
                                                                title="Переселить"
                                                                aria-label={`Переселить номер ${room.label}`}
                                                            >
                                                                <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="secondary"
                                                                className="h-8 w-8 rounded-xl"
                                                                disabled={!hasOpenShift}
                                                                onClick={() => showExtendModal(room)}
                                                                title="Продлить"
                                                                aria-label={`Продлить проживание в номере ${room.label}`}
                                                             >
                                                                 <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                                             </Button>
                                                             {canEditStayPayments ? (
                                                                 <Button
                                                                     type="button"
                                                                     size="icon"
                                                                     variant="secondary"
                                                                     className="h-8 w-8 rounded-xl"
                                                                     onClick={() => showPaymentAdjustModal(room)}
                                                                     title="Исправить суммы"
                                                                     aria-label={`Исправить суммы в номере ${room.label}`}
                                                                 >
                                                                     <Banknote className="h-4 w-4" aria-hidden="true" />
                                                                 </Button>
                                                             ) : null}
                                                             <Button
                                                                 type="button"
                                                                 size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 rounded-xl text-rose-600 hover:text-rose-700 dark:text-rose-300/70 dark:hover:text-rose-300"
                                                                disabled={!hasOpenShift}
                                                                onClick={() => setCheckoutConfirm({ roomId: room.id, roomLabel: room.label, guestName: guestLabel })}
                                                                title="Выселить"
                                                                aria-label={`Выселить номер ${room.label}`}
                                                            >
                                                                <LogOut className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="secondary"
                                                                className="h-8 w-8 rounded-xl"
                                                                onClick={() => showBookingModal(room)}
                                                                title="Поставить бронь"
                                                                aria-label={`Поставить бронь на номер ${room.label}`}
                                                            >
                                                                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="secondary"
                                                                className="h-8 w-8 rounded-xl"
                                                                disabled={!hasOpenShift || room.status !== 'AVAILABLE'}
                                                                onClick={() => showCheckInModal(room)}
                                                                title={room.status === 'DIRTY' ? 'Сначала отметьте номер убранным' : 'Заселить'}
                                                                aria-label={`Заселить номер ${room.label}`}
                                                            >
                                                                <LogIn className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                                {room.stay && (
                                                    <button
                                                        type="button"
                                                        className={`mt-1 block w-full space-y-1 rounded-xl px-2 py-1.5 text-left text-[11px] leading-snug transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:hover:bg-white/[0.06] ${isOverdue ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-white/45'}`}
                                                        onClick={() => {
                                                            if (room.stay?.status === 'SCHEDULED') {
                                                                showBookingDetails(room, room.stay);
                                                                return;
                                                            }
                                                            if (canEditStayPayments) {
                                                                showEditStayModal(room, room.stay);
                                                            } else {
                                                                showExtendModal(room);
                                                            }
                                                        }}
                                                        title={room.stay.status === 'SCHEDULED' ? 'Открыть бронь' : 'Редактировать проживание'}
                                                    >
                                                        <p className="break-words font-medium text-slate-800 dark:text-white/70">{guestLabel}</p>
                                                        {roomMealLabels.length ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {roomMealLabels.map((label) => (
                                                                    <span key={`room-meal-${room.id}-${label}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
                                                                        {label}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                        <p className="break-words">{formatDateTime(room.stay.scheduledCheckIn, hotelTz)} - {isOverdue ? 'просрочено с ' : ''}{formatDateTime(room.stay.scheduledCheckOut, hotelTz)}</p>
                                                        {totalTariff != null ? (
                                                            <p className="break-words">Тариф {formatKgs(totalTariff)} · оплачено {formatKgs(paidTotal)}{remainingTotal ? ` · остаток ${formatKgs(remainingTotal)}` : ''}</p>
                                                        ) : room.stay.amountPaid != null ? (
                                                            <p className="break-words">Оплачено {formatKgs(room.stay.amountPaid)}</p>
                                                        ) : null}
                                                        {(paymentLabel || bookingSourceLabel || bookingNumberLabel) ? (
                                                            <p className="break-words">{[paymentLabel, bookingSourceLabel, bookingNumberLabel].filter(Boolean).join(' · ')}</p>
                                                        ) : null}
                                                        {contactLabel ? <p className="break-words">{contactLabel}</p> : null}
                                                    </button>
                                                )}
                                            </article>
                                        );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        {activePanel === 'shift' && (
                            <Card>
                                <CardHeader title="Закрытие смены" />
                                {isLoading && <p className="text-sm text-slate-600 dark:text-white/60">Загружаем...</p>}
                                {error && <p className="text-sm text-rose-300">{String(error)}</p>}
                                {data?.shift && (
                                    <div className="mb-4 space-y-3">
                                        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-white/50">
                                            <span>{managerName} · {primaryHotel?.name}</span>
                                            <span>{formatDateTime(data.shift.openedAt, hotelTz)}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-white/[0.04]">
                                                <p className="text-[11px] text-slate-600 dark:text-white/40">Выручка</p>
                                                <p className="font-semibold text-emerald-600 dark:text-emerald-300">{formatKgs(shiftRevenueTotal)}</p>
                                                <p className="text-[11px] text-slate-600 dark:text-white/35">{formatKgs(shiftRevenueCash)} нал · {formatKgs(shiftRevenueCard)} б/н</p>
                                            </div>
                                            <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-white/[0.04]">
                                                <p className="text-[11px] text-slate-600 dark:text-white/40">Расход</p>
                                                <p className="font-semibold text-rose-600 dark:text-rose-300">{formatKgs(shiftExpensesTotal)}</p>
                                                <p className="text-[11px] text-slate-600 dark:text-white/35">{formatKgs(shiftExpensesCash)} нал · {formatKgs(shiftExpensesCard)} б/н</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-white/[0.06]">
                                            <span className="text-slate-600 dark:text-white/60">Наличные к закрытию</span>
                                            <span className="text-lg font-bold text-light-text dark:text-white">{formatKgs(shiftCashValue)}</span>
                                        </div>
                                        <div className="flex items-center justify-between px-1 text-xs text-slate-600 dark:text-white/40">
                                            <span>Открытие: {formatKgs(data.shift.openingCash)}</span>
                                            <span>Безнал: {formatKgs(shiftCardValue)}</span>
                                        </div>
                                        <div className="flex justify-end">
                                            <Button type="button" size="sm" variant="ghost" className="text-[11px]" onClick={handlePrintShiftReceipt}>
                                                Печать
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {data?.shift ? (
                                    <form className="space-y-3 border-t border-slate-200 pt-4 dark:border-white/[0.06]" onSubmit={handleCloseShift}>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                type="password"
                                                placeholder="PIN"
                                                maxLength={6}
                                                inputMode="numeric"
                                                {...handoverForm.register('pinCode', {
                                                    required: 'Введите PIN',
                                                    minLength: { value: 6, message: '6 цифр' },
                                                    maxLength: { value: 6, message: '6 цифр' },
                                                    pattern: { value: /^\d{6}$/, message: 'Только цифры' }
                                                })}
                                            />
                                            <TextArea rows={1} placeholder="Комментарий" {...handoverForm.register('note')} />
                                        </div>
                                        {handoverForm.formState.errors.pinCode && (
                                            <p className="text-xs text-rose-300">{handoverForm.formState.errors.pinCode.message}</p>
                                        )}
                                        <Button type="submit" className="w-full" variant="secondary">
                                            Закрыть смену
                                        </Button>
                                    </form>
                                ) : (
                                    <p className="text-sm text-slate-600 dark:text-white/60">Смена ещё не открыта.</p>
                                )}
                            </Card>
                        )}

                        {activePanel === 'cash' && (
                            <Card>
                                <CardHeader title="Касса" />
                                <form className="grid gap-3 md:grid-cols-4" onSubmit={handleExpense}>
                                    <Input type="number" step="0.01" placeholder={isAutoManagerPayout ? 'Сумма рассчитывается автоматически' : 'Сумма'} readOnly={isAutoManagerPayout} {...expenseForm.register('amount', { valueAsNumber: true })} />
                                    <Select className="min-w-0 max-w-full" {...expenseForm.register('method')}>
                                        <option value="CASH">Наличные</option>
                                        <option value="CARD">Безнал</option>
                                    </Select>
                                    <Select className="min-w-0 max-w-full" {...expenseForm.register('entryType')}>
                                        <option value="CASH_OUT">Расход</option>
                                        <option value="CASH_IN">Поступление</option>
                                        <option value="MANAGER_PAYOUT">Выплата менеджеру</option>
                                        <option value="ADJUSTMENT">Корректировка</option>
                                    </Select>
                                    <Select className="min-w-0 max-w-full" {...expenseForm.register('categoryId')} disabled={selectedExpenseEntryType !== 'CASH_OUT'}>
                                        <option value="">{selectedExpenseEntryType === 'CASH_OUT' ? (expenseCategories.length ? 'Без категории' : 'Категорий пока нет') : 'Категория недоступна'}</option>
                                        {expenseCategories.map((category) => (
                                            <option key={category.id} value={category.id}>{category.name}</option>
                                        ))}
                                    </Select>
                                    {isAutoManagerPayout ? (
                                        <p className="md:col-span-4 text-xs text-slate-500 dark:text-white/50">
                                            Выплата рассчитывается по ставке и проценту менеджера. К выплате сейчас: <span className="font-semibold text-light-text dark:text-white">{formatKgs(payoutSummary?.pending ?? 0)}</span>
                                        </p>
                                    ) : null}
                                    <TextArea rows={1} className="md:col-span-4" placeholder="Комментарий" {...expenseForm.register('note')} />
                                    <Button type="submit" className="md:col-span-4" disabled={isAutoManagerPayout && (payoutSummary?.pending ?? 0) <= 0}>
                                        Записать операцию
                                    </Button>
                                </form>
                                {data?.shift && (
                                    <div className="mt-6 space-y-3">
                                        <button
                                            type="button"
                                            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-left text-light-text transition hover:border-slate-300 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white dark:hover:border-white/30"
                                            aria-expanded={isCashLedgerOpen}
                                            aria-controls="cash-ledger-panel"
                                            onClick={() => setIsCashLedgerOpen((prev) => !prev)}
                                        >
                                            <div>
                                                <h3 className="text-sm font-semibold">Последние операции</h3>
                                                <p className="text-xs text-slate-500 dark:text-white/60">{shiftLedger.length} записей</p>
                                            </div>
                                            <span className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-white/20 dark:text-white/80">
                                                {isCashLedgerOpen ? 'Скрыть' : 'Показать'}
                                            </span>
                                        </button>
                                        {isCashLedgerOpen && (
                                            <div id="cash-ledger-panel" className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                                                {shiftLedger.length ? (
                                                    shiftLedger.map((entry) => {
                                                        const timestamp = formatDateTime(entry.recordedAt, hotelTz);
                                                        const signedAmount = ['CASH_IN', 'ADJUSTMENT'].includes(entry.entryType)
                                                            ? entry.amount
                                                            : -entry.amount;
                                                        const methodLabel = entry.method === 'CARD' ? 'б/н' : 'нал';
                                                        const entryLabel =
                                                            entry.entryType === 'CASH_IN'
                                                                ? 'Приход'
                                                                : entry.entryType === 'CASH_OUT'
                                                                    ? isCollectionLedgerEntry(entry)
                                                                        ? 'Инкассация'
                                                                        : 'Расход'
                                                                    : entry.entryType === 'MANAGER_PAYOUT'
                                                                        ? 'Выплата'
                                                                        : 'Корр.';
                                                        const amountClass = signedAmount >= 0
                                                            ? 'text-emerald-300'
                                                            : isCollectionLedgerEntry(entry)
                                                                ? 'text-cyan-300'
                                                                : 'text-rose-300';
                                                        const detailLabel = [entry.category?.name?.trim(), entry.note?.trim()].filter(Boolean).join(' · ');

                                                        return (
                                                            <div key={entry.id} className="flex items-center justify-between py-2 text-xs">
                                                                <div className="min-w-0">
                                                                    <span className="text-slate-500 dark:text-white/50">{timestamp}</span>
                                                                    <span className="ml-2 text-slate-500 dark:text-white/40">{entryLabel} · {methodLabel}</span>
                                                                    {detailLabel && <span className="ml-2 text-slate-600 dark:text-white/60">{detailLabel}</span>}
                                                                </div>
                                                                <span className={`font-semibold shrink-0 ml-3 ${amountClass}`}>{formatKgs(signedAmount)}</span>
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <p className="py-2 text-xs text-slate-500 dark:text-white/40">Нет операций.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </Card>
                        )}

                        {activePanel === 'history' && (
                            <Card>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <CardHeader title="История смен" />
                                    <Button type="button" size="sm" variant="ghost" onClick={() => refreshProfile()} disabled={isProfileLoading}>
                                        Обновить
                                    </Button>
                                </div>
                                {profileError && <p className="text-sm text-rose-600 dark:text-rose-300">Не удалось загрузить историю смен.</p>}
                                {isProfileLoading && !profileData && <p className="text-sm text-slate-600 dark:text-white/60">Загружаем историю...</p>}
                                <div className="grid gap-3 md:grid-cols-3">
                                    <Select
                                        value={historyStatus}
                                        onChange={(event) => setHistoryStatus(event.target.value as 'ALL' | 'OPEN' | 'CLOSED')}
                                    >
                                        <option value="ALL">Все смены</option>
                                        <option value="OPEN">Активные</option>
                                        <option value="CLOSED">Архив</option>
                                    </Select>
                                    <Input
                                        type="date"
                                        value={historyFromDate}
                                        onChange={(event) => setHistoryFromDate(event.target.value)}
                                    />
                                    <Input
                                        type="date"
                                        value={historyToDate}
                                        onChange={(event) => setHistoryToDate(event.target.value)}
                                    />
                                </div>
                                {selectedShift ? (
                                    <div className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-700 dark:bg-white/[0.04] dark:text-white/80">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-widest text-slate-500 dark:text-white/40">Смена №{selectedShift.number}</p>
                                                <p className="font-medium text-light-text dark:text-white">{formatDateTime(selectedShift.openedAt, hotelTz)}</p>
                                                {selectedShift.closedAt && (
                                                    <p className="text-xs text-slate-500 dark:text-white/50">Закрыта {formatDateTime(selectedShift.closedAt, hotelTz)}</p>
                                                )}
                                            </div>
                                            <Badge label={selectedShift.status === 'OPEN' ? 'Активная' : 'Архив'} tone={selectedShift.status === 'OPEN' ? 'warning' : 'success'} />
                                        </div>
                                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                            <span>Старт: {formatKgs(selectedShift.openingCash)}</span>
                                            <span>Факт: {selectedShift.closingCash != null ? formatKgs(selectedShift.closingCash) : '—'}</span>
                                            <span>Итог наличных: {selectedShift.handoverCash != null ? formatKgs(selectedShift.handoverCash) : '—'}</span>
                                        </div>
                                        <p className="mt-2 text-xs">
                                            Выплачено {formatKgs(selectedShift.payout.paid)} из {formatKgs(selectedShift.payout.expected)} • Осталось {formatKgs(selectedShift.payout.pending)}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="mt-4 text-sm text-slate-600 dark:text-white/60">Нет смен, подходящих под фильтр.</p>
                                )}
                                {filteredProfileShifts.length > 0 && (
                                    <div className="mt-4 max-h-[280px] space-y-2 overflow-y-auto pr-1">
                                        {filteredProfileShifts.map((shift) => (
                                            <button
                                                key={shift.id}
                                                type="button"
                                                onClick={() => setSelectedShiftId(shift.id)}
                                                className={`w-full rounded-xl border p-3 text-left text-sm transition ${selectedShift?.id === shift.id
                                                    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-300/80 dark:bg-amber-400/10 dark:text-amber-50'
                                                    : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-white/10 dark:text-white/70 dark:hover:border-white/30'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="font-semibold">№{shift.number}</span>
                                                    <span className="text-xs uppercase tracking-widest">{shift.status === 'OPEN' ? 'Активная' : 'Архив'}</span>
                                                </div>
                                                <p className="text-xs text-slate-500 dark:text-white/60">{formatDateTime(shift.openedAt, hotelTz)}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>

                    {isProfileOpen && (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 sm:p-4">
                            <div className="relative w-full max-w-3xl rounded-xl sm:rounded-2xl bg-ink p-3 sm:p-5 text-white shadow-2xl">
                                <button
                                    type="button"
                                    onClick={handleCloseProfile}
                                    className="absolute right-4 top-4 text-2xl text-white/60 transition hover:text-white focus:outline-none"
                                    aria-label="Закрыть профиль"
                                >
                                    ×
                                </button>
                                <div className="pr-10">
                                    <h2 className="text-base font-semibold text-white">{managerName}</h2>
                                    <p className="text-xs text-white/40">{primaryHotel.name}</p>
                                </div>
                                <div className="mt-4 space-y-4">
                                    {profileError && (
                                        <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">
                                            Не удалось загрузить профиль.
                                        </div>
                                    )}
                                    {isProfileLoading && !profileData && (
                                        <p className="text-sm text-white/60">Загружаем профиль…</p>
                                    )}
                                    {profileData && (
                                        <>
                                            <div className="rounded-xl bg-white/[0.04] p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-xs uppercase tracking-widest text-white/40">Назначение</p>
                                                        <p className="text-base font-semibold text-white">{primaryHotel.name}</p>
                                                    </div>
                                                    {profileData.assignment?.createdAt && (
                                                        <p className="text-xs text-white/60">
                                                            С {formatDateTime(profileData.assignment.createdAt, hotelTz)}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="mt-4 grid gap-3 text-sm text-white/80 sm:grid-cols-3">
                                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                                        <p className="text-xs uppercase tracking-widest text-white/40">Ставка</p>
                                                        <p className="text-base font-semibold text-white">
                                                            {profileData.assignment?.shiftPayAmount != null
                                                                ? formatKgs(profileData.assignment.shiftPayAmount)
                                                                : '—'}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                                        <p className="text-xs uppercase tracking-widest text-white/40">Процент</p>
                                                        <p className="text-base font-semibold text-white">
                                                            {profileData.assignment?.revenueSharePct != null
                                                                ? `${profileData.assignment.revenueSharePct}%`
                                                                : '—'}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                                        <p className="text-xs uppercase tracking-widest text-white/40">PIN</p>
                                                        <p className="text-base font-semibold text-white">
                                                            {profileData.assignment?.pinCode ?? '—'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <h3 className="text-sm font-semibold uppercase tracking-widest text-white/60">
                                                        История смен
                                                    </h3>
                                                    <div className="flex gap-2">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => refreshProfile()}
                                                            disabled={isProfileLoading}
                                                        >
                                                            Обновить
                                                        </Button>
                                                        {data?.shift && (
                                                            <Button type="button" size="sm" variant="secondary" onClick={() => handleProfileCloseShift()}>
                                                                Закрыть смену
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="grid gap-3 md:grid-cols-3">
                                                    <div className="space-y-1">
                                                        <label className="text-xs uppercase tracking-widest text-white/40">Статус</label>
                                                        <Select
                                                            className="bg-ink text-white"
                                                            value={historyStatus}
                                                            onChange={(event) => setHistoryStatus(event.target.value as 'ALL' | 'OPEN' | 'CLOSED')}
                                                        >
                                                            <option value="ALL">Все смены</option>
                                                            <option value="OPEN">Активные</option>
                                                            <option value="CLOSED">Архив</option>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs uppercase tracking-widest text-white/40">С даты</label>
                                                        <Input
                                                            type="date"
                                                            value={historyFromDate}
                                                            onChange={(event) => setHistoryFromDate(event.target.value)}
                                                            className=" text-white"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs uppercase tracking-widest text-white/40">До даты</label>
                                                        <Input
                                                            type="date"
                                                            value={historyToDate}
                                                            onChange={(event) => setHistoryToDate(event.target.value)}
                                                            className=" text-white"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs uppercase tracking-widest text-white/40">Выберите смену</label>
                                                    <Select
                                                        className="bg-ink text-white"
                                                        value={selectedShiftId}
                                                        onChange={(event) => setSelectedShiftId(event.target.value)}
                                                        disabled={!filteredProfileShifts.length}
                                                    >
                                                        <option value="">
                                                            {filteredProfileShifts.length ? 'Выберите смену' : 'Нет смен под выбранные фильтры'}
                                                        </option>
                                                        {filteredProfileShifts.map((shift) => (
                                                            <option key={shift.id} value={shift.id}>
                                                                {shift.status === 'OPEN' ? 'Активная' : 'Архив'} №{shift.number} • {formatDateTime(shift.openedAt, hotelTz)}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                </div>
                                                {selectedShift ? (
                                                    <div className="rounded-xl bg-white/[0.04] p-4 text-sm text-white/80">
                                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                                            <div>
                                                                <p className="text-xs uppercase tracking-widest text-white/40">
                                                                    Смена №{selectedShift.number}
                                                                </p>
                                                                <p>{formatDateTime(selectedShift.openedAt, hotelTz)}</p>
                                                                {selectedShift.closedAt && (
                                                                    <p className="text-xs text-white/50">
                                                                        Закрыта {formatDateTime(selectedShift.closedAt, hotelTz)}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <span
                                                                className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedShift.status === 'OPEN'
                                                                    ? 'bg-amber-400/20 text-amber-200'
                                                                    : 'bg-emerald-400/10 text-emerald-200'
                                                                    }`}
                                                            >
                                                                {selectedShift.status === 'OPEN' ? 'Активная' : 'Архив'}
                                                            </span>
                                                        </div>
                                                        <div className="mt-3 grid gap-2 text-xs text-white/60 sm:grid-cols-3">
                                                            <span>Старт: {formatKgs(selectedShift.openingCash)}</span>
                                                            <span>Факт: {selectedShift.closingCash != null ? formatKgs(selectedShift.closingCash) : '—'}</span>
                                                            <span>Итог наличных: {selectedShift.handoverCash != null ? formatKgs(selectedShift.handoverCash) : '—'}</span>
                                                        </div>
                                                        <p className="mt-2 text-xs text-white/70">
                                                            Выплачено {formatKgs(selectedShift.payout.paid)} из {formatKgs(selectedShift.payout.expected)} • Осталось {formatKgs(selectedShift.payout.pending)}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-white/60">Нет смен, подходящих под фильтр.</p>
                                                )}
                                                {filteredProfileShifts.length > 1 && (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between text-xs uppercase tracking-widest text-white/40">
                                                            <span>Список смен</span>
                                                            <span className="text-white/60">{filteredProfileShifts.length}</span>
                                                        </div>
                                                        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                                                            {filteredProfileShifts.map((shift) => (
                                                                <button
                                                                    key={shift.id}
                                                                    type="button"
                                                                    onClick={() => setSelectedShiftId(shift.id)}
                                                                    className={`w-full rounded-2xl border p-3 text-left text-sm transition ${selectedShiftId === shift.id
                                                                        ? 'border-amber-300/80 bg-amber-400/10 text-amber-50'
                                                                        : 'border-white/10 text-white/70 hover:border-white/30'
                                                                        }`}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="font-semibold">№{shift.number}</span>
                                                                        <span className="text-xs uppercase tracking-widest">
                                                                            {shift.status === 'OPEN' ? 'Активная' : 'Архив'}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs text-white/60">{formatDateTime(shift.openedAt, hotelTz)}</p>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {groupCheckIn && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4">
                            <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-ink p-3 text-white shadow-2xl sm:rounded-2xl sm:p-5">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Группа</p>
                                        <h3 className="mt-1 text-base font-semibold">{groupCheckIn.mode === 'edit' ? 'Редактировать группу' : 'Групповой заезд'}</h3>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" disabled={isSubmittingGroupCheckIn} onClick={() => setGroupCheckIn(null)}>
                                        ×
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {groupCheckIn.mode !== 'edit' ? (
                                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-1">
                                        <button
                                            type="button"
                                            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition ${groupCheckIn.mode === 'checkin' ? 'bg-white text-slate-950 shadow-sm' : 'text-white/65 hover:bg-white/[0.06] hover:text-white'}`}
                                            onClick={() => setGroupCheckIn((prev) => {
                                                if (!prev) return prev;
                                                const availableIds = new Set(availableGroupRooms.map((room) => room.id));
                                                return {
                                                    ...prev,
                                                    mode: 'checkin',
                                                    roomIds: prev.roomIds.filter((id) => availableIds.has(id)),
                                                };
                                            })}
                                        >
                                            <Users className="h-4 w-4" aria-hidden="true" />
                                            Заезд
                                        </button>
                                        <button
                                            type="button"
                                            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition ${groupCheckIn.mode === 'booking' ? 'bg-white text-slate-950 shadow-sm' : 'text-white/65 hover:bg-white/[0.06] hover:text-white'}`}
                                            onClick={() => setGroupCheckIn((prev) => prev ? { ...prev, mode: 'booking' } : prev)}
                                        >
                                            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                            Бронь
                                        </button>
                                    </div>
                                    ) : null}

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <div className="sm:col-span-2">
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-guest-name">Название группы</label>
                                            <Input
                                                id="group-guest-name"
                                                value={groupCheckIn.guestName}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, guestName: event.target.value } : prev)}
                                                placeholder="Футбольная команда"
                                                className="text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-guest-count">Гостей</label>
                                            <Input
                                                id="group-guest-count"
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={groupCheckIn.guestCount}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, guestCount: event.target.value } : prev)}
                                                placeholder="13"
                                                className="text-white"
                                            />
                                        </div>
                                    </div>

                                    {data?.hotel.usesExtranets && (data.hotel.extranetNames?.length ?? 0) > 0 && (
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-booking-source">Источник брони</label>
                                            <Select
                                                id="group-booking-source"
                                                value={groupCheckIn.bookingSource}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, bookingSource: event.target.value } : prev)}
                                                className="text-white"
                                            >
                                                <option value="">Без экстранета / прямой заезд</option>
                                                {(data.hotel.extranetNames ?? []).map((name) => (
                                                    <option key={`group-booking-source-${name}`} value={name}>{name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-booking-number">Номер брони</label>
                                            <Input
                                                id="group-booking-number"
                                                value={groupCheckIn.bookingNumber}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, bookingNumber: event.target.value } : prev)}
                                                placeholder="Booking #"
                                                className="text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-tariff">Общая сумма тарифа</label>
                                            <Input
                                                id="group-tariff"
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                inputMode="decimal"
                                                value={groupCheckIn.tariffAmount}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, tariffAmount: event.target.value } : prev)}
                                                placeholder="150000"
                                                className="text-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-checkin">Заезд</label>
                                            <Input
                                                id="group-checkin"
                                                type="datetime-local"
                                                value={groupCheckIn.checkIn}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, checkIn: event.target.value } : prev)}
                                                className="text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-checkout">Выезд</label>
                                            <Input
                                                id="group-checkout"
                                                type="datetime-local"
                                                value={groupCheckIn.checkOut}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, checkOut: event.target.value } : prev)}
                                                className="text-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-total">{groupCheckIn.mode === 'checkin' ? 'Общая сумма' : 'Общая предоплата'}</label>
                                            <Input
                                                id="group-total"
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                inputMode="decimal"
                                                value={groupCheckIn.totalAmount}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, totalAmount: event.target.value } : prev)}
                                                placeholder="120000"
                                                className="text-white"
                                            />
                                        </div>
                                        <div>
                                             <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-payment-mode">{groupCheckIn.mode === 'checkin' ? 'Оплата' : 'Способ предоплаты'}</label>
                                            <Select
                                                id="group-payment-mode"
                                                value={groupCheckIn.paymentMode}
                                                onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, paymentMode: event.target.value as GroupCheckInState['paymentMode'] } : prev)}
                                                className="text-white"
                                            >
                                                <option value="PENDING_TRANSFER">Перевод ожидается</option>
                                                <option value="CARD">Перевод уже пришёл</option>
                                                <option value="CASH">Наличными</option>
                                            </Select>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <label className="text-[11px] text-white/40">Номера</label>
                                            <span className="text-[11px] text-white/35">{selectedGroupRooms.length} выбрано · {groupPerRoomMinor ? `${formatKgs(groupPerRoomMinor)} / номер` : groupCheckIn.mode === 'booking' ? 'без предоплаты' : 'сумма не указана'}</span>
                                        </div>
                                        <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                                            {groupSelectableRooms.map((room) => {
                                                const checked = groupCheckIn.roomIds.includes(room.id);
                                                return (
                                                    <label
                                                        key={`group-room-${room.id}`}
                                                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${checked ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100' : 'border-white/[0.08] bg-white/[0.04] text-white/75 hover:bg-white/[0.07]'}`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleGroupRoom(room.id)}
                                                            disabled={groupCheckIn.mode === 'edit'}
                                                            className="accent-emerald-500"
                                                        />
                                                        <span className="min-w-0 truncate">№ {room.label}</span>
                                                        {groupCheckIn.mode === 'booking' && room.status !== 'AVAILABLE' ? (
                                                            <span className="ml-auto shrink-0 text-[10px] text-white/35">занят</span>
                                                        ) : null}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <p className="mb-2 text-[11px] text-white/40">Питание</p>
                                        <div className="flex flex-wrap gap-2">
                                            {MEAL_PLAN_OPTIONS.map((option) => {
                                                const checked = groupCheckIn.mealPlan.includes(option.value);
                                                return (
                                                    <label
                                                        key={`group-meal-${option.value}`}
                                                        className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${checked ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100' : 'border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]'}`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleGroupMealPlan(option.value)}
                                                            className="accent-emerald-500"
                                                        />
                                                        {option.label}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-[11px] text-white/40" htmlFor="group-notes">Комментарий</label>
                                        <TextArea
                                            id="group-notes"
                                            rows={2}
                                            value={groupCheckIn.notes}
                                            onChange={(event) => setGroupCheckIn((prev) => prev ? { ...prev, notes: event.target.value } : prev)}
                                            placeholder="Например: оплата банковским переводом позже"
                                            className="text-white"
                                        />
                                    </div>

                                    {groupCheckIn.mode === 'edit' ? (
                                        <p className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                                            Состав номеров группы зафиксирован. Здесь меняются общие даты, тариф, предоплата и данные брони.
                                        </p>
                                    ) : null}

                                    {groupCheckIn.paymentMode === 'PENDING_TRANSFER' && groupCheckIn.mode === 'checkin' ? (
                                        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                                            Сумма будет распределена по выбранным номерам и останется в ожидании. Когда перевод придёт, подтвердите его одной кнопкой в списке номеров.
                                        </p>
                                    ) : null}

                                    {groupCheckInError && <p className="text-xs text-rose-300">{groupCheckInError}</p>}

                                    <Button type="button" className="w-full py-3" disabled={isSubmittingGroupCheckIn} onClick={handleGroupCheckIn}>
                                        {isSubmittingGroupCheckIn ? 'Сохраняем...' : groupCheckIn.mode === 'edit' ? 'Сохранить группу' : groupCheckIn.mode === 'booking' ? 'Создать групповую бронь' : 'Создать групповой заезд'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {confirmTransfers && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
                            <Card className="w-full max-w-md space-y-4 border-white/[0.08] bg-ink p-5 text-white shadow-2xl dark:bg-ink">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Перевод</p>
                                        <h3 className="mt-1 text-lg font-semibold">Подтвердить поступление</h3>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" disabled={isConfirmingTransfers} onClick={() => setConfirmTransfers(null)}>
                                        ×
                                    </Button>
                                </div>
                                <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/75">
                                    <p>Номеров: <span className="font-semibold text-white">{pendingTransferRooms.length}</span></p>
                                    <p className="mt-1">Сумма: <span className="font-semibold text-white">{formatKgs(pendingTransferTotal)}</span></p>
                                    <p className="mt-2 text-xs text-white/45">
                                        После подтверждения сумма попадёт в безналичную кассу текущей смены.
                                    </p>
                                </div>
                                <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-white/55">
                                    {pendingTransferRooms.map((room) => (
                                        <div key={`pending-transfer-${room.id}`} className="flex items-center justify-between rounded-lg bg-white/[0.035] px-3 py-2">
                                            <span>№ {room.label}</span>
                                            <span>{formatKgs(room.stay?.onlinePaid ?? 0)}</span>
                                        </div>
                                    ))}
                                </div>
                                {confirmTransfersError && <p className="text-xs text-rose-300">{confirmTransfersError}</p>}
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <Button type="button" variant="secondary" disabled={isConfirmingTransfers} onClick={() => setConfirmTransfers(null)}>
                                        Отмена
                                    </Button>
                                    <Button type="button" disabled={isConfirmingTransfers} onClick={handleConfirmTransfers}>
                                        {isConfirmingTransfers ? 'Подтверждаем...' : 'Подтвердить все'}
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                    {checkInModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4">
                            <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-xl bg-ink p-3 text-white shadow-2xl sm:rounded-2xl sm:p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-base font-semibold">
                                        {checkInModal.mode === 'book'
                                            ? `Бронь № ${checkInModal.label}`
                                            : checkInModal.mode === 'extend'
                                                ? `Продление № ${checkInModal.label}`
                                                : checkInModal.mode === 'transfer'
                                                    ? `Переселение из № ${checkInModal.label}`
                                                    : checkInModal.mode === 'edit'
                                                        ? `Редактировать № ${checkInModal.label}`
                                                        : `Заселение № ${checkInModal.label}`}
                                    </h3>
                                    <Button type="button" variant="ghost" size="sm" disabled={isSubmittingCheckIn} onClick={handleCloseModal}>
                                        ×
                                    </Button>
                                </div>
                                <div className="space-y-2.5">
                                    <div>
                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-guest">Имя гостя</label>
                                        <Input
                                            id="modal-guest"
                                            type="text"
                                            autoFocus={isStayDataModalMode}
                                            placeholder="Имя гостя"
                                            value={checkInModal.guestName}
                                            onChange={(event) =>
                                                setCheckInModal((prev) => (prev ? { ...prev, guestName: event.target.value } : prev))
                                            }
                                            className="text-white"
                                            readOnly={!isStayDataModalMode}
                                        />
                                    </div>
                                    {isStayDataModalMode && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-guest-phone">Телефон</label>
                                                <Input
                                                    id="modal-guest-phone"
                                                    type="text"
                                                    placeholder="Телефон"
                                                    value={checkInModal.guestPhone}
                                                    onChange={(event) =>
                                                        setCheckInModal((prev) => (prev ? { ...prev, guestPhone: event.target.value } : prev))
                                                    }
                                                    className="text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-company-name">Компания</label>
                                                <Input
                                                    id="modal-company-name"
                                                    type="text"
                                                    placeholder="Компания"
                                                    value={checkInModal.companyName}
                                                    onChange={(event) =>
                                                        setCheckInModal((prev) => (prev ? { ...prev, companyName: event.target.value } : prev))
                                                    }
                                                    className="text-white"
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {checkInModal.mode === 'transfer' && (
                                        <>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[11px] text-white/40 mb-1 block">Текущий номер</label>
                                                    <Input value={`№ ${checkInModal.label}`} className="text-white" readOnly />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-transfer-room">Новая комната</label>
                                                    <Select
                                                        id="modal-transfer-room"
                                                        value={checkInModal.targetRoomId}
                                                        onChange={(event) =>
                                                            setCheckInModal((prev) => (prev ? { ...prev, targetRoomId: event.target.value } : prev))
                                                        }
                                                        className="text-white"
                                                    >
                                                        <option value="">Выберите свободную комнату</option>
                                                        {availableTransferRooms.map((room) => (
                                                            <option key={`transfer-room-${room.id}`} value={room.id}>{`№ ${room.label}`}</option>
                                                        ))}
                                                    </Select>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-transfer-note">Комментарий</label>
                                                <TextArea
                                                    id="modal-transfer-note"
                                                    rows={3}
                                                    placeholder="Причина переселения"
                                                    value={checkInModal.transferNote}
                                                    onChange={(event) =>
                                                        setCheckInModal((prev) => (prev ? { ...prev, transferNote: event.target.value } : prev))
                                                    }
                                                    className="text-white"
                                                />
                                            </div>
                                            {checkInModal.currentCheckOut && (
                                                <p className="text-[11px] text-white/45">Оплата и плановый выезд сохраняются. Текущий выезд: {checkInModal.currentCheckOut}</p>
                                            )}
                                        </>
                                    )}
                                    {checkInModal.mode !== 'transfer' && (
                                        <>
                                            {isStayDataModalMode && data?.hotel.usesExtranets && (data.hotel.extranetNames?.length ?? 0) > 0 && (
                                                <div>
                                                    <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-booking-source">Источник брони</label>
                                                    <Select
                                                        id="modal-booking-source"
                                                        value={checkInModal.bookingSource}
                                                        onChange={(event) =>
                                                            setCheckInModal((prev) => (prev ? { ...prev, bookingSource: event.target.value } : prev))
                                                        }
                                                        className="text-white"
                                                    >
                                                        <option value="">Без экстранета / прямой заезд</option>
                                                        {(data.hotel.extranetNames ?? []).map((name) => (
                                                            <option key={`modal-booking-source-${name}`} value={name}>{name}</option>
                                                        ))}
                                                    </Select>
                                                </div>
                                            )}
                                            {isStayDataModalMode && (
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-booking-number">Номер брони</label>
                                                        <Input
                                                            id="modal-booking-number"
                                                            type="text"
                                                            value={checkInModal.bookingNumber}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) => (prev ? { ...prev, bookingNumber: event.target.value } : prev))
                                                            }
                                                            placeholder="Booking #"
                                                            className="text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-total-amount">Общая сумма тарифа</label>
                                                        <Input
                                                            id="modal-total-amount"
                                                            type="number"
                                                            step="0.01"
                                                            inputMode="decimal"
                                                            min="0"
                                                            value={checkInModal.totalAmount}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) => (prev ? { ...prev, totalAmount: event.target.value } : prev))
                                                            }
                                                            placeholder="150000"
                                                            className="text-white"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            {isStayDataModalMode && (
                                                <div>
                                                    <p className="mb-2 text-[11px] text-white/40">Питание</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {MEAL_PLAN_OPTIONS.map((option) => {
                                                            const checked = checkInModal.mealPlan.includes(option.value);
                                                            return (
                                                                <label
                                                                    key={`modal-meal-${option.value}`}
                                                                    className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${checked ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100' : 'border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]'}`}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        onChange={() => toggleCheckInMealPlan(option.value)}
                                                                        className="accent-emerald-500"
                                                                    />
                                                                    {option.label}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {isStayDataModalMode && (
                                                <div>
                                                    <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-stay-notes">Комментарий</label>
                                                    <TextArea
                                                        id="modal-stay-notes"
                                                        rows={2}
                                                        placeholder="Комментарий к брони или гостю"
                                                        value={checkInModal.notes}
                                                        onChange={(event) =>
                                                            setCheckInModal((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                                                        }
                                                        className="text-white"
                                                    />
                                                </div>
                                            )}
                                            {isStayDataModalMode ? (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-checkin">Заезд</label>
                                                        <Input
                                                            id="modal-checkin"
                                                            type="datetime-local"
                                                            value={checkInModal.checkIn}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) => (prev ? { ...prev, checkIn: event.target.value } : prev))
                                                            }
                                                            className="text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-checkout">Выезд</label>
                                                        <Input
                                                            id="modal-checkout"
                                                            type="datetime-local"
                                                            value={checkInModal.checkOut}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) => (prev ? { ...prev, checkOut: event.target.value } : prev))
                                                            }
                                                            className="text-white"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-current-checkout">Текущий выезд</label>
                                                        <Input
                                                            id="modal-current-checkout"
                                                            type="datetime-local"
                                                            value={checkInModal.currentCheckOut ?? checkInModal.checkOut}
                                                            className="text-white"
                                                            readOnly
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-next-checkout">Новый выезд</label>
                                                        <Input
                                                            id="modal-next-checkout"
                                                            type="datetime-local"
                                                            value={checkInModal.checkOut}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) => (prev ? { ...prev, checkOut: event.target.value } : prev))
                                                            }
                                                            className="text-white"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            {checkInModal.mode === 'book' && (
                                                <p className="text-[11px] text-white/45">Предоплату можно оставить нулевой. Для наличной или безналичной предоплаты нужна открытая смена.</p>
                                            )}
                                            {checkInModal.mode === 'checkin' && checkInModal.existingPaid > 0 && (
                                                <p className="text-[11px] text-emerald-200/80">Учтена предоплата: {formatKgs(checkInModal.existingPaid)}. Здесь можно указать только доплату.</p>
                                            )}
                                            {checkInModal.mode === 'extend' && (
                                                <p className="text-[11px] text-white/45">Укажите новый выезд позже текущего. Доплату можно оставить нулевой, если продление без оплаты.</p>
                                            )}
                                            {showPaymentInputsInModal ? (
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-cash">{checkInModal.mode === 'book' ? 'Предоплата нал' : checkInModal.mode === 'extend' ? 'Доплата нал' : 'Наличные'}</label>
                                                        <Input
                                                            id="modal-cash"
                                                            type="number"
                                                            step="0.01"
                                                            inputMode="decimal"
                                                            value={checkInModal.cashAmount}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) =>
                                                                    prev ? { ...prev, cashAmount: event.target.value } : prev
                                                                )
                                                            }
                                                            placeholder="0"
                                                            className="text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-card">{checkInModal.mode === 'book' ? 'Предоплата б/н' : checkInModal.mode === 'extend' ? 'Доплата безнал' : 'Безнал'}</label>
                                                        <Input
                                                            id="modal-card"
                                                            type="number"
                                                            step="0.01"
                                                            inputMode="decimal"
                                                            value={checkInModal.cardAmount}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) =>
                                                                    prev ? { ...prev, cardAmount: event.target.value } : prev
                                                                )
                                                            }
                                                            placeholder="0"
                                                            className="text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-online">{checkInModal.mode === 'book' ? 'Предоплата сайт' : checkInModal.mode === 'extend' ? 'Доплата сайт' : 'На сайте'}</label>
                                                        <Input
                                                            id="modal-online"
                                                            type="number"
                                                            step="0.01"
                                                            inputMode="decimal"
                                                            value={checkInModal.onlineAmount}
                                                            onChange={(event) =>
                                                                setCheckInModal((prev) =>
                                                                    prev ? { ...prev, onlineAmount: event.target.value } : prev
                                                                )
                                                            }
                                                            placeholder="0"
                                                            className="text-white"
                                                        />
                                                    </div>
                                                </div>
                                            ) : null}
                                        </>
                                    )}
                                    {checkInError && <p className="text-xs text-rose-300">{checkInError}</p>}
                                    <Button
                                        type="button"
                                        className="w-full py-3 mt-1"
                                        disabled={isSubmittingCheckIn}
                                        onClick={handleConfirmCheckIn}
                                    >
                                        {isSubmittingCheckIn ? 'Сохраняем...' : checkInModal.mode === 'book' ? 'Поставить бронь' : checkInModal.mode === 'extend' ? 'Продлить' : checkInModal.mode === 'transfer' ? 'Переселить' : checkInModal.mode === 'edit' ? 'Сохранить' : 'Заселить'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )
                    }

                    {boardListPopup && (() => {
                        const isFreeDatesPopup = boardListPopup === 'freeDates';
                        const stayItems = boardListPopup === 'scheduled'
                            ? boardScheduledItems
                            : boardListPopup === 'checkedIn'
                                ? boardCheckedInItems
                                : boardOverdueItems;
                        const title = boardListPopup === 'scheduled'
                            ? 'Брони'
                            : boardListPopup === 'checkedIn'
                                ? 'Заселённые'
                                : boardListPopup === 'overdue'
                                    ? 'Просрочено'
                                    : 'Свободные даты';
                        const count = isFreeDatesPopup ? boardFreeDateItems.length : stayItems.length;
                        const periodLabel = `${formatBoardDay(roomBoardRange.start)} - ${formatBoardDay(addDays(roomBoardRange.end, -1))}`;

                        return (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm">
                                <Card className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden border-white/[0.08] bg-ink p-0 text-white shadow-2xl dark:bg-ink">
                                    <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-5">
                                        <div className="min-w-0">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Шахматка · {periodLabel}</p>
                                            <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                                            <p className="mt-1 text-xs text-white/45">{count} записей</p>
                                        </div>
                                        <Button type="button" variant="ghost" size="sm" onClick={() => setBoardListPopup(null)}>
                                            ×
                                        </Button>
                                    </div>

                                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                                        {isFreeDatesPopup ? (
                                            boardFreeDateItems.length ? (
                                                <div className="space-y-2">
                                                    {boardFreeDateItems.map((item) => {
                                                        const lastFreeDay = addDays(item.endDate, -1);
                                                        const rangeLabel = item.startIndex + 1 === item.endIndex
                                                            ? formatBoardDay(item.startDate)
                                                            : `${formatBoardDay(item.startDate)} - ${formatBoardDay(lastFreeDay)}`;

                                                        return (
                                                            <button
                                                                key={`free-${item.room.id}-${item.startIndex}-${item.endIndex}`}
                                                                type="button"
                                                                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
                                                                onClick={() => {
                                                                    setBoardListPopup(null);
                                                                    handleBoardCellClick(item.room, item.startDate);
                                                                }}
                                                            >
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-sm font-semibold">№ {item.room.label}</p>
                                                                        {item.room.floor ? <p className="mt-0.5 truncate text-[11px] text-white/40">{item.room.floor}</p> : null}
                                                                    </div>
                                                                    <p className="shrink-0 text-xs font-semibold text-cyan-100">{rangeLabel}</p>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="py-8 text-center text-sm text-white/45">Свободных интервалов в этом периоде нет.</p>
                                            )
                                        ) : stayItems.length ? (
                                            <div className="space-y-2">
                                                {stayItems.map((item) => (
                                                    <button
                                                        key={`board-list-${item.room.id}-${item.stay.id}`}
                                                        type="button"
                                                        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.07]"
                                                        onClick={() => {
                                                            setBoardListPopup(null);
                                                            if (item.stay.status === 'SCHEDULED') {
                                                                showBookingDetails(item.room, item.stay);
                                                            } else {
                                                                showExtendModal(item.room);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-semibold">№ {item.room.label} · {item.guestLabel}</p>
                                                                <p className="mt-1 truncate text-xs text-white/55">{item.detailLabel || stayStatusLabel(item.stay.status)}</p>
                                                            </div>
                                                            <Badge label={item.isOverdue ? 'Просрочено' : stayStatusLabel(item.stay.status)} tone={item.isOverdue ? 'danger' : item.stay.status === 'CHECKED_IN' ? 'warning' : 'default'} />
                                                        </div>
                                                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/45">
                                                            <span>Заезд: <span className="text-white/75">{formatDateTime(item.stay.scheduledCheckIn, hotelTz)}</span></span>
                                                            <span>Выезд: <span className="text-white/75">{formatDateTime(item.stay.scheduledCheckOut, hotelTz)}</span></span>
                                                        </div>
                                                        {item.stay.totalAmount != null ? (
                                                            <p className="mt-1 text-[11px] text-cyan-100/80">Тариф: {formatKgs(item.stay.totalAmount)} · оплачено {formatKgs(item.stay.amountPaid ?? 0)}</p>
                                                        ) : (item.stay.amountPaid ?? 0) > 0 ? (
                                                            <p className="mt-1 text-[11px] text-emerald-200/80">Оплата: {formatKgs(item.stay.amountPaid)}</p>
                                                        ) : null}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="py-8 text-center text-sm text-white/45">Записей в этом периоде нет.</p>
                                        )}
                                    </div>
                                </Card>
                            </div>
                        );
                    })()}

                    {boardDayAction && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-4 backdrop-blur-sm">
                            <Card className="w-full max-w-xs space-y-4 border-white/[0.08] bg-ink p-4 text-white shadow-2xl dark:bg-ink">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Сегодня</p>
                                        <h3 className="mt-1 text-lg font-semibold">№ {boardDayAction.room.label}</h3>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setBoardDayAction(null)}>
                                        ×
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    <Button
                                        type="button"
                                        className="w-full"
                                        disabled={!hasOpenShift || boardDayAction.room.status !== 'AVAILABLE'}
                                        onClick={() => {
                                            const room = boardDayAction.room;
                                            setBoardDayAction(null);
                                            showCheckInModal(room);
                                        }}
                                    >
                                        Заселить сейчас
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="w-full"
                                        onClick={() => {
                                            const { room, selectedDay } = boardDayAction;
                                            setBoardDayAction(null);
                                            showBookingModal(room, selectedDay);
                                        }}
                                    >
                                        Поставить бронь
                                    </Button>
                                </div>
                                {!hasOpenShift ? (
                                    <p className="text-center text-[11px] text-white/40">Для заселения сначала откройте смену.</p>
                                ) : null}
                            </Card>
                        </div>
                    )}

                    {bookingDetails && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm">
                            <Card className="w-full max-w-sm space-y-4 border-white/[0.08] bg-ink p-4 text-white shadow-2xl dark:bg-ink sm:p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Бронь</p>
                                        <h3 className="mt-1 text-lg font-semibold">№ {bookingDetails.roomLabel}</h3>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setBookingDetails(null)}>
                                        ×
                                    </Button>
                                </div>

                                <div className="space-y-2 text-sm">
                                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Гость</p>
                                        <p className="mt-1 font-semibold">{bookingDetails.stay.guestName?.trim() || 'Имя не указано'}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Заезд</p>
                                            <p className="mt-1 text-xs font-medium text-white/80">{formatDateTime(bookingDetails.stay.scheduledCheckIn, hotelTz)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Выезд</p>
                                            <p className="mt-1 text-xs font-medium text-white/80">{formatDateTime(bookingDetails.stay.scheduledCheckOut, hotelTz)}</p>
                                        </div>
                                    </div>
                                    {(bookingDetails.stay.guestPhone || bookingDetails.stay.companyName || bookingDetails.stay.bookingSource || bookingDetails.stay.bookingNumber) && (
                                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-white/75">
                                            {bookingDetails.stay.guestPhone ? <p>Телефон: <span className="text-white">{bookingDetails.stay.guestPhone}</span></p> : null}
                                            {bookingDetails.stay.companyName ? <p>Компания: <span className="text-white">{bookingDetails.stay.companyName}</span></p> : null}
                                            {bookingDetails.stay.bookingSource ? <p>Источник: <span className="text-white">{bookingDetails.stay.bookingSource}</span></p> : null}
                                            {bookingDetails.stay.bookingNumber ? <p>Номер брони: <span className="text-white">{bookingDetails.stay.bookingNumber}</span></p> : null}
                                        </div>
                                    )}
                                    {bookingDetails.stay.totalAmount != null ? (
                                        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/55">Тариф</p>
                                            <p className="mt-1 text-sm font-semibold text-cyan-100">{formatKgs(bookingDetails.stay.totalAmount)}</p>
                                            <p className="mt-0.5 text-xs text-cyan-100/65">Оплачено {formatKgs(bookingDetails.stay.amountPaid ?? 0)} · остаток {formatKgs(Math.max(bookingDetails.stay.totalAmount - (bookingDetails.stay.amountPaid ?? 0), 0))}</p>
                                        </div>
                                    ) : (bookingDetails.stay.amountPaid ?? 0) > 0 ? (
                                        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/55">Предоплата</p>
                                            <p className="mt-1 text-sm font-semibold text-emerald-100">{formatKgs(bookingDetails.stay.amountPaid)}</p>
                                        </div>
                                    ) : null}
                                    {mealPlanLabels(bookingDetails.stay.mealPlan).length ? (
                                        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/55">Питание</p>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {mealPlanLabels(bookingDetails.stay.mealPlan).map((label) => (
                                                    <span key={`booking-meal-${label}`} className="rounded-full bg-emerald-300/15 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                                                        {label}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                    {bookingDetails.stay.notes?.trim() ? (
                                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Комментарий</p>
                                            <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">{bookingDetails.stay.notes.trim()}</p>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="secondary"
                                        disabled={!canEditStayPayments}
                                        onClick={bookingDetails.stay.groupRef ? showEditGroupBookingDetails : showEditBookingDetails}
                                        title={bookingDetails.stay.groupRef ? 'Редактировать группу' : 'Редактировать бронь'}
                                        aria-label={bookingDetails.stay.groupRef ? 'Редактировать группу' : 'Редактировать бронь'}
                                    >
                                        <Pencil className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="secondary"
                                        disabled={!canEditStayPayments}
                                        onClick={showBookingPaymentAdjust}
                                        title="Изменить предоплату"
                                        aria-label="Изменить предоплату"
                                    >
                                        <Banknote className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        disabled={!hasOpenShift || isCancellingBooking || !canCheckInScheduledStay(bookingDetails.stay)}
                                        onClick={() => showScheduledCheckInModal(bookingDetails)}
                                        title="Заселить по брони"
                                        aria-label="Заселить по брони"
                                    >
                                        <LogIn className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="danger"
                                        disabled={isCancellingBooking || !canEditStayPayments}
                                        onClick={handleCancelBooking}
                                        title="Отменить бронь"
                                        aria-label="Отменить бронь"
                                    >
                                        {isCancellingBooking ? '...' : '×'}
                                    </Button>
                                </div>
                                {!canEditStayPayments ? (
                                    <p className="text-center text-[11px] text-white/40">Отмена доступна только менеджеру с правом исправлений.</p>
                                ) : null}
                                {!canCheckInScheduledStay(bookingDetails.stay) ? (
                                    <p className="text-center text-[11px] text-white/40">Заселение будет доступно в день заезда.</p>
                                ) : null}
                                {!hasOpenShift ? (
                                    <p className="text-center text-[11px] text-white/40">Для заселения сначала откройте смену.</p>
                                ) : null}
                                {hasOpenShift && boardDayAction?.room.status === 'DIRTY' ? (
                                    <p className="text-center text-[11px] text-white/40">Сначала отметьте номер убранным.</p>
                                ) : null}
                            </Card>
                        </div>
                    )}

                    {paymentAdjust && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm">
                            <Card className="w-full max-w-sm space-y-4 border-white/[0.08] bg-ink p-4 text-white shadow-2xl dark:bg-ink sm:p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Исправить оплату</p>
                                        <h3 className="mt-1 text-lg font-semibold">№ {paymentAdjust.roomLabel}</h3>
                                        <p className="mt-1 truncate text-xs text-white/45">{paymentAdjust.guestName}</p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setPaymentAdjust(null);
                                            setPaymentAdjustError(null);
                                        }}
                                    >
                                        ×
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-[11px] text-white/40" htmlFor="payment-adjust-cash">Наличные</label>
                                        <Input
                                            id="payment-adjust-cash"
                                            type="number"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={paymentAdjust.cashAmount}
                                            onChange={(event) =>
                                                setPaymentAdjust((prev) =>
                                                    prev ? { ...prev, cashAmount: event.target.value } : prev
                                                )
                                            }
                                            placeholder="0"
                                            className="text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[11px] text-white/40" htmlFor="payment-adjust-card">Безнал</label>
                                        <Input
                                            id="payment-adjust-card"
                                            type="number"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={paymentAdjust.cardAmount}
                                            onChange={(event) =>
                                                setPaymentAdjust((prev) =>
                                                    prev ? { ...prev, cardAmount: event.target.value } : prev
                                                )
                                            }
                                            placeholder="0"
                                            className="text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[11px] text-white/40" htmlFor="payment-adjust-online">На сайте</label>
                                        <Input
                                            id="payment-adjust-online"
                                            type="number"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={paymentAdjust.onlineAmount}
                                            onChange={(event) =>
                                                setPaymentAdjust((prev) =>
                                                    prev ? { ...prev, onlineAmount: event.target.value } : prev
                                                )
                                            }
                                            placeholder="0"
                                            className="text-white"
                                        />
                                    </div>
                                </div>

                                <p className="text-[11px] text-white/40">Введите итоговые суммы по проживанию. Наличные и безнал обновят записи кассы.</p>
                                {paymentAdjustError ? <p className="text-xs text-rose-300">{paymentAdjustError}</p> : null}
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="flex-1"
                                        onClick={() => {
                                            setPaymentAdjust(null);
                                            setPaymentAdjustError(null);
                                        }}
                                        disabled={isSubmittingPaymentAdjust}
                                    >
                                        Отмена
                                    </Button>
                                    <Button
                                        type="button"
                                        className="flex-1"
                                        onClick={handlePaymentAdjust}
                                        disabled={isSubmittingPaymentAdjust}
                                    >
                                        {isSubmittingPaymentAdjust ? 'Сохраняем...' : 'Сохранить'}
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Checkout confirmation modal */}
                    {checkoutConfirm && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                            <Card className="w-full max-w-sm space-y-4 p-5 text-center text-light-text dark:text-white">
                                <p className="text-base font-semibold">Выселить гостя?</p>
                                <p className="text-sm text-slate-500 dark:text-white/50">
                                    № {checkoutConfirm.roomLabel} · {checkoutConfirm.guestName}
                                </p>
                                <div className="flex gap-2">
                                    <Button type="button" variant="secondary" className="flex-1" onClick={() => setCheckoutConfirm(null)}>
                                        Отмена
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="danger"
                                        className="flex-1"
                                        onClick={() => { const id = checkoutConfirm.roomId; setCheckoutConfirm(null); handleCheckout(id); }}
                                    >
                                        Выселить
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
