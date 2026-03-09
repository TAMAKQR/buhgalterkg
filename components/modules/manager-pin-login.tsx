'use client';

import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useManualSession } from '@/hooks/useManualSession';

interface ManualLoginResponse {
    success: boolean;
    user?: {
        id: string;
        displayName: string;
        role: string;
    };
}

interface ManagerOption {
    id: string;
    displayName: string;
    username?: string | null;
    hotels: Array<{
        id: string;
        name: string;
        address: string;
    }>;
}

interface ManagerPinLoginProps {
    onAdminMode?: () => void;
    onObserverMode?: () => void;
}

export function ManagerPinLogin({ onAdminMode, onObserverMode }: ManagerPinLoginProps) {
    const { mutate } = useManualSession();
    const { data: managers, isLoading: managersLoading, error: managersError } = useSWR<ManagerOption[]>(
        '/api/manager/manual-login',
        async (url: string) => {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
                throw new Error('Не удалось загрузить список менеджеров');
            }
            return response.json();
        },
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        }
    );

    const [managerId, setManagerId] = useState('');
    const [hotelId, setHotelId] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();

    const selectedManager = managers?.find((manager) => manager.id === managerId);

    const handleManagerChange = (value: string) => {
        setManagerId(value);
        const manager = managers?.find((item) => item.id === value);
        setHotelId(manager?.hotels.length === 1 ? manager.hotels[0].id : '');
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);

        if (!managerId) {
            setError('Выберите менеджера');
            return;
        }

        if (!hotelId) {
            setError('Выберите объект');
            return;
        }

        setPending(true);

        try {
            const response = await fetch('/api/manager/manual-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ managerId, hotelId, pinCode })
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
                    <h1 className="text-xl font-semibold">Вход менеджера</h1>
                    <p className="mt-1 text-sm text-white/50">Выберите свое имя и введите PIN-код.</p>
                </div>
                <form className="space-y-3" onSubmit={handleSubmit}>
                    <Select
                        value={managerId}
                        onChange={(event) => handleManagerChange(event.target.value)}
                        disabled={pending || managersLoading || Boolean(managersError)}
                    >
                        <option value="">
                            {managersLoading ? 'Загружаем менеджеров…' : 'Выберите менеджера'}
                        </option>
                        {managers?.map((manager) => (
                            <option key={manager.id} value={manager.id}>
                                {manager.displayName}
                            </option>
                        ))}
                    </Select>
                    {selectedManager ? (
                        <Select
                            value={hotelId}
                            onChange={(event) => setHotelId(event.target.value)}
                            disabled={pending || selectedManager.hotels.length <= 1}
                        >
                            <option value="">Выберите объект</option>
                            {selectedManager.hotels.map((hotel) => (
                                <option key={hotel.id} value={hotel.id}>
                                    {hotel.name}
                                </option>
                            ))}
                        </Select>
                    ) : null}
                    {selectedManager && hotelId ? (
                        <p className="text-xs text-white/45">
                            {selectedManager.hotels.find((hotel) => hotel.id === hotelId)?.address ?? ''}
                        </p>
                    ) : null}
                    <Input
                        type="password"
                        placeholder="PIN (6 цифр)"
                        maxLength={6}
                        inputMode="numeric"
                        value={pinCode}
                        onChange={(event) => setPinCode(event.target.value.replace(/[^\d]/g, ''))}
                        disabled={pending}
                    />
                    {managersError && <p className="text-xs text-rose-400">Не удалось загрузить список менеджеров</p>}
                    {error && <p className="text-xs text-rose-400">{error}</p>}
                    <Button type="submit" className="w-full" disabled={pending || pinCode.length !== 6 || !managerId || !hotelId || managersLoading}>
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
