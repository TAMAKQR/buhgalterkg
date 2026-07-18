'use client';

import { FormEvent, useState } from 'react';

import { useCountryContext } from '@/hooks/useCountryContext';
import { useManualSession } from '@/hooks/useManualSession';
import { AuthShell } from '@/components/ui/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye } from 'lucide-react';

interface ObserverLoginProps {
    onBack?: () => void;
}

export function ObserverLogin({ onBack }: ObserverLoginProps) {
    const { mutate } = useManualSession();
    const { withCountry } = useCountryContext();
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setPending(true);

        try {
            const response = await fetch(withCountry('/api/observer/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ login, password }),
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'Ошибка входа');
            }

            const data = await response.json();
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
            title="Вход наблюдателя"
            description="Просмотр сводок без редактирования"
            icon={<Eye className="h-5 w-5" aria-hidden="true" />}
            onBack={onBack}
        >
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Логин</span>
                    <Input
                        placeholder="Введите логин"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
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
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={pending}
                        autoComplete="current-password"
                    />
                </label>
                {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending || !login || !password}>
                    {pending ? 'Вход…' : 'Войти'}
                </Button>
            </form>
        </AuthShell>
    );
}
