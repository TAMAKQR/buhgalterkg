'use client';

import QRCode from 'qrcode';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

type GuestHotel = {
    id: string;
    name: string;
    address: string;
    city?: string | null;
    country?: string | null;
};

type GuestProfileResult = {
    guest: {
        id: string;
        fullName: string;
        phone?: string | null;
        documentNumber?: string | null;
        hotelId?: string | null;
    };
    qr: {
        code: string;
        expiresAt?: string | null;
    };
};

type TelegramWebAppUser = {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
};

type TelegramWebApp = {
    initData?: string;
    initDataUnsafe?: {
        user?: TelegramWebAppUser;
    };
    ready?: () => void;
    expand?: () => void;
};

declare global {
    interface Window {
        Telegram?: {
            WebApp?: TelegramWebApp;
        };
    }
}

const storedGuestKey = 'hotel-ops-guest-profile';

const formatTelegramName = (user?: TelegramWebAppUser | null) =>
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();

export const GuestApp = () => {
    const [hotels, setHotels] = useState<GuestHotel[]>([]);
    const [hotelId, setHotelId] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [isLoadingHotels, setIsLoadingHotels] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<GuestProfileResult | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [telegramInitData, setTelegramInitData] = useState('');
    const [telegramUser, setTelegramUser] = useState<TelegramWebAppUser | null>(null);

    useEffect(() => {
        const saved = localStorage.getItem(storedGuestKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as GuestProfileResult;
                setProfile(parsed);
                setFullName(parsed.guest.fullName ?? '');
                setPhone(parsed.guest.phone ?? '');
                setDocumentNumber(parsed.guest.documentNumber ?? '');
                setHotelId(parsed.guest.hotelId ?? '');
            } catch {
                localStorage.removeItem(storedGuestKey);
            }
        }

        fetch('/api/guest/hotels', { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Не удалось загрузить отели');
                }
                return response.json() as Promise<{ hotels: GuestHotel[] }>;
            })
            .then((result) => {
                setHotels(result.hotels);
                setHotelId((current) => current || result.hotels[0]?.id || '');
            })
            .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Ошибка загрузки'))
            .finally(() => setIsLoadingHotels(false));
    }, []);

    useEffect(() => {
        const webApp = window.Telegram?.WebApp;
        if (!webApp) {
            return;
        }

        webApp.ready?.();
        webApp.expand?.();

        const user = webApp.initDataUnsafe?.user ?? null;
        const telegramName = formatTelegramName(user);

        setTelegramInitData(webApp.initData ?? '');
        setTelegramUser(user);

        if (telegramName) {
            setFullName((current) => current.trim() ? current : telegramName);
        }
    }, []);

    useEffect(() => {
        if (!profile?.qr.code) {
            setQrDataUrl(null);
            return;
        }

        QRCode.toDataURL(profile.qr.code, {
            margin: 2,
            width: 280,
            color: {
                dark: '#020617',
                light: '#ffffff'
            }
        })
            .then(setQrDataUrl)
            .catch(() => setQrDataUrl(null));
    }, [profile?.qr.code]);

    const selectedHotel = useMemo(
        () => hotels.find((hotel) => hotel.id === hotelId) ?? null,
        [hotelId, hotels]
    );

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!fullName.trim()) {
            setError('Укажите имя и фамилию');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch('/api/guest/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hotelId: hotelId || undefined,
                    fullName: fullName.trim(),
                    phone: phone.trim() || undefined,
                    telegramInitData: telegramInitData || undefined,
                    documentNumber: documentNumber.trim() || undefined
                })
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const result = await response.json() as GuestProfileResult;
            setProfile(result);
            localStorage.setItem(storedGuestKey, JSON.stringify(result));
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Не удалось создать QR');
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetProfile = () => {
        localStorage.removeItem(storedGuestKey);
        setProfile(null);
        setQrDataUrl(null);
    };

    return (
        <main className="min-h-screen bg-slate-950 px-4 py-5 text-white">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
                <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
                    <p className="text-xs uppercase tracking-[0.22em] text-sky-200/65">Hotel Guest</p>
                    <h1 className="mt-2 text-2xl font-semibold">Мой гостевой QR</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                        Заполните данные один раз. На ресепшене менеджер сканирует код и быстро создаст заселение.
                    </p>
                    {telegramUser ? (
                        <div className="mt-3 inline-flex rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs text-sky-100">
                            Telegram: {formatTelegramName(telegramUser) || telegramUser.username || telegramUser.id}
                        </div>
                    ) : null}
                </section>

                {profile ? (
                    <section className="rounded-2xl border border-white/10 bg-white p-4 text-slate-950 shadow-xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Гость</p>
                                <h2 className="mt-1 text-xl font-semibold">{profile.guest.fullName}</h2>
                                <p className="text-sm text-slate-500">{selectedHotel?.name ?? 'Отель выбран'}</p>
                            </div>
                            <Button type="button" size="sm" variant="ghost" onClick={resetProfile}>
                                Изменить
                            </Button>
                        </div>

                        <div className="mt-4 flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            {qrDataUrl ? (
                                <img src={qrDataUrl} alt="QR гостя" className="h-64 w-64 rounded-xl bg-white" />
                            ) : (
                                <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-white text-sm text-slate-500">
                                    Генерируем QR
                                </div>
                            )}
                            <p className="mt-3 rounded-full bg-slate-950 px-4 py-2 font-mono text-lg font-semibold tracking-[0.18em] text-white">
                                {profile.qr.code}
                            </p>
                            <p className="mt-2 text-center text-xs leading-5 text-slate-500">
                                Если камера не считает QR, покажите менеджеру этот код.
                            </p>
                        </div>
                    </section>
                ) : (
                    <form className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl" onSubmit={handleSubmit}>
                        <div className="space-y-3">
                            <label className="block">
                                <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-slate-400">Отель</span>
                                <Select
                                    value={hotelId}
                                    onChange={(event) => setHotelId(event.target.value)}
                                    disabled={isLoadingHotels}
                                    className="text-white"
                                >
                                    {hotels.map((hotel) => (
                                        <option key={hotel.id} value={hotel.id}>
                                            {hotel.name}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-slate-400">Имя и фамилия</span>
                                <Input
                                    value={fullName}
                                    onChange={(event) => setFullName(event.target.value)}
                                    placeholder="Например, Азамат Ибраев"
                                    className="text-white"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-slate-400">Телефон</span>
                                <Input
                                    value={phone}
                                    onChange={(event) => setPhone(event.target.value)}
                                    placeholder="+996..."
                                    className="text-white"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-slate-400">Документ</span>
                                <Input
                                    value={documentNumber}
                                    onChange={(event) => setDocumentNumber(event.target.value)}
                                    placeholder="Паспорт или ID, можно позже"
                                    className="text-white"
                                />
                            </label>
                        </div>

                        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

                        <Button type="submit" className="mt-4 w-full py-3" disabled={isSubmitting || isLoadingHotels}>
                            {isSubmitting ? 'Создаем...' : 'Получить QR'}
                        </Button>
                    </form>
                )}
            </div>
        </main>
    );
};
