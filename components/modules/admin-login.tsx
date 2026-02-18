'use client';

import { FormEvent, useState } from 'react';

import { useManualSession } from '@/hooks/useManualSession';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ManualLoginResponse {
    success: boolean;
    user?: {
        id: string;
        displayName: string;
        role: string;
    };
}

interface AdminLoginGateProps {
    embed?: boolean;
    onBack?: () => void;
    contextError?: string;
}

export function AdminLoginGate({ embed = false, onBack, contextError }: AdminLoginGateProps = {}) {
    const { mutate } = useManualSession();
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

    const card = (
        <Card className="w-full max-w-sm space-y-5 p-5 text-white">
            <div className="space-y-1">
                {onBack && (
                    <button type="button" className="text-xs text-white/40 hover:text-white/70 transition-colors" onClick={onBack}>
                        ← Назад
                    </button>
                )}
                <h1 className="text-xl font-semibold">Вход</h1>
                {contextError && <p className="text-xs text-amber-300/90">{contextError}</p>}
            </div>
            <form className="space-y-3" onSubmit={handleSubmit}>
                <Input
                    placeholder="Логин"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={pending}
                    autoComplete="username"
                />
                <Input
                    type="password"
                    placeholder="Пароль"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={pending}
                    autoComplete="current-password"
                />
                {error && <p className="text-xs text-rose-400">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending || !username || !password}>
                    {pending ? 'Вход…' : 'Войти'}
                </Button>
            </form>
        </Card>
    );

    if (embed) {
        return card;
    }

    return <div className="flex min-h-screen items-center justify-center bg-night px-4">{card}</div>;
}
