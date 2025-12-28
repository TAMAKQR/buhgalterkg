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

interface ManagerPinLoginProps {
    onAdminMode?: () => void;
    contextError?: string;
}

export function ManagerPinLogin({ onAdminMode, contextError }: ManagerPinLoginProps) {
    const { manualLogin, loading } = useTelegramContext();
    const [pinCode, setPinCode] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setPending(true);

        try {
            const response = await fetch('/api/manager/manual-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinCode })
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'Не удалось подтвердить PIN');
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
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-white">
            <Card className="w-full max-w-md space-y-5 bg-white/5 p-6">
                <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.4em] text-white/40">Веб-панель</p>
                    <h1 className="text-2xl font-semibold">Вход по PIN</h1>
                    <p className="text-sm text-white/60">
                        Откройте смену без Telegram. Введите код менеджера, который выдали администраторы.
                    </p>
                    {contextError && <p className="text-xs text-amber-300/90">{contextError}</p>}
                </div>
                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                        <Input
                            type="password"
                            placeholder="PIN (6 цифр)"
                            maxLength={6}
                            inputMode="numeric"
                            value={pinCode}
                            onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))}
                            disabled={pending || loading}
                        />
                        {error && <p className="text-xs text-rose-300">{error}</p>}
                    </div>
                    <Button type="submit" className="w-full" disabled={pending || pinCode.length !== 6}>
                        {pending ? 'Проверяем…' : 'Войти'}
                    </Button>
                </form>
                <div className="space-y-1 text-center text-xs text-white/60">
                    <p>Нужен доступ администратора?</p>
                    <button
                        type="button"
                        className="text-white underline-offset-4 hover:underline"
                        onClick={onAdminMode}
                    >
                        Войти по логину и паролю
                    </button>
                </div>
            </Card>
        </div>
    );
}
