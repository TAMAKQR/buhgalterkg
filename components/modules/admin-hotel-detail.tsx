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
import { isCollectionLedgerEntry } from '@/lib/ledger';

type ShiftStatusValue = 'OPEN' | 'CLOSED';
type RoomStatusValue = 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'HOLD';
type StayStatusValue = 'SCHEDULED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
type PaymentMethodValue = 'AUTO' | 'CASH' | 'CARD' | 'ONLINE';
type LedgerEntryTypeValue = 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
type LedgerPaymentMethodValue = 'CASH' | 'CARD';
type RoomOverviewMode = 'board' | 'history';

type PendingOnlineStayDetail = RoomStayDetail & {
    roomId: string;
    roomLabel: string;
    roomFloor?: string | null;
};

interface RoomStayDetail {
    id: string;
    guestName?: string | null;
    guestPhone?: string | null;
    companyName?: string | null;
    status: StayStatusValue;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    actualCheckIn?: string | null;
    actualCheckOut?: string | null;
    amountPaid?: number | null;
    totalAmount?: number | null;
    paymentMethod?: string | null;
    cashPaid?: number | null;
    cardPaid?: number | null;
    onlinePaid?: number | null;
    bookingSource?: string | null;
    bookingNumber?: string | null;
    shiftId?: string | null;
    shiftNumber?: number | null;
    shiftStatus?: ShiftStatusValue | null;
    shiftOpenedAt?: string | null;
    shiftClosedAt?: string | null;
    shiftManagerName?: string | null;
    transfers?: Array<{
        id: string;
        createdAt: string;
        note?: string | null;
        fromRoomLabel: string;
        toRoomLabel: string;
    }>;
    ledgerEntries?: Array<{
        id: string;
        entryType: LedgerEntryTypeValue;
        method: LedgerPaymentMethodValue;
        amount: number;
        note?: string | null;
        recordedAt: string;
        shiftNumber?: number | null;
        managerName?: string | null;
    }>;
    notes?: string | null;
}

interface LedgerEntryDetail {
    id: string;
    entryType: LedgerEntryTypeValue;
    method: LedgerPaymentMethodValue;
    amount: number;
    note?: string | null;
    category?: {
        id: string;
        name: string;
    } | null;
    recordedAt: string;
    managerName?: string | null;
    shiftId?: string | null;
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
    bonus?: number | null;
    pendingOnline?: number | null;
}

type ShiftListItem = ShiftHistoryEntry & { isCurrent: boolean };

interface HotelDetailPayload {
    id: string;
    name: string;
    address: string;
    usesExtranets?: boolean | null;
    extranetNames?: string[];
    managerSharePct?: number | null;
    notes?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        assignmentId: string;
        id: string;
        displayName: string;
        telegramId?: string | null;
        loginName?: string | null;
        username?: string | null;
        pinCode?: string | null;
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
        canEditStayPayments?: boolean | null;
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
    pendingOnlineStays?: PendingOnlineStayDetail[];
    transactions: LedgerEntryDetail[];
    timezone?: string | null;
    currency?: string | null;
    financials: {
        cashIn: number;
        cashOut: number;
        collections: number;
        payouts: number;
        adjustments: number;
        pendingOnline?: number;
        netCash: number;
    };
    bonusTiers?: Array<{
        id: string;
        threshold: number;
        bonus: number;
        bonusPct: number | null;
    }>;
    expenseCategories?: Array<{
        id: string;
        name: string;
    }>;
}

interface AddManagerForm {
    displayName: string;
    loginName: string;
    username?: string;
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
    canEditStayPayments: boolean;
}

interface UpdateManagerForm {
    assignmentId: string;
    displayName: string;
    loginName: string;
    username: string;
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
    canEditStayPayments: boolean;
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
    guestPhone: string;
    companyName: string;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    actualCheckIn: string;
    actualCheckOut: string;
    status: StayStatusValue;
    cashPaid: number;
    cardPaid: number;
    onlinePaid: number;
    totalAmount: number;
    totalPaid: number;
    paymentMethod: PaymentMethodValue;
    shiftId: string;
    bookingSource: string;
    bookingNumber: string;
    notes: string;
}

interface BookingCreateForm {
    roomId: string;
    guestName: string;
    guestPhone: string;
    companyName: string;
    scheduledCheckIn: string;
    scheduledCheckOut: string;
    bookingSource: string;
    bookingNumber: string;
    totalAmount: number;
    prepaymentAmount: number;
    prepaymentMethod: 'CASH' | 'CARD' | 'ONLINE';
    notes: string;
}

interface LedgerEditForm {
    entryId: string;
    shiftId: string;
    entryType: LedgerEntryTypeValue;
    method: LedgerPaymentMethodValue;
    amount: number;
    recordedAt: string;
    categoryId: string;
    note: string;
}

const createStayEditDefaults = (): StayEditForm => ({
    stayId: '',
    roomId: '',
    roomLabel: '',
    guestName: '',
    guestPhone: '',
    companyName: '',
    scheduledCheckIn: '',
    scheduledCheckOut: '',
    actualCheckIn: '',
    actualCheckOut: '',
    status: 'SCHEDULED',
    cashPaid: 0,
    cardPaid: 0,
    onlinePaid: 0,
    totalAmount: 0,
    totalPaid: 0,
    paymentMethod: 'AUTO',
    shiftId: '',
    bookingSource: '',
    bookingNumber: '',
    notes: ''
});

const createBookingDefaults = (): BookingCreateForm => ({
    roomId: '',
    guestName: '',
    guestPhone: '',
    companyName: '',
    scheduledCheckIn: '',
    scheduledCheckOut: '',
    bookingSource: '',
    bookingNumber: '',
    totalAmount: 0,
    prepaymentAmount: 0,
    prepaymentMethod: 'CASH',
    notes: ''
});

const stayStatusOptions: Array<{ value: StayStatusValue; label: string }> = [
    { value: 'SCHEDULED', label: 'Запланирован' },
    { value: 'CHECKED_IN', label: 'Заселён' },
    { value: 'CHECKED_OUT', label: 'Выселен' },
    { value: 'CANCELLED', label: 'Отменён' }
];

type StayHistoryStatusFilter = 'ALL' | StayStatusValue;

const stayHistoryStatusOptions: Array<{ value: StayHistoryStatusFilter; label: string }> = [
    { value: 'ALL', label: 'Все статусы' },
    ...stayStatusOptions
];

const compactStayHistoryLimit = 3;
const bookingBoardDayCount = 14;

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
    { value: 'CARD', label: 'Безнал' },
    { value: 'ONLINE', label: 'На сайте / онлайн' }
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

const ledgerDisplayLabel = (entry: LedgerEntryDetail) =>
    isCollectionLedgerEntry(entry) ? 'Инкассация' : ledgerEntryTypeLabels[entry.entryType];

const ledgerDisplayTone = (entry: LedgerEntryDetail): 'default' | 'success' | 'warning' | 'danger' =>
    isCollectionLedgerEntry(entry) ? 'default' : ledgerEntryTone[entry.entryType];

const ledgerDisplayAmountClass = (entry: LedgerEntryDetail) =>
    isCollectionLedgerEntry(entry) ? 'text-cyan-300' : ledgerAmountClass[entry.entryType];

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

const loginTransliteration: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'yu', я: 'ya', і: 'i', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', ә: 'a'
};

const createLoginSuggestion = (value?: string | null) => {
    const source = (value ?? '').trim().toLowerCase();
    let result = '';
    for (const char of source) {
        result += loginTransliteration[char] ?? char;
    }
    result = result
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    return result.length >= 3 ? result.slice(0, 50) : '';
};

const stayStartTimestamp = (stay: RoomStayDetail) => {
    const reference = stay.actualCheckIn ?? stay.scheduledCheckIn;
    if (!reference) {
        return 0;
    }
    const parsed = Date.parse(reference);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const isOverdueStay = (stay?: RoomStayDetail | null) => {
    if (!stay || stay.status !== 'CHECKED_IN') {
        return false;
    }
    const checkoutTime = Date.parse(stay.scheduledCheckOut);
    return Number.isFinite(checkoutTime) && checkoutTime < Date.now();
};

const startOfLocalDay = (value: Date) => {
    const copy = new Date(value);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const addDays = (value: Date, days: number) => {
    const copy = new Date(value);
    copy.setDate(copy.getDate() + days);
    return copy;
};

const formatBoardDay = (value: Date) =>
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(value).replace('.', '');

const formatBoardWeekday = (value: Date) =>
    new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(value).replace('.', '');

const bookingBoardStatusClass: Record<StayStatusValue, string> = {
    SCHEDULED: 'border-cyan-300/60 bg-cyan-500/15 text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-400/12 dark:text-cyan-100',
    CHECKED_IN: 'border-amber-300/70 bg-amber-400/20 text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/14 dark:text-amber-100',
    CHECKED_OUT: 'border-slate-300/80 bg-slate-100 text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white/55',
    CANCELLED: 'border-rose-300/70 bg-rose-50 text-rose-600 dark:border-rose-300/20 dark:bg-rose-500/10 dark:text-rose-200'
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
        defaultValues: { displayName: '', loginName: '', username: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined, canEditStayPayments: false }
    });
    const updateManagerForm = useForm<UpdateManagerForm>({
        defaultValues: {
            assignmentId: '',
            displayName: '',
            loginName: '',
            username: '',
            pinCode: '',
            shiftPayAmount: undefined,
            revenueSharePct: undefined,
            canEditStayPayments: false
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
    const bookingCreateForm = useForm<BookingCreateForm>({
        defaultValues: createBookingDefaults()
    });
    const ledgerEditForm = useForm<LedgerEditForm>({
        defaultValues: {
            entryId: '',
            shiftId: '',
            entryType: 'CASH_IN',
            method: 'CASH',
            amount: 0,
            recordedAt: '',
            categoryId: '',
            note: ''
        }
    });

    const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
    const [editingShift, setEditingShift] = useState<ShiftHistoryEntry | null>(null);
    const [editingLedgerEntry, setEditingLedgerEntry] = useState<LedgerEntryDetail | null>(null);
    const [isCreatingShift, setIsCreatingShift] = useState(false);
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [isDeletingShift, setIsDeletingShift] = useState(false);
    const [confirmDeleteShift, setConfirmDeleteShift] = useState(false);
    const [removingManagerId, setRemovingManagerId] = useState<string | null>(null);
    const [removingRoomId, setRemovingRoomId] = useState<string | null>(null);
    const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
    const [editRoomData, setEditRoomData] = useState<{ label: string; floor: string; notes: string; isActive: boolean }>({ label: '', floor: '', notes: '', isActive: true });
    const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
    const [isRoomListExpanded, setIsRoomListExpanded] = useState(false);
    const [isStayEditorOpen, setIsStayEditorOpen] = useState(false);
    const [isBookingFormOpen, setIsBookingFormOpen] = useState(false);
    const [isCreatingBooking, setIsCreatingBooking] = useState(false);
    const [confirmingOnlineStayId, setConfirmingOnlineStayId] = useState<string | null>(null);
    const [isPendingOnlineHistoryOpen, setIsPendingOnlineHistoryOpen] = useState(false);
    const [isManagementPanelOpen, setIsManagementPanelOpen] = useState(false);
    const [isAddManagerExpanded, setIsAddManagerExpanded] = useState(false);
    const [isUpdateManagerExpanded, setIsUpdateManagerExpanded] = useState(false);
    const [isMassAddRoomsExpanded, setIsMassAddRoomsExpanded] = useState(false);
    const [isBonusTiersExpanded, setIsBonusTiersExpanded] = useState(false);
    const [isExpenseCategoriesExpanded, setIsExpenseCategoriesExpanded] = useState(false);
    const [newTier, setNewTier] = useState({ threshold: '', bonus: '', bonusPct: '', usePercent: false });
    const [savingTier, setSavingTier] = useState(false);
    const [removingTierId, setRemovingTierId] = useState<string | null>(null);
    const [newExpenseCategoryName, setNewExpenseCategoryName] = useState('');
    const [editingExpenseCategoryId, setEditingExpenseCategoryId] = useState<string | null>(null);
    const [editingExpenseCategoryName, setEditingExpenseCategoryName] = useState('');
    const [savingExpenseCategoryId, setSavingExpenseCategoryId] = useState<string | 'new' | null>(null);
    const [removingExpenseCategoryId, setRemovingExpenseCategoryId] = useState<string | null>(null);

    const stayFormValues = stayEditForm.watch();
    const ledgerFormValues = ledgerEditForm.watch();
    const hasStaySelection = Boolean(stayFormValues.stayId);
    const selectedStayForEditor = useMemo(() => {
        if (!data || !stayFormValues.stayId || !stayFormValues.roomId) {
            return null;
        }
        const room = data.rooms.find((candidate) => candidate.id === stayFormValues.roomId);
        return room?.stays.find((stay) => stay.id === stayFormValues.stayId) ?? null;
    }, [data, stayFormValues.roomId, stayFormValues.stayId]);
    const selectedRoomForEditor = useMemo(() => {
        if (!data || !stayFormValues.roomId) {
            return null;
        }
        return data.rooms.find((candidate) => candidate.id === stayFormValues.roomId) ?? null;
    }, [data, stayFormValues.roomId]);
    const roomPaymentPreview = useMemo(
        () => ({
            totalBreakdown:
                (Number.isFinite(stayFormValues.cashPaid) ? stayFormValues.cashPaid || 0 : 0) +
                (Number.isFinite(stayFormValues.cardPaid) ? stayFormValues.cardPaid || 0 : 0) +
                (Number.isFinite(stayFormValues.onlinePaid) ? stayFormValues.onlinePaid || 0 : 0),
            totalField: Number.isFinite(stayFormValues.totalPaid) ? stayFormValues.totalPaid || 0 : 0
        }),
        [stayFormValues.cashPaid, stayFormValues.cardPaid, stayFormValues.onlinePaid, stayFormValues.totalPaid]
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

    useEffect(() => {
        if (selectedManager) {
            updateManagerForm.setValue('canEditStayPayments', Boolean(selectedManager.canEditStayPayments));
        }
    }, [selectedManager, updateManagerForm]);

    const handleGenerateManagerLogin = () => {
        const suggestion = createLoginSuggestion(managerForm.getValues('displayName'));
        if (!suggestion) {
            managerForm.setError('loginName', {
                type: 'manual',
                message: 'Сначала укажите имя менеджера'
            });
            return;
        }
        managerForm.clearErrors('loginName');
        managerForm.setValue('loginName', suggestion, { shouldDirty: true, shouldValidate: true });
    };

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
            overdue: [] as string[],
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
                if (isOverdueStay(room.stay)) {
                    buckets.overdue.push(label);
                }
            } else if (room.status === 'DIRTY') {
                buckets.dirty.push(label);
            } else if (room.status === 'HOLD') {
                buckets.hold.push(label);
            }
        }
        buckets.available.sort();
        buckets.occupied.sort();
        buckets.overdue.sort();
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
            const target = note.startsWith('заселение') || note.startsWith('продление') ? stays : cashbox;
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
        return selectedShiftTransactions.filter((entry) => entry.entryType === 'CASH_OUT' && !isCollectionLedgerEntry(entry));
    }, [selectedShift, selectedShiftTransactions]);

    const selectedShiftExpenseOut = useMemo(
        () => selectedShiftOutflows.reduce((total, entry) => total + entry.amount, 0),
        [selectedShiftOutflows]
    );

    const selectedShiftCollections = useMemo(
        () => selectedShiftTransactions
            .filter((entry) => isCollectionLedgerEntry(entry))
            .reduce((total, entry) => total + entry.amount, 0),
        [selectedShiftTransactions]
    );

    const pendingOnlineHistory = useMemo(() => data?.pendingOnlineStays ?? [], [data]);
    const prepaidBookings = useMemo(() => {
        if (!data) {
            return [];
        }

        return data.rooms
            .flatMap((room) =>
                room.stays
                    .filter((stay) => stay.status === 'SCHEDULED' && (stay.amountPaid ?? 0) > 0)
                    .map((stay) => ({ room, stay }))
            )
            .sort((first, second) => {
                const firstTime = new Date(first.stay.scheduledCheckIn).getTime();
                const secondTime = new Date(second.stay.scheduledCheckIn).getTime();
                return firstTime - secondTime;
            });
    }, [data]);
    const prepaidBookingsTotal = useMemo(
        () => prepaidBookings.reduce((total, item) => total + (item.stay.amountPaid ?? 0), 0),
        [prepaidBookings]
    );

    const [isTransactionsExpanded, setIsTransactionsExpanded] = useState(false);
    const [isRoomHistoryExpanded, setIsRoomHistoryExpanded] = useState(false);
    const [roomOverviewMode, setRoomOverviewMode] = useState<RoomOverviewMode>('board');
    const [bookingBoardStartOffset, setBookingBoardStartOffset] = useState(0);
    const [stayHistoryQuery, setStayHistoryQuery] = useState('');
    const [stayHistoryStatus, setStayHistoryStatus] = useState<StayHistoryStatusFilter>('ALL');
    const [expandedStayHistoryRooms, setExpandedStayHistoryRooms] = useState<Set<string>>(() => new Set());
    const [isOutflowModalOpen, setIsOutflowModalOpen] = useState(false);
    useEffect(() => {
        setIsTransactionsExpanded(false);
        setIsRoomHistoryExpanded(false);
        setStayHistoryQuery('');
        setStayHistoryStatus('ALL');
        setExpandedStayHistoryRooms(new Set());
        setIsOutflowModalOpen(false);
    }, [selectedShiftId]);
    const closeOutflowModal = () => setIsOutflowModalOpen(false);

    const bookingBoardDays = useMemo(() => {
        const firstDay = addDays(startOfLocalDay(new Date()), bookingBoardStartOffset);
        return Array.from({ length: bookingBoardDayCount }, (_, index) => addDays(firstDay, index));
    }, [bookingBoardStartOffset]);

    const bookingBoardRange = useMemo(() => {
        const start = bookingBoardDays[0] ?? startOfLocalDay(new Date());
        const end = addDays(start, bookingBoardDayCount);
        return { start, end };
    }, [bookingBoardDays]);

    const bookingBoardRows = useMemo(() => {
        const rangeStart = bookingBoardRange.start.getTime();
        const rangeEnd = bookingBoardRange.end.getTime();

        return sortedRooms.map((room) => {
            const items = (room.stays ?? [])
                .filter((stay) => stay.status === 'SCHEDULED' || stay.status === 'CHECKED_IN')
                .map((stay) => {
                    const stayStart = Date.parse(stay.scheduledCheckIn);
                    const stayEnd = Date.parse(stay.scheduledCheckOut);
                    if (!Number.isFinite(stayStart) || !Number.isFinite(stayEnd) || stayEnd <= rangeStart || stayStart >= rangeEnd) {
                        return null;
                    }

                    const clampedStart = Math.max(stayStart, rangeStart);
                    const clampedEnd = Math.min(stayEnd, rangeEnd);
                    const startIndex = Math.max(0, Math.floor((clampedStart - rangeStart) / 86400000));
                    const endIndex = Math.min(bookingBoardDayCount, Math.ceil((clampedEnd - rangeStart) / 86400000));
                    const span = Math.max(1, endIndex - startIndex);
                    const guestLabel = stay.guestName?.trim() || (stay.status === 'CHECKED_IN' ? 'Гость' : 'Бронь');

                    return {
                        stay,
                        startIndex,
                        span,
                        guestLabel,
                        detailLabel: [
                            stay.bookingNumber?.trim() ? `№ ${stay.bookingNumber.trim()}` : null,
                            stay.totalAmount != null ? `тариф ${formatMoney(stay.totalAmount, hotelCur)}` : null,
                            stay.bookingSource?.trim(),
                            stay.companyName?.trim(),
                            stay.guestPhone?.trim()
                        ].filter(Boolean).join(' · ')
                    };
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
                .sort((first, second) => first.startIndex - second.startIndex || second.span - first.span);
            const laneEnds: number[] = [];
            const itemsWithLanes = items.map((item) => {
                const endIndex = item.startIndex + item.span;
                const lane = laneEnds.findIndex((currentEnd) => currentEnd <= item.startIndex);
                const nextLane = lane >= 0 ? lane : laneEnds.length;
                laneEnds[nextLane] = endIndex;
                return { ...item, lane: nextLane };
            });
            const laneCount = Math.max(1, laneEnds.length);

            return { room, items: itemsWithLanes, laneCount };
        });
    }, [bookingBoardRange, hotelCur, sortedRooms]);

    const filteredRoomStayHistory = useMemo(() => {
        const query = stayHistoryQuery.trim().toLocaleLowerCase('ru-RU');
        const hasFilters = Boolean(query) || stayHistoryStatus !== 'ALL';

        return sortedRooms
            .map((room) => {
                const stays = [...(room.stays ?? [])]
                    .sort((first, second) => stayStartTimestamp(second) - stayStartTimestamp(first))
                    .filter((stay) => {
                        if (stayHistoryStatus !== 'ALL' && stay.status !== stayHistoryStatus) {
                            return false;
                        }

                        if (!query) {
                            return true;
                        }

                        return [
                            room.label,
                            room.floor,
                            stay.guestName,
                            stay.guestPhone,
                            stay.companyName,
                            stay.bookingSource,
                            stay.bookingNumber,
                            stay.notes,
                            stay.shiftNumber ? `смена ${stay.shiftNumber}` : null,
                            stay.shiftManagerName,
                        ]
                            .filter(Boolean)
                            .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
                    });

                if (!stays.length) {
                    return null;
                }

                const isExpanded = expandedStayHistoryRooms.has(room.id) || hasFilters;
                return {
                    room,
                    stays: isExpanded ? stays : stays.slice(0, compactStayHistoryLimit),
                    total: stays.length,
                    isExpanded,
                    hasMore: stays.length > compactStayHistoryLimit,
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));
    }, [expandedStayHistoryRooms, sortedRooms, stayHistoryQuery, stayHistoryStatus]);

    const totalFilteredStayHistory = filteredRoomStayHistory.reduce((total, item) => total + item.total, 0);

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

    const handleDeleteShift = async () => {
        if (!editingShift) return;
        setIsDeletingShift(true);
        try {
            await request(`/api/admin/shifts/${editingShift.id}`, { method: 'DELETE' });
            handleResetShiftEditor();
            mutate();
            toast('Смена удалена', 'success');
        } catch (deleteError) {
            console.error(deleteError);
            toast('Не удалось удалить смену', 'error');
        } finally {
            setIsDeletingShift(false);
            setConfirmDeleteShift(false);
        }
    };

    const handleClearShiftHistory = async () => {
        if (!window.confirm('Очистить закрытые смены этого объекта? Действие нельзя отменить.')) {
            return;
        }

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
        const manager = data?.managers.find((item) => item.assignmentId === assignmentId);
        const managerName = manager?.displayName || manager?.loginName || 'этого менеджера';
        if (!window.confirm(`Удалить назначение менеджера ${managerName}?`)) {
            return;
        }

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
        const room = data?.rooms.find((item) => item.id === roomId);
        const roomLabel = room?.label ? `№ ${room.label}` : 'этот номер';
        if (!window.confirm(`Удалить ${roomLabel}? История по номеру также будет удалена.`)) {
            return;
        }

        setRemovingRoomId(roomId);
        try {
            await request('/api/rooms', {
                method: 'DELETE',
                body: { roomId }
            });
            mutate();
            toast('Номер удалён', 'success');
        } catch (roomError) {
            console.error(roomError);
            toast('Не удалось удалить номер', 'error');
        } finally {
            setRemovingRoomId((current) => (current === roomId ? null : current));
        }
    };

    const handleStartEditRoom = (room: HotelDetailPayload['rooms'][number]) => {
        setEditingRoomId(room.id);
        setEditRoomData({
            label: room.label,
            floor: room.floor ?? '',
            notes: room.notes ?? '',
            isActive: room.isActive
        });
    };

    const handleSaveRoom = async (roomId: string) => {
        setSavingRoomId(roomId);
        try {
            await request('/api/rooms', {
                method: 'PATCH',
                body: {
                    roomId,
                    label: editRoomData.label.trim() || undefined,
                    floor: editRoomData.floor.trim() || null,
                    notes: editRoomData.notes.trim() || null,
                    isActive: editRoomData.isActive
                }
            });
            setEditingRoomId(null);
            mutate();
            toast('Номер обновлён', 'success');
        } catch (saveError) {
            console.error(saveError);
            toast(String(saveError), 'error');
        } finally {
            setSavingRoomId(null);
        }
    };

    const handleAddBonusTier = async () => {
        const threshold = Math.round(parseFloat(newTier.threshold) * 100);
        if (!threshold || threshold <= 0) return;
        setSavingTier(true);
        try {
            const body: Record<string, unknown> = { hotelId, threshold };
            if (newTier.usePercent) {
                const pct = Math.round(parseFloat(newTier.bonusPct) * 100);
                if (!pct || pct <= 0) { toast('Укажите процент', 'error'); return; }
                body.bonusPct = pct;
            } else {
                const bonus = Math.round(parseFloat(newTier.bonus) * 100);
                if (!bonus || bonus <= 0) { toast('Укажите бонус', 'error'); return; }
                body.bonus = bonus;
            }
            await request('/api/admin/bonus-tiers', { body });
            setNewTier({ threshold: '', bonus: '', bonusPct: '', usePercent: false });
            mutate();
            toast('Бонусный порог добавлен', 'success');
        } catch (e) {
            toast(String(e), 'error');
        } finally {
            setSavingTier(false);
        }
    };

    const handleDeleteBonusTier = async (tierId: string) => {
        if (!window.confirm('Удалить этот бонусный порог?')) {
            return;
        }

        setRemovingTierId(tierId);
        try {
            await request(`/api/admin/bonus-tiers/${tierId}`, { method: 'DELETE' });
            mutate();
            toast('Порог удалён', 'success');
        } catch (e) {
            toast(String(e), 'error');
        } finally {
            setRemovingTierId(null);
        }
    };

    const handleAddExpenseCategory = async () => {
        const name = newExpenseCategoryName.trim();
        if (!name) {
            toast('Введите название категории', 'error');
            return;
        }

        setSavingExpenseCategoryId('new');
        try {
            await request('/api/admin/expense-categories', {
                body: {
                    hotelId,
                    name
                }
            });
            setNewExpenseCategoryName('');
            mutate();
            toast('Категория добавлена', 'success');
        } catch (error) {
            console.error(error);
            toast(String(error), 'error');
        } finally {
            setSavingExpenseCategoryId(null);
        }
    };

    const handleStartEditExpenseCategory = (category: NonNullable<HotelDetailPayload['expenseCategories']>[number]) => {
        setEditingExpenseCategoryId(category.id);
        setEditingExpenseCategoryName(category.name);
    };

    const handleSaveExpenseCategory = async (categoryId: string) => {
        const name = editingExpenseCategoryName.trim();
        if (!name) {
            toast('Введите название категории', 'error');
            return;
        }

        setSavingExpenseCategoryId(categoryId);
        try {
            await request(`/api/admin/expense-categories/${categoryId}`, {
                method: 'PATCH',
                body: { name }
            });
            setEditingExpenseCategoryId(null);
            setEditingExpenseCategoryName('');
            mutate();
            toast('Категория обновлена', 'success');
        } catch (error) {
            console.error(error);
            toast(String(error), 'error');
        } finally {
            setSavingExpenseCategoryId(null);
        }
    };

    const handleDeleteExpenseCategory = async (categoryId: string) => {
        const category = data?.expenseCategories?.find((item) => item.id === categoryId);
        const categoryName = category?.name ? `«${category.name}»` : 'эту категорию';
        if (!window.confirm(`Удалить категорию расходов ${categoryName}?`)) {
            return;
        }

        setRemovingExpenseCategoryId(categoryId);
        try {
            await request(`/api/admin/expense-categories/${categoryId}`, { method: 'DELETE' });
            if (editingExpenseCategoryId === categoryId) {
                setEditingExpenseCategoryId(null);
                setEditingExpenseCategoryName('');
            }
            mutate();
            toast('Категория удалена', 'success');
        } catch (error) {
            console.error(error);
            toast(String(error), 'error');
        } finally {
            setRemovingExpenseCategoryId(null);
        }
    };

    const handleSelectLedgerEntryForEdit = (entry: LedgerEntryDetail) => {
        setEditingLedgerEntry(entry);
        ledgerEditForm.reset({
            entryId: entry.id,
            shiftId: entry.shiftId ?? '',
            entryType: entry.entryType,
            method: entry.method,
            amount: entry.amount / 100,
            recordedAt: toDateTimeInputValue(entry.recordedAt),
            categoryId: entry.category?.id ?? '',
            note: entry.note ?? ''
        });
    };

    const handleCloseLedgerEditor = () => {
        setEditingLedgerEntry(null);
        ledgerEditForm.reset({
            entryId: '',
            shiftId: '',
            entryType: 'CASH_IN',
            method: 'CASH',
            amount: 0,
            recordedAt: '',
            categoryId: '',
            note: ''
        });
    };

    const handleUpdateLedgerEntry = ledgerEditForm.handleSubmit(async (values) => {
        if (!values.entryId) {
            return;
        }

        const amount = toOptionalMinorValue(values.amount);
        if (!amount || amount <= 0) {
            ledgerEditForm.setError('amount', { type: 'manual', message: 'Укажите сумму операции' });
            return;
        }

        try {
            await request(`/api/admin/ledger/${values.entryId}`, {
                method: 'PATCH',
                body: {
                    shiftId: values.shiftId || null,
                    entryType: values.entryType,
                    method: values.method,
                    amount,
                    recordedAt: fromDateTimeInputValue(values.recordedAt) ?? undefined,
                    categoryId: values.entryType === 'CASH_OUT' ? values.categoryId || null : null,
                    note: normalizeOptionalText(values.note)
                }
            });
            await mutate();
            toast('Операция обновлена', 'success');
            handleCloseLedgerEditor();
        } catch (error) {
            console.error(error);
            toast(String(error), 'error');
        }
    });

    const handleDeleteLedgerEntry = async () => {
        const entryId = editingLedgerEntry?.id;
        if (!entryId) {
            return;
        }

        if (!window.confirm('Удалить эту кассовую операцию? Балансы смены будут пересчитаны.')) {
            return;
        }

        try {
            await request(`/api/admin/ledger/${entryId}`, { method: 'DELETE' });
            await mutate();
            toast('Операция удалена', 'success');
            handleCloseLedgerEditor();
        } catch (error) {
            console.error(error);
            toast(String(error), 'error');
        }
    };

    const resetStayEditor = () => {
        stayEditForm.reset(createStayEditDefaults());
    };

    const handleCloseStayEditor = () => {
        setIsStayEditorOpen(false);
        resetStayEditor();
    };

    const handleOpenBookingForm = (room?: HotelDetailPayload['rooms'][number]) => {
        const checkIn = new Date();
        checkIn.setHours(14, 0, 0, 0);
        if (checkIn.getTime() <= Date.now()) {
            checkIn.setDate(checkIn.getDate() + 1);
        }
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkOut.getDate() + 1);
        checkOut.setHours(12, 0, 0, 0);

        bookingCreateForm.reset({
            ...createBookingDefaults(),
            roomId: room?.id ?? '',
            scheduledCheckIn: toDateTimeInputValue(checkIn.toISOString()),
            scheduledCheckOut: toDateTimeInputValue(checkOut.toISOString())
        });
        setIsBookingFormOpen(true);
        setIsRoomHistoryExpanded(true);
    };

    const handleCloseBookingForm = () => {
        setIsBookingFormOpen(false);
        bookingCreateForm.reset(createBookingDefaults());
    };

    const handleCreateBooking = bookingCreateForm.handleSubmit(async (values) => {
        const scheduledCheckIn = fromDateTimeInputValue(values.scheduledCheckIn);
        const scheduledCheckOut = fromDateTimeInputValue(values.scheduledCheckOut);
        const prepaymentAmount = Number.isFinite(values.prepaymentAmount) ? values.prepaymentAmount || 0 : 0;
        const totalAmount = Number.isFinite(values.totalAmount) ? values.totalAmount || 0 : 0;
        const bookingNumber = normalizeOptionalText(values.bookingNumber);

        if (!values.roomId || !scheduledCheckIn || !scheduledCheckOut) {
            toast('Выберите номер и даты брони', 'error');
            return;
        }

        if (values.bookingSource.trim() && !bookingNumber) {
            toast('Укажите номер бронирования', 'error');
            return;
        }

        if (totalAmount <= 0) {
            toast('Укажите общую сумму тарифа', 'error');
            return;
        }

        if (prepaymentAmount < 0) {
            toast('Сумма предоплаты не может быть отрицательной', 'error');
            return;
        }

        if (prepaymentAmount > totalAmount) {
            toast('Предоплата не может быть больше тарифа', 'error');
            return;
        }

        if (prepaymentAmount > 0 && values.prepaymentMethod !== 'ONLINE' && !activeShiftId) {
            toast('Для наличной или безналичной предоплаты нужна активная смена', 'error');
            return;
        }

        try {
            setIsCreatingBooking(true);
            await request('/api/admin/stays', {
                body: {
                    roomId: values.roomId,
                    guestName: normalizeOptionalText(values.guestName),
                    guestPhone: normalizeOptionalText(values.guestPhone),
                    companyName: normalizeOptionalText(values.companyName),
                    scheduledCheckIn,
                    scheduledCheckOut,
                    bookingSource: data?.usesExtranets ? normalizeOptionalText(values.bookingSource) : undefined,
                    bookingNumber,
                    totalAmount: toMinor(totalAmount),
                    shiftId: prepaymentAmount > 0 && values.prepaymentMethod !== 'ONLINE' ? activeShiftId : undefined,
                    prepaymentAmount: toMinor(prepaymentAmount),
                    prepaymentMethod: prepaymentAmount > 0 ? values.prepaymentMethod : undefined,
                    notes: normalizeOptionalText(values.notes)
                }
            });
            await mutate();
            setStayHistoryStatus('SCHEDULED');
            setStayHistoryQuery('');
            handleCloseBookingForm();
            toast('Будущая бронь добавлена', 'success');
        } catch (bookingError) {
            console.error(bookingError);
            toast(bookingError instanceof Error ? bookingError.message : 'Не удалось добавить бронь', 'error');
        } finally {
            setIsCreatingBooking(false);
        }
    });

    const hydrateStayEditor = (room: HotelDetailPayload['rooms'][number], stay: RoomStayDetail) => {
        const stayBreakdownTotal = (stay.cashPaid ?? 0) + (stay.cardPaid ?? 0) + (stay.onlinePaid ?? 0);
        stayEditForm.reset({
            stayId: stay.id,
            roomId: room.id,
            roomLabel: room.label,
            guestName: stay.guestName ?? '',
            guestPhone: stay.guestPhone ?? '',
            companyName: stay.companyName ?? '',
            scheduledCheckIn: toDateTimeInputValue(stay.scheduledCheckIn),
            scheduledCheckOut: toDateTimeInputValue(stay.scheduledCheckOut),
            actualCheckIn: toDateTimeInputValue(stay.actualCheckIn),
            actualCheckOut: toDateTimeInputValue(stay.actualCheckOut),
            status: stay.status as StayStatusValue,
            cashPaid: (stay.cashPaid ?? 0) / 100,
            cardPaid: (stay.cardPaid ?? 0) / 100,
            onlinePaid: (stay.onlinePaid ?? 0) / 100,
            totalPaid: (stayBreakdownTotal > 0 ? stayBreakdownTotal : stay.amountPaid ?? 0) / 100,
            totalAmount: (stay.totalAmount ?? 0) / 100,
            paymentMethod:
                (stay.onlinePaid ?? 0) > 0 && !(stay.cashPaid ?? 0) && !(stay.cardPaid ?? 0)
                    ? 'ONLINE'
                    : stay.paymentMethod
                        ? (stay.paymentMethod as PaymentMethodValue)
                        : 'AUTO',
            shiftId: stay.shiftId ?? '',
            bookingSource: stay.bookingSource ?? '',
            bookingNumber: stay.bookingNumber ?? '',
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
        const onlineMinor = toOptionalMinorValue(values.onlinePaid);
        const breakdownTotalMinor = (cashMinor ?? 0) + (cardMinor ?? 0) + (onlineMinor ?? 0);
        const totalMinor = breakdownTotalMinor > 0 ? breakdownTotalMinor : toOptionalMinorValue(values.totalPaid);
        const totalAmountMinor = toOptionalMinorValue(values.totalAmount);
        const bookingNumber = normalizeOptionalText(values.bookingNumber);

        if ((values.status === 'SCHEDULED' || values.status === 'CHECKED_IN') && values.bookingSource.trim() && !bookingNumber) {
            toast('Укажите номер бронирования', 'error');
            return;
        }

        if ((values.status === 'SCHEDULED' || values.status === 'CHECKED_IN') && (!totalAmountMinor || totalAmountMinor <= 0)) {
            toast('Укажите общую сумму тарифа', 'error');
            return;
        }

        if ((totalMinor ?? 0) > (totalAmountMinor ?? 0) && (values.status === 'SCHEDULED' || values.status === 'CHECKED_IN')) {
            toast('Оплата не может быть больше тарифа', 'error');
            return;
        }

        try {
            await request(`/api/admin/stays/${values.stayId}`, {
                method: 'PATCH',
                body: {
                    guestName: normalizeOptionalText(values.guestName),
                    guestPhone: normalizeOptionalText(values.guestPhone),
                    companyName: normalizeOptionalText(values.companyName),
                    notes: normalizeOptionalText(values.notes),
                    scheduledCheckIn: fromDateTimeInputValue(values.scheduledCheckIn),
                    scheduledCheckOut: fromDateTimeInputValue(values.scheduledCheckOut),
                    actualCheckIn: fromDateTimeInputValue(values.actualCheckIn),
                    actualCheckOut: fromDateTimeInputValue(values.actualCheckOut),
                    status: values.status,
                    cashPaid: cashMinor,
                    cardPaid: cardMinor,
                    onlinePaid: onlineMinor,
                    amountPaid: totalMinor,
                    totalAmount: totalAmountMinor ?? undefined,
                    paymentMethod: values.paymentMethod === 'AUTO' || values.paymentMethod === 'ONLINE' ? null : values.paymentMethod,
                    shiftId: values.shiftId || null,
                    bookingSource: data?.usesExtranets ? normalizeOptionalText(values.bookingSource) : undefined,
                    bookingNumber
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

    const handleConfirmOnlinePayment = async (room: Pick<HotelDetailPayload['rooms'][number], 'id'>, stay: RoomStayDetail) => {
        const onlineMinor = stay.onlinePaid ?? 0;
        if (onlineMinor <= 0) {
            return;
        }

        const cashMinor = stay.cashPaid ?? 0;
        const nextCardMinor = (stay.cardPaid ?? 0) + onlineMinor;
        const nextTotalMinor = cashMinor + nextCardMinor;

        try {
            setConfirmingOnlineStayId(stay.id);
            await request(`/api/admin/stays/${stay.id}`, {
                method: 'PATCH',
                body: {
                    cardPaid: nextCardMinor,
                    onlinePaid: 0,
                    amountPaid: nextTotalMinor
                }
            });

            const refreshed = await mutate();
            const snapshot = refreshed ?? data ?? null;
            if (snapshot && stayEditForm.getValues('stayId') === stay.id) {
                const updatedRoom = snapshot.rooms.find((candidate) => candidate.id === room.id);
                const updatedStay = updatedRoom?.stays.find((candidate) => candidate.id === stay.id);
                if (updatedRoom && updatedStay) {
                    hydrateStayEditor(updatedRoom, updatedStay);
                }
            }
            toast('Поступление с сайта подтверждено', 'success');
        } catch (confirmError) {
            console.error(confirmError);
            toast('Не удалось подтвердить поступление', 'error');
        } finally {
            setConfirmingOnlineStayId(null);
        }
    };

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
                loginName: values.loginName.trim().toLowerCase(),
                username: values.username?.trim() || undefined,
                pinCode: values.pinCode,
                shiftPayAmount: shiftPayAmount ?? undefined,
                revenueSharePct: revenueSharePct ?? undefined,
                canEditStayPayments: values.canEditStayPayments
            }
        });
        managerForm.reset({ displayName: '', loginName: '', username: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined, canEditStayPayments: false });
        mutate();
    });

    const handleUpdateManager = updateManagerForm.handleSubmit(async (values) => {
        const shiftPayAmount = toOptionalMinorValue(values.shiftPayAmount);
        const revenueSharePct = normalizePercentage(values.revenueSharePct);

        const payload = {
            assignmentId: values.assignmentId,
            displayName: values.displayName.trim() || undefined,
            loginName: values.loginName.trim().toLowerCase() || undefined,
            username: values.username.trim() || undefined,
            pinCode: values.pinCode.trim() || undefined,
            shiftPayAmount: shiftPayAmount ?? undefined,
            revenueSharePct: revenueSharePct ?? undefined,
            canEditStayPayments: values.canEditStayPayments
        };

        const hasUpdates =
            Boolean(payload.displayName) ||
            Boolean(payload.loginName) ||
            Boolean(payload.username) ||
            Boolean(payload.pinCode) ||
            shiftPayAmount !== null ||
            revenueSharePct !== null ||
            values.canEditStayPayments !== Boolean(selectedManager?.canEditStayPayments);

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
                loginName: '',
                username: '',
                pinCode: '',
                shiftPayAmount: undefined,
                revenueSharePct: undefined,
                canEditStayPayments: values.canEditStayPayments
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
            loginName: '',
            username: '',
            pinCode: '',
            shiftPayAmount: target?.shiftPayAmount != null ? toMajorValue(target.shiftPayAmount) : undefined,
            revenueSharePct: target?.revenueSharePct ?? undefined,
            canEditStayPayments: Boolean(target?.canEditStayPayments)
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

    const occupancyRate = data.roomCount ? Math.round((data.occupiedRooms / data.roomCount) * 100) : 0;
    const managerCount = data.managers.length;
    const activeShiftLabel = data.activeShift ? `Смена №${data.activeShift.number}` : 'Нет активной смены';
    const pendingOnlineValue = data.financials.pendingOnline ?? 0;
    const summaryCards = [
        {
            label: 'Загрузка',
            value: `${data.occupiedRooms}/${data.roomCount}`,
            caption: `${occupancyRate}% занято сейчас · ${roomStatusBuckets.overdue.length} просрочено`
        },
        {
            label: 'Касса',
            value: formatCurrency(data.financials.netCash),
            caption: `${formatCurrency(data.financials.cashIn)} поступило · ${formatCurrency(data.financials.cashOut)} списано · ${formatCurrency(data.financials.collections)} инкас.`
        },
        {
            label: 'Команда',
            value: String(managerCount),
            caption: managerCount === 1 ? '1 менеджер подключен' : `${managerCount} менеджеров подключено`
        },
        {
            label: 'Текущий статус',
            value: activeShiftLabel,
            caption: data.activeShift ? `Открыта ${formatDateTime(data.activeShift.openedAt, hotelTz)}` : 'Можно открыть новую смену'
        }
    ];
    const shiftQuickStats = selectedShift && selectedShiftCash
        ? [
            {
                label: 'Касса сейчас',
                value: formatCurrency(selectedShiftCash.currentCash),
                valueClass: 'text-emerald-300'
            },
            {
                label: 'На старте',
                value: formatCurrency(selectedShiftCash.openingCash),
                valueClass: 'text-amber-200'
            },
            {
                label: 'Поступления',
                value: formatCurrency(selectedShiftCash.cashIn),
                valueClass: 'text-emerald-300'
            },
            {
                label: 'Списания',
                value: formatCurrency(selectedShiftExpenseOut),
                valueClass: 'text-rose-300'
            },
            {
                label: 'Инкассация',
                value: formatCurrency(selectedShiftCollections),
                valueClass: 'text-cyan-300'
            },
            {
                label: 'Ожидает сайт',
                value: formatCurrency(selectedShift.pendingOnline ?? 0),
                valueClass: 'text-amber-300'
            }
        ]
        : [];
    const shiftNoteItems = selectedShift
        ? [
            selectedShift.openingNote ? `Старт: ${selectedShift.openingNote}` : null,
            selectedShift.handoverNote ? `Передача: ${selectedShift.handoverNote}` : null,
            selectedShift.closingNote ? `Закрытие: ${selectedShift.closingNote}` : null
        ].filter((item): item is string => Boolean(item))
        : [];
    const formLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/40';
    const formPanelClass = 'mt-4 rounded-2xl border p-3.5 sm:mt-5 sm:rounded-[26px] sm:p-5';
    const modalLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/35';

    return (
        <>
            <div className="flex min-h-screen flex-col gap-3 px-3 pb-24 pt-3 sm:gap-6 sm:px-6 sm:pt-6">
                <Card className="overflow-hidden border-slate-200 bg-[linear-gradient(135deg,_#ffffff_0%,_#f8fafc_45%,_#e8eef7_100%)] p-0 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.12),_rgba(255,255,255,0.04)_42%,_rgba(7,10,18,0.92)_100%)] dark:shadow-none">
                    <div className="flex flex-col gap-4 px-3.5 py-4 sm:gap-6 sm:px-6 sm:py-6">
                        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                            <div className="min-w-0 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/45">
                                    <span>Объект</span>
                                    {data.timezone && <span>{data.timezone}</span>}
                                    {hotelCur && <span>{hotelCur}</span>}
                                </div>
                                <div className="space-y-2">
                                    <h1 className="break-words text-xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-white">{data.name}</h1>
                                    <p className="max-w-2xl text-sm text-slate-600 sm:text-base dark:text-white/65">{data.address}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-slate-700 dark:text-white/70">
                                    <Badge label={activeShiftLabel} tone={data.activeShift ? 'warning' : 'default'} />
                                    <Badge label={`${data.roomCount} номеров`} />
                                    <Badge label={`${managerCount} менеджеров`} />
                                </div>
                            </div>
                            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setIsManagementPanelOpen(true)}
                                >
                                    Панель управления
                                </Button>
                                <Link href="/">
                                    <Button variant="ghost" size="sm">Назад</Button>
                                </Link>
                            </div>
                        </div>

                        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                            {summaryCards.map((item) => (
                                <div
                                    key={item.label}
                                    className="min-w-0 rounded-2xl border border-slate-200 bg-white/82 px-3 py-3 shadow-[0_14px_34px_-32px_rgba(15,23,42,0.45)] backdrop-blur sm:rounded-[24px] sm:px-4 sm:py-4 dark:border-white/10 dark:bg-white/[0.045] dark:shadow-[0_14px_34px_-32px_rgba(15,23,42,0.75)]"
                                >
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/40">{item.label}</p>
                                    <p className="mt-2 break-words text-lg font-semibold tracking-tight text-slate-950 sm:mt-3 sm:text-xl dark:text-white">{item.value}</p>
                                    <p className="mt-1 break-words text-xs text-slate-600 sm:text-sm dark:text-white/55">
                                        {item.caption}
                                        {item.label === 'Касса' ? (
                                            <>
                                                {' · '}
                                                <button
                                                    type="button"
                                                    className={`rounded-lg px-1.5 py-0.5 font-semibold transition ${pendingOnlineValue > 0 ? 'text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-200 dark:hover:bg-amber-300/10 dark:hover:text-amber-100' : 'cursor-default text-slate-400 dark:text-white/40'}`}
                                                    onClick={() => pendingOnlineValue > 0 && setIsPendingOnlineHistoryOpen((current) => !current)}
                                                    disabled={pendingOnlineValue <= 0}
                                                    aria-expanded={isPendingOnlineHistoryOpen}
                                                >
                                                    {formatCurrency(pendingOnlineValue)} ожидает
                                                </button>
                                            </>
                                        ) : null}
                                    </p>
                                </div>
                            ))}
                        </div>
                        {isPendingOnlineHistoryOpen ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800 sm:rounded-[24px] sm:p-4 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-50">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100/60">Ожидающие поступления</p>
                                        <p className="mt-1 text-lg font-semibold">{formatCurrency(pendingOnlineValue)}</p>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-50 dark:hover:bg-amber-300/10 dark:hover:text-white" onClick={() => setIsPendingOnlineHistoryOpen(false)}>
                                        Скрыть
                                    </Button>
                                </div>
                                {pendingOnlineHistory.length ? (
                                    <div className="mt-4 max-h-[440px] space-y-2 overflow-y-auto pr-1">
                                        {pendingOnlineHistory.map((stay) => {
                                            const guestLabel = stay.guestName?.trim() || 'Гость';
                                            const detailLine = [
                                                stay.bookingNumber?.trim() ? `бронь № ${stay.bookingNumber.trim()}` : null,
                                                stay.totalAmount != null ? `тариф ${formatCurrency(stay.totalAmount)}` : null,
                                                stay.bookingSource?.trim() ? `источник ${stay.bookingSource.trim()}` : null,
                                                stay.companyName?.trim() ? `компания ${stay.companyName.trim()}` : null,
                                                stay.guestPhone?.trim() ? `тел. ${stay.guestPhone.trim()}` : null,
                                                stay.shiftNumber ? `смена №${stay.shiftNumber}` : null,
                                                stay.shiftManagerName
                                            ].filter(Boolean).join(' · ');

                                            return (
                                                <div key={`pending-online-${stay.id}`} className="rounded-2xl border border-amber-200/80 bg-white px-3 py-3 dark:border-amber-200/20 dark:bg-black/15">
                                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-white/10 dark:text-amber-50">№ {stay.roomLabel}</span>
                                                                <span className="text-sm font-semibold text-slate-950 dark:text-white">{guestLabel}</span>
                                                                <Badge label={stayStatusLabels[stay.status]} tone={stayStatusTone[stay.status]} />
                                                            </div>
                                                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-50/70">
                                                                {formatStayDate(stay.actualCheckIn ?? stay.scheduledCheckIn)} — {formatStayDate(stay.actualCheckOut ?? stay.scheduledCheckOut)}
                                                            </p>
                                                            {detailLine ? <p className="mt-1 text-xs text-amber-700/75 dark:text-amber-50/55">{detailLine}</p> : null}
                                                            {stay.notes?.trim() ? <p className="mt-1 text-xs text-amber-700/75 dark:text-amber-50/55">{stay.notes.trim()}</p> : null}
                                                        </div>
                                                        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                                                            <span className="text-sm font-semibold text-amber-100">{formatCurrency(stay.onlinePaid ?? 0)}</span>
                                                            <Button
                                                                type="button"
                                                                variant="secondary"
                                                                size="sm"
                                                                className="border-amber-300/80 bg-white text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-300/50 dark:bg-white/10 dark:text-amber-50 dark:hover:bg-amber-300/15 dark:hover:text-white"
                                                                disabled={confirmingOnlineStayId === stay.id}
                                                                onClick={() => handleConfirmOnlinePayment({ id: stay.roomId }, stay)}
                                                            >
                                                                {confirmingOnlineStayId === stay.id ? 'Подтверждаем...' : 'Подтвердить'}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="mt-4 rounded-2xl border border-amber-200/80 bg-white px-3 py-3 text-sm text-amber-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-amber-50/70">
                                        Ожидающих поступлений нет.
                                    </p>
                                )}
                            </div>
                        ) : null}
                        {prepaidBookings.length > 0 ? (
                            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3.5 text-cyan-900 sm:rounded-[24px] sm:p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-50">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-700/60 dark:text-cyan-100/55">Предоплаты по броням</p>
                                        <p className="mt-1 text-lg font-semibold">{formatCurrency(prepaidBookingsTotal)}</p>
                                    </div>
                                    <Badge label={`${prepaidBookings.length} броней`} tone="default" />
                                </div>
                                <div className="mt-4 grid gap-2 lg:grid-cols-2">
                                    {prepaidBookings.slice(0, 6).map(({ room, stay }) => {
                                        const paymentParts = [
                                            (stay.cashPaid ?? 0) > 0 ? `нал ${formatCurrency(stay.cashPaid)}` : null,
                                            (stay.cardPaid ?? 0) > 0 ? `безнал ${formatCurrency(stay.cardPaid)}` : null,
                                            (stay.onlinePaid ?? 0) > 0 ? `онлайн ${formatCurrency(stay.onlinePaid)}` : null
                                        ].filter(Boolean).join(' · ');
                                        const guestLabel = stay.guestName?.trim() || 'Гость';
                                        const bookingContext = [
                                            stay.bookingNumber?.trim() ? `бронь № ${stay.bookingNumber.trim()}` : null,
                                            stay.totalAmount != null ? `тариф ${formatCurrency(stay.totalAmount)}` : null
                                        ].filter(Boolean).join(' · ');

                                        return (
                                            <button
                                                key={`prepaid-booking-${stay.id}`}
                                                type="button"
                                                className="min-w-0 rounded-2xl border border-cyan-200/80 bg-white px-3 py-3 text-left transition hover:border-cyan-300 hover:bg-cyan-100/70 dark:border-cyan-200/20 dark:bg-black/15 dark:hover:border-cyan-200/35 dark:hover:bg-cyan-300/10"
                                                onClick={() => handleSelectStayForEdit(room, stay)}
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded-lg bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-800 dark:bg-white/10 dark:text-cyan-50">№ {room.label}</span>
                                                    <span className="min-w-0 truncate text-sm font-semibold text-slate-950 dark:text-white">{guestLabel}</span>
                                                </div>
                                                <p className="mt-2 text-xs text-cyan-800/75 dark:text-cyan-50/65">
                                                    {formatStayDate(stay.scheduledCheckIn)} — {formatStayDate(stay.scheduledCheckOut)}
                                                </p>
                                                <p className="mt-1 text-sm font-semibold text-cyan-800 dark:text-cyan-100">
                                                    {formatCurrency(stay.amountPaid ?? 0)}{paymentParts ? ` · ${paymentParts}` : ''}
                                                </p>
                                                {bookingContext ? (
                                                    <p className="mt-1 text-xs text-cyan-800/70 dark:text-cyan-50/55">{bookingContext}</p>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                {prepaidBookings.length > 6 ? (
                                    <p className="mt-3 text-xs text-cyan-800/70 dark:text-cyan-50/55">
                                        Показаны ближайшие 6. Полный список доступен в истории броней.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </Card>

                <Card className="space-y-4">
                    <CardHeader
                        title="Смены"
                        subtitle="Операционный контур"
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
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/35">Выбор смены</p>
                                <Select
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
                                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-white/70">
                                                            <Badge label={`Смена №${selectedShift.number}`} />
                                                            <Badge
                                                                label={selectedShift.status === 'CLOSED' ? 'Закрыта' : 'Открыта'}
                                                                tone={selectedShift.status === 'CLOSED' ? 'success' : 'warning'}
                                                            />
                                                            {selectedShift.isCurrent && <Badge label="Текущая" tone="warning" />}
                                                        </div>
                                                        <p className="mt-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{selectedShift.manager}</p>
                                                        <div className="mt-2 space-y-1 text-sm text-slate-500 dark:text-white/60">
                                                            <p>Открыта {formatDateTime(selectedShift.openedAt, hotelTz)}</p>
                                                            {selectedShift.closedAt && <p>Закрыта {formatDateTime(selectedShift.closedAt, hotelTz)}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-right dark:border-white/[0.06] dark:bg-white/[0.04]">
                                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Статус кассы</p>
                                                        <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{selectedShiftCash ? formatCurrency(selectedShiftCash.currentCash) : '—'}</p>
                                                        {selectedShift.handoverCash != null && (
                                                            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">Передано {formatShiftAmount(selectedShift.handoverCash)}</p>
                                                        )}
                                                    </div>
                                                </div>

                                                {shiftQuickStats.length ? (
                                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                                        {shiftQuickStats.map((item) => (
                                                            <div
                                                                key={item.label}
                                                                className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]"
                                                            >
                                                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">{item.label}</p>
                                                                <p className={`mt-2 text-lg font-semibold ${item.valueClass}`}>{item.value}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}

                                                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Движение средств</p>
                                                    <div className="mt-3 space-y-3 text-sm text-slate-700 dark:text-white">
                                                        <div>
                                                            <p className="flex items-center justify-between font-medium">
                                                                <span>Поступления</span>
                                                                <span className="text-emerald-300">{formatCurrency(selectedShiftCash?.cashIn ?? 0)}</span>
                                                            </p>
                                                            {selectedShiftIncomeBreakdown && (
                                                                <div className="mt-2 rounded-2xl border border-slate-200/80 bg-white p-3 text-[11px] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/60">
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <p className="flex items-center justify-between text-xs text-slate-600 dark:text-white/70">
                                                                                <span>Заселения</span>
                                                                                <span className="text-slate-900 dark:text-white">{formatCurrency(selectedShiftIncomeBreakdown.stays.total)}</span>
                                                                            </p>
                                                                            <p className="mt-1 flex items-center justify-between"><span>наличные</span><span>{formatCurrency(selectedShiftIncomeBreakdown.stays.cash)}</span></p>
                                                                            <p className="flex items-center justify-between"><span>безналично</span><span>{formatCurrency(selectedShiftIncomeBreakdown.stays.card)}</span></p>
                                                                        </div>
                                                                        <div className="border-t border-slate-200/80 pt-3 dark:border-white/[0.06]">
                                                                            <p className="flex items-center justify-between text-xs text-slate-600 dark:text-white/70">
                                                                                <span>Касса</span>
                                                                                <span className="text-slate-900 dark:text-white">{formatCurrency(selectedShiftIncomeBreakdown.cashbox.total)}</span>
                                                                            </p>
                                                                            <p className="mt-1 flex items-center justify-between"><span>наличные</span><span>{formatCurrency(selectedShiftIncomeBreakdown.cashbox.cash)}</span></p>
                                                                            <p className="flex items-center justify-between"><span>безналично</span><span>{formatCurrency(selectedShiftIncomeBreakdown.cashbox.card)}</span></p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {(selectedShift.pendingOnline ?? 0) > 0 && (
                                                                <div className="mt-2 rounded-2xl border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <span>Ожидает поступления с сайта</span>
                                                                        <span className="font-semibold">{formatCurrency(selectedShift.pendingOnline)}</span>
                                                                    </div>
                                                                    <p className="mt-1 text-[11px] text-amber-600/80 dark:text-amber-200/70">Не входит в кассу и поступления смены до фактического получения.</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition ${selectedShiftOutflows.length ? 'border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/15 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15' : 'border-slate-200/80 bg-white text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-white/40'}`}
                                                            onClick={() => selectedShiftOutflows.length && setIsOutflowModalOpen(true)}
                                                            disabled={!selectedShiftOutflows.length}
                                                        >
                                                            <span>Списания</span>
                                                            <span>{formatCurrency(selectedShiftExpenseOut)}</span>
                                                        </button>
                                                        <p className="flex items-center justify-between">
                                                            <span>Инкассация</span>
                                                            <span className="text-cyan-300">{formatCurrency(selectedShiftCollections)}</span>
                                                        </p>
                                                        <p className="flex items-center justify-between">
                                                            <span>Выплаты</span>
                                                            <span className="text-amber-200">{formatCurrency(selectedShiftCash?.payouts ?? 0)}</span>
                                                        </p>
                                                        <p className="flex items-center justify-between">
                                                            <span>Корректировки</span>
                                                            <span>{formatCurrency(selectedShiftCash?.adjustments ?? 0)}</span>
                                                        </p>
                                                        {selectedShift.bonus != null && selectedShift.bonus > 0 && (
                                                            <p className="flex items-center justify-between">
                                                                <span>Бонус</span>
                                                                <span className="text-emerald-300">+{formatCurrency(selectedShift.bonus)}</span>
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Сводка смены</p>
                                                    <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                                                        <div>
                                                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">На начало</p>
                                                            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.openingCash)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Передано</p>
                                                            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.handoverCash)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Касса факт</p>
                                                            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.closingCash)}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Комментарии</p>
                                                    {shiftNoteItems.length ? (
                                                        <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-white/65">
                                                            {shiftNoteItems.map((note) => (
                                                                <p key={note}>{note}</p>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="mt-3 text-sm text-slate-400 dark:text-white/35">По этой смене комментариев нет.</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Номера</p>
                                            <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-white/80 sm:grid-cols-2">
                                                <div className="flex items-center justify-between">
                                                    <span>Свободно</span>
                                                    <span>{roomStatusBuckets.available.length}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span>Занято</span>
                                                    <span>{roomStatusBuckets.occupied.length}</span>
                                                </div>
                                                <div className={`flex items-center justify-between ${roomStatusBuckets.overdue.length ? 'text-rose-500 dark:text-rose-300' : ''}`}>
                                                    <span>Просрочено</span>
                                                    <span>{roomStatusBuckets.overdue.length}</span>
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
                                            <div className="mt-4 grid gap-3 text-xs text-slate-500 dark:text-white/60 sm:grid-cols-2">
                                                <div>
                                                    <p className="font-semibold text-slate-700 dark:text-white/70">Свободные</p>
                                                    <p className="mt-1 min-h-[1.5rem]">{roomStatusBuckets.available.length ? roomStatusBuckets.available.join(', ') : '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-700 dark:text-white/70">Занятые</p>
                                                    <p className="mt-1 min-h-[1.5rem]">{roomStatusBuckets.occupied.length ? roomStatusBuckets.occupied.join(', ') : '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-rose-500 dark:text-rose-300">Просроченные</p>
                                                    <p className="mt-1 min-h-[1.5rem]">{roomStatusBuckets.overdue.length ? roomStatusBuckets.overdue.join(', ') : '—'}</p>
                                                </div>
                                            </div>
                                        </div>
                                        {selectedShiftTransactions.length ? (
                                            <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Операции <span className="text-slate-400 dark:text-white/40">{selectedShiftTransactions.length}</span></h4>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="border border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/[0.06]"
                                                        onClick={() => setIsTransactionsExpanded((prev) => !prev)}
                                                    >
                                                        {isTransactionsExpanded ? 'Свернуть' : 'Развернуть'}
                                                    </Button>
                                                </div>
                                                {isTransactionsExpanded ? (
                                                    <div className="space-y-3">
                                                        {selectedShiftTransactions.map((entry) => {
                                                            const note = entry.note?.trim() || null;
                                                            const categoryName = entry.category?.name?.trim() || null;
                                                            return (
                                                                <div key={entry.id} className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                                        <div>
                                                                            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-white/40">{formatDateTime(entry.recordedAt, hotelTz)}</p>
                                                                            <p className="text-sm text-slate-500 dark:text-white/70">{entry.managerName ?? 'Система'}</p>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <p className={`text-lg font-semibold ${ledgerDisplayAmountClass(entry)}`}>
                                                                                {ledgerSignSymbol[entry.entryType]}
                                                                                {formatCurrency(entry.amount)}
                                                                            </p>
                                                                            <p className="text-xs text-slate-400 dark:text-white/50">{ledgerMethodLabels[entry.method]}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                                        <Badge label={ledgerDisplayLabel(entry)} tone={ledgerDisplayTone(entry)} />
                                                                        <Badge label={ledgerMethodLabels[entry.method]} />
                                                                        {categoryName ? <Badge label={categoryName} /> : null}
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                                                        <p className="text-xs text-slate-400 dark:text-white/40">{note || categoryName || ledgerDisplayLabel(entry)}</p>
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            className="border border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/[0.06]"
                                                                            onClick={() => handleSelectLedgerEntryForEdit(entry)}
                                                                        >
                                                                            Редактировать
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-xs text-slate-400 dark:text-white/30">Нет операций</p>
                                        )}
                                        <div className="mt-6 space-y-6">
                                            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Номера <span className="text-slate-400 dark:text-white/40">{sortedRooms.length}</span></h3>
                                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-white/50">
                                                        {roomOverviewMode === 'history' && isRoomHistoryExpanded && totalFilteredStayHistory > 0 && (
                                                            <span>{totalFilteredStayHistory} записей</span>
                                                        )}
                                                        <div className="flex rounded-2xl border border-slate-200/80 bg-white p-0.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                                                            <button
                                                                type="button"
                                                                className={`rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${roomOverviewMode === 'board' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white'}`}
                                                                onClick={() => setRoomOverviewMode('board')}
                                                            >
                                                                Шахматка
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${roomOverviewMode === 'history' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white'}`}
                                                                onClick={() => setRoomOverviewMode('history')}
                                                            >
                                                                Список
                                                            </button>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            onClick={() => handleOpenBookingForm()}
                                                        >
                                                            Новая бронь
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            className="border border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/[0.06]"
                                                            onClick={() => {
                                                                setRoomOverviewMode('history');
                                                                setIsRoomHistoryExpanded((prev) => !prev);
                                                            }}
                                                        >
                                                            {isRoomHistoryExpanded ? 'Свернуть' : 'Открыть'}
                                                        </Button>
                                                    </div>
                                                </div>
                                                {roomOverviewMode === 'board' ? (
                                                    <div className="mt-4 space-y-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                <Badge label="Бронь" tone="default" />
                                                                <Badge label="Заселён" tone="warning" />
                                                                <Badge label="Выселен" tone="success" />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="border border-slate-200/80 text-slate-600 dark:border-white/15 dark:text-white/80"
                                                                    onClick={() => setBookingBoardStartOffset((current) => current - bookingBoardDayCount)}
                                                                >
                                                                    Назад
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="border border-slate-200/80 text-slate-600 dark:border-white/15 dark:text-white/80"
                                                                    onClick={() => setBookingBoardStartOffset(0)}
                                                                >
                                                                    Сегодня
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="border border-slate-200/80 text-slate-600 dark:border-white/15 dark:text-white/80"
                                                                    onClick={() => setBookingBoardStartOffset((current) => current + bookingBoardDayCount)}
                                                                >
                                                                    Вперёд
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
                                                            <div className="min-w-[1120px]">
                                                                <div
                                                                    className="grid border-b border-slate-200/80 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/45"
                                                                    style={{ gridTemplateColumns: `104px repeat(${bookingBoardDayCount}, minmax(72px, 1fr))` }}
                                                                >
                                                                    <div className="sticky left-0 z-20 bg-slate-50 px-3 py-2 dark:bg-[#151923]">Номер</div>
                                                                    {bookingBoardDays.map((day) => (
                                                                        <div key={`board-day-${day.toISOString()}`} className="border-l border-slate-200/80 px-2 py-2 text-center dark:border-white/[0.06]">
                                                                            <p>{formatBoardDay(day)}</p>
                                                                            <p className="mt-0.5 font-normal normal-case tracking-normal">{formatBoardWeekday(day)}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                {bookingBoardRows.map(({ room, items, laneCount }) => (
                                                                    <div
                                                                        key={`booking-board-row-${room.id}`}
                                                                        className="grid min-h-[58px] border-b border-slate-200/70 last:border-b-0 dark:border-white/[0.05]"
                                                                        style={{
                                                                            gridTemplateColumns: `104px repeat(${bookingBoardDayCount}, minmax(72px, 1fr))`,
                                                                            gridTemplateRows: `repeat(${laneCount}, minmax(54px, auto))`
                                                                        }}
                                                                    >
                                                                        <div className="sticky left-0 z-20 flex items-center gap-2 border-r border-slate-200/80 bg-white px-3 py-2 dark:border-white/[0.06] dark:bg-[#10141d]" style={{ gridRow: `1 / span ${laneCount}` }}>
                                                                            <div className="min-w-0">
                                                                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">№ {room.label}</p>
                                                                                {room.floor ? <p className="truncate text-[11px] text-slate-400 dark:text-white/35">{room.floor}</p> : null}
                                                                            </div>
                                                                        </div>
                                                                        {bookingBoardDays.map((day, dayIndex) => {
                                                                            const isToday = startOfLocalDay(new Date()).getTime() === startOfLocalDay(day).getTime();
                                                                            return (
                                                                                <div
                                                                                    key={`booking-board-cell-${room.id}-${dayIndex}`}
                                                                                    className={`border-l border-slate-200/60 dark:border-white/[0.04] ${isToday ? 'bg-amber-50/70 dark:bg-amber-400/[0.05]' : ''}`}
                                                                                    style={{ gridColumn: dayIndex + 2, gridRow: `1 / span ${laneCount}` }}
                                                                                />
                                                                            );
                                                                        })}
                                                                        {items.map((item) => (
                                                                            <button
                                                                                key={`booking-board-stay-${item.stay.id}`}
                                                                                type="button"
                                                                                className={`z-10 m-1 min-w-0 rounded-xl border px-2 py-1.5 text-left text-[11px] leading-tight shadow-sm transition hover:scale-[1.01] ${bookingBoardStatusClass[item.stay.status]}`}
                                                                                style={{ gridColumn: `${item.startIndex + 2} / span ${item.span}`, gridRow: item.lane + 1 }}
                                                                                onClick={() => handleSelectStayForEdit(room, item.stay)}
                                                                                title={[
                                                                                    item.guestLabel,
                                                                                    stayStatusLabels[item.stay.status],
                                                                                    item.detailLabel,
                                                                                    item.stay.notes?.trim()
                                                                                ].filter(Boolean).join(' · ')}
                                                                            >
                                                                                <span className="block truncate font-semibold">{item.guestLabel}</span>
                                                                                <span className="mt-0.5 block truncate opacity-80">{item.detailLabel || stayStatusLabels[item.stay.status]}</span>
                                                                            </button>
                                                                        ))}
                                                                        {!items.length ? (
                                                                            <button
                                                                                type="button"
                                                                                className="z-10 col-start-2 col-end-[-1] m-1 rounded-xl border border-dashed border-slate-200/90 px-2 py-1 text-left text-[11px] text-slate-300 transition hover:border-slate-300 hover:text-slate-500 dark:border-white/[0.06] dark:text-white/20 dark:hover:text-white/45"
                                                                                onClick={() => handleOpenBookingForm(room)}
                                                                            >
                                                                                Свободно в выбранном периоде
                                                                            </button>
                                                                        ) : null}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : isRoomHistoryExpanded ? (
                                                    <>
                                                        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_180px]">
                                                            <Input
                                                                placeholder="Поиск: номер, гость, номер брони, телефон, компания, источник"
                                                                value={stayHistoryQuery}
                                                                onChange={(event) => setStayHistoryQuery(event.target.value)}
                                                            />
                                                            <Select
                                                                value={stayHistoryStatus}
                                                                onChange={(event) => setStayHistoryStatus(event.target.value as StayHistoryStatusFilter)}
                                                            >
                                                                {stayHistoryStatusOptions.map((option) => (
                                                                    <option key={`stay-history-status-${option.value}`} value={option.value}>
                                                                        {option.label}
                                                                    </option>
                                                                ))}
                                                            </Select>
                                                        </div>
                                                        <div className="mt-3 divide-y divide-slate-200/80 dark:divide-white/[0.06]">
                                                            {filteredRoomStayHistory.length ? (
                                                                filteredRoomStayHistory.map(({ room, stays, total, isExpanded, hasMore }) => (
                                                                    <div key={`shift-room-history-${room.id}`} className="py-3 first:pt-0 last:pb-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm font-semibold text-slate-900 dark:text-white">№ {room.label}</span>
                                                                            {room.floor && <span className="text-[11px] text-slate-400 dark:text-white/30">{room.floor}</span>}
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
                                                                                className="text-[11px] font-medium text-slate-500 transition hover:text-slate-900 dark:text-white/45 dark:hover:text-white"
                                                                                onClick={() => handleOpenBookingForm(room)}
                                                                            >
                                                                                Бронь
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="text-[11px] text-rose-400/70 transition hover:text-rose-500 dark:text-rose-300/60 dark:hover:text-rose-300"
                                                                                onClick={() => handleDeleteRoom(room.id)}
                                                                                disabled={removingRoomId === room.id}
                                                                            >
                                                                                {removingRoomId === room.id ? '…' : '✕'}
                                                                            </button>
                                                                        </div>
                                                                        <div className="mt-2 space-y-1.5 pl-1">
                                                                            {stays.map((stayEntry) => {
                                                                                    const guestLabel =
                                                                                        stayEntry.guestName?.trim() || (stayEntry.status === 'CHECKED_IN' ? 'Гость' : '—');
                                                                                    const checkInLabel = formatStayDate(stayEntry.actualCheckIn ?? stayEntry.scheduledCheckIn);
                                                                                    const checkOutLabel = formatStayDate(stayEntry.actualCheckOut ?? stayEntry.scheduledCheckOut);
                                                                                    const cashPortion = stayEntry.cashPaid ?? 0;
                                                                                    const cardPortion = stayEntry.cardPaid ?? 0;
                                                                                    const onlinePortion = stayEntry.onlinePaid ?? 0;
                                                                                    const paymentBreakdownTotal = cashPortion + cardPortion + onlinePortion;
                                                                                    const displayAmount = paymentBreakdownTotal > 0 ? paymentBreakdownTotal : stayEntry.amountPaid;
                                                                                    const tariffAmount = stayEntry.totalAmount ?? null;
                                                                                    const remainingAmount = tariffAmount != null ? Math.max(tariffAmount - (displayAmount ?? 0), 0) : null;
                                                                                    const paymentLabel = (() => {
                                                                                        const segments: string[] = [];
                                                                                        if (cashPortion) segments.push(`нал ${formatCurrency(cashPortion)}`);
                                                                                        if (cardPortion) segments.push(`безнал ${formatCurrency(cardPortion)}`);
                                                                                        if (!segments.length && stayEntry.paymentMethod) {
                                                                                            return stayEntry.paymentMethod === 'CARD' ? 'Безнал' : 'Наличные';
                                                                                        }
                                                                                        return segments.join(' · ') || undefined;
                                                                                    })();
                                                                                    const sourceLabel = stayEntry.bookingSource?.trim() ? `источник ${stayEntry.bookingSource.trim()}` : undefined;
                                                                                    const bookingNumberLabel = stayEntry.bookingNumber?.trim() ? `бронь № ${stayEntry.bookingNumber.trim()}` : undefined;
                                                                                    const phoneLabel = stayEntry.guestPhone?.trim() ? `тел. ${stayEntry.guestPhone.trim()}` : undefined;
                                                                                    const companyLabel = stayEntry.companyName?.trim() ? `компания ${stayEntry.companyName.trim()}` : undefined;
                                                                                    const transferLabel = stayEntry.transfers?.length
                                                                                        ? stayEntry.transfers
                                                                                            .map((transfer) => `переселение ${transfer.fromRoomLabel}→${transfer.toRoomLabel}`)
                                                                                            .join(' · ')
                                                                                        : undefined;

                                                                                    return (
                                                                                        <div key={stayEntry.id} className="rounded-xl border border-slate-200/80 bg-white px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                                                            <div className="flex items-center justify-between gap-2">
                                                                                                <span className="text-xs font-medium text-slate-900 dark:text-white">{guestLabel}</span>
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <Badge label={stayStatusLabels[stayEntry.status]} tone={stayStatusTone[stayEntry.status]} />
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        className="text-[11px] text-slate-400 transition hover:text-slate-700 dark:text-white/30 dark:hover:text-white"
                                                                                                        onClick={() => handleSelectStayForEdit(room, stayEntry)}
                                                                                                    >
                                                                                                        ✎
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                                                                                                {checkInLabel} — {checkOutLabel}
                                                                                                {tariffAmount != null ? (
                                                                                                    <> · тариф {formatCurrency(tariffAmount)} · оплачено {formatCurrency(displayAmount ?? 0)}{remainingAmount ? ` · остаток ${formatCurrency(remainingAmount)}` : ''}</>
                                                                                                ) : displayAmount != null && (
                                                                                                    <> · оплачено {formatCurrency(displayAmount)}</>
                                                                                                )}
                                                                                            </p>
                                                                                            {(paymentLabel || sourceLabel || bookingNumberLabel) ? (
                                                                                                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                                                                                                    {[paymentLabel, sourceLabel, bookingNumberLabel].filter(Boolean).join(' · ')}
                                                                                                </p>
                                                                                            ) : null}
                                                                                            {(phoneLabel || companyLabel || stayEntry.notes) ? (
                                                                                                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                                                                                                    {[companyLabel, phoneLabel, stayEntry.notes?.trim()].filter(Boolean).join(' · ')}
                                                                                                </p>
                                                                                            ) : null}
                                                                                            {onlinePortion > 0 ? (
                                                                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                                                                                    <span className="font-medium">Ожидает сайт: {formatCurrency(onlinePortion)}</span>
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        className="rounded-lg border border-amber-300/80 px-2 py-1 font-semibold transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/30 dark:hover:bg-amber-400/10"
                                                                                                        disabled={confirmingOnlineStayId === stayEntry.id}
                                                                                                        onClick={() => handleConfirmOnlinePayment(room, stayEntry)}
                                                                                                    >
                                                                                                        {confirmingOnlineStayId === stayEntry.id ? 'Подтверждаем...' : 'Подтвердить'}
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : null}
                                                                                            {transferLabel ? (
                                                                                                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{transferLabel}</p>
                                                                                            ) : null}
                                                                                        </div>
                                                                                    );
                                                                            })}
                                                                            {hasMore && !isExpanded ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="mt-1 text-xs font-medium text-slate-500 transition hover:text-slate-900 dark:text-white/50 dark:hover:text-white"
                                                                                    onClick={() => setExpandedStayHistoryRooms((current) => {
                                                                                        const next = new Set(current);
                                                                                        next.add(room.id);
                                                                                        return next;
                                                                                    })}
                                                                                >
                                                                                    Показать все {total}
                                                                                </button>
                                                                            ) : null}
                                                                            {hasMore && isExpanded && !stayHistoryQuery.trim() && stayHistoryStatus === 'ALL' ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="mt-1 text-xs font-medium text-slate-500 transition hover:text-slate-900 dark:text-white/50 dark:hover:text-white"
                                                                                    onClick={() => setExpandedStayHistoryRooms((current) => {
                                                                                        const next = new Set(current);
                                                                                        next.delete(room.id);
                                                                                        return next;
                                                                                    })}
                                                                                >
                                                                                    Скрыть старые
                                                                                </button>
                                                                            ) : null}
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="py-3 text-xs text-slate-400 dark:text-white/40">По фильтрам ничего не найдено</p>
                                                            )}
                                                        </div>
                                                    </>
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
                        <div className={`${formPanelClass} border-amber-200/70 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-500/8`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-amber-700/70 dark:text-amber-200/60">Редактирование</p>
                                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Смена №{editingShift.number}</p>
                                </div>
                                <Badge label="Архивная настройка" tone="warning" />
                            </div>
                            <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleUpdateShift}>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Менеджер</label>
                                    <Select
                                        {...shiftEditForm.register('managerId')}
                                    >
                                        <option value="" >
                                            Выберите менеджера
                                        </option>
                                        {data.managers.map((manager) => (
                                            <option key={manager.id} value={manager.id} >
                                                {manager.displayName || manager.username || manager.loginName || (manager.pinCode ? `PIN ${manager.pinCode}` : 'Менеджер')}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Статус смены</label>
                                    <Select
                                        {...shiftEditForm.register('status')}
                                    >
                                        <option value="CLOSED" >
                                            Закрыта
                                        </option>
                                        <option value="OPEN" >
                                            Открыта
                                        </option>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Время открытия</label>
                                    <Input type="datetime-local" step="60" {...shiftEditForm.register('openedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Время закрытия</label>
                                    <Input type="datetime-local" step="60" {...shiftEditForm.register('closedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>{`На начало (${hotelCur || 'KZT'})`}</label>
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
                                    <label className={formLabelClass}>{`Касса факт (${hotelCur || 'KZT'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...shiftEditForm.register('closingCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>{`Передано (${hotelCur || 'KZT'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...shiftEditForm.register('handoverCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1 md:col-span-2 lg:col-span-1">
                                    <label className={formLabelClass}>Комментарий к открытию</label>
                                    <TextArea rows={3} placeholder="Что важно зафиксировать при открытии" {...shiftEditForm.register('openingNote')} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Комментарий к закрытию</label>
                                    <TextArea rows={3} placeholder="Итог или замечания по закрытию" {...shiftEditForm.register('closingNote')} />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <label className={formLabelClass}>Комментарий к передаче</label>
                                    <TextArea rows={3} placeholder="Что передано следующей смене" {...shiftEditForm.register('handoverNote')} />
                                </div>
                                <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Button type="submit" className="flex-1">
                                        Сохранить изменения
                                    </Button>
                                    <Button type="button" variant="ghost" className="flex-1 border border-slate-200/80 dark:border-white/20" onClick={handleResetShiftEditor}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                            {!confirmDeleteShift ? (
                                <Button
                                    type="button"
                                    variant="danger"
                                    className="mt-4 w-full"
                                    onClick={() => setConfirmDeleteShift(true)}
                                >
                                    Удалить смену
                                </Button>
                            ) : (
                                <div className="mt-3 flex gap-2">
                                    <Button
                                        type="button"
                                        variant="danger"
                                        className="flex-1"
                                        disabled={isDeletingShift}
                                        onClick={handleDeleteShift}
                                    >
                                        {isDeletingShift ? 'Удаляем…' : 'Да, удалить'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="flex-1 border border-slate-200/80 dark:border-white/20"
                                        onClick={() => setConfirmDeleteShift(false)}
                                    >
                                        Отмена
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {isCreatingShift && (
                        <div className={`${formPanelClass} border-emerald-200/70 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/8`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-700/70 dark:text-emerald-300/60">Создание смены</p>
                                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Новая смена задним числом</p>
                                </div>
                                <Badge label="История" tone="success" />
                            </div>
                            <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleCreateShift}>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Менеджер *</label>
                                    <Select
                                        {...createShiftForm.register('managerId', { required: 'Выберите менеджера' })}
                                    >
                                        <option value="" >
                                            Выберите менеджера
                                        </option>
                                        {data.managers.map((manager) => (
                                            <option key={manager.id} value={manager.id} >
                                                {manager.displayName || manager.username || manager.loginName || (manager.pinCode ? `PIN ${manager.pinCode}` : 'Менеджер')}
                                            </option>
                                        ))}
                                    </Select>
                                    {createShiftForm.formState.errors.managerId && (
                                        <p className="text-xs text-rose-300">{createShiftForm.formState.errors.managerId.message}</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Статус смены</label>
                                    <Select
                                        {...createShiftForm.register('status')}
                                    >
                                        <option value="CLOSED" >
                                            Закрыта
                                        </option>
                                        <option value="OPEN" >
                                            Открыта
                                        </option>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Время открытия *</label>
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
                                    <label className={formLabelClass}>Время закрытия</label>
                                    <Input type="datetime-local" step="60" {...createShiftForm.register('closedAt')} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>{`На начало (${hotelCur || 'KZT'}) *`}</label>
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
                                    <label className={formLabelClass}>{`Касса факт (${hotelCur || 'KZT'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...createShiftForm.register('closingCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>{`Передано (${hotelCur || 'KZT'})`}</label>
                                    <Input type="number" step="0.01" placeholder="—" {...createShiftForm.register('handoverCash', { valueAsNumber: true })} />
                                </div>
                                <div className="space-y-1 md:col-span-2 lg:col-span-1">
                                    <label className={formLabelClass}>Комментарий к открытию</label>
                                    <TextArea rows={3} placeholder="Что важно зафиксировать при открытии" {...createShiftForm.register('openingNote')} />
                                </div>
                                <div className="space-y-1">
                                    <label className={formLabelClass}>Комментарий к закрытию</label>
                                    <TextArea rows={3} placeholder="Итог или замечания по закрытию" {...createShiftForm.register('closingNote')} />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <label className={formLabelClass}>Комментарий к передаче</label>
                                    <TextArea rows={3} placeholder="Что передано следующей смене" {...createShiftForm.register('handoverNote')} />
                                </div>
                                <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Button type="submit" className="flex-1">
                                        Создать смену
                                    </Button>
                                    <Button type="button" variant="ghost" className="flex-1 border border-slate-200/80 dark:border-white/20" onClick={() => {
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

                {isBookingFormOpen && (
                    <div className="fixed inset-0 z-50 overflow-y-auto px-2 sm:px-6">
                        <div className="fixed inset-0 bg-black/70" onClick={handleCloseBookingForm} />
                        <div className="relative z-10 mx-auto mt-4 w-full max-w-3xl rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.65)] backdrop-blur sm:mt-12 sm:p-6 dark:border-white/[0.08] dark:bg-[#090d16]/95 dark:text-white">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/35">Будущая бронь</p>
                                    <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Новая запись</h3>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="border border-slate-200/80 dark:border-white/10"
                                    onClick={handleCloseBookingForm}
                                >
                                    ×
                                </Button>
                            </div>
                            <form className="mt-4 space-y-4" onSubmit={handleCreateBooking}>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Номер</label>
                                        <Select {...bookingCreateForm.register('roomId')}>
                                            <option value="">Выберите номер</option>
                                            {sortedRooms.filter((room) => room.isActive).map((room) => (
                                                <option key={`booking-room-${room.id}`} value={room.id}>
                                                    №{room.label}{room.floor ? ` · ${room.floor}` : ''}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    {data?.usesExtranets && (data.extranetNames?.length ?? 0) > 0 && (
                                        <div className="space-y-1">
                                            <label className={modalLabelClass}>Источник брони</label>
                                            <Select {...bookingCreateForm.register('bookingSource')}>
                                                <option value="">Без экстранета / прямой заезд</option>
                                                {(data.extranetNames ?? []).map((name) => (
                                                    <option key={`create-booking-source-${name}`} value={name}>{name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <Input placeholder="Имя клиента" {...bookingCreateForm.register('guestName')} />
                                    <Input placeholder="Телефон" {...bookingCreateForm.register('guestPhone')} />
                                    <Input placeholder="Компания" {...bookingCreateForm.register('companyName')} />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Номер брони</label>
                                        <Input placeholder="Booking #" {...bookingCreateForm.register('bookingNumber')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Общая сумма тарифа (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            placeholder="150000"
                                            {...bookingCreateForm.register('totalAmount', { valueAsNumber: true })}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Заезд</label>
                                        <Input type="datetime-local" step="60" {...bookingCreateForm.register('scheduledCheckIn')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Выезд</label>
                                        <Input type="datetime-local" step="60" {...bookingCreateForm.register('scheduledCheckOut')} />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Предоплата (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            placeholder="0"
                                            {...bookingCreateForm.register('prepaymentAmount', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Способ предоплаты</label>
                                        <Select {...bookingCreateForm.register('prepaymentMethod')}>
                                            <option value="CASH">Наличные</option>
                                            <option value="CARD">Безнал</option>
                                            <option value="ONLINE">На сайте / онлайн</option>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className={modalLabelClass}>Комментарий</label>
                                    <TextArea rows={3} placeholder="Пожелания гостя, условия оплаты, кто оставил бронь" {...bookingCreateForm.register('notes')} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button type="submit" disabled={isCreatingBooking}>
                                        {isCreatingBooking ? 'Сохраняем…' : 'Сохранить бронь'}
                                    </Button>
                                    <Button type="button" variant="ghost" className="border border-slate-200/80 dark:border-white/20" onClick={handleCloseBookingForm}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {isStayEditorOpen && hasStaySelection && (
                    <div className="fixed inset-0 z-50 overflow-y-auto px-2 sm:px-6">
                        <div className="fixed inset-0 bg-black/70" onClick={handleCloseStayEditor} />
                        <div className="relative z-10 mx-auto mt-4 w-full max-w-3xl rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.65)] backdrop-blur sm:mt-12 sm:p-6 dark:border-white/[0.08] dark:bg-[#090d16]/95 dark:text-white">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/35">Редактирование проживания</p>
                                    <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                                        № {stayEditForm.watch('roomLabel')}
                                    </h3>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="border border-slate-200/80 dark:border-white/10"
                                    onClick={handleCloseStayEditor}
                                >
                                    ×
                                </Button>
                            </div>
                            <form className="mt-4 space-y-4" onSubmit={handleUpdateStay}>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <Input placeholder="Имя гостя" {...stayEditForm.register('guestName')} />
                                    <Input placeholder="Телефон" {...stayEditForm.register('guestPhone')} />
                                    <Input placeholder="Компания" {...stayEditForm.register('companyName')} />
                                </div>
                                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                                        <div className="min-w-0">
                                            <p className={modalLabelClass}>Смена проживания</p>
                                            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                                {selectedStayForEditor?.shiftNumber
                                                    ? `Смена №${selectedStayForEditor.shiftNumber}`
                                                    : 'Смена не привязана'}
                                                {selectedStayForEditor?.shiftManagerName ? ` · ${selectedStayForEditor.shiftManagerName}` : ''}
                                            </p>
                                            {selectedStayForEditor?.shiftOpenedAt && (
                                                <p className="mt-1 text-xs text-slate-500 dark:text-white/45">
                                                    Открыта {formatDateTime(selectedStayForEditor.shiftOpenedAt, hotelTz)}
                                                    {selectedStayForEditor.shiftStatus ? ` · ${selectedStayForEditor.shiftStatus === 'OPEN' ? 'активная' : 'закрытая'}` : ''}
                                                </p>
                                            )}
                                        </div>
                                        <div className="w-full md:max-w-xs">
                                            <Select {...stayEditForm.register('shiftId')}>
                                                <option value="">Без смены</option>
                                                {selectedStayForEditor?.shiftId && !shiftList.some((shift) => shift.id === selectedStayForEditor.shiftId) && (
                                                    <option value={selectedStayForEditor.shiftId}>
                                                        №{selectedStayForEditor.shiftNumber ?? '?'} · {selectedStayForEditor.shiftManagerName ?? 'Менеджер'} · {selectedStayForEditor.shiftStatus === 'OPEN' ? 'активная' : 'закрытая'}
                                                    </option>
                                                )}
                                                {shiftList.map((shift) => (
                                                    <option key={`stay-shift-${shift.id}`} value={shift.id}>
                                                        №{shift.number} · {shift.manager} · {shift.status === 'OPEN' ? 'активная' : 'закрытая'}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                                {data?.usesExtranets && (data.extranetNames?.length ?? 0) > 0 && (
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Источник брони</label>
                                        <Select {...stayEditForm.register('bookingSource')}>
                                            <option value="">Без экстранета / прямой заезд</option>
                                            {(data.extranetNames ?? []).map((name) => (
                                                <option key={`booking-source-${name}`} value={name}>{name}</option>
                                            ))}
                                        </Select>
                                    </div>
                                )}
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Номер брони</label>
                                        <Input placeholder="Booking #" {...stayEditForm.register('bookingNumber')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Общая сумма тарифа (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('totalAmount', { valueAsNumber: true })}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Планируемый заезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('scheduledCheckIn')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Планируемый выезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('scheduledCheckOut')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Фактический заезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('actualCheckIn')} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Фактический выезд</label>
                                        <Input type="datetime-local" step="60" {...stayEditForm.register('actualCheckOut')} />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Статус</label>
                                        <Select
                                            {...stayEditForm.register('status')}
                                        >
                                            {stayStatusOptions.map((option) => (
                                                <option key={`stay-status-${option.value}`} value={option.value} >
                                                    {option.label}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Способ оплаты</label>
                                        <Select
                                            {...stayEditForm.register('paymentMethod')}
                                        >
                                            {stayPaymentOptions.map((option) => (
                                                <option key={`stay-method-${option.value}`} value={option.value} >
                                                    {option.label}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-4">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Наличные (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('cashPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Безнал (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('cardPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`На сайте (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('onlinePaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Общая оплата (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            {...stayEditForm.register('totalPaid', { valueAsNumber: true })}
                                        />
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-white/60">
                                    По разбивке: {roomPaymentPreview.totalBreakdown.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {hotelCur || 'KZT'}
                                    {' • '}Поле «Общая оплата»: {roomPaymentPreview.totalField.toLocaleString('ru-RU', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}{' '}
                                    {hotelCur || 'KZT'}
                                </div>
                                {selectedStayForEditor && (selectedStayForEditor.onlinePaid ?? 0) > 0 && selectedRoomForEditor ? (
                                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <span className="font-medium">
                                                Ожидает поступления с сайта: {formatCurrency(selectedStayForEditor?.onlinePaid ?? 0)}
                                            </span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                className="border-amber-300/80 bg-white text-amber-700 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-white/[0.05] dark:text-amber-200 dark:hover:bg-amber-400/10"
                                                disabled={confirmingOnlineStayId === selectedStayForEditor.id}
                                                onClick={() => handleConfirmOnlinePayment(selectedRoomForEditor, selectedStayForEditor)}
                                            >
                                                {confirmingOnlineStayId === selectedStayForEditor.id ? 'Подтверждаем...' : 'Подтвердить поступление'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                                    <p className={modalLabelClass}>Кассовые записи по проживанию</p>
                                    {selectedStayForEditor?.ledgerEntries?.length ? (
                                        <div className="mt-3 space-y-2">
                                            {selectedStayForEditor.ledgerEntries.map((entry) => (
                                                <div key={entry.id} className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-slate-900 dark:text-white">
                                                            {entry.entryType === 'CASH_IN' ? 'Поступление' : ledgerEntryTypeLabels[entry.entryType]} · {entry.method === 'CASH' ? 'наличные' : 'безнал'}
                                                        </p>
                                                        <p className="text-xs text-slate-500 dark:text-white/45">
                                                            {formatDateTime(entry.recordedAt, hotelTz)}
                                                            {entry.shiftNumber ? ` · смена №${entry.shiftNumber}` : ''}
                                                            {entry.managerName ? ` · ${entry.managerName}` : ''}
                                                            {entry.note ? ` · ${entry.note}` : ''}
                                                        </p>
                                                    </div>
                                                    <p className="font-semibold text-emerald-600 dark:text-emerald-300">{formatCurrency(entry.amount)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-xs text-slate-500 dark:text-white/45">
                                            Связанных кассовых записей пока нет. Новые заселения и продления будут связываться автоматически.
                                        </p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className={modalLabelClass}>Комментарий для администратора</label>
                                    <TextArea rows={3} placeholder="Важные детали по гостю или оплате" {...stayEditForm.register('notes')} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button type="submit">Сохранить заселение</Button>
                                    <Button type="button" variant="ghost" className="border border-slate-200/80 dark:border-white/20" onClick={handleCloseStayEditor}>
                                        Отменить
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {editingLedgerEntry && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-2 py-4 sm:px-6 sm:py-6">
                        <div className="absolute inset-0 bg-black/70" onClick={handleCloseLedgerEditor} />
                        <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.65)] backdrop-blur sm:p-5 dark:border-white/[0.08] dark:bg-[#090d16]/95 dark:text-white">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/35">Редактирование операции</p>
                                    <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
                                        {ledgerDisplayLabel(editingLedgerEntry)} · {formatCurrency(editingLedgerEntry.amount)}
                                    </h3>
                                </div>
                                <Button type="button" variant="ghost" size="sm" className="border border-slate-200/80 dark:border-white/10" onClick={handleCloseLedgerEditor}>
                                    ×
                                </Button>
                            </div>
                            <form className="space-y-4" onSubmit={handleUpdateLedgerEntry}>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Тип операции</label>
                                        <Select {...ledgerEditForm.register('entryType')}>
                                            <option value="CASH_IN">Поступление</option>
                                            <option value="CASH_OUT">Расход</option>
                                            <option value="MANAGER_PAYOUT">Выплата менеджеру</option>
                                            <option value="ADJUSTMENT">Корректировка</option>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Способ оплаты</label>
                                        <Select {...ledgerEditForm.register('method')}>
                                            <option value="CASH">Наличные</option>
                                            <option value="CARD">Безнал</option>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>{`Сумма (${hotelCur || 'KZT'})`}</label>
                                        <Input type="number" step="0.01" min="0.01" {...ledgerEditForm.register('amount', { valueAsNumber: true })} />
                                        {ledgerEditForm.formState.errors.amount && (
                                            <p className="text-xs text-rose-400">{ledgerEditForm.formState.errors.amount.message}</p>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Время операции</label>
                                        <Input type="datetime-local" step="60" {...ledgerEditForm.register('recordedAt')} />
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Смена</label>
                                        <Select {...ledgerEditForm.register('shiftId')}>
                                            <option value="">Без смены</option>
                                            {editingLedgerEntry.shiftId && !shiftList.some((shift) => shift.id === editingLedgerEntry.shiftId) && (
                                                <option value={editingLedgerEntry.shiftId}>
                                                    №{editingLedgerEntry.shiftNumber ?? '?'} · текущая операция
                                                </option>
                                            )}
                                            {shiftList.map((shift) => (
                                                <option key={`ledger-shift-${shift.id}`} value={shift.id}>
                                                    №{shift.number} · {shift.manager} · {shift.status === 'OPEN' ? 'активная' : 'закрытая'}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className={modalLabelClass}>Категория расхода</label>
                                        <Select
                                            {...ledgerEditForm.register('categoryId')}
                                            disabled={ledgerFormValues.entryType !== 'CASH_OUT'}
                                        >
                                            <option value="">Без категории</option>
                                            {(data.expenseCategories ?? []).map((category) => (
                                                <option key={`ledger-category-${category.id}`} value={category.id}>{category.name}</option>
                                            ))}
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className={modalLabelClass}>Комментарий</label>
                                    <TextArea rows={3} placeholder="Назначение операции" {...ledgerEditForm.register('note')} />
                                </div>
                                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <Button type="button" variant="ghost" className="border border-rose-200/80 text-rose-500 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10" onClick={handleDeleteLedgerEntry}>
                                        Удалить операцию
                                    </Button>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <Button type="button" variant="ghost" className="border border-slate-200/80 dark:border-white/20" onClick={handleCloseLedgerEditor}>
                                            Отмена
                                        </Button>
                                        <Button type="submit">Сохранить</Button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {isManagementPanelOpen && (
                    <div className="fixed inset-0 z-50">
                        <div className="absolute inset-0 bg-black/70" onClick={() => setIsManagementPanelOpen(false)} />
                        <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-white/95 p-3 shadow-2xl backdrop-blur sm:p-5 md:max-w-xl md:border-l md:border-slate-200/80 dark:md:border-white/[0.08] dark:bg-[#090d16]/95">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/35">Панель управления</p>
                                    <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Управление объектом</h3>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="border border-slate-200/80 dark:border-white/20"
                                    onClick={() => setIsManagementPanelOpen(false)}
                                >
                                    Закрыть
                                </Button>
                            </div>
                            <div className="flex-1 space-y-3 overflow-y-auto pr-1 sm:space-y-5 sm:pr-2">
                                <Card className="border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.03] dark:shadow-none">
                                    <CardHeader title="Менеджеры" />
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            {data.managers.length ? (
                                                data.managers.map((manager) => (
                                                    <div
                                                        key={manager.assignmentId}
                                                        className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/65 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 dark:border-white/[0.055] dark:bg-white/[0.03]"
                                                    >
                                                        <div>
                                                            <p className="text-sm font-medium text-slate-900 dark:text-white">{manager.displayName}</p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                Логин: {manager.loginName ?? 'не задан'}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                {manager.username ? `@${manager.username} • ` : ''}
                                                                PIN {manager.pinCode ?? 'не задан'}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                Ставка: {manager.shiftPayAmount != null ? formatCurrency(manager.shiftPayAmount) : '—'} •
                                                                Процент: {manager.revenueSharePct != null ? formatPercentage(manager.revenueSharePct) : '—'}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                Исправления: {manager.canEditStayPayments ? 'разрешены' : 'без доступа'}
                                                            </p>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                                                            <Badge label="Менеджер" />
                                                            {manager.canEditStayPayments ? <Badge label="Суммы" tone="success" /> : null}
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="border border-slate-200/80 text-xs text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/[0.06]"
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
                                                <p className="text-sm text-slate-500 dark:text-white/60">Назначений пока нет</p>
                                            )}
                                        </div>
                                        <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Добавление менеджера</p>
                                                    <p className="text-xs text-slate-500 dark:text-white/60">Имя, логин, PIN и @username</p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="border border-slate-200/80 dark:border-white/15"
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
                                                        <div className="flex flex-col gap-2 sm:flex-row">
                                                            <Input
                                                                placeholder="Логин для входа"
                                                                autoComplete="off"
                                                                className="flex-1"
                                                                {...managerForm.register('loginName', {
                                                                    required: 'Укажите логин',
                                                                    minLength: { value: 3, message: 'Минимум 3 символа' },
                                                                    maxLength: { value: 50, message: 'Максимум 50 символов' },
                                                                    pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Только латиница, цифры и _' },
                                                                    setValueAs: (value) => String(value ?? '').trim().toLowerCase()
                                                                })}
                                                            />
                                                            <Button type="button" variant="secondary" onClick={handleGenerateManagerLogin}>
                                                                Сгенерировать
                                                            </Button>
                                                        </div>
                                                        {managerForm.formState.errors.loginName && (
                                                            <p className="text-xs text-rose-300">{managerForm.formState.errors.loginName.message}</p>
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
                                                            placeholder={`Ставка за смену (${hotelCur || 'KZT'})`}
                                                            {...managerForm.register('shiftPayAmount', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <Input
                                                            type="number"
                                                            step="1"
                                                            min="0"
                                                            placeholder="Процент с оборота"
                                                            {...managerForm.register('revenueSharePct', { valueAsNumber: true, min: 0 })}
                                                        />
                                                        <label className="flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                                                            <input
                                                                type="checkbox"
                                                                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                                                                {...managerForm.register('canEditStayPayments')}
                                                            />
                                                            <span>Разрешить исправлять суммы и отменять операции</span>
                                                        </label>
                                                        <Input placeholder="Подпись / @username (необязательно)" {...managerForm.register('username')} />
                                                        <Button type="submit" className="w-full">
                                                            Добавить менеджера
                                                        </Button>

                                                    </form>
                                                </>
                                            ) : null}
                                        </div>
                                        {data.managers.length > 0 && (
                                            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Редактирование менеджера</p>

                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="border border-slate-200/80 dark:border-white/15"
                                                        onClick={() => setIsUpdateManagerExpanded((prev) => !prev)}
                                                    >
                                                        {isUpdateManagerExpanded ? 'Свернуть' : 'Открыть'}
                                                    </Button>
                                                </div>
                                                {isUpdateManagerExpanded ? (
                                                    <form className="space-y-3" onSubmit={handleUpdateManager}>
                                                        <Select
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
                                                        </Select>
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
                                                            placeholder={selectedManager?.loginName ? `Логин (сейчас ${selectedManager.loginName})` : 'Новый логин для входа'}
                                                            autoComplete="off"
                                                            {...updateManagerForm.register('loginName', {
                                                                validate: (value) => {
                                                                    const normalized = value.trim();
                                                                    if (!normalized) {
                                                                        return true;
                                                                    }
                                                                    return /^[a-zA-Z0-9_]{3,50}$/.test(normalized) || 'Только латиница, цифры и _, 3-50 символов';
                                                                },
                                                                setValueAs: (value) => String(value ?? '').trim().toLowerCase()
                                                            })}
                                                        />
                                                        {updateManagerForm.formState.errors.loginName && (
                                                            <p className="text-xs text-rose-300">
                                                                {updateManagerForm.formState.errors.loginName.message}
                                                            </p>
                                                        )}
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
                                                                    : `Новая ставка за смену (${hotelCur || 'KZT'})`
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
                                                        <label className="flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                                                            <input
                                                                type="checkbox"
                                                                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                                                                {...updateManagerForm.register('canEditStayPayments')}
                                                            />
                                                            <span>Разрешить исправлять суммы и отменять операции</span>
                                                        </label>
                                                        <Button type="submit" className="w-full" variant="secondary">
                                                            Обновить менеджера
                                                        </Button>

                                                    </form>
                                                ) : null}
                                            </div>
                                        )}
                                    </div>
                                </Card>

                                <Card className="border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.03] dark:shadow-none">
                                    <CardHeader
                                        title="Категории расходов"
                                        actions={
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-slate-200/80 dark:border-white/15"
                                                onClick={() => setIsExpenseCategoriesExpanded((prev) => !prev)}
                                            >
                                                {isExpenseCategoriesExpanded ? 'Свернуть' : 'Открыть'}
                                            </Button>
                                        }
                                    />
                                    {isExpenseCategoriesExpanded && (
                                        <div className="space-y-3">
                                            {(data?.expenseCategories ?? []).length ? (
                                                <div className="space-y-2">
                                                    {(data?.expenseCategories ?? []).map((category) => {
                                                        const isEditing = editingExpenseCategoryId === category.id;
                                                        const isSaving = savingExpenseCategoryId === category.id;
                                                        const isRemoving = removingExpenseCategoryId === category.id;

                                                        return (
                                                            <div key={category.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                                {isEditing ? (
                                                                    <Input
                                                                        value={editingExpenseCategoryName}
                                                                        onChange={(event) => setEditingExpenseCategoryName(event.target.value)}
                                                                        className="min-w-[12rem] flex-1"
                                                                        placeholder="Название категории"
                                                                    />
                                                                ) : (
                                                                    <p className="min-w-0 flex-1 text-sm text-slate-900 dark:text-white">{category.name}</p>
                                                                )}
                                                                {isEditing ? (
                                                                    <>
                                                                        <Button type="button" size="sm" variant="secondary" disabled={isSaving} onClick={() => handleSaveExpenseCategory(category.id)}>
                                                                            {isSaving ? 'Сохраняем…' : 'Сохранить'}
                                                                        </Button>
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            className="border border-slate-200/80 dark:border-white/15"
                                                                            onClick={() => {
                                                                                setEditingExpenseCategoryId(null);
                                                                                setEditingExpenseCategoryName('');
                                                                            }}
                                                                        >
                                                                            Отмена
                                                                        </Button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Button type="button" size="sm" variant="ghost" className="border border-slate-200/80 dark:border-white/15" onClick={() => handleStartEditExpenseCategory(category)}>
                                                                            Изменить
                                                                        </Button>
                                                                        <Button type="button" size="sm" variant="ghost" className="border border-rose-200/80 text-rose-600 hover:bg-rose-50 dark:border-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/10" disabled={isRemoving} onClick={() => handleDeleteExpenseCategory(category.id)}>
                                                                            {isRemoving ? 'Удаляем…' : 'Удалить'}
                                                                        </Button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="rounded-2xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:text-white/40">
                                                    Категории еще не созданы.
                                                </p>
                                            )}
                                            <div className="flex flex-col gap-2 sm:flex-row">
                                                <Input
                                                    value={newExpenseCategoryName}
                                                    onChange={(event) => setNewExpenseCategoryName(event.target.value)}
                                                    placeholder="Новая категория расходов"
                                                    className="flex-1"
                                                />
                                                <Button type="button" size="sm" variant="secondary" disabled={savingExpenseCategoryId === 'new'} onClick={handleAddExpenseCategory}>
                                                    {savingExpenseCategoryId === 'new' ? 'Добавляем…' : 'Добавить'}
                                                </Button>
                                            </div>
                                            <p className="text-[11px] text-slate-600 dark:text-white/30">
                                                Эти категории будут доступны менеджеру в форме расхода. Удаление категории не удаляет старые записи, только снимает привязку.
                                            </p>
                                        </div>
                                    )}
                                </Card>

                                <Card className="border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.03] dark:shadow-none">
                                    <CardHeader
                                        title="Бонусы за кассу"
                                        actions={
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-slate-200/80 dark:border-white/15"
                                                onClick={() => setIsBonusTiersExpanded((prev) => !prev)}
                                            >
                                                {isBonusTiersExpanded ? 'Свернуть' : 'Открыть'}
                                            </Button>
                                        }
                                    />
                                    {isBonusTiersExpanded && (
                                        <div className="space-y-3">
                                            {(data?.bonusTiers ?? []).length > 0 && (
                                                <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                                                    {data!.bonusTiers!.map((tier) => (
                                                        <div key={tier.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                            <span className="text-sm text-slate-900 dark:text-white">
                                                                {formatCurrency(tier.threshold)} →{' '}
                                                                <span className="text-emerald-300 font-medium">
                                                                    {tier.bonusPct != null && tier.bonusPct > 0
                                                                        ? `${(tier.bonusPct / 100).toFixed(1)}%`
                                                                        : `+${formatCurrency(tier.bonus)}`
                                                                    }
                                                                </span>
                                                            </span>
                                                            <span className="flex-1" />
                                                            <button
                                                                type="button"
                                                                className="text-[11px] text-rose-300/60 hover:text-rose-300 transition"
                                                                onClick={() => handleDeleteBonusTier(tier.id)}
                                                                disabled={removingTierId === tier.id}
                                                            >
                                                                {removingTierId === tier.id ? '…' : '✕'}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="space-y-2 px-1">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        placeholder="Порог кассы"
                                                        value={newTier.threshold}
                                                        onChange={(e) => setNewTier((prev) => ({ ...prev, threshold: e.target.value }))}
                                                    />
                                                    {newTier.usePercent ? (
                                                        <Input
                                                            type="number"
                                                            step="0.1"
                                                            min="0"
                                                            placeholder="Процент %"
                                                            value={newTier.bonusPct}
                                                            onChange={(e) => setNewTier((prev) => ({ ...prev, bonusPct: e.target.value }))}
                                                        />
                                                    ) : (
                                                        <Input
                                                            type="number"
                                                            step="1"
                                                            min="0"
                                                            placeholder="Бонус (сумма)"
                                                            value={newTier.bonus}
                                                            onChange={(e) => setNewTier((prev) => ({ ...prev, bonus: e.target.value }))}
                                                        />
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-white/60">
                                                        <input
                                                            type="checkbox"
                                                            checked={newTier.usePercent}
                                                            onChange={(e) => setNewTier((prev) => ({ ...prev, usePercent: e.target.checked }))}
                                                            className="accent-emerald-400"
                                                        />
                                                        Процент от кассы
                                                    </label>
                                                    <span className="flex-1" />
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="secondary"
                                                        disabled={savingTier}
                                                        onClick={handleAddBonusTier}
                                                    >
                                                        {savingTier ? 'Добавляем…' : 'Добавить порог'}
                                                    </Button>
                                                </div>
                                                <p className="text-[11px] text-slate-600 dark:text-white/30">
                                                    При достижении порога кассы за смену менеджер получает бонус. Применяется наивысший достигнутый порог.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </Card>

                                <Card className="border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.055] dark:bg-white/[0.03] dark:shadow-none">
                                    <CardHeader
                                        title="Номера"
                                        actions={
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-slate-200/80 dark:border-white/15"
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
                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                Поддерживается множественный ввод: один номер в строке или разделённые запятыми.
                                            </p>
                                        </form>
                                    ) : (
                                        <p className="px-2 pb-4 text-xs text-slate-500 dark:text-white/60">Форма массового добавления скрыта.</p>
                                    )}
                                </Card>

                                <Card className="border-slate-200 bg-white shadow-[0_10px_28px_-24px_rgba(15,23,42,0.34)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-none">
                                    <CardHeader
                                        title={`Список номеров (${sortedRooms.length})`}
                                        actions={
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="border border-slate-200/80 dark:border-white/15"
                                                onClick={() => setIsRoomListExpanded((prev) => !prev)}
                                            >
                                                {isRoomListExpanded ? 'Свернуть' : 'Показать'}
                                            </Button>
                                        }
                                    />
                                    {isRoomListExpanded && (
                                        <div className="divide-y divide-slate-200/80 dark:divide-white/[0.06]">
                                            {sortedRooms.length === 0 && (
                                                <p className="py-3 px-2 text-xs text-slate-400 dark:text-white/40">Номеров пока нет</p>
                                            )}
                                            {sortedRooms.map((room) => (
                                                <div key={room.id} className="py-2.5 px-1">
                                                    {editingRoomId === room.id ? (
                                                        <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                                                <Input
                                                                    placeholder="Номер"
                                                                    value={editRoomData.label}
                                                                    onChange={(e) => setEditRoomData((prev) => ({ ...prev, label: e.target.value }))}
                                                                />
                                                                <Input
                                                                    placeholder="Этаж"
                                                                    value={editRoomData.floor}
                                                                    onChange={(e) => setEditRoomData((prev) => ({ ...prev, floor: e.target.value }))}
                                                                />
                                                                <Input
                                                                    placeholder="Заметка"
                                                                    className="col-span-2 sm:col-span-1"
                                                                    value={editRoomData.notes}
                                                                    onChange={(e) => setEditRoomData((prev) => ({ ...prev, notes: e.target.value }))}
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-white/60">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={editRoomData.isActive}
                                                                        onChange={(e) => setEditRoomData((prev) => ({ ...prev, isActive: e.target.checked }))}
                                                                        className="accent-emerald-400"
                                                                    />
                                                                    Активен
                                                                </label>
                                                                <span className="flex-1" />
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="text-slate-400 hover:text-slate-700 dark:text-white/50 dark:hover:text-white"
                                                                    onClick={() => setEditingRoomId(null)}
                                                                >
                                                                    Отмена
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    disabled={savingRoomId === room.id}
                                                                    onClick={() => handleSaveRoom(room.id)}
                                                                >
                                                                    {savingRoomId === room.id ? 'Сохраняем…' : 'Сохранить'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-slate-200/65 bg-white px-3 py-2.5 dark:border-white/[0.055] dark:bg-white/[0.03]">
                                                            <span className="min-w-0 break-words text-sm font-medium text-slate-900 dark:text-white">№ {room.label}</span>
                                                            {room.floor && <span className="text-[11px] text-slate-400 dark:text-white/30">{room.floor}</span>}
                                                            {room.notes && <span className="max-w-[120px] truncate text-[11px] text-slate-400 dark:text-white/25" title={room.notes}>{room.notes}</span>}
                                                            <Badge
                                                                label={
                                                                    room.status === 'OCCUPIED' ? 'Занят'
                                                                        : room.status === 'DIRTY' ? 'Уборка'
                                                                            : room.status === 'HOLD' ? 'Бронь'
                                                                                : 'Свободен'
                                                                }
                                                                tone={
                                                                    room.status === 'OCCUPIED' ? 'warning'
                                                                        : room.status === 'DIRTY' ? 'danger'
                                                                            : room.status === 'HOLD' ? 'default'
                                                                                : 'success'
                                                                }
                                                            />
                                                            {!room.isActive && <span className="text-[11px] text-rose-300">выкл</span>}
                                                            <span className="min-w-[1rem] flex-1" />
                                                            <button
                                                                type="button"
                                                                className="text-[11px] text-slate-400 transition hover:text-slate-700 dark:text-white/30 dark:hover:text-white"
                                                                onClick={() => handleStartEditRoom(room)}
                                                            >
                                                                ✎
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="text-[11px] text-rose-400/70 transition hover:text-rose-500 dark:text-rose-300/60 dark:hover:text-rose-300"
                                                                onClick={() => handleDeleteRoom(room.id)}
                                                                disabled={removingRoomId === room.id}
                                                            >
                                                                {removingRoomId === room.id ? '…' : '✕'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Card>

                            </div>
                        </div>
                    </div>
                )}
                {isOutflowModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-2 py-4 sm:px-6 sm:py-6">
                        <div className="absolute inset-0 bg-black/70" onClick={closeOutflowModal} />
                        <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.65)] backdrop-blur sm:p-5 dark:border-white/[0.08] dark:bg-[#090d16]/95 dark:text-white">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/35">Детализация расходов</p>
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">Списания №{selectedShift?.number ?? '—'}</h3>
                                    <p className="text-sm font-semibold text-rose-300">{formatCurrency(selectedShiftExpenseOut)}</p>
                                </div>
                                <Button type="button" variant="ghost" size="sm" className="border border-slate-200/80 dark:border-white/10" onClick={closeOutflowModal}>
                                    ×
                                </Button>
                            </div>
                            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                                {selectedShiftOutflows.length ? (
                                    selectedShiftOutflows.map((entry) => {
                                        const note = entry.note?.trim() || null;
                                        const categoryName = entry.category?.name?.trim() || null;
                                        return (
                                            <div key={entry.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-white/60">
                                                    <span>{formatDateTime(entry.recordedAt, hotelTz)}</span>
                                                    <span>{entry.managerName ?? 'Система'}</span>
                                                </div>
                                                <p className="mt-2 text-lg font-semibold text-rose-300">-{formatCurrency(entry.amount)}</p>
                                                <p className="text-xs text-slate-500 dark:text-white/50">{ledgerMethodLabels[entry.method]}</p>
                                                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">{note || categoryName || 'Расход'}</p>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-sm text-slate-400 dark:text-white/30">Нет записей</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};
