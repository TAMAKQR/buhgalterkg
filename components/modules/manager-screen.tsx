'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, TextArea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { SessionUser } from '@/lib/types';
import { useCookieApi } from '@/hooks/useCookieApi';
import { formatDateTime, formatInputValue, parseInputValue, formatMoney } from '@/lib/timezone';

interface ManagerStateResponse {
    hotel: {
        id: string;
        name: string;
        address: string;
        timezone?: string;
        currency?: string;
    };
    shift?: {
        id: string;
        openedAt: string;
        openingCash: number;
        handoverCash?: number | null;
        closingCash?: number | null;
        handoverRecipientId?: string | null;
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
    shiftLedger?: Array<{
        id: string;
        entryType: 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
        method: 'CASH' | 'CARD';
        amount: number;
        note?: string | null;
        recordedAt: string;
    }> | null;
    rooms: Array<{
        id: string;
        label: string;
        status: string;
        stay?: {
            id: string;
            guestName?: string | null;
            scheduledCheckIn: string;
            scheduledCheckOut: string;
            status: string;
            amountPaid?: number | null;
            paymentMethod?: 'CASH' | 'CARD' | null;
            cashPaid?: number | null;
            cardPaid?: number | null;
        } | null;
    }>;
    compensation?: {
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
        expectedPayout?: number | null;
        paidPayout?: number | null;
        pendingPayout?: number | null;
        bonus?: number | null;
        bonusThreshold?: number | null;
    } | null;
    handoverManagers?: Array<{
        id: string;
        displayName: string;
        username?: string | null;
    }>;
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
    handoverRecipientId: string;
}

interface CheckInModalState {
    roomId: string;
    label: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
    cashAmount: string;
    cardAmount: string;
}

type PanelKey = 'rooms' | 'shift' | 'cash';

export const ManagerScreen = ({ user, onLogout }: { user: SessionUser; onLogout?: () => void }) => {
    const { get, request } = useCookieApi();

    const handleLogout = async () => {
        await fetch('/api/session/logout', { method: 'POST' });
        if (onLogout) {
            // Pass null to immediately clear the cache
            onLogout();
        }
    };

    const { data, mutate, isLoading, error, isValidating } = useSWR<ManagerStateResponse>(
        user.hotels[0]?.id ? ['manager-state', user.hotels[0].id] : null,
        ([, hotelId]) => get(`/api/manager/state?hotelId=${hotelId}`),
        { refreshInterval: 30_000 }
    );

    const hotelTz = data?.hotel?.timezone;
    const hotelCur = data?.hotel?.currency;
    const formatKgs = (amount?: number | null) => formatMoney(typeof amount === 'number' ? amount : 0, hotelCur);
    const formatDateInputValue = (date: Date) => formatInputValue(date, hotelTz);

    const expenseForm = useForm<ExpenseForm>({ defaultValues: { method: 'CASH', entryType: 'CASH_OUT' } });
    const openShiftForm = useForm<ShiftOpenForm>({ defaultValues: { openingCash: 0, pinCode: '', note: '' } });
    const handoverForm = useForm<ShiftHandoverForm>({ defaultValues: { pinCode: '', note: '', handoverRecipientId: '' } });
    const [checkInModal, setCheckInModal] = useState<CheckInModalState | null>(null);
    const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false);
    const [checkInError, setCheckInError] = useState<string | null>(null);
    const [activePanel, setActivePanel] = useState<PanelKey>('rooms');
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [selectedShiftId, setSelectedShiftId] = useState<string>('');
    const [historyStatus, setHistoryStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
    const [historyFromDate, setHistoryFromDate] = useState('');
    const [historyToDate, setHistoryToDate] = useState('');
    const [isCashLedgerOpen, setIsCashLedgerOpen] = useState(false);
    const [checkoutConfirm, setCheckoutConfirm] = useState<{ roomId: string; roomLabel: string; guestName: string } | null>(null);
    const { toast } = useToast();
    const {
        data: profileData,
        mutate: refreshProfile,
        isLoading: isProfileLoading,
        error: profileError
    } = useSWR<ManagerProfileResponse>(
        isProfileOpen ? 'manager-profile' : null,
        () => get<ManagerProfileResponse>('/api/manager/profile')
    );
    const ExitButton = () => (
        <button
            type="button"
            onClick={handleLogout}
            className="fixed right-4 top-4 z-30 rounded-full border border-white/20 bg-ink p-2 text-white/70 shadow-lg backdrop-blur transition hover:border-white hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300"
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
    const shiftBalances = data?.shiftBalances ?? null;
    const shiftCashValue = shiftBalances?.cash ?? data?.shiftCash ?? data?.shift?.openingCash ?? 0;
    const computedCardFallback = shiftRevenueCard - shiftExpensesCard;
    const shiftCardValue = shiftBalances?.card ?? computedCardFallback;
    const shiftTotalBalance = shiftBalances?.total ?? shiftCashValue + shiftCardValue;
    const shiftNetIncome = shiftRevenueTotal - shiftExpensesTotal;
    const shiftLedger = data?.shiftLedger ?? [];
    const compensation = data?.compensation ?? null;
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
    const handleOpenProfile = () => setIsProfileOpen(true);
    const handleCloseProfile = () => setIsProfileOpen(false);
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
        <li><span>Менеджер</span><strong>${managerName}</strong></li>
        <li><span>Открыта</span><strong>${formatDateTime(data.shift.openedAt, hotelTz)}</strong></li>
        <li><span>Печать</span><strong>${formatDateTime(printTimestamp, hotelTz)}</strong></li>
        <li><span>Открытие кассы</span><strong>${formatKgs(data.shift.openingCash)}</strong></li>
        <li><span>Выручка (нал)</span><strong>${formatKgs(shiftRevenueCash)}</strong></li>
        <li><span>Выручка (безнал)</span><strong>${formatKgs(shiftRevenueCard)}</strong></li>
        <li><span>Затраты (нал/безнал)</span><strong>${formatKgs(shiftExpensesTotal)} (${formatKgs(shiftExpensesCash)} / ${formatKgs(shiftExpensesCard)})</strong></li>
    </ul>
    ${shiftLedger.filter(e => e.entryType === 'CASH_OUT').length > 0 ? `
    <ul class="expenses">
        ${shiftLedger.filter(e => e.entryType === 'CASH_OUT').map(e =>
            `<li><span style="padding-left:16px;color:#64748b">↳ ${e.note?.trim() || 'Расход'} (${e.method === 'CASH' ? 'нал' : 'безнал'})</span><strong style="color:#dc2626">-${formatKgs(e.amount)}</strong></li>`
        ).join('')}
    </ul>` : ''}
    <ul>
        <li><span>Чистый доход</span><strong>${formatKgs(shiftNetIncome)}</strong></li>
        <li><span>Остаток (нал)</span><strong>${formatKgs(shiftCashValue)}</strong></li>
        <li><span>Остаток (безнал)</span><strong>${formatKgs(shiftCardValue)}</strong></li>
        <li><span>Остаток суммарно</span><strong>${formatKgs(shiftTotalBalance)}</strong></li>
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
                    className="text-left text-base font-semibold text-white underline decoration-dotted decoration-white/40 underline-offset-4 transition hover:text-amber-200 focus:outline-none"
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

    const occupiedCount = useMemo(() => sortedRooms.filter((r) => r.status === 'OCCUPIED').length, [sortedRooms]);

    const panelTabs: Array<{ id: PanelKey; label: string; hint?: string }> = [
        { id: 'rooms', label: 'Номера', hint: `${occupiedCount}/${sortedRooms.length}` },
        { id: 'shift', label: data?.shift ? `Смена №${data.shift.number}` : 'Принять смену' },
        { id: 'cash', label: 'Касса' }
    ];

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
                pinCode: '',
                handoverRecipientId: data.shift.handoverRecipientId ?? ''
            });
        }
    }, [data?.shift, handoverForm]);

    useEffect(() => {
        if (!data?.shift && activePanel === 'rooms') {
            setActivePanel('shift');
        }
    }, [data?.shift, activePanel]);

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
        mutate();
    });

    const handleCloseShift = handoverForm.handleSubmit(async (values) => {
        if (!data?.shift) return;
        const cashToReport = shiftCashValue;
        await request(`/api/shifts/${data.shift.id}/handover`, {
            body: {
                handoverCash: cashToReport,
                closingCash: cashToReport,
                note: values.note,
                pinCode: values.pinCode,
                handoverRecipientId: values.handoverRecipientId || undefined
            }
        });
        handoverForm.reset({
            note: '',
            pinCode: '',
            handoverRecipientId: ''
        });
        mutate();
    });

    const handleExpense = expenseForm.handleSubmit(async (values) => {
        if (!data?.shift) {
            throw new Error('Сначала откройте смену');
        }
        await request('/api/expenses', {
            body: {
                hotelId: data.hotel.id,
                shiftId: data.shift.id,
                amount: toMinor(values.amount),
                method: values.method,
                note: values.note,
                entryType: values.entryType
            }
        });
        expenseForm.reset({ amount: 0, method: values.method, entryType: values.entryType, note: '' });
    });

    const handleCheckout = async (roomId: string) => {
        if (!data?.shift) return;
        await request(`/api/rooms/${roomId}/stay`, {
            body: {
                shiftId: data.shift.id,
                intent: 'checkout'
            }
        });
        toast('Гость выселен', 'success');
        mutate();
    };

    const showCheckInModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!data?.shift) {
            toast('Сначала откройте смену, чтобы заселить гостя', 'error');
            return;
        }

        const startDate = room.stay?.scheduledCheckIn ? new Date(room.stay.scheduledCheckIn) : new Date();
        const endDate = room.stay?.scheduledCheckOut
            ? new Date(room.stay.scheduledCheckOut)
            : new Date(startDate.getTime() + 12 * 60 * 60 * 1000);

        setCheckInModal({
            roomId: room.id,
            label: room.label,
            guestName: '',
            checkIn: formatDateInputValue(startDate),
            checkOut: formatDateInputValue(endDate),
            cashAmount: '',
            cardAmount: ''
        });
        setCheckInError(null);
    };

    const handleConfirmCheckIn = async () => {
        if (!checkInModal || !data?.shift) {
            return;
        }

        const scheduledCheckIn = parseInputValue(checkInModal.checkIn, hotelTz);
        const scheduledCheckOut = parseInputValue(checkInModal.checkOut, hotelTz);

        if (!scheduledCheckIn || !scheduledCheckOut) {
            setCheckInError('Укажите корректные даты заселения и выезда');
            return;
        }

        if (scheduledCheckOut <= scheduledCheckIn) {
            setCheckInError('Время выезда должно быть позже заселения');
            return;
        }

        const cashValue = Number(checkInModal.cashAmount || 0);
        const cardValue = Number(checkInModal.cardAmount || 0);

        if (!Number.isFinite(cashValue) || cashValue < 0 || !Number.isFinite(cardValue) || cardValue < 0) {
            setCheckInError('Сумма не может быть отрицательной или пустой');
            return;
        }

        if (cashValue === 0 && cardValue === 0) {
            setCheckInError('Укажите оплату наличными и/или безналичными');
            return;
        }

        const cashMinor = toMinor(cashValue);
        const cardMinor = toMinor(cardValue);

        setIsSubmittingCheckIn(true);
        try {
            await request(`/api/rooms/${checkInModal.roomId}/stay`, {
                body: {
                    shiftId: data.shift.id,
                    intent: 'checkin',
                    guestName: checkInModal.guestName.trim() || undefined,
                    scheduledCheckIn: scheduledCheckIn.toISOString(),
                    scheduledCheckOut: scheduledCheckOut.toISOString(),
                    cashAmount: cashMinor,
                    cardAmount: cardMinor
                }
            });
            setCheckInModal(null);
            setCheckInError(null);
            mutate();
        } catch (modalError) {
            console.error(modalError);
            setCheckInError('Не удалось заселить гостя');
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

    if (!primaryHotel) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-2 py-4 text-center sm:px-6">
                    <p className="text-white/80">Администратор ещё не назначил вас на точку.</p>
                </div>
            </>
        );
    }

    if (!data && isLoading) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-2 py-4 text-center sm:px-6">
                    <p className="text-white/70">Загружаем данные точки…</p>
                </div>
            </>
        );
    }

    if (!data && error) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-2 py-4 text-center text-rose-300 sm:px-6">
                    <p>Не удалось загрузить состояние менеджера</p>
                    <p className="text-sm text-white/60">{String(error)}</p>
                </div>
            </>
        );
    }

    if (data && !data.shift) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col gap-4 px-3 pb-16 pt-4 sm:px-5">
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
            </>
        );
    }

    return (
        <>
            <ExitButton />
            <div className="flex min-h-screen flex-col gap-3 px-3 pb-16 pt-4 sm:px-5">
                <header>
                    {data?.shift ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-base font-semibold text-white">Смена №{data.shift.number}</h1>
                                    <p className="text-[11px] text-white/40">{formatDateTime(data.shift.openedAt, hotelTz)}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => mutate()}
                                        className={`rounded-full p-1.5 text-white/40 transition hover:text-white/70 ${isValidating ? 'animate-spin' : ''}`}
                                        aria-label="Обновить"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
                                    </button>
                                    <Button type="button" size="sm" variant="ghost" className="text-[11px] text-amber-200/70" onClick={() => setActivePanel('shift')}>
                                        Сдать смену
                                    </Button>
                                </div>
                            </div>
                            <div className="flex gap-3 text-xs">
                                <span className="text-white/50">Касса <span className="font-semibold text-white">{formatKgs(shiftCashValue)}</span></span>
                                <span className="text-white/50">Б/н <span className="font-semibold text-white">{formatKgs(shiftCardValue)}</span></span>
                                <span className="text-white/50">Расход <span className="font-semibold text-white">{formatKgs(shiftExpensesTotal)}</span></span>
                                <span className="text-white/50">Занято <span className="font-semibold text-white">{occupiedCount}/{sortedRooms.length}</span></span>
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="mt-3 text-sm text-amber-200/80">Смена не открыта</p>
                            {managerInfoBlock}
                        </>
                    )}
                </header>
                <div className="sticky top-0 z-10 -mx-3 bg-night/95 px-3 py-2 backdrop-blur-md sm:-mx-5 sm:px-5">
                    <div className="flex gap-1 rounded-xl bg-white/[0.05] p-1 text-sm font-medium text-white/50">
                        {panelTabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActivePanel(tab.id)}
                                className={`flex-1 rounded-lg px-3 py-1.5 transition-all ${activePanel === tab.id ? 'bg-white/[0.12] text-white shadow-sm' : 'hover:text-white/70'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {activePanel === 'rooms' && (
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white">Номера</h2>
                            <Badge label={`${sortedRooms.length} в учёте`} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            {sortedRooms.map((room) => {
                                const isOccupied = room.status === 'OCCUPIED';
                                const guestLabel = room.stay?.guestName?.trim() || (isOccupied ? 'Гость' : 'Свободен');
                                const cashPortion = room.stay?.cashPaid ?? 0;
                                const cardPortion = room.stay?.cardPaid ?? 0;
                                const paymentLabel = (() => {
                                    const segments = [] as string[];
                                    if (cashPortion) segments.push(`нал ${formatKgs(cashPortion)}`);
                                    if (cardPortion) segments.push(`безнал ${formatKgs(cardPortion)}`);
                                    if (!segments.length && room.stay?.paymentMethod) {
                                        return room.stay.paymentMethod === 'CARD' ? 'Безнал' : 'Наличные';
                                    }
                                    return segments.join(' · ') || null;
                                })();

                                return (
                                    <article key={room.id} className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-sm font-semibold text-white">№ {room.label}</span>
                                                <Badge
                                                    label={isOccupied ? 'Занят' : room.status === 'DIRTY' ? 'Уборка' : 'Свободен'}
                                                    tone={isOccupied ? 'warning' : 'success'}
                                                />
                                            </div>
                                            {isOccupied ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-[11px] text-rose-300/70 hover:text-rose-300"
                                                    disabled={!hasOpenShift}
                                                    onClick={() => setCheckoutConfirm({ roomId: room.id, roomLabel: room.label, guestName: guestLabel })}
                                                >
                                                    Выселить
                                                </Button>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    className="text-[11px]"
                                                    disabled={!hasOpenShift}
                                                    onClick={() => showCheckInModal(room)}
                                                >
                                                    Заселить
                                                </Button>
                                            )}
                                        </div>
                                        {room.stay && (
                                            <div className="mt-1 text-[11px] text-white/40">
                                                <span className="font-medium text-white/60">{guestLabel}</span>
                                                {' · '}
                                                {formatDateTime(room.stay.scheduledCheckIn, hotelTz)} — {formatDateTime(room.stay.scheduledCheckOut, hotelTz)}
                                                {room.stay.amountPaid != null && (
                                                    <> · {formatKgs(room.stay.amountPaid)}{paymentLabel ? ` · ${paymentLabel}` : ''}</>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}

                {activePanel === 'shift' && (
                    <Card>
                        <CardHeader title="Сдача смены" />
                        {isLoading && <p className="text-sm text-white/60">Загружаем...</p>}
                        {error && <p className="text-sm text-rose-300">{String(error)}</p>}
                        {data?.shift && (
                            <div className="mb-4 space-y-3">
                                <div className="flex items-center justify-between text-xs text-white/50">
                                    <span>{managerName} · {primaryHotel?.name}</span>
                                    <span>{formatDateTime(data.shift.openedAt, hotelTz)}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                                        <p className="text-[11px] text-white/40">Выручка</p>
                                        <p className="font-semibold text-emerald-300">{formatKgs(shiftRevenueTotal)}</p>
                                        <p className="text-[11px] text-white/35">{formatKgs(shiftRevenueCash)} нал · {formatKgs(shiftRevenueCard)} б/н</p>
                                    </div>
                                    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                                        <p className="text-[11px] text-white/40">Расход</p>
                                        <p className="font-semibold text-rose-300">{formatKgs(shiftExpensesTotal)}</p>
                                        <p className="text-[11px] text-white/35">{formatKgs(shiftExpensesCash)} нал · {formatKgs(shiftExpensesCard)} б/н</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between rounded-lg bg-white/[0.06] px-3 py-2 text-sm">
                                    <span className="text-white/60">К передаче (нал)</span>
                                    <span className="text-lg font-bold text-white">{formatKgs(shiftCashValue)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs text-white/40 px-1">
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
                            <form className="space-y-3 border-t border-white/[0.06] pt-4" onSubmit={handleCloseShift}>
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
                                    Сдать смену
                                </Button>
                            </form>
                        ) : (
                            <p className="text-sm text-white/60">Смена ещё не открыта.</p>
                        )}
                    </Card>
                )}

                {activePanel === 'cash' && (
                    <Card>
                        <CardHeader title="Касса" />
                        <form className="grid gap-3 md:grid-cols-3" onSubmit={handleExpense}>
                            <Input type="number" step="0.01" placeholder="Сумма" {...expenseForm.register('amount', { valueAsNumber: true })} />
                            <Select className="bg-ink text-white min-w-0 max-w-full" {...expenseForm.register('method')}>
                                <option value="CASH">Наличные</option>
                                <option value="CARD">Безнал</option>
                            </Select>
                            <Select className="bg-ink text-white min-w-0 max-w-full" {...expenseForm.register('entryType')}>
                                <option value="CASH_OUT">Расход</option>
                                <option value="CASH_IN">Поступление</option>
                                <option value="MANAGER_PAYOUT">Выплата менеджеру</option>
                                <option value="ADJUSTMENT">Корректировка</option>
                            </Select>
                            <TextArea rows={1} className="md:col-span-3" placeholder="Комментарий" {...expenseForm.register('note')} />
                            <Button type="submit" className="md:col-span-3">
                                Записать операцию
                            </Button>
                        </form>
                        {data?.shift && (
                            <div className="mt-6 space-y-3">
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-left text-white transition hover:border-white/30"
                                    aria-expanded={isCashLedgerOpen}
                                    aria-controls="cash-ledger-panel"
                                    onClick={() => setIsCashLedgerOpen((prev) => !prev)}
                                >
                                    <div>
                                        <h3 className="text-sm font-semibold">Последние операции</h3>
                                        <p className="text-xs text-white/60">{shiftLedger.length} записей</p>
                                    </div>
                                    <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
                                        {isCashLedgerOpen ? 'Скрыть' : 'Показать'}
                                    </span>
                                </button>
                                {isCashLedgerOpen && (
                                    <div id="cash-ledger-panel" className="divide-y divide-white/[0.06]">
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
                                                            ? 'Расход'
                                                            : entry.entryType === 'MANAGER_PAYOUT'
                                                                ? 'Выплата'
                                                                : 'Корр.';
                                                const amountClass = signedAmount >= 0 ? 'text-emerald-300' : 'text-rose-300';

                                                return (
                                                    <div key={entry.id} className="flex items-center justify-between py-2 text-xs">
                                                        <div className="min-w-0">
                                                            <span className="text-white/50">{timestamp}</span>
                                                            <span className="ml-2 text-white/40">{entryLabel} · {methodLabel}</span>
                                                            {entry.note && <span className="ml-2 text-white/60">{entry.note}</span>}
                                                        </div>
                                                        <span className={`font-semibold shrink-0 ml-3 ${amountClass}`}>{formatKgs(signedAmount)}</span>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <p className="py-2 text-xs text-white/40">Нет операций.</p>
                                        )}
                                    </div>
                                )}
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
                                                    <span>Передано: {selectedShift.handoverCash != null ? formatKgs(selectedShift.handoverCash) : '—'}</span>
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

            {checkInModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4">
                    <div className="w-full max-w-sm rounded-xl sm:rounded-2xl bg-ink p-3 sm:p-5 text-white shadow-2xl">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-semibold">Заселение № {checkInModal.label}</h3>
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
                                    autoFocus
                                    placeholder="Имя гостя"
                                    value={checkInModal.guestName}
                                    onChange={(event) =>
                                        setCheckInModal((prev) => (prev ? { ...prev, guestName: event.target.value } : prev))
                                    }
                                    className="text-white"
                                />
                            </div>
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
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-cash">Наличные</label>
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
                                    <label className="text-[11px] text-white/40 mb-1 block" htmlFor="modal-card">Безнал</label>
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
                            </div>
                            {checkInError && <p className="text-xs text-rose-300">{checkInError}</p>}
                            <Button
                                type="button"
                                className="w-full py-3 mt-1"
                                disabled={isSubmittingCheckIn}
                                onClick={handleConfirmCheckIn}
                            >
                                {isSubmittingCheckIn ? 'Сохраняем...' : 'Заселить'}
                            </Button>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Checkout confirmation modal */}
            {checkoutConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                    <Card className="w-full max-w-sm space-y-4 p-5 text-center text-white">
                        <p className="text-base font-semibold">Выселить гостя?</p>
                        <p className="text-sm text-white/50">
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

        </>
    );
};
