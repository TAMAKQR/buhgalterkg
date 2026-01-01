"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import useSWR from "swr";

import { useTelegramContext } from "@/components/providers/telegram-provider";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBishkekDateTime } from "@/lib/timezone";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, TextArea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

type PaymentSplit = {
    cash: number;
    card: number;
};

type AdminHotelSummary = {
    id: string;
    name: string;
    address?: string | null;
    managerSharePct?: number | null;
    notes?: string | null;
    cleaningChatId?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        id: string;
        displayName: string | null;
        telegramId?: string | null;
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
    ledger: {
        cashIn: number;
        cashInBreakdown: PaymentSplit;
        cashOut: number;
        cashOutBreakdown: PaymentSplit;
    };
};

type AdminOverview = {
    totals: {
        cashIn: number;
        cashInBreakdown: PaymentSplit;
        cashOut: number;
        cashOutBreakdown: PaymentSplit;
        payouts: number;
        payoutsBreakdown: PaymentSplit;
        adjustments: number;
        adjustmentsBreakdown: PaymentSplit;
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

type AdminProductCategory = {
    id: string;
    name: string;
    description?: string | null;
    productCount: number;
};

type AdminProductRecord = {
    id: string;
    name: string;
    sku?: string | null;
    description?: string | null;
    costPrice: number;
    sellPrice: number;
    stockOnHand: number;
    reorderThreshold?: number | null;
    unit?: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    category: { id: string; name: string } | null;
    sales: { quantity: number; revenue: number } | null;
};

type AdminStoreSummary = {
    totalProducts: number;
    lowStock: number;
    stockValue: number;
    potentialRevenue: number;
    sales: null | {
        range: { start: string | null; end: string | null };
        totalQuantity: number;
        totalRevenue: number;
    };
};

type AdminStoreResponse = {
    hotelId: string;
    categories: AdminProductCategory[];
    products: AdminProductRecord[];
    summary: AdminStoreSummary;
};

type InventoryAdjustmentType = "RESTOCK" | "ADJUSTMENT" | "WRITE_OFF";

type InventoryModalState = {
    product: AdminProductRecord;
    adjustmentType: InventoryAdjustmentType;
    quantity: string;
    costTotal: string;
    note: string;
};

type InventoryAdjustmentFields = {
    productId: string;
    adjustmentType: InventoryAdjustmentType;
    quantity: string;
    costTotal: string;
    note: string;
};

type AdminTab = "overview" | "hotels" | "store" | "manage";

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
    cleaningChatId?: string;
}

type HotelFormState = {
    name: string;
    address: string;
    notes: string;
    cleaningChatId: string;
};

const notify = (message: string) => {
    if (typeof window !== "undefined") {
        window.alert(message);
    }
};

const formatCurrency = (value: number) => `${(value / 100).toLocaleString("ru-RU")} KGS`;

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatDateTime = (value?: string | null) => formatBishkekDateTime(value, undefined, "");

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

type AnalyticsFlowChartProps = {
    inflow: number;
    outflow: number;
    net: number;
};

const AnalyticsFlowChart = ({ inflow, outflow, net }: AnalyticsFlowChartProps) => {
    const safeInflow = inflow || 0;
    const safeOutflow = outflow || 0;
    const safeNet = net || 0;
    const total = Math.max(safeInflow + safeOutflow, 1);
    const inflowRatio = safeInflow / total;
    const outflowRatio = safeOutflow / total;
    const inflowDegrees = inflowRatio * 360;
    const chartStyle: CSSProperties = {
        backgroundImage: `conic-gradient(#34d399 ${inflowDegrees}deg, #f87171 ${inflowDegrees}deg 360deg)`
    };
    const netPositive = safeNet >= 0;
    const netTone = netPositive ? "text-emerald-200" : "text-rose-200";
    const netLabel = netPositive ? "Профицит" : "Дефицит";

    return (
        <Card className="bg-white/5 p-4 text-white md:col-span-2 lg:col-span-4">
            <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Диаграмма потоков</p>
                <span className="text-xs text-white/60">По текущим фильтрам</span>
            </div>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                <div
                    className="relative mx-auto h-48 w-48 overflow-hidden rounded-full border border-white/10 bg-slate-900/70"
                    style={chartStyle}
                >
                    <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-slate-900/95 text-center">
                        <span className="text-[10px] uppercase tracking-[0.4em] text-white/40">{netLabel}</span>
                        <span className={`text-xl font-semibold ${netTone}`}>{formatCurrency(safeNet)}</span>
                        <span className="text-xs text-white/50">Вход {formatPercent(inflowRatio)}</span>
                    </div>
                </div>
                <div className="flex-1 space-y-4 text-sm">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-2 text-white/70">
                            <span className="h-2 w-6 rounded-full bg-emerald-300" />
                            <span>Поступления</span>
                        </div>
                        <div className="text-right">
                            <p className="text-base font-semibold text-emerald-200">{formatCurrency(safeInflow)}</p>
                            <p className="text-xs text-white/50">{formatPercent(inflowRatio)} потока</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div className="flex items-center gap-2 text-white/70">
                            <span className="h-2 w-6 rounded-full bg-rose-300" />
                            <span>Списания</span>
                        </div>
                        <div className="text-right">
                            <p className="text-base font-semibold text-rose-200">{formatCurrency(safeOutflow)}</p>
                            <p className="text-xs text-white/50">{formatPercent(outflowRatio)} потока</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white/70">
                            <span className={`h-2 w-6 rounded-full ${netPositive ? "bg-emerald-200" : "bg-rose-200"}`} />
                            <span>Баланс</span>
                        </div>
                        <div className="text-right">
                            <p className={`text-base font-semibold ${netTone}`}>{formatCurrency(safeNet)}</p>
                            <p className="text-xs text-white/50">
                                {netPositive ? "Накопление" : "Расход"} {formatPercent(Math.abs(safeNet) / total)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export function AdminDashboard({ user }: AdminDashboardProps) {
    const { authPayload, manualMode, devOverrideActive, logout } = useTelegramContext();
    const showLogout = manualMode || devOverrideActive;
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

    const createEmptyHotelForm = (): HotelFormState => ({
        name: "",
        address: "",
        notes: "",
        cleaningChatId: "",
    });

    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [editForm, setEditForm] = useState<HotelFormState>(() => createEmptyHotelForm());
    const [isUpdatingHotel, setIsUpdatingHotel] = useState(false);
    const [isDeletingHotel, setIsDeletingHotel] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>("overview");
    const [storeHotelId, setStoreHotelId] = useState("");
    const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
    const [productForm, setProductForm] = useState({
        name: "",
        categoryId: "",
        sku: "",
        description: "",
        costPrice: "",
        sellPrice: "",
        unit: "",
        reorderThreshold: "",
        isActive: true,
    });
    const [inventoryForm, setInventoryForm] = useState({
        productId: "",
        adjustmentType: "RESTOCK" as InventoryAdjustmentType,
        quantity: "",
        costTotal: "",
        note: "",
    });
    const [isSavingCategory, setIsSavingCategory] = useState(false);
    const [isSavingProduct, setIsSavingProduct] = useState(false);
    const [isSavingInventory, setIsSavingInventory] = useState(false);
    const [inventoryModal, setInventoryModal] = useState<InventoryModalState | null>(null);
    const [inventoryModalError, setInventoryModalError] = useState<string | null>(null);
    const [isInventoryModalSaving, setIsInventoryModalSaving] = useState(false);
    const [isHeaderHintVisible, setIsHeaderHintVisible] = useState(false);

    useEffect(() => {
        if (!selectedHotelId) {
            setEditForm(createEmptyHotelForm());
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
                cleaningChatId: target.cleaningChatId ?? "",
            });
        } else {
            setSelectedHotelId("");
            setEditForm(createEmptyHotelForm());
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

            const rawCleaningChatId = (formData.get("cleaningChatId") as string | null)?.trim();
            if (rawCleaningChatId) {
                payload.cleaningChatId = rawCleaningChatId;
            }

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
                    cleaningChatId: editForm.cleaningChatId.trim() ? editForm.cleaningChatId.trim() : null,
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
            setEditForm(createEmptyHotelForm());
            notify("Отель удалён");
        } catch (error) {
            console.error(error);
            notify("Ошибка удаления");
        } finally {
            setIsDeletingHotel(false);
        }
    }, [authHeader, authPayload, mutate, selectedHotelId]);

    const hotels = useMemo(() => data ?? [], [data]);

    useEffect(() => {
        if (!storeHotelId && hotels.length) {
            setStoreHotelId(hotels[0].id);
        }
    }, [storeHotelId, hotels]);

    const storeKey = authHeader && storeHotelId ? ([`/api/admin/products?hotelId=${storeHotelId}`, authHeader] as const) : null;
    const {
        data: storeData,
        mutate: refreshStore,
        isLoading: isStoreLoading,
    } = useSWR<AdminStoreResponse>(storeKey, fetchWithAuth);

    const adminTabs: Array<{ id: AdminTab; label: string; hint?: string }> = [
        { id: "overview", label: "Сводка" },
        { id: "hotels", label: "Объекты", hint: hotels.length ? String(hotels.length) : undefined },
        { id: "store", label: "Магазин" },
        { id: "manage", label: "Управление" },
    ];

    const managerOptions = useMemo(() => {
        const sourceHotels = filters.hotelId ? hotels.filter((hotel) => hotel.id === filters.hotelId) : hotels;
        const unique = new Map<string, string>();
        for (const hotel of sourceHotels) {
            for (const manager of hotel.managers) {
                const label =
                    manager.displayName?.trim() ||
                    manager.username?.trim() ||
                    (manager.pinCode ? `PIN ${manager.pinCode}` : 'Менеджер');
                if (!unique.has(manager.id)) {
                    unique.set(manager.id, label);
                }
            }
        }
        return Array.from(unique.entries()).map(([id, label]) => ({ id, label }));
    }, [filters.hotelId, hotels]);

    const hasActiveFilters = Boolean(filters.startDate || filters.endDate || filters.hotelId || filters.managerId);

    const storeCategories = useMemo(() => storeData?.categories ?? [], [storeData]);
    const storeProducts = useMemo(() => storeData?.products ?? [], [storeData]);
    const storeSummary = storeData?.summary ?? null;
    const inventoryTargetProduct = storeProducts.find((product) => product.id === inventoryForm.productId) ?? null;

    useEffect(() => {
        if (!inventoryForm.productId && storeProducts.length) {
            setInventoryForm((prev) => ({ ...prev, productId: storeProducts[0].id }));
        }
    }, [inventoryForm.productId, storeProducts]);

    const handleFilterInput = (field: keyof OverviewFilters, value: string) => {
        setFilters((prev) => ({ ...prev, [field]: value }));
    };

    const handleHotelFilterChange = (value: string) => {
        setFilters((prev) => ({ ...prev, hotelId: value, managerId: "" }));
    };

    const handleResetFilters = () => {
        setFilters({ startDate: "", endDate: "", hotelId: "", managerId: "" });
    };

    const handleCategoryInputChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = event.target;
        setCategoryForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleProductInputChange = useCallback(
        (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
            const { name, value } = event.target;
            setProductForm((prev) => ({ ...prev, [name]: value }));
        },
        [],
    );

    const handleProductToggleActive = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const { checked } = event.target;
        setProductForm((prev) => ({ ...prev, isActive: checked }));
    }, []);

    const handleInventoryInputChange = useCallback(
        (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
            const { name, value } = event.target;
            setInventoryForm((prev) => ({ ...prev, [name]: value }));
        },
        [],
    );

    const handleOpenInventoryModal = useCallback(
        (product: AdminProductRecord, adjustmentType: InventoryAdjustmentType) => {
            setInventoryModal({
                product,
                adjustmentType,
                quantity: "1",
                costTotal: "",
                note: "",
            });
            setInventoryModalError(null);
        },
        [],
    );

    const submitInventoryAdjustment = useCallback(
        async (fields: InventoryAdjustmentFields) => {
            if (!fields.productId) {
                return { ok: false as const, error: "Выберите товар" };
            }
            if (!authPayload) {
                return { ok: false as const, error: "Нет авторизации Telegram" };
            }

            const quantityValue = Number(fields.quantity);
            if (!Number.isFinite(quantityValue) || quantityValue === 0) {
                return { ok: false as const, error: "Количество не может быть 0" };
            }

            if (
                (fields.adjustmentType === "RESTOCK" || fields.adjustmentType === "WRITE_OFF") &&
                quantityValue < 0
            ) {
                return { ok: false as const, error: "Используйте положительное количество" };
            }

            let parsedCost: number | undefined;
            if (fields.costTotal) {
                const normalizedCost = Number(fields.costTotal.replace(",", "."));
                if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
                    return { ok: false as const, error: "Введите корректную стоимость" };
                }
                parsedCost = normalizedCost;
            }

            try {
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authHeader) {
                    headers["x-telegram-auth-payload"] = authHeader;
                }
                const payload = {
                    ...authPayload,
                    adjustmentType: fields.adjustmentType,
                    quantity: Math.trunc(quantityValue),
                    costTotal: parsedCost,
                    note: fields.note.trim() || undefined,
                };
                const response = await fetch(`/api/admin/products/${fields.productId}/inventory`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });
                if (!response.ok) {
                    throw new Error("INVENTORY_ADJUST_FAILED");
                }
                await refreshStore();
                return { ok: true as const };
            } catch (error) {
                console.error(error);
                return { ok: false as const, error: "Не удалось записать операцию" };
            }
        },
        [authHeader, authPayload, refreshStore],
    );

    const handleCreateCategory = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!storeHotelId) {
                notify("Сначала выберите отель");
                return;
            }
            if (!categoryForm.name.trim()) {
                notify("Название категории обязательно");
                return;
            }
            if (!authPayload) {
                notify("Нет авторизации Telegram");
                return;
            }

            setIsSavingCategory(true);
            try {
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authHeader) {
                    headers["x-telegram-auth-payload"] = authHeader;
                }
                const payload = {
                    ...authPayload,
                    hotelId: storeHotelId,
                    name: categoryForm.name.trim(),
                    description: categoryForm.description.trim() || undefined,
                };
                const response = await fetch("/api/admin/product-categories", {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });
                if (!response.ok) {
                    throw new Error("CATEGORY_CREATE_FAILED");
                }
                setCategoryForm({ name: "", description: "" });
                await refreshStore();
                notify("Категория добавлена");
            } catch (error) {
                console.error(error);
                notify("Не удалось создать категорию");
            } finally {
                setIsSavingCategory(false);
            }
        },
        [authHeader, authPayload, categoryForm, refreshStore, storeHotelId],
    );

    const handleCreateProduct = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!storeHotelId) {
                notify("Сначала выберите отель");
                return;
            }
            if (!productForm.name.trim()) {
                notify("Название товара обязательно");
                return;
            }
            const costValue = Number(productForm.costPrice.replace(",", "."));
            const sellValue = Number(productForm.sellPrice.replace(",", "."));
            if (!Number.isFinite(costValue) || costValue < 0) {
                notify("Укажите себестоимость");
                return;
            }
            if (!Number.isFinite(sellValue) || sellValue <= 0) {
                notify("Укажите цену продажи");
                return;
            }
            if (!authPayload) {
                notify("Нет авторизации Telegram");
                return;
            }

            setIsSavingProduct(true);
            try {
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authHeader) {
                    headers["x-telegram-auth-payload"] = authHeader;
                }
                const payload = {
                    ...authPayload,
                    hotelId: storeHotelId,
                    categoryId: productForm.categoryId || undefined,
                    name: productForm.name.trim(),
                    sku: productForm.sku.trim() || undefined,
                    description: productForm.description.trim() || undefined,
                    costPrice: costValue,
                    sellPrice: sellValue,
                    unit: productForm.unit.trim() || undefined,
                    reorderThreshold: productForm.reorderThreshold ? Number(productForm.reorderThreshold) : undefined,
                    isActive: productForm.isActive,
                };
                const response = await fetch("/api/admin/products", {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });
                if (!response.ok) {
                    throw new Error("PRODUCT_CREATE_FAILED");
                }
                setProductForm({
                    name: "",
                    categoryId: "",
                    sku: "",
                    description: "",
                    costPrice: "",
                    sellPrice: "",
                    unit: "",
                    reorderThreshold: "",
                    isActive: true,
                });
                await refreshStore();
                notify("Товар добавлен");
            } catch (error) {
                console.error(error);
                notify("Не удалось создать товар");
            } finally {
                setIsSavingProduct(false);
            }
        },
        [authHeader, authPayload, productForm, refreshStore, storeHotelId],
    );

    const handleInventorySubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setIsSavingInventory(true);
            const result = await submitInventoryAdjustment({
                productId: inventoryForm.productId,
                adjustmentType: inventoryForm.adjustmentType,
                quantity: inventoryForm.quantity,
                costTotal: inventoryForm.costTotal,
                note: inventoryForm.note,
            });
            setIsSavingInventory(false);
            if (result.ok) {
                setInventoryForm((prev) => ({ ...prev, quantity: "", costTotal: "", note: "" }));
                notify("Остаток обновлён");
            } else if (result.error) {
                notify(result.error);
            }
        },
        [inventoryForm, submitInventoryAdjustment],
    );

    const handleInventoryModalSubmit = useCallback(async () => {
        if (!inventoryModal) {
            return;
        }
        setIsInventoryModalSaving(true);
        const result = await submitInventoryAdjustment({
            productId: inventoryModal.product.id,
            adjustmentType: inventoryModal.adjustmentType,
            quantity: inventoryModal.quantity,
            costTotal: inventoryModal.costTotal,
            note: inventoryModal.note,
        });
        setIsInventoryModalSaving(false);
        if (result.ok) {
            setInventoryModal(null);
            setInventoryModalError(null);
            notify("Остаток обновлён");
        } else if (result.error) {
            setInventoryModalError(result.error);
        }
    }, [inventoryModal, submitInventoryAdjustment]);

    const handleCloseInventoryModal = useCallback(() => {
        if (isInventoryModalSaving) {
            return;
        }
        setInventoryModal(null);
        setInventoryModalError(null);
    }, [isInventoryModalSaving]);

    return (
        <div className="flex min-h-screen flex-col gap-4 px-3 pb-16 pt-3 sm:px-6 sm:pt-4">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-semibold text-white">{user.displayName}</h1>
                        <button
                            type="button"
                            aria-label="Показать подсказку по работе с отелями"
                            aria-pressed={isHeaderHintVisible}
                            onClick={() => setIsHeaderHintVisible((prev) => !prev)}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border border-white/30 text-xs font-semibold transition ${isHeaderHintVisible ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10"}`}
                        >
                            ?
                        </button>
                    </div>
                    {showLogout && (
                        <div className="flex items-center justify-end text-xs text-white/80">
                            <div className="flex items-center gap-2">
                                {devOverrideActive && (
                                    <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.3em] text-white/70">
                                        DEV
                                    </span>
                                )}
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
                        </div>
                    )}
                </div>
                {isHeaderHintVisible && (
                    <p className="max-w-sm text-xs text-white/60">
                        Выберите отель чтобы назначать менеджеров, добавлять номера и отслеживать смены
                    </p>
                )}
            </header>
            <div className="sticky top-0 z-10 -mx-3 mb-1 bg-slate-900/90 px-3 pb-2 pt-3 backdrop-blur sm:-mx-6 sm:rounded-3xl">
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
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Чистый доход</p>
                                    <p className="mt-1 text-2xl font-semibold text-white">{formatCurrency(overview.totals.netCash)}</p>
                                    <p className="text-xs text-white/60">Сводный баланс по выбранным фильтрам</p>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Поступления</p>
                                    <p className="mt-1 text-xl font-semibold text-emerald-300">
                                        {formatCurrency(overview.totals.cashIn)}
                                    </p>
                                    <div className="mt-3 space-y-1 text-xs text-white/60">
                                        <p>Наличные · {formatCurrency(overview.totals.cashInBreakdown.cash)}</p>
                                        <p>Безналичные · {formatCurrency(overview.totals.cashInBreakdown.card)}</p>
                                    </div>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white">
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Списания</p>
                                    <p className="mt-1 text-xl font-semibold text-rose-300">
                                        {formatCurrency(overview.totals.cashOut)}
                                    </p>
                                    <div className="mt-3 space-y-1 text-xs text-white/60">
                                        <p>Наличные · {formatCurrency(overview.totals.cashOutBreakdown.cash)}</p>
                                        <p>Безналичные · {formatCurrency(overview.totals.cashOutBreakdown.card)}</p>
                                    </div>
                                    <div className="mt-3 rounded-xl border border-white/10 p-2 text-[11px] text-white/60">
                                        <p>
                                            Выплаты · {formatCurrency(overview.totals.payouts)}
                                            <span className="text-white/40">
                                                {' '}
                                                (нал {formatCurrency(overview.totals.payoutsBreakdown.cash)} · безн {formatCurrency(overview.totals.payoutsBreakdown.card)})
                                            </span>
                                        </p>
                                        <p>
                                            Корректировки · {formatCurrency(overview.totals.adjustments)}
                                            <span className="text-white/40">
                                                {' '}
                                                (нал {formatCurrency(overview.totals.adjustmentsBreakdown.cash)} · безн {formatCurrency(overview.totals.adjustmentsBreakdown.card)})
                                            </span>
                                        </p>
                                    </div>
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
                                <AnalyticsFlowChart
                                    inflow={overview.totals.cashIn}
                                    outflow={overview.totals.cashOut}
                                    net={overview.totals.netCash}
                                />
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
                        <div className="mb-4">
                            <h2 className="text-2xl font-semibold">Отели</h2>
                        </div>
                        <div className="grid gap-2.5">
                            {isLoading && <HotelsSkeleton />}
                            {!isLoading && hotels.length === 0 && (
                                <p className="text-sm text-white/60">Пока нет отелей</p>
                            )}
                            {!isLoading &&
                                hotels.map((hotel) => {
                                    const inflow = hotel.ledger?.cashIn ?? 0;
                                    const inflowCash = hotel.ledger?.cashInBreakdown.cash ?? 0;
                                    const inflowCard = hotel.ledger?.cashInBreakdown.card ?? 0;
                                    const outflow = hotel.ledger?.cashOut ?? 0;
                                    const outflowCash = hotel.ledger?.cashOutBreakdown.cash ?? 0;
                                    const outflowCard = hotel.ledger?.cashOutBreakdown.card ?? 0;

                                    return (
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
                                            <div className="mt-3 grid gap-3 rounded-xl border border-white/10 p-3 text-xs text-white/70 sm:grid-cols-2">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Поступления</p>
                                                    <p className="text-sm font-semibold text-emerald-300">{formatCurrency(inflow)}</p>
                                                    <p>Наличные · {formatCurrency(inflowCash)}</p>
                                                    <p>Безналичные · {formatCurrency(inflowCard)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Списания</p>
                                                    <p className="text-sm font-semibold text-rose-300">{formatCurrency(outflow)}</p>
                                                    <p>Наличные · {formatCurrency(outflowCash)}</p>
                                                    <p>Безналичные · {formatCurrency(outflowCard)}</p>
                                                </div>
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
                                                                {manager.displayName ?? manager.username ?? 'Менеджер'}: {manager.pinCode ?? 'PIN не задан'}
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
                                    );
                                })}
                        </div>
                    </Card>
                </section>
            )}

            {activeTab === "store" && (
                <section className="space-y-4">
                    <Card className="bg-white/5 p-4 text-white">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Склад</p>
                                <h2 className="text-2xl font-semibold">Товары и категории</h2>
                                <p className="text-sm text-white/60">Выберите объект, чтобы управлять остатками</p>
                            </div>
                            <div className="w-full space-y-1 sm:max-w-xs">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="store-hotel">
                                    Объект
                                </label>
                                <select
                                    id="store-hotel"
                                    value={storeHotelId}
                                    onChange={(event) => setStoreHotelId(event.target.value)}
                                    className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                >
                                    <option value="" className="bg-slate-900 text-white">
                                        {hotels.length ? "Выберите" : "Нет объектов"}
                                    </option>
                                    {hotels.map((hotel) => (
                                        <option key={hotel.id} value={hotel.id} className="bg-slate-900 text-white">
                                            {hotel.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {storeHotelId ? (
                            storeSummary ? (
                                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                                    <Card className="bg-white/5 p-4 text-white">
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Товаров</p>
                                        <p className="mt-1 text-2xl font-semibold">{storeSummary.totalProducts}</p>
                                        <p className="text-xs text-white/60">Позиции в учёте</p>
                                    </Card>
                                    <Card className="bg-white/5 p-4 text-white">
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Себестоимость</p>
                                        <p className="mt-1 text-xl font-semibold text-white">{formatCurrency(storeSummary.stockValue)}</p>
                                        <p className="text-xs text-white/60">Стоимость склада</p>
                                    </Card>
                                    <Card className="bg-white/5 p-4 text-white">
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Потенциал</p>
                                        <p className="mt-1 text-xl font-semibold text-emerald-300">{formatCurrency(storeSummary.potentialRevenue)}</p>
                                        <p className="text-xs text-white/60">Выручка при продаже</p>
                                    </Card>
                                    <Card className="bg-white/5 p-4 text-white">
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Малый остаток</p>
                                        <p className="mt-1 text-2xl font-semibold text-amber-200">{storeSummary.lowStock}</p>
                                        <p className="text-xs text-white/60">Нужно пополнить</p>
                                    </Card>
                                </div>
                            ) : isStoreLoading ? (
                                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <Card key={`store-skeleton-${index}`} className="bg-white/5 p-4">
                                            <Skeleton className="h-4 w-1/3" />
                                            <Skeleton className="mt-3 h-8 w-1/2" />
                                            <Skeleton className="mt-2 h-4 w-2/3" />
                                        </Card>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-4 text-sm text-white/60">Загружаем данные склада…</p>
                            )
                        ) : (
                            <p className="mt-4 text-sm text-white/60">Добавьте объект, чтобы вести учёт товаров.</p>
                        )}
                    </Card>
                    {storeHotelId && (
                        <>
                            <div className="grid gap-4 lg:grid-cols-3">
                                <Card className="bg-white/5 p-4 text-white">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Категории</p>
                                            <h3 className="text-xl font-semibold">{storeCategories.length || 0}</h3>
                                            <p className="text-xs text-white/60">Группы товаров</p>
                                        </div>
                                        <Badge label={`${storeCategories.length || 0}`} />
                                    </div>
                                    <div className="mt-4 space-y-2">
                                        {storeCategories.length ? (
                                            storeCategories.map((category) => (
                                                <div
                                                    key={category.id}
                                                    className="flex items-center justify-between rounded-2xl border border-white/10 px-3 py-2 text-sm"
                                                >
                                                    <div>
                                                        <p className="font-semibold text-white">{category.name}</p>
                                                        {category.description && (
                                                            <p className="text-xs text-white/60">{category.description}</p>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-white/60">{category.productCount} шт.</span>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-sm text-white/60">Категории ещё не созданы</p>
                                        )}
                                    </div>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white lg:col-span-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Товары</p>
                                            <h3 className="text-xl font-semibold">{storeProducts.length}</h3>
                                            <p className="text-xs text-white/60">Остатки по точке</p>
                                        </div>
                                        {storeSummary?.sales && (
                                            <div className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-white/70">
                                                <p>Продано: {storeSummary.sales.totalQuantity} шт.</p>
                                                <p>На сумму: {formatCurrency(storeSummary.sales.totalRevenue)}</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {storeProducts.length ? (
                                            storeProducts.map((product) => {
                                                const lowStock =
                                                    typeof product.reorderThreshold === "number" &&
                                                    product.reorderThreshold > 0 &&
                                                    product.stockOnHand <= product.reorderThreshold;
                                                const badgeTone = !product.isActive ? "danger" : lowStock ? "warning" : "success";
                                                const badgeLabel = !product.isActive ? "Отключен" : lowStock ? "Мало" : "Активен";
                                                return (
                                                    <div
                                                        key={product.id}
                                                        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                                                    >
                                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                                            <div>
                                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                                                                    {product.category?.name ?? "Без категории"}
                                                                </p>
                                                                <h4 className="text-lg font-semibold text-white">{product.name}</h4>
                                                                {product.sku && (
                                                                    <p className="text-xs text-white/60">SKU: {product.sku}</p>
                                                                )}
                                                            </div>
                                                            <Badge label={badgeLabel} tone={badgeTone as "success" | "warning" | "danger" | "default"} />
                                                        </div>
                                                        <div className="mt-3 grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                                                            <div>
                                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Цена</p>
                                                                <p className="font-semibold text-white">{formatCurrency(product.sellPrice)}</p>
                                                                <p className="text-xs text-white/60">Себестоимость {formatCurrency(product.costPrice)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Остаток</p>
                                                                <p className="font-semibold text-white">
                                                                    {product.stockOnHand} {product.unit || "ед."}
                                                                </p>
                                                                {typeof product.reorderThreshold === "number" && product.reorderThreshold > 0 && (
                                                                    <p className="text-xs text-white/60">Порог: {product.reorderThreshold}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => handleOpenInventoryModal(product, "RESTOCK")}
                                                            >
                                                                Пополнить
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleOpenInventoryModal(product, "WRITE_OFF")}
                                                            >
                                                                Списать
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : isStoreLoading ? (
                                            <p className="text-sm text-white/60">Загружаем список товаров…</p>
                                        ) : (
                                            <p className="text-sm text-white/60">Товары ещё не заведены</p>
                                        )}
                                    </div>
                                </Card>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-3">
                                <Card className="bg-white/5 p-4 text-white">
                                    <div className="mb-3">
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Категория</p>
                                        <h3 className="text-lg font-semibold">Новая</h3>
                                    </div>
                                    <form className="space-y-3" onSubmit={handleCreateCategory}>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="category-name">
                                                Название
                                            </label>
                                            <Input
                                                id="category-name"
                                                name="name"
                                                value={categoryForm.name}
                                                onChange={handleCategoryInputChange}
                                                placeholder="Мини-бар"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="category-description">
                                                Описание
                                            </label>
                                            <TextArea
                                                id="category-description"
                                                name="description"
                                                rows={3}
                                                value={categoryForm.description}
                                                onChange={handleCategoryInputChange}
                                                placeholder="Что входит"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <Button type="submit" className="w-full" disabled={isSavingCategory || !storeHotelId}>
                                            {isSavingCategory ? "Сохраняем..." : "Добавить"}
                                        </Button>
                                    </form>
                                </Card>
                                <Card className="bg-white/5 p-4 text-white lg:col-span-2">
                                    <div className="mb-3 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Товар</p>
                                            <h3 className="text-lg font-semibold">Новая позиция</h3>
                                        </div>
                                    </div>
                                    <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreateProduct}>
                                        <div className="space-y-1 md:col-span-2">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-name">
                                                Название
                                            </label>
                                            <Input
                                                id="product-name"
                                                name="name"
                                                value={productForm.name}
                                                onChange={handleProductInputChange}
                                                placeholder="Вода 0.5л"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-category">
                                                Категория
                                            </label>
                                            <select
                                                id="product-category"
                                                name="categoryId"
                                                value={productForm.categoryId}
                                                onChange={handleProductInputChange}
                                                className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                            >
                                                <option value="" className="bg-slate-900 text-white">
                                                    Без категории
                                                </option>
                                                {storeCategories.map((category) => (
                                                    <option key={category.id} value={category.id} className="bg-slate-900 text-white">
                                                        {category.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-sku">
                                                SKU
                                            </label>
                                            <Input
                                                id="product-sku"
                                                name="sku"
                                                value={productForm.sku}
                                                onChange={handleProductInputChange}
                                                placeholder="Опционально"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-unit">
                                                Единица
                                            </label>
                                            <Input
                                                id="product-unit"
                                                name="unit"
                                                value={productForm.unit}
                                                onChange={handleProductInputChange}
                                                placeholder="шт, бут и т.д."
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-cost">
                                                Себестоимость (KGS)
                                            </label>
                                            <Input
                                                id="product-cost"
                                                name="costPrice"
                                                type="number"
                                                step="0.01"
                                                value={productForm.costPrice}
                                                onChange={handleProductInputChange}
                                                placeholder="0.00"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-sell">
                                                Цена продажи (KGS)
                                            </label>
                                            <Input
                                                id="product-sell"
                                                name="sellPrice"
                                                type="number"
                                                step="0.01"
                                                value={productForm.sellPrice}
                                                onChange={handleProductInputChange}
                                                placeholder="0.00"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-reorder">
                                                Порог заказа
                                            </label>
                                            <Input
                                                id="product-reorder"
                                                name="reorderThreshold"
                                                type="number"
                                                value={productForm.reorderThreshold}
                                                onChange={handleProductInputChange}
                                                placeholder="Например, 5"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                            <label className="text-xs font-semibold uppercase text-white/70" htmlFor="product-description">
                                                Описание
                                            </label>
                                            <TextArea
                                                id="product-description"
                                                name="description"
                                                rows={3}
                                                value={productForm.description}
                                                onChange={handleProductInputChange}
                                                placeholder="Кратко о товаре"
                                                className="bg-white/10 text-white placeholder:text-white/40"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="flex items-center gap-2 text-xs font-semibold uppercase text-white/70">
                                                <input
                                                    type="checkbox"
                                                    checked={productForm.isActive}
                                                    onChange={handleProductToggleActive}
                                                    className="h-4 w-4 rounded border-white/30 bg-transparent"
                                                />
                                                Активен для продажи
                                            </label>
                                        </div>
                                        <Button
                                            type="submit"
                                            className="md:col-span-2"
                                            disabled={isSavingProduct || !storeHotelId}
                                        >
                                            {isSavingProduct ? "Сохраняем..." : "Добавить товар"}
                                        </Button>
                                    </form>
                                </Card>
                            </div>
                            <Card className="bg-white/5 p-4 text-white">
                                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Складская операция</p>
                                        <h3 className="text-lg font-semibold">Приход/списание</h3>
                                    </div>
                                    {inventoryTargetProduct && (
                                        <div className="text-xs text-white/60">
                                            <p>
                                                {inventoryTargetProduct.name}: {inventoryTargetProduct.stockOnHand}{" "}
                                                {inventoryTargetProduct.unit || "ед."}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <form className="grid gap-3 md:grid-cols-2" onSubmit={handleInventorySubmit}>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="inventory-product">
                                            Товар
                                        </label>
                                        <select
                                            id="inventory-product"
                                            name="productId"
                                            value={inventoryForm.productId}
                                            onChange={handleInventoryInputChange}
                                            className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                        >
                                            <option value="" className="bg-slate-900 text-white">
                                                Выберите
                                            </option>
                                            {storeProducts.map((product) => (
                                                <option key={product.id} value={product.id} className="bg-slate-900 text-white">
                                                    {product.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="inventory-type">
                                            Тип
                                        </label>
                                        <select
                                            id="inventory-type"
                                            name="adjustmentType"
                                            value={inventoryForm.adjustmentType}
                                            onChange={handleInventoryInputChange}
                                            className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                        >
                                            <option value="RESTOCK" className="bg-slate-900 text-white">
                                                Поставка
                                            </option>
                                            <option value="WRITE_OFF" className="bg-slate-900 text-white">
                                                Списание
                                            </option>
                                            <option value="ADJUSTMENT" className="bg-slate-900 text-white">
                                                Корректировка
                                            </option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="inventory-qty">
                                            Количество
                                        </label>
                                        <Input
                                            id="inventory-qty"
                                            name="quantity"
                                            type="number"
                                            value={inventoryForm.quantity}
                                            onChange={handleInventoryInputChange}
                                            placeholder="Например, 10"
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="inventory-cost">
                                            Стоимость поставки (KGS)
                                        </label>
                                        <Input
                                            id="inventory-cost"
                                            name="costTotal"
                                            type="number"
                                            step="0.01"
                                            value={inventoryForm.costTotal}
                                            onChange={handleInventoryInputChange}
                                            placeholder="0.00"
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="inventory-note">
                                            Комментарий
                                        </label>
                                        <TextArea
                                            id="inventory-note"
                                            name="note"
                                            rows={2}
                                            value={inventoryForm.note}
                                            onChange={handleInventoryInputChange}
                                            placeholder="Например, чек поставщика"
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                    </div>
                                    <Button
                                        type="submit"
                                        className="md:col-span-2"
                                        disabled={isSavingInventory || !inventoryForm.productId}
                                    >
                                        {isSavingInventory ? "Сохраняем..." : "Записать"}
                                    </Button>
                                </form>
                            </Card>
                        </>
                    )}
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
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="cleaningChatId">
                                    ID чата уборки
                                </label>
                                <Input
                                    id="cleaningChatId"
                                    name="cleaningChatId"
                                    placeholder="Например, -1001234567890"
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                                <p className="text-xs text-white/50">Используется для уведомлений горничных в Telegram.</p>
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
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold uppercase text-white/70" htmlFor="edit-cleaningChatId">
                                            ID чата уборки
                                        </label>
                                        <Input
                                            id="edit-cleaningChatId"
                                            name="cleaningChatId"
                                            value={editForm.cleaningChatId}
                                            onChange={handleEditFieldChange}
                                            placeholder="Например, -1001234567890"
                                            disabled={!selectedHotelId || isUpdatingHotel}
                                            className="bg-white/10 text-white placeholder:text-white/40"
                                        />
                                        <p className="text-xs text-white/50">
                                            Укажите Telegram-группу, куда отправлять задачи уборки.
                                        </p>
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

            {inventoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                    <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.35em] text-white/40">Склад</p>
                                <h3 className="text-xl font-semibold">
                                    {inventoryModal.adjustmentType === "RESTOCK"
                                        ? "Пополнение"
                                        : inventoryModal.adjustmentType === "WRITE_OFF"
                                            ? "Списание"
                                            : "Корректировка"}
                                </h3>
                                <p className="mt-1 text-sm text-white/80">{inventoryModal.product.name}</p>
                                <p className="text-xs text-white/60">
                                    Остаток {inventoryModal.product.stockOnHand} {inventoryModal.product.unit || "ед."} · Себестоимость {formatCurrency(inventoryModal.product.costPrice)} · Цена {formatCurrency(inventoryModal.product.sellPrice)}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="text-2xl text-white/60 transition hover:text-white focus:outline-none"
                                aria-label="Закрыть"
                                onClick={handleCloseInventoryModal}
                                disabled={isInventoryModalSaving}
                            >
                                ×
                            </button>
                        </div>
                        <div className="mt-6 space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="modal-inventory-type">
                                    Тип операции
                                </label>
                                <select
                                    id="modal-inventory-type"
                                    value={inventoryModal.adjustmentType}
                                    onChange={(event) =>
                                        setInventoryModal((prev) => {
                                            setInventoryModalError(null);

                                            return prev
                                                ? {
                                                    ...prev,
                                                    adjustmentType: event.target.value as InventoryAdjustmentType,
                                                }
                                                : prev;
                                        })
                                    }
                                    className="w-full rounded-2xl border border-white/20 bg-slate-900/70 p-3 text-sm text-white focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber"
                                >
                                    <option value="RESTOCK" className="bg-slate-900 text-white">
                                        Поставка
                                    </option>
                                    <option value="WRITE_OFF" className="bg-slate-900 text-white">
                                        Списание
                                    </option>
                                    <option value="ADJUSTMENT" className="bg-slate-900 text-white">
                                        Корректировка
                                    </option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="modal-inventory-qty">
                                    Количество
                                </label>
                                <Input
                                    id="modal-inventory-qty"
                                    type="number"
                                    value={inventoryModal.quantity}
                                    onChange={(event) =>
                                        setInventoryModal((prev) => {
                                            setInventoryModalError(null);
                                            return prev ? { ...prev, quantity: event.target.value } : prev;
                                        })
                                    }
                                    placeholder="Например, 5"
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="modal-inventory-cost">
                                    Стоимость поставки (KGS)
                                </label>
                                <Input
                                    id="modal-inventory-cost"
                                    type="number"
                                    step="0.01"
                                    value={inventoryModal.costTotal}
                                    onChange={(event) =>
                                        setInventoryModal((prev) => {
                                            setInventoryModalError(null);
                                            return prev ? { ...prev, costTotal: event.target.value } : prev;
                                        })
                                    }
                                    placeholder="0.00"
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-white/70" htmlFor="modal-inventory-note">
                                    Комментарий
                                </label>
                                <TextArea
                                    id="modal-inventory-note"
                                    rows={2}
                                    value={inventoryModal.note}
                                    onChange={(event) =>
                                        setInventoryModal((prev) => {
                                            setInventoryModalError(null);
                                            return prev ? { ...prev, note: event.target.value } : prev;
                                        })
                                    }
                                    placeholder="Например, номер накладной"
                                    className="bg-white/10 text-white placeholder:text-white/40"
                                />
                            </div>
                            {inventoryModalError && <p className="text-sm text-rose-300">{inventoryModalError}</p>}
                            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                                <Button
                                    type="button"
                                    className="flex-1"
                                    disabled={isInventoryModalSaving || !inventoryModal.quantity.trim()}
                                    onClick={handleInventoryModalSubmit}
                                >
                                    {isInventoryModalSaving ? "Сохраняем..." : "Подтвердить"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="flex-1"
                                    disabled={isInventoryModalSaving}
                                    onClick={handleCloseInventoryModal}
                                >
                                    Отмена
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
