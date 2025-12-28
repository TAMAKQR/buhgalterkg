'use client';

import useSWR from 'swr';
import { useEffect, useState } from 'react';
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
    handoverCash: number;
    closingCash: number;
    note?: string;
    pinCode: string;
}

interface CheckInModalState {
    roomId: string;
    label: string;
    checkIn: string;
    checkOut: string;
    cashAmount: string;
    cardAmount: string;
}

type PanelKey = 'rooms' | 'shift' | 'cash';

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
    const handoverForm = useForm<ShiftHandoverForm>({ defaultValues: { handoverCash: 0, closingCash: 0, pinCode: '', note: '' } });
    const [checkInModal, setCheckInModal] = useState<CheckInModalState | null>(null);
    const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false);
    const [checkInError, setCheckInError] = useState<string | null>(null);
    const [activePanel, setActivePanel] = useState<PanelKey>('rooms');
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
    const shiftLedger = data?.shiftLedger ?? [];
    const panelTabs: Array<{ id: PanelKey; label: string; hint?: string }> = [
        { id: 'rooms', label: 'Номера', hint: `${data?.rooms?.length ?? 0}` },
        { id: 'shift', label: data?.shift ? `Смена №${data.shift.number}` : 'Принять смену' },
        { id: 'cash', label: 'Касса' }
    ];
    const managerName = user.displayName?.trim() || user.username?.trim() || 'Менеджер';

    useEffect(() => {
        if (data?.shift) {
            handoverForm.reset({
                handoverCash: (data.shift.handoverCash ?? data.shift.openingCash) / 100,
                closingCash: (data.shift.closingCash ?? data.shift.openingCash) / 100,
                note: '',
                pinCode: ''
            });
        }
    }, [data?.shift, handoverForm]);

    useEffect(() => {
        if (!data?.shift && activePanel === 'rooms') {
            setActivePanel('shift');
        }
    }, [data?.shift, activePanel]);

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
                pinCode: values.pinCode
            }
        });
        handoverForm.reset({ handoverCash: 0, closingCash: 0, note: '', pinCode: '' });
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

    if (!primaryHotel) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-white/80">Администратор ещё не назначил вас на точку.</p>
                </div>
            </>
        );
    }

    if (!data && isLoading) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-white/70">Загружаем данные точки…</p>
                </div>
            </>
        );
    }

    if (!data && error) {
        return (
            <>
                <ExitButton />
                <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-rose-300">
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
                <div className="flex min-h-screen flex-col gap-6 p-6 pb-24">
                    <header className="space-y-4">
                        <h1 className="text-3xl font-semibold text-white">{managerName}</h1>
                        <p className="mt-3 text-sm text-amber-200/80">Чтобы начать работу, введите код менеджера и сумму в кассе.</p>
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
            <div className="flex min-h-screen flex-col gap-4 p-4 pb-24">
                <header className="space-y-4">
                    <h1 className="text-3xl font-semibold text-white">{managerName}</h1>
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
                        <p className="mt-3 text-sm text-amber-200/80">Смена не открыта</p>
                    )}
                </header>
                <div className="sticky top-0 z-10 -mx-4 mb-2 mt-4 bg-slate-900/90 p-4 pb-3 backdrop-blur">
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
                            <Badge label={`${data?.rooms?.length ?? 0} в учёте`} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            {data?.rooms?.map((room) => {
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

                {activePanel === 'shift' && (
                    <Card>
                        <CardHeader title="Статус смены" subtitle="Приём/сдача" />
                        {isLoading && <p className="text-sm text-white/60">Загружаем...</p>}
                        {error && <p className="text-sm text-rose-300">{String(error)}</p>}
                        {data?.shift ? (
                            <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCloseShift}>
                                <Input type="number" step="0.01" placeholder="Касса фактическая" {...handoverForm.register('closingCash', { valueAsNumber: true })} />
                                <Input type="number" step="0.01" placeholder="Передаю" {...handoverForm.register('handoverCash', { valueAsNumber: true })} />
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
                            <div className="mt-6 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-white">Последние операции</h3>
                                    <span className="text-xs text-white/50">{shiftLedger.length} записей</span>
                                </div>
                                <div className="space-y-2">
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
                            </div>
                        )}
                    </Card>
                )}
            </div>

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
        </>
    );
};
