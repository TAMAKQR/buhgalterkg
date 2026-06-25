'use client';

import QRCode from 'qrcode';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { BadgeCheck, Building2, CheckCircle2, FileText, QrCode, ShieldCheck, Smartphone, UserRound } from 'lucide-react';

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

const formatExpiry = (value?: string | null) => {
    if (!value) {
        return null;
    }

    try {
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(value));
    } catch {
        return null;
    }
};

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
    const profileHotel = useMemo(
        () => hotels.find((hotel) => hotel.id === profile?.guest.hotelId) ?? selectedHotel,
        [hotels, profile?.guest.hotelId, selectedHotel]
    );
    const telegramLabel = telegramUser ? formatTelegramName(telegramUser) || telegramUser.username || String(telegramUser.id) : '';
    const isTelegramLinked = Boolean(telegramInitData && telegramUser);
    const hasDocumentNumber = Boolean((profile?.guest.documentNumber ?? documentNumber).trim());
    const expiryLabel = formatExpiry(profile?.qr.expiresAt);

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
        <main className="min-h-screen bg-[#f3f6fb] px-4 py-4 text-slate-950">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
                <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-[0_24px_70px_-36px_rgba(15,23,42,0.7)]">
                    <div className="bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.28),transparent_32%),linear-gradient(135deg,#0f172a,#111827)] p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.22em] text-sky-100/70">GuestPass</p>
                                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Быстрое заселение</h1>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-2.5">
                                <QrCode className="h-5 w-5" aria-hidden="true" />
                            </div>
                        </div>
                        <p className="mt-4 max-w-sm text-sm leading-6 text-slate-200/80">
                            Заполните профиль один раз. Менеджер сканирует QR, сверяет документ на стойке и заселяет без повторного ручного ввода.
                        </p>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-2">
                                <Smartphone className="mb-1 h-4 w-4 text-sky-200" aria-hidden="true" />
                                Telegram
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-2">
                                <FileText className="mb-1 h-4 w-4 text-sky-200" aria-hidden="true" />
                                Документ
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-2">
                                <ShieldCheck className="mb-1 h-4 w-4 text-sky-200" aria-hidden="true" />
                                Проверка
                            </div>
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.45)]">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Статус профиля</p>
                            <h2 className="mt-1 text-lg font-semibold">{profile ? 'QR готов' : 'Нужно заполнить данные'}</h2>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${profile ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {profile ? 'Активен' : 'Новый'}
                        </span>
                    </div>
                    <div className="mt-4 grid gap-2">
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                                <Smartphone className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                Telegram
                            </span>
                            <span className={`text-xs font-semibold ${isTelegramLinked ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {isTelegramLinked ? telegramLabel || 'подключен' : 'не подключен'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                                <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                Документ
                            </span>
                            <span className={`text-xs font-semibold ${hasDocumentNumber ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {hasDocumentNumber ? 'номер указан' : 'можно позже'}
                            </span>
                        </div>
                    </div>
                </section>

                {profile ? (
                    <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.45)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Гость</p>
                                <h2 className="mt-1 truncate text-xl font-semibold">{profile.guest.fullName}</h2>
                                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-500">
                                    <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    {profileHotel?.name ?? 'Отель выбран'}
                                </p>
                            </div>
                            <Button type="button" size="sm" variant="secondary" onClick={resetProfile}>
                                Изменить
                            </Button>
                        </div>

                        <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-col items-center rounded-[22px] bg-white p-3 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
                                {qrDataUrl ? (
                                    <img src={qrDataUrl} alt="QR гостя" className="h-64 w-64 rounded-2xl bg-white" />
                                ) : (
                                    <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-white text-sm text-slate-500">
                                        Генерируем QR
                                    </div>
                                )}
                                <p className="mt-3 rounded-full bg-slate-950 px-4 py-2 font-mono text-base font-semibold tracking-[0.18em] text-white">
                                    {profile.qr.code}
                                </p>
                            </div>
                            <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm leading-5 text-emerald-800">
                                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>
                                    Покажите QR менеджеру. Документ сверяется глазами на стойке; фото паспорта в чат отправлять не нужно.
                                </span>
                            </div>
                            {expiryLabel ? (
                                <p className="mt-2 text-center text-xs text-slate-500">QR активен до {expiryLabel}</p>
                            ) : null}
                        </div>
                    </section>
                ) : (
                    <form className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.45)]" onSubmit={handleSubmit}>
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-slate-100 p-2.5">
                                <UserRound className="h-5 w-5 text-slate-600" aria-hidden="true" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Профиль гостя</h2>
                                <p className="text-sm text-slate-500">Эти данные подтянутся при сканировании QR.</p>
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Отель</span>
                                <Select
                                    value={hotelId}
                                    onChange={(event) => setHotelId(event.target.value)}
                                    disabled={isLoadingHotels || hotels.length === 0}
                                >
                                    {hotels.length ? hotels.map((hotel) => (
                                        <option key={hotel.id} value={hotel.id}>
                                            {hotel.name}
                                        </option>
                                    )) : (
                                        <option value="">Нет доступных объектов</option>
                                    )}
                                </Select>
                                {selectedHotel?.address ? (
                                    <p className="mt-1.5 truncate text-xs text-slate-500">{selectedHotel.address}</p>
                                ) : null}
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Имя и фамилия</span>
                                <Input
                                    value={fullName}
                                    onChange={(event) => setFullName(event.target.value)}
                                    placeholder="Например, Азамат Ибраев"
                                    autoComplete="name"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Телефон</span>
                                <Input
                                    value={phone}
                                    onChange={(event) => setPhone(event.target.value)}
                                    placeholder="+996..."
                                    type="tel"
                                    autoComplete="tel"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Номер документа</span>
                                <Input
                                    value={documentNumber}
                                    onChange={(event) => setDocumentNumber(event.target.value)}
                                    placeholder="Паспорт или ID, можно позже"
                                    autoComplete="off"
                                />
                            </label>
                        </div>

                        <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900">
                            <div className="flex gap-2">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <p>
                                    Лучший сценарий: гость заполняет профиль сам, а менеджер один раз сверяет документ при заселении и больше не переносит данные вручную.
                                </p>
                            </div>
                        </div>

                        {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

                        <Button type="submit" className="mt-4 w-full py-3" disabled={isSubmitting || isLoadingHotels || hotels.length === 0}>
                            {isSubmitting ? 'Создаем QR...' : 'Получить QR'}
                        </Button>
                    </form>
                )}
            </div>
        </main>
    );
};
