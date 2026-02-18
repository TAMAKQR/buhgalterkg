'use client';

import { FormEvent, useState } from 'react';

import { useManualSession } from '@/hooks/useManualSession';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ObserverLoginProps {
    onBack?: () => void;
}

export function ObserverLogin({ onBack }: ObserverLoginProps) {
    const { mutate } = useManualSession();
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setPending(true);

        try {
            const response = await fetch('/api/observer/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        <div className="flex min-h-screen items-center justify-center bg-night px-4">
            <Card className="w-full max-w-sm space-y-5 p-5 text-white">
                <div className="space-y-1">
                    {onBack && (
                        <button type="button" className="text-xs text-white/40 hover:text-white/70 transition-colors" onClick={onBack}>
                            ← Назад
                        </button>
                    )}
                    <h1 className="text-xl font-semibold">Наблюдатель</h1>
                    <p className="text-xs text-white/40">Только просмотр</p>
                </div>
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <Input
                        placeholder="Логин"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        disabled={pending}
                        autoComplete="username"
                    />
                    <Input
                        type="password"
                        placeholder="Пароль"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={pending}
                        autoComplete="current-password"
                    />
                    {error && <p className="text-xs text-rose-400">{error}</p>}
                    <Button type="submit" className="w-full" disabled={pending || !login || !password}>
                        {pending ? 'Вход…' : 'Войти'}
                    </Button>
                </form>
            </Card>
        </div>
    );
}
