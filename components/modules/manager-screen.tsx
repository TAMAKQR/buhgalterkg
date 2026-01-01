'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, TextArea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { SessionUser } from '@/lib/types';
import { useApi } from '@/hooks/useApi';
import { useTelegramContext } from '@/components/providers/telegram-provider';
import { formatBishkekDateTime, formatBishkekInputValue, parseBishkekInputValue } from '@/lib/timezone';

interface ManagerStateResponse {
    hotel: {
        id: string;
        name: string;
        address: string;
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
    shiftExpenses?: number | null;
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
    } | null;
    handoverManagers?: Array<{
        id: string;
        displayName: string;
        username?: string | null;
    }>;
    inventory?: {
        categories: ManagerInventoryCategory[];
        products: ManagerInventoryProduct[];
        summary: ManagerInventorySummary;
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

interface ManagerInventoryCategory {
    id: string;
    name: string;
    description?: string | null;
    productCount: number;
}

interface ManagerInventoryProduct {
    id: string;
    name: string;
    unit?: string | null;
    stockOnHand: number;
    sellPrice: number;
    costPrice: number;
    categoryId?: string | null;
    categoryName?: string | null;
    reorderThreshold?: number | null;
}

interface ManagerInventorySummary {
    totalProducts: number;
    totalUnits: number;
    stockValue: number;
    potentialRevenue: number;
    lowStock: number;
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
    handoverCash?: number;
    closingCash?: number;
    note?: string;
    pinCode: string;
    handoverRecipientId: string;
}

interface SaleModalState {
    product: ManagerInventoryProduct;
    quantity: string;
    paymentMethod: 'CASH' | 'CARD';
    saleType: 'ROOM' | 'TAKEAWAY' | 'DIRECT';
    roomStayId?: string;
    note?: string;
}

interface CheckInModalState {
    roomId: string;
    label: string;
    checkIn: string;
    checkOut: string;
    cashAmount: string;
    cardAmount: string;
}

type PanelKey = 'rooms' | 'store' | 'shift' | 'cash';

const formatDateInputValue = (date: Date) => formatBishkekInputValue(date);

const formatKgs = (amount?: number | null) => {
    const safe = typeof amount === 'number' ? amount : 0;
    const fractionDigits = safe % 100 === 0 ? 0 : 2;
    return `${(safe / 100).toLocaleString('ru-RU', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    })} KGS`;
};

export const ManagerScreen = ({ user }: { user: SessionUser }) => {
    const { get, request } = useApi();
    const { logout } = useTelegramContext();

    const { data, mutate, isLoading, error } = useSWR<ManagerStateResponse>(
        user.hotels[0]?.id ? ['manager-state', user.hotels[0].id] : null,
        ([, hotelId]) => get(`/api/manager/state?hotelId=${hotelId}`)
    );

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
    const [inventoryFilter, setInventoryFilter] = useState<string>('all');
    const [saleModal, setSaleModal] = useState<SaleModalState | null>(null);
    const [saleError, setSaleError] = useState<string | null>(null);
    const [isSubmittingSale, setIsSubmittingSale] = useState(false);
    const [isCashLedgerOpen, setIsCashLedgerOpen] = useState(false);
    const salePreviewQuantity = saleModal ? Math.max(0, Math.floor(Number(saleModal.quantity) || 0)) : 0;
    const salePreviewTotal = saleModal ? saleModal.product.sellPrice * salePreviewQuantity : 0;
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
            onClick={logout}
            className="fixed right-4 top-4 z-30 rounded-full border border-white/20 bg-slate-900/70 p-2 text-white/70 shadow-lg backdrop-blur transition hover:border-white hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300"
            aria-label="Выйти к экрану PIN"
        >
            <span className="text-lg leading-none">×</span>
        </button>
    );

    const primaryHotel = data?.hotel ?? user.hotels[0];
    const hasOpenShift = Boolean(data?.shift);
    const shiftCashValue = data?.shiftCash ?? data?.shift?.openingCash ?? 0;
    const shiftExpensesValue = data?.shiftExpenses ?? 0;
    const shiftPayments = data?.shiftPayments;
    const shiftRevenueTotal = shiftPayments?.total ?? 0;
    const shiftRevenueCash = shiftPayments?.cash ?? 0;
    const shiftRevenueCard = shiftPayments?.card ?? 0;
    const shiftNetIncome = shiftRevenueTotal - shiftExpensesValue;
    const shiftLedger = data?.shiftLedger ?? [];
    const compensation = data?.compensation ?? null;
    const handoverTargets = data?.handoverManagers ?? [];
    const inventory = data?.inventory ?? null;
    const inventoryProducts = useMemo(
        () => inventory?.products ?? [],
        [inventory?.products]
    );
    const inventoryCategories = inventory?.categories ?? [];
    const inventorySummary = inventory?.summary ?? null;
    const hasOutOfStockProducts = inventoryProducts.some((product) => product.stockOnHand === 0);
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
    const inventoryFilterClass = (value: string) =>
        `rounded-full border px-4 py-1 text-xs font-semibold transition ${inventoryFilter === value
            ? 'border-amber-200/80 bg-amber-400/10 text-amber-50'
            : 'border-white/10 text-white/60 hover:border-white/40 hover:text-white'
        }`;
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
        <li><span>Открыта</span><strong>${formatBishkekDateTime(data.shift.openedAt)}</strong></li>
        <li><span>Печать</span><strong>${formatBishkekDateTime(printTimestamp)}</strong></li>
        <li><span>Открытие кассы</span><strong>${formatKgs(data.shift.openingCash)}</strong></li>
        <li><span>Выручка (нал)</span><strong>${formatKgs(shiftRevenueCash)}</strong></li>
        <li><span>Выручка (безнал)</span><strong>${formatKgs(shiftRevenueCard)}</strong></li>
        <li><span>Затраты</span><strong>${formatKgs(shiftExpensesValue)}</strong></li>
        <li><span>Чистый доход</span><strong>${formatKgs(shiftNetIncome)}</strong></li>
        <li><span>Текущая касса</span><strong>${formatKgs(shiftCashValue)}</strong></li>
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
        <div className="rounded-2xl bg-white/[0.03] px-4 py-3 text-white">
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
                        Начислено: {formatKgs(payoutSummary.expected ?? 0)} • Выплачено: {formatKgs(payoutSummary.paid ?? 0)} • Осталось:{' '}
                        {formatKgs(payoutSummary.pending ?? 0)}
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

    const activeRoomOptions = useMemo(
        () =>
            (data?.rooms ?? [])
                .filter((room) => room.stay && room.stay.status === 'CHECKED_IN')
                .map((room) => ({
                    stayId: room.stay?.id ?? '',
                    roomLabel: room.label,
                    guestName: room.stay?.guestName?.trim() || null
                }))
                .filter((option) => Boolean(option.stayId)),
        [data?.rooms]
    );

    const filteredInventoryProducts = useMemo(() => {
        if (!inventoryProducts.length) {
            return [] as ManagerInventoryProduct[];
        }

        if (inventoryFilter === 'low') {
            return inventoryProducts.filter(
                (product) =>
                    typeof product.reorderThreshold === 'number' &&
                    product.reorderThreshold > 0 &&
                    product.stockOnHand <= product.reorderThreshold
            );
        }

        if (inventoryFilter === 'out') {
            return inventoryProducts.filter((product) => product.stockOnHand === 0);
        }

        if (inventoryFilter.startsWith('cat:')) {
            const categoryId = inventoryFilter.slice(4);
            return inventoryProducts.filter((product) => product.categoryId === categoryId);
        }

        return inventoryProducts;
    }, [inventoryProducts, inventoryFilter]);

    const panelTabs: Array<{ id: PanelKey; label: string; hint?: string }> = [
        { id: 'rooms', label: 'Номера', hint: `${sortedRooms.length}` },
        { id: 'store', label: 'Магазин', hint: `${inventoryProducts.length}` },
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
                handoverCash: typeof data.shift.handoverCash === 'number'
                    ? data.shift.handoverCash / 100
                    : undefined,
                closingCash: typeof data.shift.closingCash === 'number'
                    ? data.shift.closingCash / 100
                    : undefined,
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
                action: 'open',
                pinCode: values.pinCode
            }
        });
        openShiftForm.reset({ openingCash: 0, note: '', pinCode: '' });
        mutate();
    });

    const handleCloseShift = handoverForm.handleSubmit(async (values) => {
        if (!data?.shift) return;
        await request(`/api/shifts/${data.shift.id}/handover`, {
            body: {
                handoverCash: toMinor(values.handoverCash),
                closingCash: toMinor(values.closingCash),
                note: values.note,
                pinCode: values.pinCode,
                handoverRecipientId: values.handoverRecipientId || undefined
            }
        });
        handoverForm.reset({
            handoverCash: undefined,
            closingCash: undefined,
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

    const handleOpenSaleModal = (product: ManagerInventoryProduct) => {
        if (!data?.shift) {
            if (typeof window !== 'undefined') {
                window.alert('Сначала откройте смену, чтобы провести продажу');
            }
            return;
        }
        const defaultSaleType = activeRoomOptions.length ? 'ROOM' : 'DIRECT';
        setSaleModal({
            product,
            quantity: '1',
            paymentMethod: 'CASH',
            saleType: defaultSaleType,
            roomStayId: defaultSaleType === 'ROOM' ? activeRoomOptions[0]?.stayId ?? '' : '',
            note: ''
        });
        setSaleError(null);
    };

    const handleCloseSaleModal = () => {
        if (isSubmittingSale) return;
        setSaleModal(null);
        setSaleError(null);
    };

    const handleConfirmSale = async () => {
        if (!saleModal || !data?.shift) {
            return;
        }

        const quantityValue = Math.floor(Number(saleModal.quantity || 0));
        if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
            setSaleError('Укажите количество товара');
            return;
        }

        if (quantityValue > saleModal.product.stockOnHand) {
            setSaleError('Такого количества нет на складе');
            return;
        }

        if (saleModal.saleType === 'ROOM' && !saleModal.roomStayId) {
            setSaleError('Выберите гостя, которому списывается товар');
            return;
        }

        setIsSubmittingSale(true);
        try {
            await request('/api/manager/products/sales', {
                body: {
                    shiftId: data.shift.id,
                    productId: saleModal.product.id,
                    quantity: quantityValue,
                    paymentMethod: saleModal.paymentMethod,
                    saleType: saleModal.saleType,
                    roomStayId: saleModal.saleType === 'ROOM' ? saleModal.roomStayId || undefined : undefined,
                    note: saleModal.note?.trim() || undefined
                }
            });
            setSaleModal(null);
            setSaleError(null);
            mutate();
        } catch (saleSubmitError) {
            console.error(saleSubmitError);
            setSaleError('Не удалось записать продажу');
        } finally {
            setIsSubmittingSale(false);
        }
    };

    const handleCheckout = async (roomId: string) => {
        if (!data?.shift) return;
        await request(`/api/rooms/${roomId}/stay`, {
            body: {
                shiftId: data.shift.id,
                intent: 'checkout'
            }
        });
        mutate();
    };

    const showCheckInModal = (room: ManagerStateResponse['rooms'][number]) => {
        if (!data?.shift) {
            if (typeof window !== 'undefined') {
                window.alert('Сначала откройте смену, чтобы заселить гостя');
            }
            return;
        }

        const startDate = room.stay?.scheduledCheckIn ? new Date(room.stay.scheduledCheckIn) : new Date();
        const endDate = room.stay?.scheduledCheckOut
            ? new Date(room.stay.scheduledCheckOut)
            : new Date(startDate.getTime() + 12 * 60 * 60 * 1000);

        setCheckInModal({
            roomId: room.id,
            label: room.label,
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

        const scheduledCheckIn = parseBishkekInputValue(checkInModal.checkIn);
        const scheduledCheckOut = parseBishkekInputValue(checkInModal.checkOut);

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
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-3 py-6 text-center sm:px-6">
                    <p className="text-white/80">Администратор ещё не назначил вас на точку.</p>
                </div>
            </>
        );
    }

    if (!data && isLoading) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-3 py-6 text-center sm:px-6">
                    <p className="text-white/70">Загружаем данные точки…</p>
                </div>
            </>
        );
    }

    if (!data && error) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-3 py-6 text-center text-rose-300 sm:px-6">
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
                <div className="flex min-h-screen flex-col gap-6 px-3 pb-24 pt-6 sm:px-6">
                    <header className="space-y-4">
                        <p className="mt-3 text-sm text-amber-200/80">Чтобы начать работу, введите код менеджера и сумму в кассе.</p>
                        {managerInfoBlock}
                    </header>
                    <Card>
                        <CardHeader title="Принять смену" subtitle="Код менеджера" />
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
                                {...openShiftForm.register('openingCash', { valueAsNumber: true })}
                            />
                            <TextArea rows={2} placeholder="Комментарий" {...openShiftForm.register('note')} />
                            <Button type="submit" className="w-full">
                                Начать смену
                            </Button>
                            <p className="text-xs text-white/50">
                                Код назначает администратор. Пока смена не закрыта, другой менеджер не сможет начать работу.
                            </p>
                        </form>
                    </Card>
                </div>
            </>
        );
    }

    return (
        <>
            <ExitButton />
            <div className="flex min-h-screen flex-col gap-4 px-3 pb-24 pt-3 sm:px-6 sm:pt-4">
                <header className="space-y-4">
                    {data?.shift ? (
                        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-3 text-white/80">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Смена</p>
                                    <p className="text-lg font-semibold text-white">№{data.shift.number}</p>
                                </div>
                                <div className="text-right text-sm">
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Открыта</p>
                                    <p>{formatBishkekDateTime(data.shift.openedAt)}</p>
                                </div>
                            </div>
                            {managerInfoBlock}
                            <p className="text-sm text-white/70">Остаток на начало: {formatKgs(data.shift.openingCash)}</p>
                            {shiftPayments && (
                                <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-3">
                                    <div className="rounded-xl border border-white/10 p-3">
                                        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Наличные</p>
                                        <p className="text-base font-semibold text-white">{formatKgs(shiftPayments.cash)}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 p-3">
                                        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Безналичные</p>
                                        <p className="text-base font-semibold text-white">{formatKgs(shiftPayments.card)}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 p-3">
                                        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Общий доход</p>
                                        <p className="text-base font-semibold text-white">{formatKgs(shiftPayments.total)}</p>
                                    </div>
                                </div>
                            )}
                            <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                                <div className="rounded-xl border border-white/10 p-3">
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Операции</p>
                                    <p className="text-base font-semibold text-white">{formatKgs(shiftExpensesValue)}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 p-3">
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Факт в кассе</p>
                                    <p className="text-base font-semibold text-white">{formatKgs(shiftCashValue)}</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="mt-3 text-sm text-amber-200/80">Смена не открыта</p>
                            {managerInfoBlock}
                        </>
                    )}
                </header>
                <div className="sticky top-0 z-10 -mx-3 mb-2 mt-4 bg-slate-900/90 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:rounded-3xl">
                    <div className="flex gap-2 rounded-full bg-white/5 p-1 text-sm font-semibold text-white/60">
                        {panelTabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActivePanel(tab.id)}
                                className={`flex-1 rounded-full px-3 py-2 transition ${activePanel === tab.id ? 'bg-white text-slate-900 shadow' : 'hover:text-white'
                                    }`}
                            >
                                <span>{tab.label}</span>
                                {tab.hint && activePanel === tab.id && <span className="ml-1 text-xs text-slate-600">{tab.hint}</span>}
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
                                    <article key={room.id} className="rounded-2xl border border-white/10 p-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm uppercase tracking-[0.4em] text-white/40">№ {room.label}</p>
                                                <h3 className="text-xl font-semibold text-white">{guestLabel}</h3>
                                            </div>
                                            <Badge
                                                label={isOccupied ? 'Занят' : room.status === 'DIRTY' ? 'Уборка' : 'Свободен'}
                                                tone={isOccupied ? 'warning' : 'success'}
                                            />
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/60">
                                            <p>Заезд: {room.stay ? formatBishkekDateTime(room.stay.scheduledCheckIn) : '—'}</p>
                                            <p>Выезд: {room.stay ? formatBishkekDateTime(room.stay.scheduledCheckOut) : '—'}</p>
                                        </div>
                                        <div className="mt-3 space-y-1 text-sm">
                                            <p className="font-semibold text-white">
                                                {room.stay?.amountPaid != null ? formatKgs(room.stay.amountPaid) : '—'}
                                            </p>
                                            {paymentLabel && (
                                                <p className="text-xs uppercase tracking-[0.25em] text-white/50">{paymentLabel}</p>
                                            )}
                                        </div>
                                        <div className="mt-4 flex gap-3">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={isOccupied || !hasOpenShift}
                                                onClick={() => showCheckInModal(room)}
                                            >
                                                Заселить
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={!isOccupied || !hasOpenShift}
                                                onClick={() => handleCheckout(room.id)}
                                            >
                                                Выселить
                                            </Button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}

                {activePanel === 'store' && (
                    <section className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white">Магазин</h2>
                            <Badge label={`${inventoryProducts.length} позиций`} />
                        </div>
                        {inventorySummary && (
                            <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                                <div className="rounded-2xl border border-white/10 p-4">
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">В наличии</p>
                                    <p className="text-base font-semibold text-white">{inventorySummary.totalUnits} ед.</p>
                                    <p className="text-xs text-white/60">Себестоимость: {formatKgs(inventorySummary.stockValue)}</p>
                                </div>
                                <div className="rounded-2xl border border-white/10 p-4">
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Потенциал</p>
                                    <p className="text-base font-semibold text-white">{formatKgs(inventorySummary.potentialRevenue)}</p>
                                    <p className="text-xs text-white/60">Низкий остаток: {inventorySummary.lowStock}</p>
                                </div>
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={inventoryFilterClass('all')} onClick={() => setInventoryFilter('all')}>
                                Все
                            </button>
                            {inventorySummary?.lowStock ? (
                                <button type="button" className={inventoryFilterClass('low')} onClick={() => setInventoryFilter('low')}>
                                    Мало
                                </button>
                            ) : null}
                            {hasOutOfStockProducts && (
                                <button type="button" className={inventoryFilterClass('out')} onClick={() => setInventoryFilter('out')}>
                                    Нет в наличии
                                </button>
                            )}
                            {inventoryCategories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    className={inventoryFilterClass(`cat:${category.id}`)}
                                    onClick={() => setInventoryFilter(`cat:${category.id}`)}
                                >
                                    {category.name}
                                </button>
                            ))}
                        </div>
                        {inventoryProducts.length ? (
                            filteredInventoryProducts.length ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                    {filteredInventoryProducts.map((product) => {
                                        const isLowStock =
                                            typeof product.reorderThreshold === 'number' &&
                                            product.reorderThreshold > 0 &&
                                            product.stockOnHand <= product.reorderThreshold;
                                        return (
                                            <article key={product.id} className="rounded-2xl border border-white/10 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-xs uppercase tracking-[0.35em] text-white/40">
                                                            {product.categoryName ?? 'Без категории'}
                                                        </p>
                                                        <h3 className="text-lg font-semibold text-white">{product.name}</h3>
                                                    </div>
                                                    {isLowStock && <Badge label="Мало" tone="warning" />}
                                                </div>
                                                <p className="mt-2 text-sm text-white/70">
                                                    {formatKgs(product.sellPrice)} {product.unit ? `· ${product.unit}` : ''}
                                                </p>
                                                <p className="text-xs text-white/50">
                                                    Остаток: {product.stockOnHand} {product.unit ?? 'ед.'}
                                                </p>
                                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="flex-1"
                                                        onClick={() => handleOpenSaleModal(product)}
                                                        disabled={!hasOpenShift || product.stockOnHand === 0}
                                                    >
                                                        Продать
                                                    </Button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70">
                                    Нет товаров под выбранный фильтр.
                                </div>
                            )
                        ) : (
                            <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70">
                                Товары ещё не заведены. Обратитесь к администратору.
                            </div>
                        )}
                    </section>
                )}

                {activePanel === 'shift' && (
                    <Card>
                        <CardHeader title="Статус смены" subtitle="Приём/сдача" />
                        {isLoading && <p className="text-sm text-white/60">Загружаем...</p>}
                        {error && <p className="text-sm text-rose-300">{String(error)}</p>}
                        {data?.shift && (
                            <div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 sm:grid-cols-2">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.35em] text-white/40">Смена</p>
                                    <p className="text-lg font-semibold text-white">№{data.shift.number}</p>
                                    <p className="text-sm text-white/70">{managerName}</p>
                                    <p className="text-xs text-white/60">{primaryHotel?.name}</p>
                                    <p className="text-xs text-white/50">{primaryHotel?.address}</p>
                                    <p className="text-xs text-white/50">Открыта {formatBishkekDateTime(data.shift.openedAt)}</p>
                                </div>
                                <div className="grid gap-2 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white/60">Сумма открытия</span>
                                        <span className="font-semibold text-white">{formatKgs(data.shift.openingCash)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-white/60">Выручка (нал/безнал)</span>
                                        <span className="font-semibold text-emerald-200">
                                            {formatKgs(shiftRevenueTotal)}
                                            <span className="ml-2 text-xs text-white/60">
                                                ({formatKgs(shiftRevenueCash)} / {formatKgs(shiftRevenueCard)})
                                            </span>
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-white/60">Затраты</span>
                                        <span className="font-semibold text-rose-200">{formatKgs(shiftExpensesValue)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-white/60">Чистый доход</span>
                                        <span className="font-semibold text-amber-200">{formatKgs(shiftNetIncome)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-white/60">Текущая касса</span>
                                        <span className="font-semibold text-sky-200">{formatKgs(shiftCashValue)}</span>
                                    </div>
                                </div>
                                <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-2">
                                    <Button type="button" variant="secondary" onClick={handlePrintShiftReceipt}>
                                        Печать чека / PDF
                                    </Button>
                                </div>
                            </div>
                        )}
                        {data?.shift ? (
                            <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCloseShift}>
                                <Input type="number" step="0.01" placeholder="Касса фактическая" {...handoverForm.register('closingCash', { valueAsNumber: true })} />
                                <Input type="number" step="0.01" placeholder="Передаю" {...handoverForm.register('handoverCash', { valueAsNumber: true })} />
                                <div className="space-y-1 md:col-span-2">
                                    <Select
                                        className="min-w-0 bg-slate-900/80 text-white"
                                        disabled={!handoverTargets.length}
                                        {...handoverForm.register('handoverRecipientId', {
                                            required: handoverTargets.length ? 'Укажите кому передаёте смену' : false
                                        })}
                                    >
                                        <option value="">
                                            {handoverTargets.length ? 'Кому передаю смену' : 'Менеджеры ещё не назначены'}
                                        </option>
                                        {handoverTargets.map((manager) => (
                                            <option key={manager.id} value={manager.id}>
                                                {manager.displayName}
                                            </option>
                                        ))}
                                    </Select>
                                    {handoverForm.formState.errors.handoverRecipientId && (
                                        <p className="text-xs text-rose-300">
                                            {handoverForm.formState.errors.handoverRecipientId.message}
                                        </p>
                                    )}
                                    {!handoverTargets.length && (
                                        <p className="text-xs text-white/50">
                                            Обратитесь к администратору, чтобы назначить менеджеров для передачи смены.
                                        </p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <Input
                                        type="password"
                                        placeholder="PIN для закрытия"
                                        maxLength={6}
                                        inputMode="numeric"
                                        {...handoverForm.register('pinCode', {
                                            required: 'Введите PIN менеджера',
                                            minLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                            maxLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                            pattern: { value: /^\d{6}$/, message: 'Допустимы только цифры' }
                                        })}
                                    />
                                    {handoverForm.formState.errors.pinCode && (
                                        <p className="text-xs text-rose-300">{handoverForm.formState.errors.pinCode.message}</p>
                                    )}
                                </div>
                                <TextArea rows={1} className="md:col-span-2" placeholder="Комментарий" {...handoverForm.register('note')} />
                                <Button type="submit" className="md:col-span-2" variant="secondary">
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
                        <CardHeader title="Расход" subtitle="Касса" />
                        <form className="grid gap-3 md:grid-cols-3" onSubmit={handleExpense}>
                            <Input type="number" step="0.01" placeholder="Сумма" {...expenseForm.register('amount', { valueAsNumber: true })} />
                            <Select className="bg-slate-900/80 text-white min-w-0 max-w-full" {...expenseForm.register('method')}>
                                <option value="CASH">Наличные</option>
                                <option value="CARD">Безнал</option>
                            </Select>
                            <Select className="bg-slate-900/80 text-white min-w-0 max-w-full" {...expenseForm.register('entryType')}>
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
                                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white transition hover:border-white/30"
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
                                    <div id="cash-ledger-panel" className="space-y-2">
                                        {shiftLedger.length ? (
                                            shiftLedger.map((entry) => {
                                                const timestamp = formatBishkekDateTime(entry.recordedAt);
                                                const signedAmount = ['CASH_IN', 'ADJUSTMENT'].includes(entry.entryType)
                                                    ? entry.amount
                                                    : -entry.amount;
                                                const methodLabel = entry.method === 'CARD' ? 'Безналичные' : 'Наличные';
                                                const entryLabel =
                                                    entry.entryType === 'CASH_IN'
                                                        ? 'Поступление'
                                                        : entry.entryType === 'CASH_OUT'
                                                            ? 'Расход'
                                                            : entry.entryType === 'MANAGER_PAYOUT'
                                                                ? 'Выплата менеджеру'
                                                                : 'Корректировка';
                                                const amountClass = signedAmount >= 0 ? 'text-emerald-300' : 'text-rose-300';

                                                return (
                                                    <div key={entry.id} className="rounded-2xl border border-white/10 p-3">
                                                        <div className="flex items-center justify-between text-sm">
                                                            <p className="text-white/70">{timestamp}</p>
                                                            <span className={`font-semibold ${amountClass}`}>{formatKgs(signedAmount)}</span>
                                                        </div>
                                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                                                            {entryLabel} • {methodLabel}
                                                        </p>
                                                        {entry.note && <p className="mt-1 text-sm text-white/80">{entry.note}</p>}
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <p className="text-sm text-white/60">Пока нет операций в этой смене.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>
                )}
            </div>

            {isProfileOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
                    <div className="relative w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
                        <button
                            type="button"
                            onClick={handleCloseProfile}
                            className="absolute right-4 top-4 text-2xl text-white/60 transition hover:text-white focus:outline-none"
                            aria-label="Закрыть профиль"
                        >
                            ×
                        </button>
                        <div className="space-y-2 pr-10">
                            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Менеджер</p>
                            <h2 className="text-2xl font-semibold text-white">{managerName}</h2>
                            {profileData?.manager?.username && (
                                <p className="text-sm text-white/60">@{profileData.manager.username}</p>
                            )}
                            <p className="text-sm text-white/60">{primaryHotel.name}</p>
                        </div>
                        <div className="mt-6 space-y-5">
                            {profileError && (
                                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                                    Не удалось загрузить профиль менеджера. Попробуйте обновить.
                                </div>
                            )}
                            {isProfileLoading && !profileData && (
                                <p className="text-sm text-white/60">Загружаем профиль…</p>
                            )}
                            {profileData && (
                                <>
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-[0.4em] text-white/40">Назначение</p>
                                                <p className="text-base font-semibold text-white">{primaryHotel.name}</p>
                                            </div>
                                            {profileData.assignment?.createdAt && (
                                                <p className="text-xs text-white/60">
                                                    С {formatBishkekDateTime(profileData.assignment.createdAt)}
                                                </p>
                                            )}
                                        </div>
                                        <div className="mt-4 grid gap-3 text-sm text-white/80 sm:grid-cols-3">
                                            <div className="rounded-xl border border-white/10 p-3">
                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Ставка</p>
                                                <p className="text-base font-semibold text-white">
                                                    {profileData.assignment?.shiftPayAmount != null
                                                        ? formatKgs(profileData.assignment.shiftPayAmount)
                                                        : '—'}
                                                </p>
                                            </div>
                                            <div className="rounded-xl border border-white/10 p-3">
                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Процент</p>
                                                <p className="text-base font-semibold text-white">
                                                    {profileData.assignment?.revenueSharePct != null
                                                        ? `${profileData.assignment.revenueSharePct}%`
                                                        : '—'}
                                                </p>
                                            </div>
                                            <div className="rounded-xl border border-white/10 p-3">
                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">PIN</p>
                                                <p className="text-base font-semibold text-white">
                                                    {profileData.assignment?.pinCode ?? '—'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="text-sm font-semibold uppercase tracking-[0.4em] text-white/60">
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
                                                <label className="text-xs uppercase tracking-[0.4em] text-white/40">Статус</label>
                                                <Select
                                                    className="bg-slate-900/80 text-white"
                                                    value={historyStatus}
                                                    onChange={(event) => setHistoryStatus(event.target.value as 'ALL' | 'OPEN' | 'CLOSED')}
                                                >
                                                    <option value="ALL">Все смены</option>
                                                    <option value="OPEN">Активные</option>
                                                    <option value="CLOSED">Архив</option>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs uppercase tracking-[0.4em] text-white/40">С даты</label>
                                                <Input
                                                    type="date"
                                                    value={historyFromDate}
                                                    onChange={(event) => setHistoryFromDate(event.target.value)}
                                                    className="bg-white/10 text-white"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs uppercase tracking-[0.4em] text-white/40">До даты</label>
                                                <Input
                                                    type="date"
                                                    value={historyToDate}
                                                    onChange={(event) => setHistoryToDate(event.target.value)}
                                                    className="bg-white/10 text-white"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs uppercase tracking-[0.4em] text-white/40">Выберите смену</label>
                                            <Select
                                                className="bg-slate-900/80 text-white"
                                                value={selectedShiftId}
                                                onChange={(event) => setSelectedShiftId(event.target.value)}
                                                disabled={!filteredProfileShifts.length}
                                            >
                                                <option value="">
                                                    {filteredProfileShifts.length ? 'Выберите смену' : 'Нет смен под выбранные фильтры'}
                                                </option>
                                                {filteredProfileShifts.map((shift) => (
                                                    <option key={shift.id} value={shift.id}>
                                                        {shift.status === 'OPEN' ? 'Активная' : 'Архив'} №{shift.number} • {formatBishkekDateTime(shift.openedAt)}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                        {selectedShift ? (
                                            <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/80">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-xs uppercase tracking-[0.35em] text-white/40">
                                                            Смена №{selectedShift.number}
                                                        </p>
                                                        <p>{formatBishkekDateTime(selectedShift.openedAt)}</p>
                                                        {selectedShift.closedAt && (
                                                            <p className="text-xs text-white/50">
                                                                Закрыта {formatBishkekDateTime(selectedShift.closedAt)}
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
                                                <div className="flex items-center justify-between text-xs uppercase tracking-[0.35em] text-white/40">
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
                                                                <span className="text-xs uppercase tracking-[0.4em]">
                                                                    {shift.status === 'OPEN' ? 'Активная' : 'Архив'}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-white/60">{formatBishkekDateTime(shift.openedAt)}</p>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
                        <h3 className="text-xl font-semibold">Заселение № {checkInModal.label}</h3>
                        <p className="mt-1 text-sm text-white/60">Укажите плановые времена заезда и выезда</p>
                        <div className="mt-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-white/60" htmlFor="modal-checkin">
                                    Заселение
                                </label>
                                <Input
                                    id="modal-checkin"
                                    type="datetime-local"
                                    value={checkInModal.checkIn}
                                    onChange={(event) =>
                                        setCheckInModal((prev) => (prev ? { ...prev, checkIn: event.target.value } : prev))
                                    }
                                    className="bg-white/10 text-white"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-white/60" htmlFor="modal-checkout">
                                    Выезд
                                </label>
                                <Input
                                    id="modal-checkout"
                                    type="datetime-local"
                                    value={checkInModal.checkOut}
                                    onChange={(event) =>
                                        setCheckInModal((prev) => (prev ? { ...prev, checkOut: event.target.value } : prev))
                                    }
                                    className="bg-white/10 text-white"
                                />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase text-white/60" htmlFor="modal-cash">
                                        Наличные, KGS
                                    </label>
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
                                        placeholder="0.00"
                                        className="bg-white/10 text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase text-white/60" htmlFor="modal-card">
                                        Безнал, KGS
                                    </label>
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
                                        placeholder="0.00"
                                        className="bg-white/10 text-white"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-white/50">
                                Можно заполнить оба поля, если гость платит частично наличными и картой.
                            </p>
                            {checkInError && <p className="text-sm text-rose-300">{checkInError}</p>}
                            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                                <Button
                                    type="button"
                                    className="flex-1 py-3"
                                    disabled={isSubmittingCheckIn}
                                    onClick={handleConfirmCheckIn}
                                >
                                    {isSubmittingCheckIn ? 'Сохраняем...' : 'Подтвердить'}
                                </Button>
                                <Button type="button" variant="ghost" className="flex-1" disabled={isSubmittingCheckIn} onClick={handleCloseModal}>
                                    Отмена
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {saleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
                        <h3 className="text-xl font-semibold">Продажа {saleModal.product.name}</h3>
                        <p className="mt-1 text-sm text-white/60">
                            Цена {formatKgs(saleModal.product.sellPrice)} · Остаток {saleModal.product.stockOnHand}{' '}
                            {saleModal.product.unit ?? 'ед.'}
                        </p>
                        <div className="mt-6 space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Input
                                    type="number"
                                    min={1}
                                    max={saleModal.product.stockOnHand}
                                    step={1}
                                    value={saleModal.quantity}
                                    onChange={(event) =>
                                        setSaleModal((prev) => (prev ? { ...prev, quantity: event.target.value } : prev))
                                    }
                                    placeholder="Количество"
                                />
                                <Select
                                    value={saleModal.paymentMethod}
                                    onChange={(event) =>
                                        setSaleModal((prev) =>
                                            prev ? { ...prev, paymentMethod: event.target.value as SaleModalState['paymentMethod'] } : prev
                                        )
                                    }
                                >
                                    <option value="CASH">Оплата: наличные</option>
                                    <option value="CARD">Оплата: безнал</option>
                                </Select>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Select
                                    value={saleModal.saleType}
                                    onChange={(event) =>
                                        setSaleModal((prev) => {
                                            if (!prev) return prev;
                                            const nextType = event.target.value as SaleModalState['saleType'];
                                            return {
                                                ...prev,
                                                saleType: nextType,
                                                roomStayId:
                                                    nextType === 'ROOM'
                                                        ? prev.roomStayId || activeRoomOptions[0]?.stayId || ''
                                                        : ''
                                            };
                                        })
                                    }
                                >
                                    <option value="DIRECT">Продажа на точке</option>
                                    <option value="TAKEAWAY">С собой</option>
                                    <option value="ROOM" disabled={!activeRoomOptions.length}>
                                        В номер
                                    </option>
                                </Select>
                                {saleModal.saleType === 'ROOM' ? (
                                    activeRoomOptions.length ? (
                                        <Select
                                            value={saleModal.roomStayId}
                                            onChange={(event) =>
                                                setSaleModal((prev) =>
                                                    prev ? { ...prev, roomStayId: event.target.value } : prev
                                                )
                                            }
                                        >
                                            <option value="">Выберите гостя</option>
                                            {activeRoomOptions.map((option) => (
                                                <option key={option.stayId} value={option.stayId}>
                                                    №{option.roomLabel} • {option.guestName ?? 'Гость'}
                                                </option>
                                            ))}
                                        </Select>
                                    ) : (
                                        <div className="rounded-2xl border border-white/10 p-3 text-xs text-white/60">
                                            Нет заселённых гостей
                                        </div>
                                    )
                                ) : (
                                    <div className="rounded-2xl border border-white/10 p-3 text-xs text-white/60">
                                        Привязка к гостю не требуется
                                    </div>
                                )}
                            </div>
                            <TextArea
                                rows={2}
                                placeholder="Комментарий (необязательно)"
                                value={saleModal.note ?? ''}
                                onChange={(event) =>
                                    setSaleModal((prev) => (prev ? { ...prev, note: event.target.value } : prev))
                                }
                            />
                            <div className="rounded-2xl border border-white/10 p-4">
                                <p className="text-xs uppercase tracking-[0.35em] text-white/40">Итог</p>
                                <p className="text-xl font-semibold text-white">{formatKgs(salePreviewTotal)}</p>
                                <p className="text-xs text-white/60">
                                    Количество: {salePreviewQuantity > 0 ? salePreviewQuantity : '—'} {saleModal.product.unit ?? 'ед.'}
                                </p>
                            </div>
                            {saleError && <p className="text-sm text-rose-300">{saleError}</p>}
                            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                                <Button
                                    type="button"
                                    className="flex-1"
                                    disabled={
                                        isSubmittingSale ||
                                        salePreviewQuantity <= 0 ||
                                        (saleModal.saleType === 'ROOM' && (!activeRoomOptions.length || !saleModal.roomStayId))
                                    }
                                    onClick={handleConfirmSale}
                                >
                                    {isSubmittingSale ? 'Сохраняем...' : 'Подтвердить'}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="flex-1"
                                    disabled={isSubmittingSale}
                                    onClick={handleCloseSaleModal}
                                >
                                    Отмена
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
