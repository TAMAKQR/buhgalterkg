"use client";

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SyncStatus = {
    configured: boolean;
    enabled: boolean;
    propertyId: string;
    clientId: string;
    hasClientSecret: boolean;
    configuredAt: string | null;
    total: number;
    assigned: number;
    unassigned: number;
    activeUnassigned: number;
    lastSyncedAt: string | null;
};

type SyncResult = {
    summaries: number;
    detailsLoaded: number;
    created: number;
    updated: number;
    cancelled: number;
    unassigned: number;
    skippedPast: number;
    failed: Array<{ number: string; error: string }>;
};

type ConnectionForm = {
    enabled: boolean;
    propertyId: string;
    clientId: string;
    clientSecret: string;
};

const emptyForm: ConnectionForm = {
    enabled: false,
    propertyId: '',
    clientId: '',
    clientSecret: '',
};

export function ExelySyncPanel({ hotelId, country }: { hotelId: string; country: string }) {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [form, setForm] = useState<ConnectionForm>(emptyForm);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const endpoint = `/api/admin/hotels/${hotelId}/exely-sync?country=${encodeURIComponent(country)}`;

    const applyStatus = useCallback((payload: SyncStatus) => {
        setStatus(payload);
        setForm({
            enabled: payload.enabled,
            propertyId: payload.propertyId,
            clientId: payload.clientId,
            clientSecret: '',
        });
    }, []);

    useEffect(() => {
        let active = true;
        setStatus(null);
        setForm(emptyForm);
        setResult(null);
        setMessage(null);
        setError(null);
        fetch(endpoint, { credentials: 'include', cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(await response.text() || 'Не удалось получить статус Exely');
                return response.json() as Promise<SyncStatus>;
            })
            .then((payload) => { if (active) applyStatus(payload); })
            .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Ошибка Exely'); });
        return () => { active = false; };
    }, [applyStatus, endpoint]);

    const saveConnection = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch(endpoint, {
                method: 'PUT',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    enabled: form.enabled,
                    propertyId: form.propertyId.trim(),
                    clientId: form.clientId.trim(),
                    ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret.trim() } : {}),
                }),
            });
            if (!response.ok) throw new Error(await response.text() || 'Не удалось сохранить подключение Exely');
            applyStatus(await response.json() as SyncStatus);
            setMessage(form.enabled ? 'Exely подключён к этому отелю.' : 'Настройки сохранены, подключение выключено.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Ошибка сохранения Exely');
        } finally {
            setSaving(false);
        }
    };

    const removeConnection = async () => {
        if (!window.confirm('Удалить подключение Exely у этого отеля? Уже импортированные брони останутся в системе.')) return;
        setRemoving(true);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch(endpoint, { method: 'DELETE', credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text() || 'Не удалось удалить подключение Exely');
            applyStatus(await response.json() as SyncStatus);
            setResult(null);
            setMessage('Подключение Exely удалено.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Ошибка удаления Exely');
        } finally {
            setRemoving(false);
        }
    };

    const sync = async () => {
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch(endpoint, {
                method: 'POST', credentials: 'include', cache: 'no-store',
                headers: { 'content-type': 'application/json' }, body: '{}',
            });
            if (!response.ok) throw new Error(await response.text() || 'Синхронизация Exely завершилась ошибкой');
            const payload = await response.json() as { result: SyncResult; status: SyncStatus };
            setResult(payload.result);
            applyStatus(payload.status);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Ошибка синхронизации Exely');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-400/15 dark:bg-violet-400/[0.05]">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Exely</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status?.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/55'}`}>
                            {status?.enabled ? 'Подключён' : status?.configured ? 'Выключен' : 'Не настроен'}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-white/55">
                        Настройки действуют только для выбранного отеля. Брони синхронизируются без оплат.
                    </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-white/70">
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                        disabled={saving || removing}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600"
                    />
                    Использовать Exely
                </label>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <label className="text-xs text-slate-600 dark:text-white/55">
                    <span className="mb-1 block font-medium">property_id</span>
                    <Input
                        value={form.propertyId}
                        onChange={(event) => setForm((current) => ({ ...current, propertyId: event.target.value }))}
                        placeholder="Например, 514487"
                        autoComplete="off"
                        disabled={saving || removing}
                    />
                </label>
                <label className="text-xs text-slate-600 dark:text-white/55">
                    <span className="mb-1 block font-medium">client_id</span>
                    <Input
                        value={form.clientId}
                        onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
                        placeholder="api_connection_..."
                        autoComplete="off"
                        disabled={saving || removing}
                    />
                </label>
                <label className="text-xs text-slate-600 dark:text-white/55">
                    <span className="mb-1 block font-medium">client_secret</span>
                    <Input
                        type="password"
                        value={form.clientSecret}
                        onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))}
                        placeholder={status?.hasClientSecret ? 'Сохранён · оставьте пустым без изменений' : 'Введите client_secret'}
                        autoComplete="new-password"
                        disabled={saving || removing}
                    />
                </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    onClick={saveConnection}
                    disabled={saving || removing || !form.propertyId.trim() || !form.clientId.trim() || (!status?.hasClientSecret && !form.clientSecret.trim())}
                    className="gap-2"
                >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {saving ? (form.enabled ? 'Проверяем подключение…' : 'Сохраняем…') : 'Сохранить настройки'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={sync} disabled={loading || saving || removing || !status?.enabled} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {loading ? 'Синхронизация…' : 'Синхронизировать брони'}
                </Button>
                {status?.configured ? (
                    <Button type="button" size="sm" variant="ghost" onClick={removeConnection} disabled={loading || saving || removing} className="gap-2 text-rose-600 dark:text-rose-300">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        {removing ? 'Удаляем…' : 'Удалить подключение'}
                    </Button>
                ) : null}
            </div>

            {status?.configured ? (
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-violet-200/70 pt-3 text-xs sm:grid-cols-4 dark:border-violet-300/10">
                    <div><span className="text-slate-500 dark:text-white/45">Получено</span><strong className="block text-slate-900 dark:text-white">{status.total}</strong></div>
                    <div><span className="text-slate-500 dark:text-white/45">Назначено</span><strong className="block text-slate-900 dark:text-white">{status.assigned}</strong></div>
                    <div><span className="text-slate-500 dark:text-white/45">Без номера</span><strong className="block text-amber-700 dark:text-amber-300">{status.activeUnassigned}</strong></div>
                    <div><span className="text-slate-500 dark:text-white/45">Последняя синхронизация</span><strong className="block text-slate-900 dark:text-white">{status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString('ru-RU') : '—'}</strong></div>
                </div>
            ) : null}
            {result ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">Создано: {result.created} · обновлено: {result.updated} · отменено: {result.cancelled} · без номера: {result.unassigned}{result.failed.length ? ` · ошибок: ${result.failed.length}` : ''}</p> : null}
            {message ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
            {error ? <p className="mt-3 break-words text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
        </div>
    );
}
