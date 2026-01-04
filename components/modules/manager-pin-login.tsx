'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
}

export function ManagerPinLogin({ onAdminMode }: ManagerPinLoginProps) {
    const { mutate } = useManualSession();
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
                throw new Error(message || 'Неверный PIN-код');
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
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-3 py-8 text-white sm:px-6">
            <Card className="w-full max-w-md space-y-5 bg-white/5 p-6">
                <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.4em] text-white/40">Панель менеджера</p>
                    <h1 className="text-2xl font-semibold">Вход по PIN</h1>
                    <p className="text-sm text-white/60">
                        Введите PIN-код менеджера, который назначил администратор.
                    </p>
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
                            disabled={pending}
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
