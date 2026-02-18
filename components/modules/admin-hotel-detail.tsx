'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, TextArea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { useApi } from '@/hooks/useApi';
import { formatDateTime, formatMoney } from '@/lib/timezone';

type ShiftStatusValue = 'OPEN' | 'CLOSED';
type RoomStatusValue = 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'HOLD';
type StayStatusValue = 'SCHEDULED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
type PaymentMethodValue = 'AUTO' | 'CASH' | 'CARD';
type LedgerEntryTypeValue = 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
type LedgerPaymentMethodValue = 'CASH' | 'CARD';

interface RoomStayDetail {
    id: string;
    guestName?: string | null;
    status: StayStatusValue;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    actualCheckIn?: string | null;
    actualCheckOut?: string | null;
    amountPaid?: number | null;
    paymentMethod?: string | null;
    cashPaid?: number | null;
    cardPaid?: number | null;
    notes?: string | null;
}

interface LedgerEntryDetail {
    id: string;
    entryType: LedgerEntryTypeValue;
    method: LedgerPaymentMethodValue;
    amount: number;
    note?: string | null;
    recordedAt: string;
    managerName?: string | null;
    shiftNumber?: number | null;
}

interface ShiftHistoryEntry {
    id: string;
    number: number;
    managerId: string;
    manager: string;
    openedAt: string;
    closedAt?: string | null;
    openingCash: number;
    closingCash?: number | null;
    handoverCash?: number | null;
    openingNote?: string | null;
    closingNote?: string | null;
    handoverNote?: string | null;
    status: ShiftStatusValue;
    expectedPayout?: number | null;
    paidPayout?: number | null;
    pendingPayout?: number | null;
}

type ShiftListItem = ShiftHistoryEntry & { isCurrent: boolean };

interface HotelDetailPayload {
    id: string;
    name: string;
    address: string;
    managerSharePct?: number | null;
    notes?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        assignmentId: string;
        id: string;
        displayName: string;
        telegramId?: string | null;
        username?: string | null;
        pinCode?: string | null;
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
    }>;
    rooms: Array<{
        id: string;
        label: string;
        floor?: string | null;
        status: RoomStatusValue;
        isActive: boolean;
        notes?: string | null;
        stay?: RoomStayDetail | null;
        stays: RoomStayDetail[];
    }>;
    activeShift?: ShiftHistoryEntry | null;
    shiftHistory: ShiftHistoryEntry[];
    transactions: LedgerEntryDetail[];
    timezone?: string | null;
    currency?: string | null;
    financials: {
        cashIn: number;
        cashOut: number;
        payouts: number;
        adjustments: number;
        netCash: number;
    };
}

interface AddManagerForm {
    displayName: string;
    username?: string;
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
}

interface UpdateManagerForm {
    assignmentId: string;
    displayName: string;
    username: string;
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
}

interface EditShiftForm {
    managerId: string;
    openedAt: string;
    closedAt: string;
    openingCash: number;
    closingCash?: number | null;
    handoverCash?: number | null;
    openingNote?: string;
    closingNote?: string;
    handoverNote?: string;
    status: ShiftStatusValue;
}

interface CreateShiftForm {
    managerId: string;
    openedAt: string;
    closedAt: string;
    openingCash: number;
    closingCash?: number | null;
    handoverCash?: number | null;
    openingNote?: string;
    closingNote?: string;
    handoverNote?: string;
    status: ShiftStatusValue;
}

interface CreateRoomsForm {
    roomLabels: string;
    floor?: string;
    notes?: string;
}

interface StayEditForm {
    stayId: string;
    roomId: string;
    roomLabel: string;
    guestName: string;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    actualCheckIn: string;
    actualCheckOut: string;
    status: StayStatusValue;
    cashPaid: number;
    cardPaid: number;
    totalPaid: number;
    paymentMethod: PaymentMethodValue;
    notes: string;
}

const createStayEditDefaults = (): StayEditForm => ({
    stayId: '',
    roomId: '',
    roomLabel: '',
    guestName: '',
    scheduledCheckIn: '',
    scheduledCheckOut: '',
    actualCheckIn: '',
    actualCheckOut: '',
    status: 'SCHEDULED',
    cashPaid: 0,
    cardPaid: 0,
    totalPaid: 0,
    paymentMethod: 'AUTO',
    notes: ''
});

const stayStatusOptions: Array<{ value: StayStatusValue; label: string }> = [
    { value: 'SCHEDULED', label: 'Запланирован' },
    { value: 'CHECKED_IN', label: 'Заселён' },
    { value: 'CHECKED_OUT', label: 'Выселен' },
    { value: 'CANCELLED', label: 'Отменён' }
];

const stayStatusLabels: Record<StayStatusValue, string> = {
    SCHEDULED: 'Запланирован',
    CHECKED_IN: 'Заселён',
    CHECKED_OUT: 'Выселен',
    CANCELLED: 'Отменён'
};

const stayStatusTone: Record<StayStatusValue, 'default' | 'success' | 'warning' | 'danger'> = {
    SCHEDULED: 'default',
    CHECKED_IN: 'warning',
    CHECKED_OUT: 'success',
    CANCELLED: 'danger'
};

const stayPaymentOptions: Array<{ value: PaymentMethodValue; label: string }> = [
    { value: 'AUTO', label: 'Определить автоматически' },
    { value: 'CASH', label: 'Наличные' },
    { value: 'CARD', label: 'Безнал' }
];

const ledgerEntryTypeLabels: Record<LedgerEntryTypeValue, string> = {
    CASH_IN: 'Поступление',
    CASH_OUT: 'Расход',
    MANAGER_PAYOUT: 'Выплата менеджеру',
    ADJUSTMENT: 'Корректировка'
};

const ledgerEntryTone: Record<LedgerEntryTypeValue, 'default' | 'success' | 'warning' | 'danger'> = {
    CASH_IN: 'success',
    CASH_OUT: 'danger',
    MANAGER_PAYOUT: 'warning',
    ADJUSTMENT: 'default'
};

const ledgerAmountClass: Record<LedgerEntryTypeValue, string> = {
    CASH_IN: 'text-emerald-300',
    CASH_OUT: 'text-rose-300',
    MANAGER_PAYOUT: 'text-amber-200',
    ADJUSTMENT: 'text-white'
};

const ledgerSignSymbol: Record<LedgerEntryTypeValue, string> = {
    CASH_IN: '+',
    CASH_OUT: '-',
    MANAGER_PAYOUT: '-',
    ADJUSTMENT: '±'
};

const ledgerMethodLabels: Record<LedgerPaymentMethodValue, string> = {
    CASH: 'Наличные',
    CARD: 'Безнал'
};

const toDateTimeInputValue = (value?: string | null) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};

const fromDateTimeInputValue = (value?: string | null) => {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed.length) {
        return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
};

const toOptionalMinorValue = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    return Math.round(value * 100);
};

const normalizePercentage = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    return Math.round(value);
};

const toMajorValue = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return undefined;
    }
    return value / 100;
};

const formatPercentage = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '—';
    }
    return `${value}%`;
};

const stayStartTimestamp = (stay: RoomStayDetail) => {
    const reference = stay.actualCheckIn ?? stay.scheduledCheckIn;
    if (!reference) {
        return 0;
    }
    const parsed = Date.parse(reference);
    return Number.isNaN(parsed) ? 0 : parsed;
};

interface AdminHotelDetailProps {
    hotelId: string;
}

export const AdminHotelDetail = ({ hotelId }: AdminHotelDetailProps) => {
    const router = useRouter();
    const { request, get } = useApi();
    const { toast } = useToast();

    const hotelKey = hotelId ? `/api/hotels/${hotelId}` : null;
    const { data, error, isLoading, mutate } = useSWR<HotelDetailPayload>(hotelKey, (url: string) => get<HotelDetailPayload>(url));

    const hotelTz = data?.timezone ?? undefined;
    const hotelCur = data?.currency ?? undefined;
    const formatCurrency = (value?: number | null) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return '—';
        return formatMoney(value, hotelCur);
    };
    const formatShiftAmount = (value?: number | null) => (value == null ? '—' : formatCurrency(value));
    const formatStayDate = (value?: string | null) => formatDateTime(value, hotelTz, undefined, '—');

    const managerForm = useForm<AddManagerForm>({
        defaultValues: { displayName: '', username: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined }
    });
    const updateManagerForm = useForm<UpdateManagerForm>({
        defaultValues: {
            assignmentId: '',
            displayName: '',
            username: '',
            pinCode: '',
            shiftPayAmount: undefined,
            revenueSharePct: undefined
        }
    });
    const roomForm = useForm<CreateRoomsForm>({
        defaultValues: { roomLabels: '', floor: '', notes: '' }
    });
    const shiftEditForm = useForm<EditShiftForm>({
        defaultValues: {
            managerId: '',
            openedAt: '',
            closedAt: '',
            openingCash: 0,
            closingCash: undefined,
            handoverCash: undefined,
            openingNote: '',
            closingNote: '',
            handoverNote: '',
            status: 'CLOSED'
        }
    });
    const createShiftForm = useForm<CreateShiftForm>({
        defaultValues: {
            managerId: '',
            openedAt: '',
            closedAt: '',
            openingCash: 0,
            closingCash: undefined,
            handoverCash: undefined,
            openingNote: '',
            closingNote: '',
            handoverNote: '',
            status: 'CLOSED'
        }
    });
    const stayEditForm = useForm<StayEditForm>({
        defaultValues: createStayEditDefaults()
    });

    const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
    const [editingShift, setEditingShift] = useState<ShiftHistoryEntry | null>(null);
    const [isCreatingShift, setIsCreatingShift] = useState(false);
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [removingManagerId, setRemovingManagerId] = useState<string | null>(null);
    const [removingRoomId, setRemovingRoomId] = useState<string | null>(null);
    const [isStayEditorOpen, setIsStayEditorOpen] = useState(false);
    const [isManagementPanelOpen, setIsManagementPanelOpen] = useState(false);
    const [isAddManagerExpanded, setIsAddManagerExpanded] = useState(false);
    const [isUpdateManagerExpanded, setIsUpdateManagerExpanded] = useState(false);
    const [isMassAddRoomsExpanded, setIsMassAddRoomsExpanded] = useState(false);

    const stayFormValues = stayEditForm.watch();
    const hasStaySelection = Boolean(stayFormValues.stayId);
    const roomPaymentPreview = useMemo(
        () => ({
            totalBreakdown: (Number.isFinite(stayFormValues.cashPaid) ? stayFormValues.cashPaid || 0 : 0) + (Number.isFinite(stayFormValues.cardPaid) ? stayFormValues.cardPaid || 0 : 0),
            totalField: Number.isFinite(stayFormValues.totalPaid) ? stayFormValues.totalPaid || 0 : 0
        }),
        [stayFormValues.cashPaid, stayFormValues.cardPaid, stayFormValues.totalPaid]
    );

    const selectedManagerId = updateManagerForm.watch('assignmentId');
    const selectedManager = useMemo(() => {
        if (!data || !selectedManagerId) {
            return null;
        }
        return data.managers.find((manager) => manager.assignmentId === selectedManagerId) ?? null;
    }, [data, selectedManagerId]);

    useEffect(() => {
        if (isUpdateManagerExpanded && selectedManagerId) {
            updateManagerForm.setFocus('pinCode');
        }
    }, [isUpdateManagerExpanded, selectedManagerId, updateManagerForm]);

    const shiftList = useMemo<ShiftListItem[]>(() => {
        if (!data) {
            return [];
        }
        const history = [...data.shiftHistory];
        const seen = new Set(history.map((shift) => shift.id));
        if (data.activeShift && !seen.has(data.activeShift.id)) {
            history.unshift(data.activeShift);
        }
        return history
            .map((shift) => ({
                ...shift,
                isCurrent: Boolean(data.activeShift && data.activeShift.id === shift.id)
            }))
            .sort((first, second) => second.number - first.number);
    }, [data]);

    const activeShiftId = useMemo(() => shiftList.find((shift) => shift.isCurrent)?.id ?? null, [shiftList]);

    useEffect(() => {
        if (!shiftList.length) {
            if (selectedShiftId !== null) {
                setSelectedShiftId(null);
            }
            return;
        }
        const preferredShiftId = activeShiftId ?? shiftList[0].id;
        if (!selectedShiftId || !shiftList.some((shift) => shift.id === selectedShiftId)) {
            setSelectedShiftId(preferredShiftId);
        }
    }, [shiftList, selectedShiftId, activeShiftId]);

    const shiftLedgerTotals = useMemo(() => {
        const map = new Map<number, { cashIn: number; cashOut: number; payouts: number; adjustments: number }>();
        if (!data) {
            return map;
        }
        for (const entry of data.transactions) {
            if (!entry.shiftNumber) {
                continue;
            }
            const bucket = map.get(entry.shiftNumber) ?? { cashIn: 0, cashOut: 0, payouts: 0, adjustments: 0 };
            switch (entry.entryType) {
                case 'CASH_IN':
                    bucket.cashIn += entry.amount;
                    break;
                case 'CASH_OUT':
                    bucket.cashOut += entry.amount;
                    break;
                case 'MANAGER_PAYOUT':
                    bucket.payouts += entry.amount;
                    break;
                case 'ADJUSTMENT':
                    bucket.adjustments += entry.amount;
                    break;
            }
            map.set(entry.shiftNumber, bucket);
        }
        return map;
    }, [data]);

    const roomStatusBuckets = useMemo(() => {
        const buckets = {
            available: [] as string[],
            occupied: [] as string[],
            dirty: [] as string[],
            hold: [] as string[]
        };
        if (!data) {
            return buckets;
        }
        for (const room of data.rooms) {
            const label = room.label.trim();
            if (room.status === 'AVAILABLE') {
                buckets.available.push(label);
            } else if (room.status === 'OCCUPIED') {
                buckets.occupied.push(label);
            } else if (room.status === 'DIRTY') {
                buckets.dirty.push(label);
            } else if (room.status === 'HOLD') {
                buckets.hold.push(label);
            }
        }
        buckets.available.sort();
        buckets.occupied.sort();
        buckets.dirty.sort();
        buckets.hold.sort();
        return buckets;
    }, [data]);

    const sortedRooms = useMemo(() => {
        if (!data) {
            return [] as HotelDetailPayload['rooms'];
        }
        return [...data.rooms].sort((first, second) =>
            first.label.localeCompare(second.label, 'ru', { numeric: true, sensitivity: 'base' })
        );
    }, [data]);

    const selectedShift = shiftList.find((shift) => shift.id === selectedShiftId) ?? null;
    const shiftTransactions = useMemo(() => {
        if (!data) {
            return new Map<number, HotelDetailPayload['transactions']>();
        }
        const map = new Map<number, Array<HotelDetailPayload['transactions'][number]>>();
        for (const entry of data.transactions) {
            if (!entry.shiftNumber) {
                continue;
            }
            const bucket = map.get(entry.shiftNumber) ?? [];
            bucket.push(entry);
            map.set(entry.shiftNumber, bucket);
        }
        return map;
    }, [data]);

    const selectedShiftCash = useMemo(() => {
        if (!selectedShift) {
            return null;
        }
        const ledger = shiftLedgerTotals.get(selectedShift.number) ?? { cashIn: 0, cashOut: 0, payouts: 0, adjustments: 0 };
        const movement = ledger.cashIn - ledger.cashOut - ledger.payouts + ledger.adjustments;
        const fallbackClosing = selectedShift.openingCash + movement;
        const currentCash = selectedShift.status === 'CLOSED'
            ? typeof selectedShift.closingCash === 'number'
                ? selectedShift.closingCash
                : fallbackClosing
            : fallbackClosing;
        return {
            openingCash: selectedShift.openingCash,
            currentCash,
            ...ledger
        };
    }, [selectedShift, shiftLedgerTotals]);

    const selectedShiftTransactions = useMemo(() => {
        if (!selectedShift) {
            return [];
        }
        return shiftTransactions.get(selectedShift.number) ?? [];
    }, [selectedShift, shiftTransactions]);

    const selectedShiftIncomeBreakdown = useMemo(() => {
        if (!selectedShift) {
            return null;
        }
        const base = () => ({ total: 0, cash: 0, card: 0 });
        const stays = base();
        const cashbox = base();
        for (const entry of selectedShiftTransactions) {
            if (entry.entryType !== 'CASH_IN') {
                continue;
            }
            const note = entry.note?.toLowerCase() ?? '';
            const target = note.startsWith('заселение') ? stays : cashbox;
            if (entry.method === 'CARD') {
                target.card += entry.amount;
            } else {
                target.cash += entry.amount;
            }
            target.total += entry.amount;
        }
        return { stays, cashbox };
    }, [selectedShift, selectedShiftTransactions]);

    const selectedShiftOutflows = useMemo(() => {
        if (!selectedShift) {
            return [];
        }
        return selectedShiftTransactions.filter((entry) => entry.entryType === 'CASH_OUT');
    }, [selectedShift, selectedShiftTransactions]);

    const [isTransactionsExpanded, setIsTransactionsExpanded] = useState(false);
    const [isRoomHistoryExpanded, setIsRoomHistoryExpanded] = useState(false);
    const [isOutflowModalOpen, setIsOutflowModalOpen] = useState(false);
    useEffect(() => {
        setIsTransactionsExpanded(false);
        setIsRoomHistoryExpanded(false);
        setIsOutflowModalOpen(false);
    }, [selectedShiftId]);
    const closeOutflowModal = () => setIsOutflowModalOpen(false);

    const toMinor = (value: number) => Math.round(value * 100);
    const toOptionalMinor = (value?: number | null) => {
        if (value === undefined || value === null || Number.isNaN(value)) {
            return null;
        }
        return Math.round(value * 100);
    };
    const normalizeOptionalText = (value?: string | null) => {
        if (value == null) {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    };

    const handleSelectShiftForEdit = (shift: ShiftHistoryEntry) => {
        setEditingShift(shift);
        shiftEditForm.reset({
            managerId: shift.managerId,
            openedAt: toDateTimeInputValue(shift.openedAt),
            closedAt: toDateTimeInputValue(shift.closedAt),
            openingCash: shift.openingCash / 100,
            closingCash: typeof shift.closingCash === 'number' ? shift.closingCash / 100 : undefined,
            handoverCash: typeof shift.handoverCash === 'number' ? shift.handoverCash / 100 : undefined,
            openingNote: shift.openingNote ?? '',
            closingNote: shift.closingNote ?? '',
            handoverNote: shift.handoverNote ?? '',
            status: shift.status
        });
    };

    const handleResetShiftEditor = () => {
        setEditingShift(null);
        shiftEditForm.reset({
            managerId: '',
            openedAt: '',
            closedAt: '',
            openingCash: 0,
            closingCash: undefined,
            handoverCash: undefined,
            openingNote: '',
            closingNote: '',
            handoverNote: '',
            status: 'CLOSED'
        });
    };

    const handleCreateShift = createShiftForm.handleSubmit(async (values) => {
        if (!Number.isFinite(values.openingCash)) {
            createShiftForm.setError('openingCash', { type: 'manual', message: 'Укажите сумму на начало смены' });
            return;
        }

        if (!values.managerId) {
            createShiftForm.setError('managerId', { type: 'manual', message: 'Выберите менеджера' });
            return;
        }

        if (!values.openedAt) {
            createShiftForm.setError('openedAt', { type: 'manual', message: 'Укажите время открытия смены' });
            return;
        }

        await request('/api/admin/shifts', {
            method: 'POST',
            body: {
                hotelId,
                managerId: values.managerId,
                openedAt: fromDateTimeInputValue(values.openedAt),
                closedAt: values.closedAt ? fromDateTimeInputValue(values.closedAt) : null,
                openingCash: toMinor(values.openingCash),
                closingCash: toOptionalMinor(values.closingCash ?? undefined),
                handoverCash: toOptionalMinor(values.handoverCash ?? undefined),
                openingNote: normalizeOptionalText(values.openingNote),
                closingNote: normalizeOptionalText(values.closingNote),
                handoverNote: normalizeOptionalText(values.handoverNote),
                status: values.status
            }
        });

        createShiftForm.reset();
        setIsCreatingShift(false);
        mutate();
    });

    const handleUpdateShift = shiftEditForm.handleSubmit(async (values) => {
        if (!editingShift) {
            return;
        }

        if (!Number.isFinite(values.openingCash)) {
            shiftEditForm.setError('openingCash', { type: 'manual', message: 'Укажите сумму на начало смены' });
            return;
        }

        await request(`/api/admin/shifts/${editingShift.id}`, {
            method: 'PATCH',
            body: {
                managerId: values.managerId || undefined,
                openedAt: values.openedAt ? fromDateTimeInputValue(values.openedAt) : undefined,
                closedAt: values.closedAt ? fromDateTimeInputValue(values.closedAt) : null,
                openingCash: toMinor(values.openingCash),
                closingCash: toOptionalMinor(values.closingCash ?? undefined),
                handoverCash: toOptionalMinor(values.handoverCash ?? undefined),
                openingNote: normalizeOptionalText(values.openingNote),
                closingNote: normalizeOptionalText(values.closingNote),
                handoverNote: normalizeOptionalText(values.handoverNote),
                status: values.status
            }
        });
        handleResetShiftEditor();
        mutate();
    });

    const handleClearShiftHistory = async () => {
        setIsClearingHistory(true);
        try {
            await request('/api/admin/shifts/clear', {
                method: 'POST',
                body: { hotelId }
            });
            mutate();
        } catch (clearError) {
            console.error(clearError);
            toast('Не удалось очистить историю смен', 'error');
        } finally {
            setIsClearingHistory(false);
        }
    };

    const handleRemoveManager = async (assignmentId: string) => {
        setRemovingManagerId(assignmentId);
        try {
            await request('/api/hotel-assignments', {
                method: 'DELETE',
                body: { assignmentId }
            });
            mutate();
        } catch (managerError) {
            console.error(managerError);
            toast('Не удалось удалить менеджера', 'error');
        } finally {
            setRemovingManagerId((current) => (current === assignmentId ? null : current));
        }
    };

    const handleDeleteRoom = async (roomId: string) => {
        setRemovingRoomId(roomId);
        try {
            await request('/api/rooms', {
                method: 'DELETE',
                body: { roomId }
            });
            mutate();
        } catch (roomError) {
            console.error(roomError);
            toast('Не удалось удалить номер', 'error');
        } finally {
            setRemovingRoomId((current) => (current === roomId ? null : current));
        }
    };

    const resetStayEditor = () => {
        stayEditForm.reset(createStayEditDefaults());
    };

    const handleCloseStayEditor = () => {
        setIsStayEditorOpen(false);
        resetStayEditor();
    };

    const hydrateStayEditor = (room: HotelDetailPayload['rooms'][number], stay: RoomStayDetail) => {
        stayEditForm.reset({
            stayId: stay.id,
            roomId: room.id,
            roomLabel: room.label,
            guestName: stay.guestName ?? '',
            scheduledCheckIn: toDateTimeInputValue(stay.scheduledCheckIn),
            scheduledCheckOut: toDateTimeInputValue(stay.scheduledCheckOut),
            actualCheckIn: toDateTimeInputValue(stay.actualCheckIn),
            actualCheckOut: toDateTimeInputValue(stay.actualCheckOut),
            status: stay.status as StayStatusValue,
            cashPaid: (stay.cashPaid ?? 0) / 100,
            cardPaid: (stay.cardPaid ?? 0) / 100,
            totalPaid: (stay.amountPaid ?? (stay.cashPaid ?? 0) + (stay.cardPaid ?? 0)) / 100,
            paymentMethod: stay.paymentMethod ? (stay.paymentMethod as PaymentMethodValue) : 'AUTO',
            notes: stay.notes ?? ''
        });
    };

    const handleSelectStayForEdit = (room: HotelDetailPayload['rooms'][number], stay: RoomStayDetail) => {
        hydrateStayEditor(room, stay);
        stayEditForm.setFocus('guestName');
        setIsStayEditorOpen(true);
    };

    const handleUpdateStay = stayEditForm.handleSubmit(async (values) => {
        if (!values.stayId) {
            return;
        }

        const cashMinor = toOptionalMinorValue(values.cashPaid);
        const cardMinor = toOptionalMinorValue(values.cardPaid);
        const totalMinor = toOptionalMinorValue(values.totalPaid);

        try {
            await request(`/api/admin/stays/${values.stayId}`, {
                method: 'PATCH',
                body: {
                    guestName: normalizeOptionalText(values.guestName),
                    notes: normalizeOptionalText(values.notes),
                    scheduledCheckIn: fromDateTimeInputValue(values.scheduledCheckIn),
                    scheduledCheckOut: fromDateTimeInputValue(values.scheduledCheckOut),
                    actualCheckIn: fromDateTimeInputValue(values.actualCheckIn),
                    actualCheckOut: fromDateTimeInputValue(values.actualCheckOut),
                    status: values.status,
                    cashPaid: cashMinor,
                    cardPaid: cardMinor,
                    amountPaid: totalMinor,
                    paymentMethod: values.paymentMethod === 'AUTO' ? null : values.paymentMethod
                }
            });

            const refreshed = await mutate();
            const snapshot = refreshed ?? data ?? null;
            if (snapshot) {
                const updatedRoom = snapshot.rooms.find((room) => room.id === values.roomId);
                const updatedStay = updatedRoom?.stays.find((stay) => stay.id === values.stayId);
                if (updatedRoom && updatedStay) {
                    hydrateStayEditor(updatedRoom, updatedStay);
                } else {
                    handleCloseStayEditor();
                }
            }
        } catch (stayUpdateError) {
            console.error(stayUpdateError);
            toast('Не удалось обновить заселение', 'error');
        }
    });

    if (isLoading || !data) {
        return (
            <div className="flex min-h-screen flex-col gap-4 px-2 py-4 sm:px-6 sm:py-6">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-24" />
                </div>
                <Skeleton className="h-24" />
                <Skeleton className="h-40" />
                <Skeleton className="h-72" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-2 py-4 text-center text-rose-300 sm:px-6">
                <p>Не удалось загрузить данные точки</p>
                <p className="text-sm text-white/60">{String(error)}</p>
                <Button onClick={() => router.refresh()}>Повторить</Button>
            </div>
        );
    }

    const handleAddManager = managerForm.handleSubmit(async (values) => {
        const shiftPayAmount = toOptionalMinorValue(values.shiftPayAmount);
        const revenueSharePct = normalizePercentage(values.revenueSharePct);

        await request('/api/hotel-assignments', {
            body: {
                hotelId,
                displayName: values.displayName.trim(),
                username: values.username?.trim() || undefined,
                pinCode: values.pinCode,
                shiftPayAmount: shiftPayAmount ?? undefined,
                revenueSharePct: revenueSharePct ?? undefined
            }
        });
        managerForm.reset({ displayName: '', username: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined });
        mutate();
    });

    const handleUpdateManager = updateManagerForm.handleSubmit(async (values) => {
        const shiftPayAmount = toOptionalMinorValue(values.shiftPayAmount);
        const revenueSharePct = normalizePercentage(values.revenueSharePct);

        const payload = {
            assignmentId: values.assignmentId,
            displayName: values.displayName.trim() || undefined,
            username: values.username.trim() || undefined,
            pinCode: values.pinCode.trim() || undefined,
            shiftPayAmount: shiftPayAmount ?? undefined,
            revenueSharePct: revenueSharePct ?? undefined
        };

        const hasUpdates =
            Boolean(payload.displayName) ||
            Boolean(payload.username) ||
            Boolean(payload.pinCode) ||
            shiftPayAmount !== null ||
            revenueSharePct !== null;

        if (!hasUpdates) {
            updateManagerForm.setError('assignmentId', {
                type: 'manual',
                message: 'Укажите хотя бы одно поле для обновления'
            });
            return;
        }

        try {
            await request('/api/hotel-assignments', {
                method: 'PATCH',
                body: payload
            });

            updateManagerForm.reset({
                assignmentId: values.assignmentId,
                displayName: '',
                username: '',
                pinCode: '',
                shiftPayAmount: undefined,
                revenueSharePct: undefined
            });
            mutate();
            toast('Менеджер обновлён', 'success');
        } catch (updateError) {
            console.error(updateError);
            toast('Не удалось обновить менеджера', 'error');
        }
    });

    const handleSelectManagerForEdit = (assignmentId: string) => {
        setIsManagementPanelOpen(true);
        setIsUpdateManagerExpanded(true);
        const target = data?.managers.find((manager) => manager.assignmentId === assignmentId) ?? null;
        updateManagerForm.reset({
            assignmentId,
            displayName: '',
            username: '',
            pinCode: '',
            shiftPayAmount: target?.shiftPayAmount != null ? toMajorValue(target.shiftPayAmount) : undefined,
            revenueSharePct: target?.revenueSharePct ?? undefined
        });
    };

    const handleAddRooms = roomForm.handleSubmit(async (values) => {
        const labels = values.roomLabels
            .split(/[\n,]+/)
            .map((label) => label.trim())
            .filter(Boolean);

        if (!labels.length) {
            roomForm.setError('roomLabels', { type: 'manual', message: 'Добавьте хотя бы один номер' });
            return;
        }

        await request('/api/rooms', {
            body: {
                hotelId,
                rooms: labels.map((label) => ({
                    label,
                    floor: values.floor?.trim() || undefined,
                    notes: values.notes?.trim() || undefined
                }))
            }
        });

        roomForm.reset({ roomLabels: '', floor: values.floor, notes: '' });
        mutate();
    });

    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-2 py-4 text-center text-rose-200 sm:px-6">
                <p className="text-lg font-semibold">Не удалось загрузить данные объекта</p>
                <p className="text-sm text-rose-100/70">{String(error)}</p>
                <Button type="button" variant="secondary" onClick={() => mutate()}>
                    Повторить запрос
                </Button>
            </div>
        );
    }

    if (!data || isLoading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-2 py-4 text-center text-white/70 sm:px-6">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-64" />
                <p className="text-sm">Загружаем актуальные данные отеля…</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-2 py-4 text-center text-white/70 sm:px-6">
                <p className="text-lg font-semibold">Отель не найден</p>
                <Button type="button" variant="secondary" onClick={() => mutate()}>
                    Обновить
                </Button>
            </div>
        );
    }

    return (
        <>
            <div className="flex min-h-screen flex-col gap-4 sm:gap-6 px-3 pb-24 pt-4 sm:px-6 sm:pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-3xl font-semibold text-white">{data.name}</h1>
                        <p className="text-white/60">{data.address}</p>
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsManagementPanelOpen(true)}
                        >
                            Панель
                        </Button>
                        <Link href="/">
                            <Button variant="ghost" size="sm">Назад</Button>
                        </Link>
                    </div>
                </div>

                <Card>
                    <CardHeader
                        title="Смены"
                        actions={
                            data.shiftHistory.length ? (
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setIsCreatingShift(!isCreatingShift)}
                                    >
                                        {isCreatingShift ? 'Отмена' : '+ Смена'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleClearShiftHistory}
                                        disabled={isClearingHistory}
                                    >
                                        {isClearingHistory ? 'Очищаем…' : 'Очистить'}
                                    </Button>
                                </div>
                            ) : null
                        }
                    />
                    {shiftList.length ? (
                        <div className="space-y-4">
                            <div>
                                <Select
                                    className="bg-ink text-white"
                                    value={selectedShiftId ?? activeShiftId ?? shiftList[0]?.id ?? ''}
                                    onChange={(event) => setSelectedShiftId(event.target.value)}
                                >
                                    {shiftList.map((shift) => (
                                        <option key={shift.id} value={shift.id}>
                                            Смена №{shift.number} · {shift.status === 'CLOSED' ? 'Закрыта' : 'Открыта'} · {formatDateTime(shift.openedAt, hotelTz)} · {shift.manager}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                            <div className="rounded-xl bg-white/[0.04] p-4">
                                {selectedShift ? (
                                    <>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                                            <Badge label={`Смена №${selectedShift.number}`} />
                                            <Badge
                                                label={selectedShift.status === 'CLOSED' ? 'Закрыта' : 'Открыта'}
                                                tone={selectedShift.status === 'CLOSED' ? 'success' : 'warning'}
                                            />
                                            {selectedShift.isCurrent && <Badge label="Текущая" tone="warning" />}
                                        </div>
                                        <p className="mt-3 text-sm text-white/70">Менеджер {selectedShift.manager}</p>
                                        {selectedShiftCash && (
                                            <div className="mt-4 grid gap-3 text-sm text-white md:grid-cols-2">
                                                <div className="rounded-xl bg-white/[0.04] p-3">
                                                    <p className="mt-1 text-lg font-semibold text-emerald-300">Касса сейчас {formatCurrency(selectedShiftCash.currentCash)}</p>
                                                    <p className="mt-1 text-lg font-semibold text-amber-200">Открытие {formatCurrency(selectedShiftCash.openingCash)}</p>
                                                    {selectedShift.handoverCash != null && (
                                                        <p className="text-xs text-white/60">Передано {formatShiftAmount(selectedShift.handoverCash)}</p>
                                                    )}
                                                </div>
                                                <div className="rounded-xl bg-white/[0.04] p-3">
                                                    <p className="text-xs uppercase tracking-widest text-white/40">Движение</p>
                                                    <div className="mt-2 space-y-3">
                                                        <div>
                                                            <p className="flex items-center justify-between">
                                                                <span>Поступления</span>
                                                                <span className="text-emerald-300">{formatCurrency(selectedShiftCash.cashIn)}</span>
                                                            </p>
                                                            {selectedShiftIncomeBreakdown && (
                                                                <div className="mt-2 rounded-2xl border border-white/5 bg-white/[0.04] p-2 text-[11px] text-white/60">
                                                                    <div className="space-y-2">
                                                                        <div>
                                                                            <p className="flex items-center justify-between text-xs text-white/70">
                                                                                <span>Заселения</span>
                                                                                <span className="text-white">{formatCurrency(selectedShiftIncomeBreakdown.stays.total)}</span>
                                                                            </p>
                                                                            <p className="flex items-center justify-between">
                                                                                <span>наличные</span>
                                                                                <span>{formatCurrency(selectedShiftIncomeBreakdown.stays.cash)}</span>
                                                                            </p>
                                                                            <p className="flex items-center justify-between">
                                                                                <span>безналично</span>
                                                                                <span>{formatCurrency(selectedShiftIncomeBreakdown.stays.card)}</span>
                                                                            </p>
                                                                        </div>
                                                                        <div className=" pt-2">
                                                                            <p className="flex items-center justify-between text-xs text-white/70">
                                                                                <span>Касса</span>
                                                                                <span className="text-white">{formatCurrency(selectedShiftIncomeBreakdown.cashbox.total)}</span>
                                                                            </p>
                                                                            <p className="flex items-center justify-between">
                                                                                <span>наличные</span>
                                                                                <span>{formatCurrency(selectedShiftIncomeBreakdown.cashbox.cash)}</span>
                                                                            </p>
                                                                            <p className="flex items-center justify-between">
                                                                                <span>безналично</span>
                                                                                <span>{formatCurrency(selectedShiftIncomeBreakdown.cashbox.card)}</span>
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`flex w-full items-center justify-between text-left transition ${selectedShiftOutflows.length ? 'hover:text-white' : 'text-white/50'}`}
                                                            onClick={() => selectedShiftOutflows.length && setIsOutflowModalOpen(true)}
                                                            disabled={!selectedShiftOutflows.length}
                                                        >
                                                            <span>Списания</span>
                                                            <span className="text-rose-300">{formatCurrency(selectedShiftCash.cashOut)}</span>
                                                        </button>
                                                        <p className="flex items-center justify-between">
                                                            <span>Выплаты</span>
                                                            <span className="text-amber-200">{formatCurrency(selectedShiftCash.payouts)}</span>
                                                        </p>
                                                        <p className="flex items-center justify-between">
                                                            <span>Корректировки</span>
                                                            <span>{formatCurrency(selectedShiftCash.adjustments)}</span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="mt-4 grid gap-3 text-sm text-white/90 md:grid-cols-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-widest text-white/40">На начало</p>
                                                <p className="font-semibold">{formatShiftAmount(selectedShift.openingCash)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs uppercase tracking-widest text-white/40">Передано</p>
                                                <p className="font-semibold">{formatShiftAmount(selectedShift.handoverCash)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs uppercase tracking-widest text-white/40">Касса факт</p>
                                                <p className="font-semibold">{formatShiftAmount(selectedShift.closingCash)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 space-y-1 text-xs text-white/60">
                                            <p>Открыта {formatDateTime(selectedShift.openedAt, hotelTz)}</p>
                                            {selectedShift.closedAt && <p>Закрыта {formatDateTime(selectedShift.closedAt, hotelTz)}</p>}
                                        </div>
                                        {(selectedShift.openingNote || selectedShift.handoverNote || selectedShift.closingNote) && (
                                            <div className="mt-3 space-y-1 text-xs text-white/70">
                                                {selectedShift.openingNote && <p>Комментарий (старт): {selectedShift.openingNote}</p>}
                                                {selectedShift.handoverNote && <p>Комментарий (передача): {selectedShift.handoverNote}</p>}
                                                {selectedShift.closingNote && <p>Комментарий (конец): {selectedShift.closingNote}</p>}
                                            </div>
                                        )}
                                        <div className="mt-4 rounded-xl bg-white/[0.04] p-3">
                                            <p className="text-xs uppercase tracking-widest text-white/40">Номера</p>
                                            <div className="mt-2 grid gap-2 text-sm text-white/80 sm:grid-cols-2">
                                                <div className="flex items-center justify-between">
                                                    <span>Свободно</span>
                                                    <span>{roomStatusBuckets.available.length}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span>Занято</span>
                                                    <span>{roomStatusBuckets.occupied.length}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span>Уборка</span>
                                                    <span>{roomStatusBuckets.dirty.length}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span>Бронь</span>
                                                    <span>{roomStatusBuckets.hold.length}</span>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid gap-3 text-xs text-white/60 sm:grid-cols-2">
                                                <div>
                                                    <p className="font-semibold text-white/70">Свободные</p>
                                                    <p className="mt-1 min-h-[1.5rem]">{roomStatusBuckets.available.length ? roomStatusBuckets.available.join(', ') : '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-white/70">Занятые</p>
                                                    <p className="mt-1 min-h-[1.5rem]">{roomStatusBuckets.occupied.length ? roomStatusBuckets.occupied.join(', ') : '—'}</p>
                                                </div>
                                            </div>
                                        </div>
                                        {selectedShiftTransactions.length ? (
                                            <div className="mt-4 rounded-xl bg-white/[0.04] p-3">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-white">Операции <span className="text-white/40">{selectedShiftTransactions.length}</span></h4>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                        onClick={() => setIsTransactionsExpanded((prev) => !prev)}
                                                    >
                                                        {isTransactionsExpanded ? 'Свернуть' : 'Развернуть'}
                                                    </Button>
                                                </div>
                                                {isTransactionsExpanded ? (
                                                    <div className="space-y-3">
                                                        {selectedShiftTransactions.map((entry) => {
                                                            const note = entry.note?.trim() || null;
                                                            return (
                                                                <div key={entry.id} className="rounded-xl bg-white/[0.04] p-3">
                                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                                        <div>
                                                                            <p className="text-xs uppercase tracking-widest text-white/40">{formatDateTime(entry.recordedAt, hotelTz)}</p>
                                                                            <p className="text-sm text-white/70">{entry.managerName ?? 'Система'}</p>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <p className={`text-lg font-semibold ${ledgerAmountClass[entry.entryType]}`}>
                                                                                {ledgerSignSymbol[entry.entryType]}
                                                                                {formatCurrency(entry.amount)}
                                                                            </p>
                                                                            <p className="text-xs text-white/50">{ledgerMethodLabels[entry.method]}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                                        <Badge label={ledgerEntryTypeLabels[entry.entryType]} tone={ledgerEntryTone[entry.entryType]} />
                                                                        <Badge label={ledgerMethodLabels[entry.method]} />
                                                                    </div>
                                                                    {note && <p className="mt-2 text-xs text-white/40">{note}</p>}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-xs text-white/30">Нет операций</p>
                                        )}
                                        <div className="mt-6 space-y-6">
                                            <div className="rounded-xl bg-white/[0.04] p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <h3 className="text-sm font-semibold text-white">Номера <span className="text-white/40">{sortedRooms.length}</span></h3>
                                                    <div className="flex items-center gap-3 text-xs text-white/50">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                            onClick={() => setIsRoomHistoryExpanded((prev) => !prev)}
                                                        >
                                                            {isRoomHistoryExpanded ? 'Свернуть' : 'Открыть'}
                                                        </Button>
                                                    </div>
                                                </div>
                                                {isRoomHistoryExpanded ? (
                                                    <div className="mt-3 divide-y divide-white/[0.06]">
                                                        {sortedRooms.length ? (
                                                            sortedRooms.map((room) => {
                                                                const stayHistory = [...(room.stays ?? [])].sort(
                                                                    (first, second) => stayStartTimestamp(first) - stayStartTimestamp(second)
                                                                );

                                                                return (
                                                                    <div key={`shift-room-history-${room.id}`} className="py-3 first:pt-0 last:pb-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm font-semibold text-white">№ {room.label}</span>
                                                                            {room.floor && <span className="text-[11px] text-white/30">{room.floor}</span>}
                                                                            <Badge
                                                                                label={
                                                                                    room.status === 'OCCUPIED'
                                                                                        ? 'Занят'
                                                                                        : room.status === 'DIRTY'
                                                                                            ? 'Уборка'
                                                                                            : room.status === 'HOLD'
                                                                                                ? 'Бронь'
                                                                                                : 'Свободен'
                                                                                }
                                                                                tone={
                                                                                    room.status === 'OCCUPIED'
                                                                                        ? 'warning'
                                                                                        : room.status === 'DIRTY'
                                                                                            ? 'danger'
                                                                                            : room.status === 'HOLD'
                                                                                                ? 'default'
                                                                                                : 'success'
                                                                                }
                                                                            />
                                                                            {!room.isActive && <span className="text-[11px] text-rose-300">выкл</span>}
                                                                            <span className="flex-1" />
                                                                            <button
                                                                                type="button"
                                                                                className="text-[11px] text-rose-300/60 hover:text-rose-300 transition"
                                                                                onClick={() => handleDeleteRoom(room.id)}
                                                                                disabled={removingRoomId === room.id}
                                                                            >
                                                                                {removingRoomId === room.id ? '…' : '✕'}
                                                                            </button>
                                                                        </div>
                                                                        {stayHistory.length ? (
                                                                            <div className="mt-2 space-y-1.5 pl-1">
                                                                                {stayHistory.map((stayEntry) => {
                                                                                    const guestLabel =
                                                                                        stayEntry.guestName?.trim() || (stayEntry.status === 'CHECKED_IN' ? 'Гость' : '—');
                                                                                    const checkInLabel = formatStayDate(stayEntry.actualCheckIn ?? stayEntry.scheduledCheckIn);
                                                                                    const checkOutLabel = formatStayDate(stayEntry.actualCheckOut ?? stayEntry.scheduledCheckOut);
                                                                                    const cashPortion = stayEntry.cashPaid ?? 0;
                                                                                    const cardPortion = stayEntry.cardPaid ?? 0;
                                                                                    const paymentLabel = (() => {
                                                                                        const segments: string[] = [];
                                                                                        if (cashPortion) segments.push(`нал ${formatCurrency(cashPortion)}`);
                                                                                        if (cardPortion) segments.push(`безнал ${formatCurrency(cardPortion)}`);
                                                                                        if (!segments.length && stayEntry.paymentMethod) {
                                                                                            return stayEntry.paymentMethod === 'CARD' ? 'Безнал' : 'Наличные';
                                                                                        }
                                                                                        return segments.join(' · ') || undefined;
                                                                                    })();

                                                                                    return (
                                                                                        <div key={stayEntry.id} className="rounded-lg bg-white/[0.04] px-2.5 py-2">
                                                                                            <div className="flex items-center justify-between gap-2">
                                                                                                <span className="text-xs font-medium text-white">{guestLabel}</span>
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <Badge label={stayStatusLabels[stayEntry.status]} tone={stayStatusTone[stayEntry.status]} />
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        className="text-[11px] text-white/30 hover:text-white transition"
                                                                                                        onClick={() => handleSelectStayForEdit(room, stayEntry)}
                                                                                                    >
                                                                                                        ✎
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                            <p className="mt-0.5 text-[11px] text-white/40">
                                                                                                {checkInLabel} — {checkOutLabel}
                                                                                                {stayEntry.amountPaid != null && (
                                                                                                    <> · {formatCurrency(stayEntry.amountPaid)}{paymentLabel ? ` · ${paymentLabel}` : ''}</>
                                                                                                )}
                                                                                            </p>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                );
                                                            })
                                                        ) : (
                                                            <p className="py-3 text-xs text-white/40">Номеров пока нет</p>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                onClick={() => handleSelectShiftForEdit(selectedShift)}
                                            >
                                                Редактировать смену
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-white/60">Выберите смену слева.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-white/60">Смен пока нет.</p>
                    )}

                    {editingShift && (
                        <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-500/5 p-4">
                            <p className="text-sm font-semibold text-white">Редактирование смены №{editingShift.number}</p>
                            <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleUpdateShift}>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Менеджер</label>
                                    <select
                                        className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                        {...shiftEditForm.register('managerId')}
                                    >
                                        <option value="" >
                                            Выберите менеджера
                                        </option>
                                        {data.managers.map((manager) => (
                                            <option key={manager.id} value={manager.id} >
                                                {manager.displayName || manager.username || `PIN ${manager.pinCode}`} (PIN: {manager.pinCode})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Статус смены</label>
                                    <select
                                        className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                        {...shiftEditForm.register('status')}
                                    >
                                        <option value="CLOSED" >
                                            Закрыта
                                        </option>
                                        <option value="OPEN" >
                                            Открыта
                                        </option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Время открытия</label>
                                    <Input type="datetime-local" step="60" {...shiftEditForm.register('openedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Время закрытия</label>
                                    <Input type="datetime-local" step="60" {...shiftEditForm.register('closedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`На начало (${hotelCur || 'KGS'})`}</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0"
                                        {...shiftEditForm.register('openingCash', {
                                            valueAsNumber: true,
                                            required: 'Укажите сумму на начало'
                                        })}
                                    />
                                    {shiftEditForm.formState.errors.openingCash && (
                                        <p className="text-xs text-rose-300">{shiftEditForm.formState.errors.openingCash.message}</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`Касса факт (${hotelCur || 'KGS'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...shiftEditForm.register('closingCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`Передано (${hotelCur || 'KGS'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...shiftEditForm.register('handoverCash', { valueAsNumber: true })} />
                                </div>
                                <TextArea rows={2} placeholder="Комментарий к открытию" {...shiftEditForm.register('openingNote')} />
                                <TextArea rows={2} placeholder="Комментарий к закрытию" {...shiftEditForm.register('closingNote')} />
                                <TextArea rows={2} placeholder="Комментарий к передаче" {...shiftEditForm.register('handoverNote')} />
                                <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row">
                                    <Button type="submit" className="flex-1">
                                        Сохранить изменения
                                    </Button>
                                    <Button type="button" variant="ghost" className="flex-1 border border-white/20" onClick={handleResetShiftEditor}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                        </div>
                    )}

                    {isCreatingShift && (
                        <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-500/5 p-4">
                            <p className="text-sm font-semibold text-white">Создание новой смены задним числом</p>
                            <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleCreateShift}>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Менеджер *</label>
                                    <select
                                        className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                        {...createShiftForm.register('managerId', { required: 'Выберите менеджера' })}
                                    >
                                        <option value="" >
                                            Выберите менеджера
                                        </option>
                                        {data.managers.map((manager) => (
                                            <option key={manager.id} value={manager.id} >
                                                {manager.displayName || manager.username || `PIN ${manager.pinCode}`} (PIN: {manager.pinCode})
                                            </option>
                                        ))}
                                    </select>
                                    {createShiftForm.formState.errors.managerId && (
                                        <p className="text-xs text-rose-300">{createShiftForm.formState.errors.managerId.message}</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Статус смены</label>
                                    <select
                                        className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                        {...createShiftForm.register('status')}
                                    >
                                        <option value="CLOSED" >
                                            Закрыта
                                        </option>
                                        <option value="OPEN" >
                                            Открыта
                                        </option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Время открытия *</label>
                                    <Input
                                        type="datetime-local"
                                        step="60"
                                        {...createShiftForm.register('openedAt', { required: 'Укажите время открытия' })}
                                    />
                                    {createShiftForm.formState.errors.openedAt && (
                                        <p className="text-xs text-rose-300">{createShiftForm.formState.errors.openedAt.message}</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">Время закрытия</label>
                                    <Input type="datetime-local" step="60" {...createShiftForm.register('closedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`На начало (${hotelCur || 'KGS'}) *`}</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0"
                                        {...createShiftForm.register('openingCash', {
                                            valueAsNumber: true,
                                            required: 'Укажите сумму на начало'
                                        })}
                                    />
                                    {createShiftForm.formState.errors.openingCash && (
                                        <p className="text-xs text-rose-300">{createShiftForm.formState.errors.openingCash.message}</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`Касса факт (${hotelCur || 'KGS'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...createShiftForm.register('closingCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold uppercase text-white/60">{`Передано (${hotelCur || 'KGS'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...createShiftForm.register('handoverCash', { valueAsNumber: true })} />
                                </div>
                                <TextArea rows={2} placeholder="Комментарий к открытию" {...createShiftForm.register('openingNote')} />
                                <TextArea rows={2} placeholder="Комментарий к закрытию" {...createShiftForm.register('closingNote')} />
                                <TextArea rows={2} placeholder="Комментарий к передаче" {...createShiftForm.register('handoverNote')} />
                                <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row">
                                    <Button type="submit" className="flex-1">
                                        Создать смену
                                    </Button>
                                    <Button type="button" variant="ghost" className="flex-1 border border-white/20" onClick={() => {
                                        setIsCreatingShift(false);
                                        createShiftForm.reset();
                                    }}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                        </div>
                    )}
                </Card>

                {isStayEditorOpen && hasStaySelection && (
                    <div className="fixed inset-0 z-50 overflow-y-auto px-2 sm:px-6">
                        <div className="fixed inset-0 bg-black/70" onClick={handleCloseStayEditor} />
                        <div className="relative z-10 mx-auto mt-4 sm:mt-12 w-full max-w-3xl rounded-xl sm:rounded-2xl bg-ink p-3 sm:p-5 shadow-2xl">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-base font-semibold text-white">
                                    № {stayEditForm.watch('roomLabel')}
                                </h3>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleCloseStayEditor}
                                >
                                    ×
                                </Button>
                            </div>
                            <form className="mt-4 space-y-4" onSubmit={handleUpdateStay}>
                                <Input placeholder="Имя гостя" {...stayEditForm.register('guestName')} />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Планируемый заезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('scheduledCheckIn')} />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Планируемый выезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('scheduledCheckOut')} />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Фактический заезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('actualCheckIn')} />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Фактический выезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('actualCheckOut')} />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Статус</label>
                                        <select
                                            className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                            {...stayEditForm.register('status')}
                                        >
                                            {stayStatusOptions.map((option) => (
                                                <option key={`stay-status-${option.value}`} value={option.value} >
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">Способ оплаты</label>
                                        <select
                                            className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                            {...stayEditForm.register('paymentMethod')}
                                        >
                                            {stayPaymentOptions.map((option) => (
                                                <option key={`stay-method-${option.value}`} value={option.value} >
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">{`Наличные (${hotelCur || 'KGS'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('cashPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">{`Безнал (${hotelCur || 'KGS'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('cardPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase tracking-widest text-white/40">{`Общая оплата (${hotelCur || 'KGS'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('totalPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-white/60">
                                    По разбивке: {roomPaymentPreview.totalBreakdown.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {hotelCur || 'KGS'}
                                    {' • '}Поле «Общая оплата»: {roomPaymentPreview.totalField.toLocaleString('ru-RU', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}{' '}
                                    {hotelCur || 'KGS'}
                                </p>
                                <TextArea rows={3} placeholder="Комментарий для администратора" {...stayEditForm.register('notes')} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button type="submit">Сохранить заселение</Button>
                                    <Button type="button" variant="ghost" className="border border-white/20" onClick={handleCloseStayEditor}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {isManagementPanelOpen && (
                    <div className="fixed inset-0 z-50">
                        <div className="absolute inset-0 bg-black/70" onClick={() => setIsManagementPanelOpen(false)} />
                        <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-ink p-3 shadow-2xl sm:p-5 md:max-w-xl">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h3 className="text-base font-semibold text-white">Управление</h3>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="border border-white/20 text-white/80 hover:bg-white/[0.06]"
                                    onClick={() => setIsManagementPanelOpen(false)}
                                >
                                    Закрыть
                                </Button>
                            </div>
                            <div className="flex-1 space-y-5 overflow-y-auto pr-2">
                                <Card className="border-white/20 bg-white/5">
                                    <CardHeader title="Менеджеры" />
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            {data.managers.length ? (
                                                data.managers.map((manager) => (
                                                    <div
                                                        key={manager.assignmentId}
                                                        className="flex flex-col gap-3 rounded-xl px-4 py-2 sm:flex-row sm:items-center sm:justify-between"
                                                    >
                                                        <div>
                                                            <p className="text-sm font-medium text-white">{manager.displayName}</p>
                                                            <p className="text-xs text-white/50">
                                                                {manager.username ? `@${manager.username} • ` : ''}
                                                                PIN {manager.pinCode ?? 'не задан'}
                                                            </p>
                                                            <p className="text-xs text-white/50">
                                                                Ставка: {manager.shiftPayAmount != null ? formatCurrency(manager.shiftPayAmount) : '—'} •
                                                                Процент: {manager.revenueSharePct != null ? formatPercentage(manager.revenueSharePct) : '—'}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Badge label="Менеджер" />
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="border border-white/10 text-xs text-white/80 hover:bg-white/[0.06]"
                                                                onClick={() => handleSelectManagerForEdit(manager.assignmentId)}
                                                            >
                                                                Редактировать
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="border border-rose-400/40 text-xs text-rose-200 hover:bg-rose-500/10"
                                                                onClick={() => handleRemoveManager(manager.assignmentId)}
                                                                disabled={removingManagerId === manager.assignmentId}
                                                            >
                                                                {removingManagerId === manager.assignmentId ? 'Удаляем…' : 'Удалить'}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-sm text-white/60">Назначений пока нет</p>
                                            )}
                                        </div>
                                        <div className="rounded-xl bg-white/[0.04] p-3">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-white">Добавление менеджера</p>
                                                    <p className="text-xs text-white/60">Имя, PIN и @username</p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                    onClick={() => setIsAddManagerExpanded((prev) => !prev)}
                                                >
                                                    {isAddManagerExpanded ? 'Свернуть' : 'Открыть'}
                                                </Button>
                                            </div>
                                            {isAddManagerExpanded ? (
                                                <>
                                                    <form className="space-y-3" onSubmit={handleAddManager}>
                                                        <Input placeholder="Имя менеджера" {...managerForm.register('displayName', { required: 'Укажите имя менеджера' })} />
                                                        {managerForm.formState.errors.displayName && (
                                                            <p className="text-xs text-rose-300">{managerForm.formState.errors.displayName.message}</p>
                                                        )}
                                                        <Input
                                                            placeholder="PIN (6 цифр)"
                                                            maxLength={6}
                                                            inputMode="numeric"
                                                            {...managerForm.register('pinCode', {
                                                                required: 'Укажите PIN',
                                                                minLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                                                maxLength: { value: 6, message: 'Код состоит из 6 цифр' },
                                                                pattern: { value: /^\d{6}$/, message: 'Используйте только цифры' }
                                                            })}
                                                        />
                                                        {managerForm.formState.errors.pinCode && (
                                                            <p className="text-xs text-rose-300">{managerForm.formState.errors.pinCode.message}</p>
                                                        )}
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder={`Ставка за смену (${hotelCur || 'KGS'})`}
                                                            {...managerForm.register('shiftPayAmount', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <Input
                                                            type="number"
                                                            step="1"
                                                            min="0"
                                                            placeholder="Процент с оборота"
                                                            {...managerForm.register('revenueSharePct', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <Input placeholder="Подпись / @username (необязательно)" {...managerForm.register('username')} />
                                                        <Button type="submit" className="w-full">
                                                            Добавить менеджера
                                                        </Button>

                                                    </form>
                                                </>
                                            ) : null}
                                        </div>
                                        {data.managers.length > 0 && (
                                            <div className="rounded-xl bg-white/[0.04] p-3">
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-white">Редактирование менеджера</p>

                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                        onClick={() => setIsUpdateManagerExpanded((prev) => !prev)}
                                                    >
                                                        {isUpdateManagerExpanded ? 'Свернуть' : 'Открыть'}
                                                    </Button>
                                                </div>
                                                {isUpdateManagerExpanded ? (
                                                    <form className="space-y-3" onSubmit={handleUpdateManager}>
                                                        <select
                                                            className="h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                                                            defaultValue=""
                                                            {...updateManagerForm.register('assignmentId', { required: 'Выберите менеджера' })}
                                                        >
                                                            <option value="" >
                                                                Выберите менеджера для обновления
                                                            </option>
                                                            {data.managers.map((manager) => (
                                                                <option key={`edit-${manager.assignmentId}`} value={manager.assignmentId} >
                                                                    {manager.displayName}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        {updateManagerForm.formState.errors.assignmentId && (
                                                            <p className="text-xs text-rose-300">
                                                                {updateManagerForm.formState.errors.assignmentId.message}
                                                            </p>
                                                        )}
                                                        <Input
                                                            placeholder={selectedManager ? `Новое имя (сейчас ${selectedManager.displayName})` : 'Новое имя менеджера'}
                                                            {...updateManagerForm.register('displayName')}
                                                        />
                                                        <Input
                                                            placeholder={selectedManager?.username ? `@${selectedManager.username}` : '@username (необязательно)'}
                                                            {...updateManagerForm.register('username')}
                                                        />
                                                        <Input
                                                            placeholder={selectedManager?.pinCode ? `Новый PIN (сейчас ${selectedManager.pinCode})` : 'Новый PIN (6 цифр)'}
                                                            maxLength={6}
                                                            inputMode="numeric"
                                                            {...updateManagerForm.register('pinCode', {
                                                                validate: (value) => {
                                                                    if (!value.trim()) {
                                                                        return true;
                                                                    }
                                                                    return /^\d{6}$/.test(value) || 'PIN состоит из 6 цифр';
                                                                }
                                                            })}
                                                        />
                                                        {updateManagerForm.formState.errors.pinCode && (
                                                            <p className="text-xs text-rose-300">
                                                                {updateManagerForm.formState.errors.pinCode.message}
                                                            </p>
                                                        )}
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder={
                                                                selectedManager?.shiftPayAmount != null
                                                                    ? `Ставка (сейчас ${formatCurrency(selectedManager.shiftPayAmount)})`
                                                                    : `Новая ставка за смену (${hotelCur || 'KGS'})`
                                                            }
                                                            {...updateManagerForm.register('shiftPayAmount', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <Input
                                                            type="number"
                                                            step="1"
                                                            min="0"
                                                            placeholder={
                                                                selectedManager?.revenueSharePct != null
                                                                    ? `Процент (сейчас ${formatPercentage(selectedManager.revenueSharePct)})`
                                                                    : 'Новый процент с оборота'
                                                            }
                                                            {...updateManagerForm.register('revenueSharePct', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <Button type="submit" className="w-full" variant="secondary">
                                                            Обновить менеджера
                                                        </Button>

                                                    </form>
                                                ) : null}
                                            </div>
                                        )}
                                    </div>
                                </Card>

                                <Card>
                                    <CardHeader
                                        title="Номера"
                                        actions={
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                onClick={() => setIsMassAddRoomsExpanded((prev) => !prev)}
                                            >
                                                {isMassAddRoomsExpanded ? 'Свернуть' : 'Открыть'}
                                            </Button>
                                        }
                                    />
                                    {isMassAddRoomsExpanded ? (
                                        <form className="space-y-3" onSubmit={handleAddRooms}>
                                            <TextArea
                                                rows={6}
                                                placeholder="Номера через запятую или с новой строки: 101, 102"
                                                {...roomForm.register('roomLabels', { required: true })}
                                            />
                                            {roomForm.formState.errors.roomLabels && (
                                                <p className="text-xs text-rose-300">{roomForm.formState.errors.roomLabels.message}</p>
                                            )}
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <Input placeholder="Этаж / корпус" {...roomForm.register('floor')} />
                                                <Input placeholder="Комментарий" {...roomForm.register('notes')} />
                                            </div>
                                            <Button type="submit" className="w-full">
                                                Добавить номера
                                            </Button>
                                            <p className="text-xs text-white/50">
                                                Поддерживается множественный ввод: один номер в строке или разделённые запятыми.
                                            </p>
                                        </form>
                                    ) : (
                                        <p className="px-2 pb-4 text-xs text-white/60">Форма массового добавления скрыта.</p>
                                    )}
                                </Card>

                            </div>
                        </div>
                    </div>
                )}
                {isOutflowModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-2 py-4 sm:px-6 sm:py-6">
                        <div className="absolute inset-0 bg-ink" onClick={closeOutflowModal} />
                        <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl sm:rounded-2xl bg-ink p-3 sm:p-5 text-white shadow-2xl">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-white">Списания №{selectedShift?.number ?? '—'}</h3>
                                    <p className="text-sm font-semibold text-rose-300">{formatCurrency(selectedShiftCash?.cashOut ?? 0)}</p>
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={closeOutflowModal}>
                                    ×
                                </Button>
                            </div>
                            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                                {selectedShiftOutflows.length ? (
                                    selectedShiftOutflows.map((entry) => {
                                        const note = entry.note?.trim() || null;
                                        return (
                                            <div key={entry.id} className="rounded-xl bg-white/[0.04] p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                                                    <span>{formatDateTime(entry.recordedAt, hotelTz)}</span>
                                                    <span>{entry.managerName ?? 'Система'}</span>
                                                </div>
                                                <p className="mt-2 text-lg font-semibold text-rose-200">-{formatCurrency(entry.amount)}</p>
                                                <p className="text-xs text-white/50">{ledgerMethodLabels[entry.method]}</p>
                                                {note && <p className="mt-1 text-xs text-white/40">{note}</p>}
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-sm text-white/30">Нет записей</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};
