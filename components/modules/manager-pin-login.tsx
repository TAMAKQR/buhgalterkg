'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCountryContext } from '@/hooks/useCountryContext';
import { useManualSession } from '@/hooks/useManualSession';

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
        <div className="flex min-h-screen items-center justify-center bg-night px-4 text-white">
            <Card className="w-full max-w-sm space-y-5 p-5">
                <div>
                    <h1 className="text-xl font-semibold">Вход менеджера</h1>
                    <p className="mt-1 text-sm text-white/50">Введите назначенный логин и PIN-код.</p>
                </div>
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <Input
                        type="text"
                        placeholder="Логин"
                        autoComplete="username"
                        value={login}
                        onChange={(event) => setLogin(event.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                        disabled={pending}
                    />
                    <Input
                        type="password"
                        placeholder="PIN (6 цифр)"
                        maxLength={6}
                        inputMode="numeric"
                        autoComplete="current-password"
                        value={pinCode}
                        onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))}
                        disabled={pending}
                    />
                    {error && <p className="text-xs text-rose-400">{error}</p>}
                    <Button type="submit" className="w-full" disabled={pending || pinCode.length !== 6 || !login.trim()}>
                        {pending ? 'Вход…' : 'Войти'}
                    </Button>
                </form>
                <button
                    type="button"
                    className="block w-full text-center text-xs text-white/40 transition-colors hover:text-white/60"
                    onClick={onAdminMode}
                >
                    Войти как администратор
                </button>
                <button
                    type="button"
                    className="block w-full text-center text-xs text-white/40 transition-colors hover:text-white/60"
                    onClick={onObserverMode}
                >
                    Войти как наблюдатель
                </button>
            </Card>
        </div>
    );
}
