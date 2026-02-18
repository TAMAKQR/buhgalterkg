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
    onObserverMode?: () => void;
}

export function ManagerPinLogin({ onAdminMode, onObserverMode }: ManagerPinLoginProps) {
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
        <div className="flex min-h-screen items-center justify-center bg-night px-4 text-white">
            <Card className="w-full max-w-sm space-y-5 p-5">
                <div>
                    <h1 className="text-xl font-semibold">Вход по PIN</h1>
                </div>
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <Input
                        type="password"
                        placeholder="PIN (6 цифр)"
                        maxLength={6}
                        inputMode="numeric"
                        value={pinCode}
                        onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))}
                        disabled={pending}
                    />
                    {error && <p className="text-xs text-rose-400">{error}</p>}
                    <Button type="submit" className="w-full" disabled={pending || pinCode.length !== 6}>
                        {pending ? 'Вход…' : 'Войти'}
                    </Button>
                </form>
                <button
                    type="button"
                    className="block w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors"
                    onClick={onAdminMode}
                >
                    Войти как администратор
                </button>
                <button
                    type="button"
                    className="block w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors"
                    onClick={onObserverMode}
                >
                    Войти как наблюдатель
                </button>
            </Card>
        </div>
    );
}
