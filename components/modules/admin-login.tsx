'use client';

import { FormEvent, useState } from 'react';

import { useTelegramContext } from '@/components/providers/telegram-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { SessionUser } from '@/lib/types';

interface ManualLoginResponse {
    token: string;
    user: SessionUser;
}

export function AdminLoginGate() {
    const { manualLogin, manualMode, loading } = useTelegramContext();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setPending(true);

        try {
            const response = await fetch('/api/admin/manual-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'Ошибка входа');
            }

            const data = (await response.json()) as ManualLoginResponse;
            manualLogin(data.token, data.user);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
            <Card className="w-full max-w-md space-y-5 bg-white/5 p-6 text-white">
                <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-white/40">Веб-доступ</p>
                    <h1 className="text-2xl font-semibold">Вход для администраторов</h1>
                    <p className="text-sm text-white/60">Введите учётные данные, если запускаете приложение вне Telegram.</p>
                </div>
                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                        <Input
                            placeholder="Логин"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            disabled={pending || loading}
                            autoComplete="username"
                        />
                        <Input
                            type="password"
                            placeholder="Пароль"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            disabled={pending || loading}
                            autoComplete="current-password"
                        />
                        {error && <p className="text-xs text-rose-300">{error}</p>}
                    </div>
                    <Button type="submit" className="w-full" disabled={pending || !username || !password}>
                        {pending ? 'Проверяем…' : 'Войти'}
                    </Button>
                    {manualMode && <p className="text-center text-xs text-emerald-300">Сессия активна</p>}
                </form>
                <p className="text-xs text-white/50">
                    Для быстрой работы используйте Telegram WebApp. Логин по паролю нужен только в браузере.
                </p>
            </Card>
        </div>
    );
}
