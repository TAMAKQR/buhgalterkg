'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, TextArea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/useApi';
import { useTelegramContext } from '@/components/providers/telegram-provider';
import { formatBishkekDateTime } from '@/lib/timezone';

interface HotelDetailPayload {
    id: string;
    name: string;
    address: string;
    managerSharePct?: number | null;
    notes?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        assignmentId: string;
        id: string;
        displayName: string;
        telegramId?: string | null;
        username?: string | null;
        pinCode?: string | null;
    }>;
    rooms: Array<{
        id: string;
        label: string;
        status: string;
        isActive: boolean;
        notes?: string | null;
        stay?: {
            id: string;
            guestName?: string | null;
            status: string;
            scheduledCheckIn: string;
            scheduledCheckOut: string;
            actualCheckIn?: string | null;
            actualCheckOut?: string | null;
            amountPaid?: number | null;
            paymentMethod?: string | null;
        } | null;
    }>;
    activeShift?: {
        manager: string;
        openedAt: string;
        openingCash: number;
        number: number;
    } | null;
    financials: {
        cashIn: number;
        cashOut: number;
        payouts: number;
        adjustments: number;
        netCash: number;
    };
}

interface AddManagerForm {
    displayName: string;
    username?: string;
    pinCode: string;
}

interface UpdateManagerForm {
    assignmentId: string;
    displayName: string;
    username: string;
    pinCode: string;
}

interface CreateRoomsForm {
    roomLabels: string;
    floor?: string;
    notes?: string;
}

const formatCurrency = (value: number) => `${(value / 100).toLocaleString('ru-RU')} KGS`;

const formatStayDate = (value?: string | null) => formatBishkekDateTime(value);

export const AdminHotelDetail = ({ hotelId }: { hotelId: string }) => {
    const { user } = useTelegramContext();
    const router = useRouter();
    const { get, request } = useApi();

    const { data, isLoading, error, mutate } = useSWR<HotelDetailPayload>(hotelId ? ['hotel-detail', hotelId] : null, () => get(`/api/hotels/${hotelId}`));
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [removingManagerId, setRemovingManagerId] = useState<string | null>(null);
    const [removingRoomId, setRemovingRoomId] = useState<string | null>(null);

    const managerForm = useForm<AddManagerForm>({
        defaultValues: { displayName: '', username: '', pinCode: '' }
    });

    const updateManagerForm = useForm<UpdateManagerForm>({
        defaultValues: { assignmentId: '', displayName: '', username: '', pinCode: '' }
    });

    const roomForm = useForm<CreateRoomsForm>({
        defaultValues: { roomLabels: '' }
    });

    const selectedAssignmentId = updateManagerForm.watch('assignmentId');
    const selectedManager = (data?.managers ?? []).find((manager) => manager.assignmentId === selectedAssignmentId);

    const handleClearShiftHistory = async () => {
        if (typeof window !== 'undefined') {
            const confirmed = window.confirm('Удалить все закрытые смены и связанные кассовые операции на этой точке?');
            if (!confirmed) {
                return;
            }
        }

        setIsClearingHistory(true);
        try {
            await request('/api/admin/shifts/clear', {
                body: { hotelId }
            });
            mutate();
            if (typeof window !== 'undefined') {
                window.alert('История смен удалена');
            }
        } catch (clearError) {
            console.error(clearError);
            if (typeof window !== 'undefined') {
                window.alert('Не удалось очистить историю');
            }
        } finally {
            setIsClearingHistory(false);
        }
    };

    const handleRemoveManager = async (assignmentId: string) => {
        if (typeof window !== 'undefined') {
            const confirmed = window.confirm('Удалить менеджера из этой точки? Доступ будет заблокирован.');
            if (!confirmed) {
                return;
            }
        }
        setRemovingManagerId(assignmentId);
        try {
            await request('/api/hotel-assignments', {
                method: 'DELETE',
                body: { assignmentId }
            });
            mutate();
        } catch (managerError) {
            console.error(managerError);
            if (typeof window !== 'undefined') {
                window.alert('Не удалось удалить менеджера');
            }
        } finally {
            setRemovingManagerId((current) => (current === assignmentId ? null : current));
        }
    };

    const handleDeleteRoom = async (roomId: string) => {
        if (typeof window !== 'undefined') {
            const confirmed = window.confirm('Удалить номер и его историю заселений? Действие необратимо.');
            if (!confirmed) {
                return;
            }
        }
        setRemovingRoomId(roomId);
        try {
            await request('/api/rooms', {
                method: 'DELETE',
                body: { roomId }
            });
            mutate();
        } catch (roomError) {
            console.error(roomError);
            if (typeof window !== 'undefined') {
                window.alert('Не удалось удалить номер');
            }
        } finally {
            setRemovingRoomId((current) => (current === roomId ? null : current));
        }
    };

    if (user && user.role !== 'ADMIN') {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
                <p>Только администраторы могут управлять точками.</p>
                <Button onClick={() => router.push('/')}>Вернуться</Button>
            </div>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="flex min-h-screen flex-col gap-4 p-6">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-24" />
                </div>
                <Skeleton className="h-24" />
                <Skeleton className="h-40" />
                <Skeleton className="h-72" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-rose-300">
                <p>Не удалось загрузить данные точки</p>
                <p className="text-sm text-white/60">{String(error)}</p>
                <Button onClick={() => router.refresh()}>Повторить</Button>
            </div>
        );
    }

    const handleAddManager = managerForm.handleSubmit(async (values) => {
        await request('/api/hotel-assignments', {
            body: {
                hotelId,
                displayName: values.displayName.trim(),
                username: values.username?.trim() || undefined,
                pinCode: values.pinCode
            }
        });
        managerForm.reset({ displayName: '', username: '', pinCode: '' });
        mutate();
    });

    const handleUpdateManager = updateManagerForm.handleSubmit(async (values) => {
        const payload = {
            assignmentId: values.assignmentId,
            displayName: values.displayName.trim() || undefined,
            username: values.username.trim() || undefined,
            pinCode: values.pinCode.trim() || undefined
        };

        if (!payload.displayName && !payload.username && !payload.pinCode) {
            updateManagerForm.setError('assignmentId', {
                type: 'manual',
                message: 'Укажите хотя бы одно поле для обновления'
            });
            return;
        }

        await request('/api/hotel-assignments', {
            method: 'PATCH',
            body: payload
        });

        updateManagerForm.reset({
            assignmentId: values.assignmentId,
            displayName: '',
            username: '',
            pinCode: ''
        });
        mutate();
    });

    const handleSelectManagerForEdit = (assignmentId: string) => {
        updateManagerForm.reset({ assignmentId, displayName: '', username: '', pinCode: '' });
        updateManagerForm.setFocus('pinCode');
    };

    const handleAddRooms = roomForm.handleSubmit(async (values) => {
        const labels = values.roomLabels
            .split(/[\n,]+/)
            .map((label) => label.trim())
            .filter(Boolean);

        if (!labels.length) {
            roomForm.setError('roomLabels', { type: 'manual', message: 'Добавьте хотя бы один номер' });
            return;
        }

        await request('/api/rooms', {
            body: {
                hotelId,
                rooms: labels.map((label) => ({
                    label,
                    floor: values.floor?.trim() || undefined,
                    notes: values.notes?.trim() || undefined
                }))
            }
        });

        roomForm.reset({ roomLabels: '', floor: values.floor, notes: '' });
        mutate();
    });

    return (
        <div className="flex min-h-screen flex-col gap-6 p-6 pb-24">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-white/60">Точка</p>
                    <h1 className="text-4xl font-semibold text-white">{data.name}</h1>
                    <p className="text-white/60">{data.address}</p>
                </div>
                <Link href="/">
                    <Button variant="ghost">Назад</Button>
                </Link>
            </div>

            <section className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader title="Номеров" subtitle="Под учётом" />
                    <p className="text-4xl font-semibold text-white">{data.roomCount}</p>
                </Card>
                <Card>
                    <CardHeader title="Занято" subtitle="Сейчас" />
                    <p className="text-4xl font-semibold text-white">{`${data.occupiedRooms}/${data.roomCount}`}</p>
                </Card>
                <Card>
                    <CardHeader title="Менеджеры" subtitle="Назначено" />
                    <p className="text-4xl font-semibold text-white">{data.managers.length}</p>
                </Card>
            </section>

            <Card>
                <CardHeader title="Смена" subtitle="Статус" />
                {data.activeShift ? (
                    <div className="flex flex-wrap items-center gap-4 text-sm text-white/80">
                        <Badge label={`Смена №${data.activeShift.number}`} />
                        <Badge label={`Менеджер ${data.activeShift.manager}`} tone="success" />
                        <p>Открыта {formatBishkekDateTime(data.activeShift.openedAt)}</p>
                        <p>Касса {data.activeShift.openingCash / 100} KGS</p>
                    </div>
                ) : (
                    <p className="text-sm text-white/60">Активной смены нет</p>
                )}
                <div className="mt-4 rounded-2xl border border-white/10 p-3">
                    <p className="text-xs text-white/60">Удаляются все закрытые смены и связанные кассовые операции.</p>
                    <Button
                        type="button"
                        variant="ghost"
                        className="mt-2 w-full border border-white/10 text-sm text-white/80 hover:bg-white/10"
                        onClick={handleClearShiftHistory}
                        disabled={isClearingHistory}
                    >
                        {isClearingHistory ? 'Очищаем…' : 'Очистить историю смен'}
                    </Button>
                </div>
            </Card>

            <Card>
                <CardHeader title="Финансы" subtitle="Только этот отель" />
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Чистый поток</p>
                        <p className="text-3xl font-semibold text-white">{formatCurrency(data.financials.netCash)}</p>
                        <p className="text-xs text-white/60">С учётом корректировок</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 p-4">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Поступления</p>
                            <p className="text-xl font-semibold text-emerald-300">{formatCurrency(data.financials.cashIn)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 p-4">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Списания</p>
                            <p className="text-xl font-semibold text-rose-300">{formatCurrency(data.financials.cashOut)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 p-4">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Платежи менеджерам</p>
                            <p className="text-xl font-semibold text-white">{formatCurrency(data.financials.payouts)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 p-4">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Корректировки</p>
                            <p className="text-xl font-semibold text-white">{formatCurrency(data.financials.adjustments)}</p>
                        </div>
                    </div>
                </div>
            </Card>

            <section className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader title="Менеджеры" subtitle="Управление назначениями" />
                    <div className="space-y-4">
                        <div className="space-y-2">
                            {data.managers.length ? (
                                data.managers.map((manager) => (
                                    <div key={manager.assignmentId} className="flex flex-col gap-3 rounded-2xl border border-white/10 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-white">{manager.displayName}</p>
                                            <p className="text-xs text-white/50">
                                                {manager.username ? `@${manager.username} • ` : ''}
                                                PIN {manager.pinCode ?? 'не задан'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge label="Менеджер" />
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-white/10 text-xs text-white/80 hover:bg-white/10"
                                                onClick={() => handleSelectManagerForEdit(manager.assignmentId)}
                                            >
                                                Редактировать
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-rose-400/40 text-xs text-rose-200 hover:bg-rose-500/10"
                                                onClick={() => handleRemoveManager(manager.assignmentId)}
                                                disabled={removingManagerId === manager.assignmentId}
                                            >
                                                {removingManagerId === manager.assignmentId ? 'Удаляем…' : 'Удалить'}
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-white/60">Назначений пока нет</p>
                            )}
                        </div>
                        <form className="space-y-3" onSubmit={handleAddManager}>
                            <Input placeholder="Имя менеджера" {...managerForm.register('displayName', { required: 'Укажите имя менеджера' })} />
                            {managerForm.formState.errors.displayName && (
                                <p className="text-xs text-rose-300">{managerForm.formState.errors.displayName.message}</p>
                            )}
                            <Input
                                placeholder="PIN (6 цифр)"
                                maxLength={6}
                                inputMode="numeric"
                                {...managerForm.register('pinCode', {
                                    required: 'Укажите PIN',
                                    minLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                    maxLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                    pattern: { value: /^\d{6}$/, message: 'Используйте только цифры' }
                                })}
                            />
                            {managerForm.formState.errors.pinCode && (
                                <p className="text-xs text-rose-300">{managerForm.formState.errors.pinCode.message}</p>
                            )}
                            <Input placeholder="Подпись / @username (необязательно)" {...managerForm.register('username')} />
                            <Button type="submit" className="w-full">
                                Добавить менеджера
                            </Button>
                            <p className="text-center text-xs text-white/50">
                                Telegram не требуется: имя и PIN формируют профиль менеджера.
                            </p>
                        </form>
                        {data.managers.length > 0 && (
                            <form className="space-y-3" onSubmit={handleUpdateManager}>
                                <select
                                    className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                    defaultValue=""
                                    {...updateManagerForm.register('assignmentId', { required: 'Выберите менеджера' })}
                                >
                                    <option value="" className="bg-slate-900 text-white">
                                        Выберите менеджера для обновления
                                    </option>
                                    {data.managers.map((manager) => (
                                        <option key={`edit-${manager.assignmentId}`} value={manager.assignmentId} className="bg-slate-900 text-white">
                                            {manager.displayName}
                                        </option>
                                    ))}
                                </select>
                                {updateManagerForm.formState.errors.assignmentId && (
                                    <p className="text-xs text-rose-300">
                                        {updateManagerForm.formState.errors.assignmentId.message}
                                    </p>
                                )}
                                <Input
                                    placeholder={selectedManager ? `Новое имя (сейчас ${selectedManager.displayName})` : 'Новое имя менеджера'}
                                    {...updateManagerForm.register('displayName')}
                                />
                                <Input
                                    placeholder={selectedManager?.username ? `@${selectedManager.username}` : '@username (необязательно)'}
                                    {...updateManagerForm.register('username')}
                                />
                                <Input
                                    placeholder={selectedManager?.pinCode ? `Новый PIN (сейчас ${selectedManager.pinCode})` : 'Новый PIN (6 цифр)'}
                                    maxLength={6}
                                    inputMode="numeric"
                                    {...updateManagerForm.register('pinCode', {
                                        validate: (value) => {
                                            if (!value.trim()) {
                                                return true;
                                            }
                                            return /^\d{6}$/.test(value) || 'PIN состоит из 6 цифр';
                                        }
                                    })}
                                />
                                {updateManagerForm.formState.errors.pinCode && (
                                    <p className="text-xs text-rose-300">
                                        {updateManagerForm.formState.errors.pinCode.message}
                                    </p>
                                )}
                                <Button type="submit" className="w-full" variant="secondary">
                                    Обновить менеджера
                                </Button>
                                <p className="text-xs text-white/50">
                                    Заполните только те поля, которые хотите изменить. Остальные можно оставить пустыми.
                                </p>
                            </form>
                        )}
                    </div>
                </Card>

                <Card>
                    <CardHeader title="Номера" subtitle="Массовое добавление" />
                    <form className="space-y-3" onSubmit={handleAddRooms}>
                        <TextArea
                            rows={6}
                            placeholder="Номера через запятую или с новой строки: 101, 102"
                            {...roomForm.register('roomLabels', { required: true })}
                        />
                        {roomForm.formState.errors.roomLabels && (
                            <p className="text-xs text-rose-300">{roomForm.formState.errors.roomLabels.message}</p>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                            <Input placeholder="Этаж / корпус" {...roomForm.register('floor')} />
                            <Input placeholder="Комментарий" {...roomForm.register('notes')} />
                        </div>
                        <Button type="submit" className="w-full">
                            Добавить номера
                        </Button>
                        <p className="text-xs text-white/50">
                            Поддерживается множественный ввод: один номер в строке или разделённые запятыми.
                        </p>
                    </form>
                </Card>
            </section>

            <Card>
                <CardHeader title="Список номеров" subtitle="По алфавиту" />
                <div className="grid gap-3 md:grid-cols-2">
                    {data.rooms.length ? (
                        data.rooms.map((room) => {
                            const stay = room.stay ?? null;
                            const guestLabel = stay?.guestName?.trim() || (room.status === 'OCCUPIED' ? 'Гость' : '—');
                            const checkInLabel = stay ? formatStayDate(stay.actualCheckIn ?? stay.scheduledCheckIn) : '—';
                            const checkOutLabel = stay ? formatStayDate(stay.actualCheckOut ?? stay.scheduledCheckOut) : '—';
                            const paymentLabel = stay?.paymentMethod === 'CARD'
                                ? 'Безнал'
                                : stay?.paymentMethod === 'CASH'
                                    ? 'Наличные'
                                    : undefined;
                            const stayStatusLabel = stay
                                ? stay.status === 'CHECKED_IN'
                                    ? 'Заселён'
                                    : stay.status === 'CHECKED_OUT'
                                        ? 'Выселен'
                                        : stay.status === 'SCHEDULED'
                                            ? 'Запланирован'
                                            : 'Отменён'
                                : null;

                            return (
                                <div key={room.id} className="rounded-2xl border border-white/10 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.4em] text-white/40">№ {room.label}</p>
                                            <p className="text-lg font-semibold text-white">{room.notes ?? 'Без описания'}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2 text-right">
                                            <Badge
                                                label={
                                                    room.status === 'OCCUPIED'
                                                        ? 'Занят'
                                                        : room.status === 'DIRTY'
                                                            ? 'Уборка'
                                                            : room.status === 'HOLD'
                                                                ? 'Бронь'
                                                                : 'Свободен'
                                                }
                                                tone={
                                                    room.status === 'OCCUPIED'
                                                        ? 'warning'
                                                        : room.status === 'DIRTY'
                                                            ? 'danger'
                                                            : room.status === 'HOLD'
                                                                ? 'default'
                                                                : 'success'
                                                }
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="text-[11px] text-rose-200 hover:bg-rose-500/10"
                                                onClick={() => handleDeleteRoom(room.id)}
                                                disabled={removingRoomId === room.id}
                                            >
                                                {removingRoomId === room.id ? 'Удаляем…' : 'Удалить'}
                                            </Button>
                                        </div>
                                    </div>
                                    {!room.isActive && <p className="mt-2 text-xs text-rose-300">Выключен из учёта</p>}
                                    {stay ? (
                                        <div className="mt-3 space-y-1 text-sm text-white/70">
                                            <p>Гость: {guestLabel}</p>
                                            <p>Заезд: {checkInLabel}</p>
                                            <p>Выезд: {checkOutLabel}</p>
                                            {stayStatusLabel && <p>Статус: {stayStatusLabel}</p>}
                                            {stay.amountPaid != null && (
                                                <p>
                                                    Оплата: {formatCurrency(stay.amountPaid)}
                                                    {paymentLabel ? ` • ${paymentLabel}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="mt-3 text-sm text-white/60">История поселений отсутствует.</p>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-sm text-white/60">Номеров пока нет</p>
                    )}
                </div>
            </Card>
        </div>
    );
};
