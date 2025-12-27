"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import useSWR from "swr";

import { useTelegramContext } from "@/components/providers/telegram-provider";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type AdminHotelSummary = {
    id: string;
    name: string;
    address?: string | null;
    managerSharePct?: number | null;
    notes?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        id: string;
        displayName: string | null;
        telegramId: string;
        username?: string | null;
        role: string;
        pinCode?: string | null;
    }>;
    activeShift: null | {
        manager?: string | null;
        openedAt: string;
        openingCash?: number | null;
        number?: number | null;
    };
};

type AdminOverview = {
    totals: {
        cashIn: number;
        cashOut: number;
        payouts: number;
        adjustments: number;
        netCash: number;
    };
    occupancy: {
        hotels: number;
        rooms: number;
        occupiedRooms: number;
        rate: number;
    };
    shifts: {
        active: number;
        lastOpenedAt: string | null;
    };
};

type AdminTab = "overview" | "hotels" | "manage";

type OverviewFilters = {
    startDate: string;
    endDate: string;
    hotelId: string;
    managerId: string;
};

interface AdminDashboardProps {
    user: SessionUser;
}

interface CreateHotelPayload {
    name: string;
    address: string;
    notes?: string;
}

const notify = (message: string) => {
    if (typeof window !== "undefined") {
        window.alert(message);
    }
};

const formatCurrency = (value: number) => `${(value / 100).toLocaleString("ru-RU")} KGS`;

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatDateTime = (value?: string | null) => {
    if (!value) {
        return "";
    }

    try {
        return new Date(value).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (error) {
        console.warn("Failed to format date", error);
        return value;
    }
};

function HotelsSkeleton() {
    return (
        <>
            {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="mt-2 h-4 w-1/3" />
                    <Skeleton className="mt-4 h-10 w-full" />
                </div>
            ))}
        </>
    );
}

function OverviewSkeleton() {
    return (
        <>
            {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="bg-white/5 p-4">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="mt-3 h-8 w-1/2" />
                    <Skeleton className="mt-2 h-4 w-2/3" />
                </Card>
            ))}
        </>
    );
}

export function AdminDashboard({ user }: AdminDashboardProps) {
    const { authPayload, manualMode, logout } = useTelegramContext();
    const authHeader = authPayload ? JSON.stringify(authPayload) : undefined;

    const fetchWithAuth = useCallback(async ([url, header]: [string, string]) => {
        const response = await fetch(url, {
            headers: {
                "x-telegram-auth-payload": header,
            },
        });

        if (!response.ok) {
            throw new Error("Не удалось загрузить данные");
        }

        return response.json();
    }, []);

    const hotelsKey = authHeader ? (["/api/hotels", authHeader] as const) : null;

    const { data, mutate, isLoading } = useSWR<AdminHotelSummary[]>(hotelsKey, fetchWithAuth);

    const [filters, setFilters] = useState<OverviewFilters>({ startDate: "", endDate: "", hotelId: "", managerId: "" });

    const overviewQuery = useMemo(() => {
        const params = new URLSearchParams();
        if (filters.startDate) {
            params.set("startDate", filters.startDate);
        }
        if (filters.endDate) {
            params.set("endDate", filters.endDate);
        }
        if (filters.hotelId) {
            params.set("hotelId", filters.hotelId);
        }
        if (filters.managerId) {
            params.set("managerId", filters.managerId);
        }
        return params.toString();
    }, [filters]);

    const overviewUrl = overviewQuery ? `/api/admin/overview?${overviewQuery}` : "/api/admin/overview";
    const overviewKey = authHeader ? ([overviewUrl, authHeader] as const) : null;
    const { data: overview } = useSWR<AdminOverview>(overviewKey, fetchWithAuth);

    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [editForm, setEditForm] = useState({ name: "", address: "", notes: "" });
    const [isUpdatingHotel, setIsUpdatingHotel] = useState(false);
    const [isDeletingHotel, setIsDeletingHotel] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>("overview");

    useEffect(() => {
        if (!selectedHotelId) {
            setEditForm({ name: "", address: "", notes: "" });
            return;
        }

        if (!data) {
            return;
        }

        const target = data.find((hotel) => hotel.id === selectedHotelId);
        if (target) {
            setEditForm({
                name: target.name ?? "",
                address: target.address ?? "",
                notes: target.notes ?? "",
            });
        } else {
            setSelectedHotelId("");
            setEditForm({ name: "", address: "", notes: "" });
        }
    }, [data, selectedHotelId]);

    const handleEditFieldChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;
        setEditForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleCreateHotel = useCallback(
        async (formData: FormData) => {
            const payload: CreateHotelPayload = {
                name: formData.get("name") as string,
                address: formData.get("address") as string,
                notes: (formData.get("notes") as string) || undefined,
            };

            if (!payload.name?.trim()) {
                notify("Название обязательно");
                return;
            }

            if (!payload.address?.trim()) {
                notify("Адрес обязателен");
                return;
            }

            if (!authPayload) {
                notify("Нет авторизации Telegram");
                return;
            }

            try {
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authHeader) {
                    headers["x-telegram-auth-payload"] = authHeader;
                }

                const requestBody = { ...authPayload, ...payload };

                const res = await fetch("/api/hotels", {
                    method: "POST",
                    headers,
                    body: JSON.stringify(requestBody),
                });

                if (!res.ok) {
                    throw new Error("Не удалось создать отель");
                }

                await mutate();
                notify("Отель добавлен");
            } catch (error) {
                console.error(error);
                notify("Ошибка создания");
            }
        },
        [authHeader, authPayload, mutate],
    );

    const handleUpdateHotel = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();

            if (!selectedHotelId) {
                notify("Выберите отель");
                return;
            }

            if (!editForm.name.trim()) {
                notify("Название обязательно");
                return;
            }

            if (!editForm.address.trim()) {
                notify("Адрес обязателен");
                return;
            }

            if (!authPayload) {
                notify("Нет авторизации Telegram");
                return;
            }

            setIsUpdatingHotel(true);

            try {
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authHeader) {
                    headers["x-telegram-auth-payload"] = authHeader;
                }

                const payload = {
                    name: editForm.name.trim(),
                    address: editForm.address.trim(),
                    notes: editForm.notes.trim(),
                };

                const res = await fetch(`/api/hotels/${selectedHotelId}`, {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({ ...authPayload, ...payload }),
                });

                if (!res.ok) {
                    throw new Error("Не удалось обновить отель");
                }

                await mutate();
                notify("Изменения сохранены");
            } catch (error) {
                console.error(error);
                notify("Ошибка обновления");
            } finally {
                setIsUpdatingHotel(false);
            }
        },
        [authHeader, authPayload, editForm, mutate, selectedHotelId],
    );

    const handleDeleteHotel = useCallback(async () => {
        if (!selectedHotelId) {
            notify("Выберите отель");
            return;
        }

        if (!authPayload) {
            notify("Нет авторизации Telegram");
            return;
        }

        if (typeof window !== "undefined" && !window.confirm("Удалить отель без возможности восстановления?")) {
            return;
        }

        setIsDeletingHotel(true);

        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (authHeader) {
                headers["x-telegram-auth-payload"] = authHeader;
            }

            const res = await fetch(`/api/hotels/${selectedHotelId}`, {
                method: "DELETE",
                headers,
                body: JSON.stringify({ ...authPayload }),
            });

            if (!res.ok) {
                throw new Error("Не удалось удалить отель");
            }

            await mutate();
            setSelectedHotelId("");
            setEditForm({ name: "", address: "", notes: "" });
            notify("Отель удалён");
        } catch (error) {
            console.error(error);
            notify("Ошибка удаления");
        } finally {
            setIsDeletingHotel(false);
        }
    }, [authHeader, authPayload, mutate, selectedHotelId]);

    const hotels = useMemo(() => data ?? [], [data]);
    const adminTabs: Array<{ id: AdminTab; label: string; hint?: string }> = [
        { id: "overview", label: "Сводка" },
        { id: "hotels", label: "Объекты", hint: hotels.length ? String(hotels.length) : undefined },
        { id: "manage", label: "Управление" },
    ];

    const managerOptions = useMemo(() => {
        const sourceHotels = filters.hotelId ? hotels.filter((hotel) => hotel.id === filters.hotelId) : hotels;
        const unique = new Map<string, string>();
        for (const hotel of sourceHotels) {
            for (const manager of hotel.managers) {
                const label = manager.displayName?.trim() || manager.username?.trim() || manager.telegramId;
                if (!unique.has(manager.id)) {
                    unique.set(manager.id, label || manager.telegramId);
                }
            }
        }
        return Array.from(unique.entries()).map(([id, label]) => ({ id, label }));
    }, [filters.hotelId, hotels]);

    const hasActiveFilters = Boolean(filters.startDate || filters.endDate || filters.hotelId || filters.managerId);

    const handleFilterInput = (field: keyof OverviewFilters, value: string) => {
        setFilters((prev) => ({ ...prev, [field]: value }));
    };

    const handleHotelFilterChange = (value: string) => {
        setFilters((prev) => ({ ...prev, hotelId: value, managerId: "" }));
    };

    const handleResetFilters = () => {
        setFilters({ startDate: "", endDate: "", hotelId: "", managerId: "" });
    };

    return (
        <div className="flex min-h-screen flex-col gap-4 p-4 pb-16">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-[0.4em] text-white/60">Администратор</p>
                        <h1 className="text-3xl font-semibold text-white">{user.displayName}</h1>
                    </div>
                    {manualMode && (
                        <div className="flex flex-col items-end gap-2 text-xs text-white/80">
                            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1 font-semibold text-amber-50">
                                <span className="h-2 w-2 rounded-full bg-amber-300" aria-hidden />
                                Вход без Telegram
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="border border-white/20 text-white/80 hover:bg-white/10"
                                onClick={logout}
                            >
                                Выйти
                            </Button>
                        </div>
                    )}
                </div>
                <p className="text-xs text-white/60">
                    Выберите отель чтобы назначать менеджеров, добавлять номера и отслеживать смены
                </p>
            </header>
            <div className="sticky top-0 z-10 -mx-4 mb-1 bg-slate-900/90 p-3 pb-2 backdrop-blur">
                <div className="flex gap-1 rounded-full bg-white/5 p-1 text-sm font-semibold text-white/60">
                    {adminTabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 rounded-full px-3 py-2 transition ${activeTab === tab.id ? "bg-white text-slate-900 shadow" : "hover:text-white"
                                }`}
                        >
                            <span>{tab.label}</span>
                            {tab.hint && activeTab === tab.id && (
                                <span className="ml-1 text-xs text-slate-600">{tab.hint}</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === "overview" && (
                <>
                    <Card className="bg-white/5 p-4 text-white">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Фильтры</p>
                                <h2 className="text-lg font-semibold">Аналитика</h2>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={!hasActiveFilters}
                                onClick={handleResetFilters}
                                className="border border-white/20 text-white/80 hover:bg-white/10"
                            >
                                Сбросить
                            </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="overview-start">
                                    С даты
                                </label>
                                <Input
                                    id="overview-start"
                                    type="date"
                                    value={filters.startDate}
                                    onChange={(event) => handleFilterInput("startDate", event.target.value)}
                                    className="bg-white/10 text-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="overview-end">
                                    По дату
                                </label>
                                <Input
                                    id="overview-end"
                                    type="date"
                                    value={filters.endDate}
                                    min={filters.startDate || undefined}
                                    onChange={(event) => handleFilterInput("endDate", event.target.value)}
                                    className="bg-white/10 text-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="overview-hotel">
                                    Объект
                                </label>
                                <select
                                    id="overview-hotel"
                                    value={filters.hotelId}
                                    onChange={(event) => handleHotelFilterChange(event.target.value)}
                                    className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                >
                                    <option value="" className="bg-slate-900 text-white">
                                        Все объекты
                                    </option>
                                    {hotels.map((hotel) => (
                                        <option key={hotel.id} value={hotel.id} className="bg-slate-900 text-white">
                                            {hotel.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="overview-manager">
                                    Менеджер
                                </label>
                                <select
                                    id="overview-manager"
                                    value={filters.managerId}
                                    onChange={(event) => handleFilterInput("managerId", event.target.value)}
                                    disabled={!managerOptions.length}
                                    className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white disabled:opacity-50 focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                >
                                    <option value="" className="bg-slate-900 text-white">
                                        {managerOptions.length ? "Все менеджеры" : "Нет менеджеров"}
                                    </option>
                                    {managerOptions.map((manager) => (
                                        <option key={manager.id} value={manager.id} className="bg-slate-900 text-white">
                                            {manager.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </Card>
                    <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                        {overview ? (
                            <>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Чистый поток</p>
                                    <p className="mt-1 text-2xl font-semibold text-white">{formatCurrency(overview.totals.netCash)}</p>
                                    <p className="text-xs text-white/60">Сводный баланс по выбранным фильтрам</p>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Поступления</p>
                                    <p className="mt-1 text-xl font-semibold text-emerald-300">
                                        {formatCurrency(overview.totals.cashIn)}
                                    </p>
                                    <p className="text-xs text-white/60">Списания {formatCurrency(overview.totals.cashOut)}</p>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Выплаты</p>
                                    <p className="mt-1 text-xl font-semibold text-white">
                                        {formatCurrency(overview.totals.payouts)}
                                    </p>
                                    <p className="text-xs text-white/60">
                                        Корректировки {formatCurrency(overview.totals.adjustments)}
                                    </p>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Заполнение</p>
                                    <p className="mt-1 text-xl font-semibold text-white">
                                        {formatPercent(overview.occupancy.rate)}
                                    </p>
                                    <p className="text-xs text-white/60">
                                        Занято {overview.occupancy.occupiedRooms}/{overview.occupancy.rooms} номеров
                                    </p>
                                    <p className="text-xs text-white/60">Активных смен: {overview.shifts.active}</p>
                                    {overview.shifts.lastOpenedAt && (
                                        <p className="text-xs text-white/60">
                                            Последняя смена {formatDateTime(overview.shifts.lastOpenedAt)}
                                        </p>
                                    )}
                                </Card>
                            </>
                        ) : (
                            <OverviewSkeleton />
                        )}
                    </section>
                </>
            )}

            {activeTab === "hotels" && (
                <section>
                    <Card className="bg-white/5 p-4 text-white">
                        <div className="mb-4 space-y-0.5">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Мониторинг</p>
                            <h2 className="text-2xl font-semibold">Отели</h2>
                            <p className="text-sm text-white/60">Статистика по активным объектам</p>
                        </div>
                        <div className="grid gap-2.5">
                            {isLoading && <HotelsSkeleton />}
                            {!isLoading && hotels.length === 0 && (
                                <p className="text-sm text-white/60">Пока нет отелей</p>
                            )}
                            {!isLoading &&
                                hotels.map((hotel) => (
                                    <div
                                        key={hotel.id}
                                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3 shadow-sm"
                                    >
                                        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                                            <div>
                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Объект</p>
                                                <h3 className="text-xl font-semibold text-white">{hotel.name}</h3>
                                                <p className="text-xs text-white/60">{hotel.address || "Адрес не указан"}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Номера</p>
                                                <p className="text-2xl font-semibold text-white">{hotel.roomCount}</p>
                                                <p className="text-xs text-white/60">
                                                    Занято {hotel.occupiedRooms}/{hotel.roomCount}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="mt-2 text-xs text-white/60">
                                            {hotel.activeShift ? (
                                                <span>
                                                    Смена №{hotel.activeShift.number ?? "?"} · {hotel.activeShift.manager || "Без имени"} · с {" "}
                                                    {formatDateTime(hotel.activeShift.openedAt)}
                                                </span>
                                            ) : (
                                                <span>Смена закрыта</span>
                                            )}
                                        </div>
                                        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div className="flex flex-wrap items-center gap-2">
                                                {hotel.managers.length > 0 ? (
                                                    hotel.managers.slice(0, 3).map((manager) => (
                                                        <span
                                                            key={manager.id}
                                                            className={cn(
                                                                "flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs font-semibold",
                                                            )}
                                                        >
                                                            {manager.displayName?.slice(0, 2).toUpperCase() || "??"}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-xs text-white/60">Нет менеджеров</span>
                                                )}
                                                {hotel.managers.length > 3 && (
                                                    <span className="text-xs text-white/60">+{hotel.managers.length - 3}</span>
                                                )}
                                            </div>
                                            {hotel.managers.length > 0 && (
                                                <div className="w-full text-left text-xs text-white/80 md:text-right">
                                                    {hotel.managers.slice(0, 3).map((manager) => (
                                                        <p key={`${manager.id}-pin`} className="font-mono">
                                                            {manager.displayName ?? manager.telegramId}: {manager.pinCode ?? "PIN не задан"}
                                                        </p>
                                                    ))}
                                                    {hotel.managers.length > 3 && (
                                                        <p className="text-white/60">Смотрите все PIN в карточке отеля</p>
                                                    )}
                                                </div>
                                            )}
                                            <Link href={`/admin/hotels/${hotel.id}`} className="w-full md:w-auto">
                                                <Button size="sm" variant="secondary" className="w-full">
                                                    Открыть управление
                                                </Button>
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </Card>
                </section>
            )}

            {activeTab === "manage" && (
                <section className="grid gap-3 lg:grid-cols-2">
                    <Card className="bg-white/5 p-4 text-white">
                        <div className="mb-4 space-y-0.5">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Добавление</p>
                            <h2 className="text-2xl font-semibold">Новый отель</h2>
                            <p className="text-sm text-white/60">Сразу появится в списке слева</p>
                        </div>
                        <form action={handleCreateHotel} className="space-y-3">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="name">
                                    Название
                                </label>
                                <Input
                                    id="name"
                                    name="name"
                                    placeholder={"Например, \"Парк Инн\""}
                                    required
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="address">
                                    Адрес
                                </label>
                                <Input
                                    id="address"
                                    name="address"
                                    placeholder="Город, улица, дом"
                                    required
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="notes">
                                    Заметки
                                </label>
                                <Input
                                    id="notes"
                                    name="notes"
                                    placeholder="Особенности"
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            <Button type="submit" className="w-full">
                                Сохранить
                            </Button>
                        </form>
                    </Card>

                    <Card className="bg-white/5 p-4 text-white">
                        <div className="mb-4 space-y-0.5">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Управление</p>
                            <h2 className="text-2xl font-semibold">Редактировать отель</h2>
                            <p className="text-sm text-white/60">Обновите данные или удалите объект</p>
                        </div>
                        {hotels.length === 0 ? (
                            <p className="text-sm text-white/60">Пока нет отелей для изменения</p>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase text-white/70" htmlFor="edit-hotel">
                                        Выберите отель
                                    </label>
                                    <select
                                        id="edit-hotel"
                                        className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                        value={selectedHotelId}
                                        onChange={(event) => setSelectedHotelId(event.target.value)}
                                    >
                                        <option value="" className="bg-slate-900 text-white">
                                            Не выбрано
                                        </option>
                                        {hotels.map((hotel) => (
                                            <option key={hotel.id} value={hotel.id} className="bg-slate-900 text-white">
                                                {hotel.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <form className="mt-4 space-y-3" onSubmit={handleUpdateHotel}>
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="edit-name">
                                            Название
                                        </label>
                                        <Input
                                            id="edit-name"
                                            name="name"
                                            value={editForm.name}
                                            onChange={handleEditFieldChange}
                                            placeholder="Название"
                                            disabled={!selectedHotelId || isUpdatingHotel}
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="edit-address">
                                            Адрес
                                        </label>
                                        <Input
                                            id="edit-address"
                                            name="address"
                                            value={editForm.address}
                                            onChange={handleEditFieldChange}
                                            placeholder="Город, улица, дом"
                                            disabled={!selectedHotelId || isUpdatingHotel}
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="edit-notes">
                                            Заметки
                                        </label>
                                        <Input
                                            id="edit-notes"
                                            name="notes"
                                            value={editForm.notes}
                                            onChange={handleEditFieldChange}
                                            placeholder="Особенности"
                                            disabled={!selectedHotelId || isUpdatingHotel}
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <Button type="submit" className="w-full" disabled={!selectedHotelId || isUpdatingHotel}>
                                        {isUpdatingHotel ? "Сохраняем..." : "Обновить отель"}
                                    </Button>
                                </form>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={!selectedHotelId || isDeletingHotel}
                                    onClick={handleDeleteHotel}
                                    className="w-full border border-rose-400/40 text-rose-200 hover:bg-rose-500/10"
                                >
                                    {isDeletingHotel ? "Удаляем..." : "Удалить отель"}
                                </Button>
                            </>
                        )}
                    </Card>
                </section>
            )}
        </div>
    );
}
