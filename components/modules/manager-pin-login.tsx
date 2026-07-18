'use client';

import { FormEvent, useState } from 'react';
import { AuthShell } from '@/components/ui/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCountryContext } from '@/hooks/useCountryContext';
import { useManualSession } from '@/hooks/useManualSession';
import { ArrowRight, Building2, Eye, ShieldCheck } from 'lucide-react';

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

export function ManagerPinLogin({ onAdminMode, onObserverMode }: ManagerPinLoginProps) {
    const { mutate } = useManualSession();
    const { withCountry } = useCountryContext();
    const [login, setLogin] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
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
                <div className="flex items-center justify-center gap-1 text-xs">
                    <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/[0.05] dark:hover:text-slate-200" onClick={onAdminMode}><ShieldCheck className="h-3.5 w-3.5" />Администратор</button>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/[0.05] dark:hover:text-slate-200" onClick={onObserverMode}><Eye className="h-3.5 w-3.5" />Наблюдатель</button>
                </div>
            )}
        >
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Логин</span>
                    <Input type="text" placeholder="Введите логин" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(event) => setLogin(event.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} disabled={pending} />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">PIN-код</span>
                    <Input className="font-mono text-base tracking-[0.35em]" type="password" placeholder="••••••" maxLength={6} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={pinCode} onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))} disabled={pending} />
                </label>
                {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
                <Button type="submit" className="w-full gap-2" disabled={pending || pinCode.length !== 6 || !login.trim()}>
                    {pending ? 'Проверяем…' : 'Продолжить'}
                    {!pending && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </Button>
            </form>
        </AuthShell>
    );
}
