'use client';

import QRCode from 'qrcode';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, FileText, MapPin, Pencil, QrCode, Smartphone, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type GuestHotel = {
    id: string;
    name: string;
    address: string;
    city?: string | null;
    country?: string | null;
    guestDescription?: string | null;
    guestAmenities?: string[];
    guestPhotoUrls?: string[];
    guestMapUrl?: string | null;
};

type GuestVerificationStatus = 'PENDING' | 'VERIFIED' | 'NEEDS_REVIEW';

type GuestProfileResult = {
    guest: {
        id: string;
        fullName: string;
        phone?: string | null;
        documentNumber?: string | null;
        verificationStatus?: GuestVerificationStatus | null;
        verifiedAt?: string | null;
        consentAcceptedAt?: string | null;
        consentVersion?: string | null;
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
const CURRENT_CONSENT_VERSION = 'guestpass-2026-06-25';

const formatTelegramName = (user?: TelegramWebAppUser | null) =>
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();

const formatExpiry = (value?: string | null) => {
    if (!value) return null;

    try {
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(value));
    } catch {
        return null;
    }
};

const verificationMeta: Record<GuestVerificationStatus, { label: string; className: string }> = {
    PENDING: { label: 'Ожидает проверки', className: 'bg-slate-100 text-slate-600' },
    VERIFIED: { label: 'Документ проверен', className: 'bg-emerald-50 text-emerald-700' },
    NEEDS_REVIEW: { label: 'Нужно уточнить', className: 'bg-amber-50 text-amber-700' }
};

const getVerificationMeta = (status?: GuestVerificationStatus | null) => verificationMeta[status ?? 'PENDING'];

const getHotelMapUrl = (hotel: GuestHotel) => {
    if (hotel.guestMapUrl) return hotel.guestMapUrl;
    if (!hotel.address) return null;

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.name} ${hotel.address}`)}`;
};

function StatusPill({ children, className }: { children: React.ReactNode; className: string }) {
    return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

function HotelCard({ hotel }: { hotel: GuestHotel }) {
    const photoUrl = hotel.guestPhotoUrls?.find(Boolean);
    const amenities = (hotel.guestAmenities ?? []).filter(Boolean).slice(0, 4);
    const mapUrl = getHotelMapUrl(hotel);

    return (
        <article className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)]">
            {photoUrl ? (
                <div className="aspect-[16/9] bg-slate-100">
                    <img src={photoUrl} alt={hotel.name} className="h-full w-full object-cover" />
                </div>
            ) : null}
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-950">{hotel.name}</h3>
                        {hotel.address ? (
                            <p className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-slate-500">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{hotel.address}</span>
                            </p>
                        ) : null}
                    </div>
                    {mapUrl ? (
                        <a
                            href={mapUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                        >
                            Карта
                        </a>
                    ) : null}
                </div>
                {hotel.guestDescription ? (
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{hotel.guestDescription}</p>
                ) : null}
                {amenities.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {amenities.map((amenity) => (
                            <span key={amenity} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                {amenity}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function HotelDirectory({ hotels, isLoading }: { hotels: GuestHotel[]; isLoading: boolean }) {
    if (isLoading) {
        return (
            <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.45)]">
                <div className="h-4 w-24 rounded-full bg-slate-100" />
                <div className="mt-3 h-24 rounded-3xl bg-slate-100" />
            </section>
        );
    }

    if (!hotels.length) return null;

    return (
        <section className="space-y-3">
            <div className="px-1">
                <h2 className="text-base font-semibold text-slate-950">Отели</h2>
            </div>
            <div className="grid gap-3">
                {hotels.map((hotel) => (
                    <HotelCard key={hotel.id} hotel={hotel} />
                ))}
            </div>
        </section>
    );
}

export const GuestApp = () => {
    const [hotels, setHotels] = useState<GuestHotel[]>([]);
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [consentAccepted, setConsentAccepted] = useState(false);
    const [isLoadingHotels, setIsLoadingHotels] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<GuestProfileResult | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [isQrOpen, setIsQrOpen] = useState(false);
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
            } catch {
                localStorage.removeItem(storedGuestKey);
            }
        }

        fetch('/api/guest/hotels', { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) throw new Error('Не удалось загрузить объекты');
                return response.json() as Promise<{ hotels: GuestHotel[] }>;
            })
            .then((result) => setHotels(result.hotels))
            .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Ошибка загрузки'))
            .finally(() => setIsLoadingHotels(false));
    }, []);

    useEffect(() => {
        let isCancelled = false;
        let timerId: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const readTelegramWebApp = () => {
            if (isCancelled) return;

            const webApp = window.Telegram?.WebApp;
            if (!webApp) {
                attempt += 1;
                if (attempt < 20) timerId = setTimeout(readTelegramWebApp, 150);
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
        };

        readTelegramWebApp();

        return () => {
            isCancelled = true;
            if (timerId) clearTimeout(timerId);
        };
    }, []);

    useEffect(() => {
        if (!profile?.qr.code) {
            setQrDataUrl(null);
            setIsQrOpen(false);
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

    const telegramLabel = telegramUser ? formatTelegramName(telegramUser) || telegramUser.username || String(telegramUser.id) : '';
    const isTelegramLinked = Boolean(telegramInitData && telegramUser);
    const hasDocumentNumber = Boolean((profile?.guest.documentNumber ?? documentNumber).trim());
    const profileVerification = getVerificationMeta(profile?.guest.verificationStatus);
    const expiryLabel = formatExpiry(profile?.qr.expiresAt);
    const profileInitials = useMemo(() => {
        const source = profile?.guest.fullName ?? fullName;
        const initials = source
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase();
        return initials || 'GP';
    }, [fullName, profile?.guest.fullName]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!fullName.trim()) {
            setError('Укажите имя и фамилию');
            return;
        }

        if (!consentAccepted) {
            setError('Нужно согласие на обработку данных для создания QR');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch('/api/guest/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullName: fullName.trim(),
                    phone: phone.trim() || undefined,
                    telegramInitData: telegramInitData || undefined,
                    documentNumber: documentNumber.trim() || undefined,
                    consentAccepted: true,
                    consentVersion: CURRENT_CONSENT_VERSION
                })
            });

            if (!response.ok) throw new Error(await response.text());

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
        setConsentAccepted(false);
    };

    return (
        <main className="min-h-screen bg-[#f7f8fb] px-4 pb-28 pt-3 text-slate-950">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
                <header className="flex items-center justify-between gap-3 px-1 py-1">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">GuestPass</p>
                        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{profile ? profile.guest.fullName : 'Быстрое заселение'}</h1>
                    </div>
                    <StatusPill className={profile ? profileVerification.className : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200'}>
                        {profile ? profileVerification.label : 'Новый'}
                    </StatusPill>
                </header>

                {profile ? (
                    <>
                        <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.85)]">
                            <div className="bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.22),transparent_36%),linear-gradient(135deg,#0f172a,#111827)] p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <UserRound className="h-5 w-5 text-white/55" aria-hidden="true" />
                                        <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight">{profile.guest.fullName}</h2>
                                        <p className="mt-2 font-mono text-sm font-semibold tracking-[0.16em] text-white/65">{profile.qr.code}</p>
                                    </div>
                                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10 text-sm font-semibold">
                                        {profileInitials}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-[24px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_46px_-38px_rgba(15,23,42,0.32)]">
                            <div className="grid gap-2">
                                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                                    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
                                        <Smartphone className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                    </span>
                                    <span className={`text-xs font-semibold ${isTelegramLinked ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {isTelegramLinked ? telegramLabel || 'подключен' : 'не подключен'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                                    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
                                        <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                    </span>
                                    <span className={`text-xs font-semibold ${hasDocumentNumber ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {hasDocumentNumber ? 'номер указан' : 'можно позже'}
                                    </span>
                                </div>
                            </div>
                            <div className={`mt-3 flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm leading-5 ${profile.guest.verificationStatus === 'VERIFIED' ? 'bg-emerald-50 text-emerald-800' : 'bg-sky-50 text-sky-900'}`}>
                                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>
                                    {profile.guest.verificationStatus === 'VERIFIED'
                                        ? 'Документ проверен'
                                        : 'Проверка на стойке'}
                                </span>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                {expiryLabel ? <p className="text-xs text-slate-500">до {expiryLabel}</p> : <span />}
                                <button
                                    type="button"
                                    className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600"
                                    onClick={resetProfile}
                                    aria-label="Изменить данные"
                                >
                                    <Pencil className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </section>
                    </>
                ) : (
                    <form className="rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.35)]" onSubmit={handleSubmit}>
                        <div className="flex items-start gap-3">
                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                                <UserRound className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Данные</h2>
                            </div>
                        </div>

                        <div className="mt-5 space-y-4">
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Имя и фамилия</span>
                                <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Например, Азамат Ибраев" autoComplete="name" />
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Телефон</span>
                                <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+996..." type="tel" autoComplete="tel" />
                            </label>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Номер документа</span>
                                <Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="Паспорт или ID, можно позже" autoComplete="off" />
                            </label>
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <div className="flex gap-2 text-sm leading-5 text-slate-700">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                                <p>QR создается один раз.</p>
                            </div>
                        </div>

                        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                            <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} className="mt-1 accent-slate-900" />
                            <span>
                                Я согласен на обработку данных для профиля, QR-заселения и проверки документа.{' '}
                                <a href="/guest/privacy" className="font-semibold text-slate-950 underline underline-offset-2">
                                    Политика
                                </a>
                            </span>
                        </label>

                        {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

                        <Button type="submit" className="mt-4 w-full py-3" disabled={isSubmitting || !consentAccepted}>
                            {isSubmitting ? 'Создаем...' : 'Создать'}
                        </Button>
                    </form>
                )}

                <HotelDirectory hotels={hotels} isLoading={isLoadingHotels} />
            </div>
            {profile ? (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/[0.92] px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 backdrop-blur">
                    <div className="mx-auto flex w-full max-w-md gap-3">
                        <Button type="button" className="min-h-12 flex-1" onClick={() => setIsQrOpen(true)}>
                            <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
                            QR
                        </Button>
                    </div>
                </div>
            ) : null}
            {profile && isQrOpen ? (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-4 pb-4 backdrop-blur-[2px]" onClick={() => setIsQrOpen(false)}>
                    <section
                        className="w-full max-w-md rounded-[30px] border border-white/70 bg-white p-4 shadow-[0_28px_80px_-28px_rgba(15,23,42,0.75)]"
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="QR гостя"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">GuestPass</p>
                                <h2 className="mt-1 text-lg font-semibold text-slate-950">QR</h2>
                            </div>
                            <button
                                type="button"
                                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600"
                                onClick={() => setIsQrOpen(false)}
                                aria-label="Закрыть QR"
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="mt-4 flex flex-col items-center rounded-[26px] bg-slate-50 p-4">
                            <div className="rounded-[24px] bg-white p-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.7)]">
                                {qrDataUrl ? (
                                    <img src={qrDataUrl} alt="QR гостя" className="h-64 w-64 rounded-2xl bg-white" />
                                ) : (
                                    <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-white text-sm text-slate-500">
                                        Генерируем QR
                                    </div>
                                )}
                            </div>
                            <p className="mt-3 rounded-full bg-slate-950 px-4 py-2 font-mono text-base font-semibold tracking-[0.18em] text-white">
                                {profile.qr.code}
                            </p>
                        </div>
                    </section>
                </div>
            ) : null}
        </main>
    );
};
