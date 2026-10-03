'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/ui/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCountryContext } from '@/hooks/useCountryContext';
import { useManualSession } from '@/hooks/useManualSession';
import { ArrowRight, Building2, Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface ManualLoginResponse {
    success: boolean;
    user?: {
        id: string;
        displayName: string;
        role: string;
    };
}

interface ManagerPinLoginProps {
    onAdminMode?: () => void;
    onObserverMode?: () => void;
}

const formatRetryTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    }

    return [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
};

const readRetryAfterSeconds = (value: string | null) => {
    const normalized = value?.trim();
    if (!normalized || !/^\d+$/.test(normalized)) return null;

    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
};

export function ManagerPinLogin({ onAdminMode, onObserverMode }: ManagerPinLoginProps) {
    const { mutate } = useManualSession();
    const { withCountry } = useCountryContext();
    const [login, setLogin] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    const [retryUntil, setRetryUntil] = useState<number | null>(null);
    const [retrySeconds, setRetrySeconds] = useState(0);

    useEffect(() => {
        if (retryUntil === null) return;

        const updateCountdown = () => {
            const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
            setRetrySeconds(remaining);
            if (remaining === 0) {
                setRetryUntil(null);
                setError(undefined);
            }
        };

        updateCountdown();
        const intervalId = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(intervalId);
    }, [retryUntil]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (retrySeconds > 0) return;

        setError(undefined);

        const normalizedLogin = login.trim().toLowerCase();
        if (!normalizedLogin) {
            setError('Введите логин');
            return;
        }

        setPending(true);

        try {
            const response = await fetch(withCountry('/api/manager/manual-login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ login: normalizedLogin, pinCode })
            });

            if (!response.ok) {
                const message = await response.text();
                if (response.status === 429) {
                    const retryAfterSeconds = readRetryAfterSeconds(response.headers.get('Retry-After'));
                    if (retryAfterSeconds !== null) {
                        setRetrySeconds(retryAfterSeconds);
                        setRetryUntil(Date.now() + retryAfterSeconds * 1000);
                    }
                }
                throw new Error(message || 'Неверный логин или PIN');
            }

            const data = (await response.json()) as ManualLoginResponse;

            if (data.success) {
                await mutate();
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthShell
            title="С возвращением"
            description="Войдите, чтобы продолжить работу"
            icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            footer={(
                <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                    <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/[0.05] dark:hover:text-slate-200" onClick={onAdminMode}><ShieldCheck className="h-3.5 w-3.5" />Администратор</button>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/[0.05] dark:hover:text-slate-200" onClick={onObserverMode}><Eye className="h-3.5 w-3.5" />Управляющий отеля</button>
                </div>
            )}
        >
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Логин</span>
                    <Input type="text" placeholder="Введите логин" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(event) => setLogin(event.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} disabled={pending} />
                </label>
                <div className="space-y-1.5">
                    <label htmlFor="manager-pin-code" className="block text-xs font-medium text-slate-600 dark:text-slate-400">PIN-код</label>
                    <div className="relative">
                        <Input id="manager-pin-code" className="pr-11 font-mono text-base tracking-[0.35em]" type={showPin ? 'text' : 'password'} placeholder="••••••" maxLength={6} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={pinCode} onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))} disabled={pending} />
                        <button
                            type="button"
                            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            onClick={() => setShowPin((visible) => !visible)}
                            aria-label={showPin ? 'Скрыть PIN' : 'Показать PIN'}
                            aria-pressed={showPin}
                            title={showPin ? 'Скрыть PIN' : 'Показать PIN'}
                            disabled={pending}
                        >
                            {showPin ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    </div>
                </div>
                {error && (
                    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                        {retrySeconds > 0
                            ? <>Превышено число попыток. Повторите через <span aria-live="off" className="font-mono font-semibold">{formatRetryTime(retrySeconds)}</span></>
                            : error}
                    </p>
                )}
                <Button type="submit" className="w-full gap-2" disabled={pending || retrySeconds > 0 || pinCode.length !== 6 || !login.trim()}>
                    {pending
                        ? 'Проверяем…'
                        : retrySeconds > 0
                            ? `Повторить через ${formatRetryTime(retrySeconds)}`
                            : 'Продолжить'}
                    {!pending && retrySeconds === 0 && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </Button>
            </form>
        </AuthShell>
    );
}
