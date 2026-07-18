'use client';

import { FormEvent, useState } from 'react';

import { useCountryContext } from '@/hooks/useCountryContext';
import { useManualSession } from '@/hooks/useManualSession';
import { AuthShell } from '@/components/ui/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldCheck } from 'lucide-react';

interface ManualLoginResponse {
    success: boolean;
    user?: {
        id: string;
        displayName: string;
        role: string;
    };
}

interface AdminLoginGateProps {
    onBack?: () => void;
    contextError?: string;
}

export function AdminLoginGate({ onBack, contextError }: AdminLoginGateProps = {}) {
    const { mutate } = useManualSession();
    const { withCountry } = useCountryContext();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setPending(true);

        try {
            const response = await fetch(withCountry('/api/admin/manual-login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'Ошибка входа');
            }

            const data = (await response.json()) as ManualLoginResponse;

            if (data.success) {
                // Trigger session refresh
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
            title="Вход администратора"
            description="Управление объектами и доступами"
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
            onBack={onBack}
        >
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                {contextError ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">{contextError}</p> : null}
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Логин</span>
                    <Input
                        placeholder="Введите логин"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        disabled={pending}
                        autoComplete="username"
                    />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Пароль</span>
                    <Input
                        type="password"
                        placeholder="Введите пароль"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={pending}
                        autoComplete="current-password"
                    />
                </label>
                {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending || !username || !password}>
                    {pending ? 'Вход…' : 'Войти'}
                </Button>
            </form>
        </AuthShell>
    );
}
