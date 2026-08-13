'use client';

import Link from 'next/link';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useForm } from 'react-hook-form';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, TextArea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useApi } from '@/hooks/useApi';
import { formatDateKey, formatDateTime, formatMoney, parseDateOnly } from '@/lib/timezone';
import { useHotelToday } from '@/hooks/useHotelToday';
import { isCollectionLedgerEntry } from '@/lib/ledger';
import { AiAnalysisModal, type AiShiftAnalysisResponse } from '@/components/modules/ai-analysis-modal';
import { RoomEconomicsPanel } from '@/components/modules/room-economics-panel';
import { Archive, Pencil, Trash2 } from 'lucide-react';

type ShiftStatusValue = 'OPEN' | 'CLOSED';
type RoomStatusValue = 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'HOLD';
type StayStatusValue = 'SCHEDULED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
type PaymentMethodValue = 'AUTO' | 'CASH' | 'CARD' | 'ONLINE';
type LedgerEntryTypeValue = 'CASH_IN' | 'CASH_OUT' | 'MANAGER_PAYOUT' | 'ADJUSTMENT';
type LedgerPaymentMethodValue = 'CASH' | 'CARD';
type RoomOverviewMode = 'board' | 'history';
type BoardListPopupKind = 'scheduled' | 'checkedIn' | 'overdue' | 'freeDates';
type AdminAiPeriod = 'week' | 'month' | 'custom';

type PendingOnlineStayDetail = RoomStayDetail & {
    roomId: string;
    roomLabel: string;
    roomFloor?: string | null;
};

type PendingPostpaidStayDetail = PendingOnlineStayDetail & {
    pendingPostpaidAmount?: number | null;
};

interface CursorPagination {
    total: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: string | null;
}

interface StayHistoryPayload {
    stays: Array<{
        roomId: string;
        stay: RoomStayDetail;
    }>;
    pagination: CursorPagination;
}

interface PendingStayPayload<TStay extends PendingOnlineStayDetail> {
    stays: TStay[];
    pagination: CursorPagination;
}

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
    tariffPending?: boolean | null;
    bookingSource?: string | null;
    bookingNumber?: string | null;
    cancellationPaymentAction?: 'REFUND' | 'RETAIN' | null;
    cancellationAmount?: number | null;
    cancelledAt?: string | null;
    shiftId?: string | null;
    shiftNumber?: number | null;
    shiftStatus?: ShiftStatusValue | null;
    shiftOpenedAt?: string | null;
    shiftClosedAt?: string | null;
    shiftManagerName?: string | null;
    groupRef?: string | null;
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
        originalAmount?: number | null;
        originalCurrency?: string | null;
        exchangeRate?: number | null;
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
    originalAmount?: number | null;
    originalCurrency?: string | null;
    exchangeRate?: number | null;
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

interface ShiftLedgerPayload {
    shift?: {
        id: string;
        number: number;
        status: ShiftStatusValue;
    } | null;
    entries: LedgerEntryDetail[];
    summary: {
        totals: {
            cashIn: number;
            cashOut: number;
            payouts: number;
            adjustments: number;
        };
        cashMovement: number;
        incomeBreakdown: {
            stays: { total: number; cash: number; card: number };
            cashbox: { total: number; cash: number; card: number };
        };
        expenseOut: number;
        collections: number;
        collectionOriginals: Array<{ currency: string; amount: number }>;
    } | null;
    pagination: {
        total: number | null;
        limit: number;
        hasMore: boolean;
        nextCursor?: string | null;
    };
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
    pendingPostpaid?: number | null;
    tariffPendingCount?: number | null;
}

type ShiftListItem = ShiftHistoryEntry & { isCurrent: boolean };

interface HotelDetailPayload {
    id: string;
    name: string;
    address: string;
    usesExtranets?: boolean | null;
    extranetNames?: string[];
    hasMealPlan?: boolean | null;
    allowPostpaidStays?: boolean | null;
    allowOnlinePayments?: boolean | null;
    guestQrEnabled?: boolean | null;
    guestDescription?: string | null;
    guestAmenities?: string[];
    guestPhotoUrls?: string[];
    guestMapUrl?: string | null;
    managerSharePct?: number | null;
    notes?: string | null;
    roomCount: number;
    occupiedRooms: number;
    managers: Array<{
        assignmentId: string;
        id: string;
        displayName: string;
        loginName?: string | null;
        hasPin?: boolean;
        shiftPayAmount?: number | null;
        revenueSharePct?: number | null;
        canEditBookings?: boolean | null;
        canEditStayPayments?: boolean | null;
        canCancelBookings?: boolean | null;
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
    employees: Array<{
        id: string;
        fullName: string;
        position: string;
        payType: 'MONTHLY' | 'SHIFT' | 'ROOM' | 'PERCENT' | 'OTHER';
        payAmount: number;
        turnoverThreshold?: number | null;
        highPayAmount?: number | null;
        bonusTiers?: Array<{ id?: string; threshold: number; bonus: number }>;
        isActive: boolean;
        hiredAt?: string | null;
        dismissedAt?: string | null;
        notes?: string | null;
    }>;
    activeShift?: ShiftHistoryEntry | null;
    shiftHistory: ShiftHistoryEntry[];
    prepaidBookings?: {
        count: number;
        total: number;
        items: PendingOnlineStayDetail[];
    };
    timezone?: string | null;
    currency?: string | null;
    financials: {
        cashIn: number;
        cashOut: number;
        collections: number;
        payouts: number;
        adjustments: number;
        pendingOnline?: number;
        pendingPostpaid?: number;
        tariffPendingCount?: number;
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
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
    canEditBookings: boolean;
    canEditStayPayments: boolean;
    canCancelBookings: boolean;
}

interface UpdateManagerForm {
    assignmentId: string;
    displayName: string;
    loginName: string;
    pinCode: string;
    shiftPayAmount?: number;
    revenueSharePct?: number;
    canEditBookings: boolean;
    canEditStayPayments: boolean;
    canCancelBookings: boolean;
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
    cancellationPaymentAction: '' | 'REFUND' | 'RETAIN';
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
    cancellationPaymentAction: '',
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

const dateInputFromDate = (date: Date) => date.toISOString().slice(0, 10);

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
    return new Date(value.getTime() + days * 86_400_000);
};

const formatBoardDay = (value: Date, timezone?: string) =>
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', timeZone: timezone }).format(value).replace('.', '');

const formatBoardWeekday = (value: Date, timezone?: string) =>
    new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: timezone }).format(value).replace('.', '');

const bookingBoardStatusClass: Record<StayStatusValue, string> = {
    SCHEDULED: 'border-cyan-300/60 bg-cyan-500/15 text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-400/12 dark:text-cyan-100',
    CHECKED_IN: 'border-amber-300/70 bg-amber-400/20 text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/14 dark:text-amber-100',
    CHECKED_OUT: 'border-slate-300/80 bg-slate-100 text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white/55',
    CANCELLED: 'border-rose-300/70 bg-rose-50 text-rose-600 dark:border-rose-300/20 dark:bg-rose-500/10 dark:text-rose-200'
};

const tariffPendingBookingBoardClass = 'border-fuchsia-300/70 bg-fuchsia-500/15 text-fuchsia-900 ring-1 ring-fuchsia-200/80 dark:border-fuchsia-300/35 dark:bg-fuchsia-400/14 dark:text-fuchsia-100 dark:ring-fuchsia-300/20';

interface AdminHotelDetailProps {
    hotelId: string;
}

export const AdminHotelDetail = ({ hotelId }: AdminHotelDetailProps) => {
    const { request, get } = useApi();
    const { toast } = useToast();
    const { confirm: requestConfirmation, confirmationDialog } = useConfirmDialog();
    const [bookingBoardStartOffset, setBookingBoardStartOffset] = useState(0);
    const [bookingBoardScale, setBookingBoardScale] = useState<'fit' | 'compact' | 'medium' | 'wide'>('fit');
    const bookingBoardDayCount = bookingBoardScale === 'compact' ? 28 : bookingBoardScale === 'medium' ? 18 : bookingBoardScale === 'wide' ? 14 : 21;
    const bookingBoardHeaderScrollRef = useRef<HTMLDivElement>(null);
    const [draggedBoardStay, setDraggedBoardStay] = useState<{ roomId: string; stay: RoomStayDetail } | null>(null);
    const [dragTargetRoomId, setDragTargetRoomId] = useState<string | null>(null);
    const [isMovingBoardStay, setIsMovingBoardStay] = useState(false);

    useEffect(() => {
        const saved = window.localStorage.getItem('ops-board-scale');
        if (saved === 'fit' || saved === 'compact' || saved === 'medium' || saved === 'wide') setBookingBoardScale(saved);
    }, []);
    const boardRequestRange = useMemo(() => {
        const visibleStart = addDays(startOfLocalDay(new Date()), bookingBoardStartOffset);
        return {
            startAt: addDays(visibleStart, -2).toISOString(),
            endAt: addDays(visibleStart, bookingBoardDayCount + 2).toISOString(),
        };
    }, [bookingBoardDayCount, bookingBoardStartOffset]);

    const hotelKey = hotelId
        ? `/api/hotels/${hotelId}?view=core&boardStartAt=${encodeURIComponent(boardRequestRange.startAt)}&boardEndAt=${encodeURIComponent(boardRequestRange.endAt)}`
        : null;
    const { data, error, isLoading, mutate: mutateHotel } = useSWR<HotelDetailPayload>(
        hotelKey,
        (url: string) => get<HotelDetailPayload>(url),
        { keepPreviousData: true }
    );

    const hotelTz = data?.timezone ?? undefined;
    const hotelTodayKey = useHotelToday(hotelTz);
    const hotelCur = data?.currency ?? undefined;
    const formatCurrency = useCallback((value?: number | null) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return '—';
        return formatMoney(value, hotelCur);
    }, [hotelCur]);
    const formatLedgerAmount = (entry: Pick<LedgerEntryDetail, 'amount' | 'originalAmount' | 'originalCurrency' | 'entryType'>) => {
        const sign = ledgerSignSymbol[entry.entryType];
        if (entry.originalCurrency && entry.originalCurrency !== hotelCur && typeof entry.originalAmount === 'number') {
            const original = `${sign}${formatMoney(entry.originalAmount, entry.originalCurrency)}`;
            return entry.amount ? `${original} / ${formatCurrency(entry.amount)}` : original;
        }
        return `${sign}${formatCurrency(entry.amount)}`;
    };
    const formatShiftAmount = (value?: number | null) => (value == null ? '—' : formatCurrency(value));
    const formatStayDate = (value?: string | null) => formatDateTime(value, hotelTz, undefined, '—');

    const managerForm = useForm<AddManagerForm>({
        defaultValues: { displayName: '', loginName: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined, canEditBookings: false, canEditStayPayments: false, canCancelBookings: false }
    });
    const updateManagerForm = useForm<UpdateManagerForm>({
        defaultValues: {
            assignmentId: '',
            displayName: '',
            loginName: '',
            pinCode: '',
            shiftPayAmount: undefined,
            revenueSharePct: undefined,
            canEditBookings: false,
            canEditStayPayments: false,
            canCancelBookings: false
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
    const {
        data: selectedShiftLedgerPages,
        error: selectedShiftLedgerError,
        isLoading: isSelectedShiftLedgerLoading,
        mutate: mutateSelectedShiftLedger,
        size: selectedShiftLedgerPageCount,
        setSize: setSelectedShiftLedgerPageCount
    } = useSWRInfinite<ShiftLedgerPayload>(
        (_pageIndex, previousPage) => {
            if (!hotelId || !selectedShiftId || (previousPage && !previousPage.pagination.nextCursor)) {
                return null;
            }
            const cursor = previousPage?.pagination.nextCursor;
            return `/api/admin/hotels/${hotelId}/ledger?shiftId=${encodeURIComponent(selectedShiftId)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}&summary=false` : ''}`;
        },
        (url: string) => get<ShiftLedgerPayload>(url),
        { revalidateFirstPage: true }
    );
    const [editingShift, setEditingShift] = useState<ShiftHistoryEntry | null>(null);
    const [editingLedgerEntry, setEditingLedgerEntry] = useState<LedgerEntryDetail | null>(null);
    const [isCreatingShift, setIsCreatingShift] = useState(false);
    const [adminAiAnalysis, setAdminAiAnalysis] = useState<AiShiftAnalysisResponse | null>(null);
    const [adminAiShiftId, setAdminAiShiftId] = useState<string | null>(null);
    const [isAdminAiLoading, setIsAdminAiLoading] = useState(false);
    const [adminAiError, setAdminAiError] = useState<string | null>(null);
    const [isAdminAiModalOpen, setIsAdminAiModalOpen] = useState(false);
    const [adminBusinessAiAnalysis, setAdminBusinessAiAnalysis] = useState<AiShiftAnalysisResponse | null>(null);
    const [adminBusinessAiPeriod, setAdminBusinessAiPeriod] = useState<AdminAiPeriod>('month');
    const [adminBusinessAiStartDate, setAdminBusinessAiStartDate] = useState(() => dateInputFromDate(new Date(Date.now() - 29 * 86_400_000)));
    const [adminBusinessAiEndDate, setAdminBusinessAiEndDate] = useState(() => dateInputFromDate(new Date()));
    const [isAdminBusinessAiLoading, setIsAdminBusinessAiLoading] = useState(false);
    const [adminBusinessAiError, setAdminBusinessAiError] = useState<string | null>(null);
    const [isAdminBusinessAiModalOpen, setIsAdminBusinessAiModalOpen] = useState(false);
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [isDeletingShift, setIsDeletingShift] = useState(false);
    const [confirmDeleteShift, setConfirmDeleteShift] = useState(false);
    const [removingManagerId, setRemovingManagerId] = useState<string | null>(null);
    const [employeeForm, setEmployeeForm] = useState({ fullName: '', position: '', payType: 'MONTHLY', payAmount: '', bonusTiers: [] as Array<{ threshold: string; bonus: string }>, notes: '' });
    const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
    const [savingEmployee, setSavingEmployee] = useState(false);
    const [updatingEmployeeId, setUpdatingEmployeeId] = useState<string | null>(null);
    const [removingRoomId, setRemovingRoomId] = useState<string | null>(null);
    const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
    const [editRoomData, setEditRoomData] = useState<{ label: string; floor: string; notes: string; isActive: boolean }>({ label: '', floor: '', notes: '', isActive: true });
    const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
    const [isRoomListExpanded, setIsRoomListExpanded] = useState(false);
    const [isStayEditorOpen, setIsStayEditorOpen] = useState(false);
    const [selectedStayDetail, setSelectedStayDetail] = useState<RoomStayDetail | null>(null);
    const [loadingStayId, setLoadingStayId] = useState<string | null>(null);
    const [isBookingFormOpen, setIsBookingFormOpen] = useState(false);
    const [isCreatingBooking, setIsCreatingBooking] = useState(false);
    const [confirmingOnlineStayId, setConfirmingOnlineStayId] = useState<string | null>(null);
    const [confirmingBankTransferKey, setConfirmingBankTransferKey] = useState<string | null>(null);
    const [isPendingOnlineHistoryOpen, setIsPendingOnlineHistoryOpen] = useState(false);
    const [isPendingPostpaidHistoryOpen, setIsPendingPostpaidHistoryOpen] = useState(false);
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
        if (selectedStayDetail?.id === stayFormValues.stayId) {
            return selectedStayDetail;
        }
        const room = data.rooms.find((candidate) => candidate.id === stayFormValues.roomId);
        return room?.stays.find((stay) => stay.id === stayFormValues.stayId) ?? null;
    }, [data, selectedStayDetail, stayFormValues.roomId, stayFormValues.stayId]);
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
            updateManagerForm.setValue('canEditBookings', Boolean(selectedManager.canEditBookings));
            updateManagerForm.setValue('canEditStayPayments', Boolean(selectedManager.canEditStayPayments));
            updateManagerForm.setValue('canCancelBookings', Boolean(selectedManager.canCancelBookings));
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
    const dirtyRooms = useMemo(
        () => sortedRooms.filter((room) => room.status === 'DIRTY'),
        [sortedRooms]
    );

    const selectedShift = shiftList.find((shift) => shift.id === selectedShiftId) ?? null;
    const selectedShiftTransactions = useMemo(() => {
        const seen = new Set<string>();
        const entries: LedgerEntryDetail[] = [];
        for (const page of selectedShiftLedgerPages ?? []) {
            for (const entry of page.entries) {
                if (!seen.has(entry.id)) {
                    seen.add(entry.id);
                    entries.push(entry);
                }
            }
        }
        return entries;
    }, [selectedShiftLedgerPages]);
    const selectedShiftLedger = selectedShiftLedgerPages?.[0] ?? null;
    const selectedShiftTransactionTotal = selectedShiftLedger?.pagination.total ?? 0;
    const selectedShiftLedgerLastPage = selectedShiftLedgerPages?.[selectedShiftLedgerPages.length - 1] ?? null;
    const hasMoreSelectedShiftTransactions = Boolean(selectedShiftLedgerLastPage?.pagination.hasMore);
    const isLoadingMoreSelectedShiftTransactions = isSelectedShiftLedgerLoading || (
        selectedShiftLedgerPageCount > 0 &&
        Boolean(selectedShiftLedgerPages) &&
        typeof selectedShiftLedgerPages?.[selectedShiftLedgerPageCount - 1] === 'undefined'
    );

    const selectedShiftCash = useMemo(() => {
        if (!selectedShift || !selectedShiftLedger?.summary) {
            return null;
        }
        const fallbackClosing = selectedShift.openingCash + selectedShiftLedger.summary.cashMovement;
        const currentCash = selectedShift.status === 'CLOSED'
            ? typeof selectedShift.closingCash === 'number'
                ? selectedShift.closingCash
                : fallbackClosing
            : fallbackClosing;
        return {
            openingCash: selectedShift.openingCash,
            currentCash,
            ...selectedShiftLedger.summary.totals
        };
    }, [selectedShift, selectedShiftLedger]);

    const selectedShiftIncomeBreakdown = selectedShiftLedger?.summary?.incomeBreakdown ?? null;

    const selectedShiftOutflows = useMemo(() => {
        if (!selectedShift) {
            return [];
        }
        return selectedShiftTransactions.filter((entry) => entry.entryType === 'CASH_OUT' && !isCollectionLedgerEntry(entry));
    }, [selectedShift, selectedShiftTransactions]);

    const selectedShiftExpenseOut = selectedShiftLedger?.summary?.expenseOut ?? 0;

    const selectedShiftCollections = selectedShiftLedger?.summary?.collections ?? 0;
    const selectedShiftCollectionOriginals = useMemo(
        () => selectedShiftLedger?.summary?.collectionOriginals ?? [],
        [selectedShiftLedger]
    );
    const selectedShiftCollectionsLabel = useMemo(() => {
        const parts = selectedShiftCollections > 0 ? [formatCurrency(selectedShiftCollections)] : [];
        for (const item of selectedShiftCollectionOriginals) {
            parts.push(formatMoney(item.amount, item.currency));
        }
        return parts.length ? parts.join(' + ') : formatCurrency(0);
    }, [formatCurrency, selectedShiftCollectionOriginals, selectedShiftCollections]);

    const prepaidBookings = useMemo(() => {
        if (!data) {
            return [];
        }

        return (data.prepaidBookings?.items ?? []).flatMap((stay) => {
            const room = data.rooms.find((candidate) => candidate.id === stay.roomId);
            return room ? [{ room, stay }] : [];
        });
    }, [data]);
    const prepaidBookingsTotal = data?.prepaidBookings?.total ?? 0;
    const prepaidBookingsCount = data?.prepaidBookings?.count ?? prepaidBookings.length;

    const [isTransactionsExpanded, setIsTransactionsExpanded] = useState(false);
    const [isRoomHistoryExpanded, setIsRoomHistoryExpanded] = useState(false);
    const [isDirtyRoomsOpen, setIsDirtyRoomsOpen] = useState(false);
    const [roomOverviewMode, setRoomOverviewMode] = useState<RoomOverviewMode>('board');
    const roomBoardRef = useRef<HTMLDivElement | null>(null);
    const [boardListPopup, setBoardListPopup] = useState<BoardListPopupKind | null>(null);
    const [stayHistoryQuery, setStayHistoryQuery] = useState('');
    const [stayHistoryStatus, setStayHistoryStatus] = useState<StayHistoryStatusFilter>('ALL');
    const [expandedStayHistoryRooms, setExpandedStayHistoryRooms] = useState<Set<string>>(() => new Set());
    const [isOutflowModalOpen, setIsOutflowModalOpen] = useState(false);
    const [debouncedStayHistoryQuery, setDebouncedStayHistoryQuery] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedStayHistoryQuery(stayHistoryQuery.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [stayHistoryQuery]);

    const {
        data: stayHistoryPages,
        isLoading: isStayHistoryLoading,
        mutate: mutateStayHistory,
        size: stayHistoryPageCount,
        setSize: setStayHistoryPageCount,
    } = useSWRInfinite<StayHistoryPayload>(
        (_pageIndex, previousPage) => {
            if (!hotelId || roomOverviewMode !== 'history' || !isRoomHistoryExpanded || (previousPage && !previousPage.pagination.nextCursor)) {
                return null;
            }
            const cursor = previousPage?.pagination.nextCursor;
            const search = debouncedStayHistoryQuery
                ? `&search=${encodeURIComponent(debouncedStayHistoryQuery)}`
                : '';
            const status = stayHistoryStatus !== 'ALL'
                ? `&status=${encodeURIComponent(stayHistoryStatus)}`
                : '';
            return `/api/hotels/${hotelId}?view=history&limit=50${search}${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        },
        (url: string) => get<StayHistoryPayload>(url),
        { revalidateFirstPage: true }
    );

    const {
        data: pendingOnlinePages,
        isLoading: isPendingOnlineLoading,
        mutate: mutatePendingOnline,
        size: pendingOnlinePageCount,
        setSize: setPendingOnlinePageCount,
    } = useSWRInfinite<PendingStayPayload<PendingOnlineStayDetail>>(
        (_pageIndex, previousPage) => {
            if (!hotelId || !isPendingOnlineHistoryOpen || (previousPage && !previousPage.pagination.nextCursor)) {
                return null;
            }
            const cursor = previousPage?.pagination.nextCursor;
            return `/api/hotels/${hotelId}?view=pending&kind=online&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        },
        (url: string) => get<PendingStayPayload<PendingOnlineStayDetail>>(url),
        { revalidateFirstPage: true }
    );

    const {
        data: pendingPostpaidPages,
        isLoading: isPendingPostpaidLoading,
        mutate: mutatePendingPostpaid,
        size: pendingPostpaidPageCount,
        setSize: setPendingPostpaidPageCount,
    } = useSWRInfinite<PendingStayPayload<PendingPostpaidStayDetail>>(
        (_pageIndex, previousPage) => {
            if (!hotelId || !isPendingPostpaidHistoryOpen || (previousPage && !previousPage.pagination.nextCursor)) {
                return null;
            }
            const cursor = previousPage?.pagination.nextCursor;
            return `/api/hotels/${hotelId}?view=pending&kind=postpaid&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        },
        (url: string) => get<PendingStayPayload<PendingPostpaidStayDetail>>(url),
        { revalidateFirstPage: true }
    );

    const stayHistoryRows = useMemo(() => {
        const uniqueRows = new Map<string, StayHistoryPayload['stays'][number]>();
        for (const page of stayHistoryPages ?? []) {
            for (const row of page.stays) {
                uniqueRows.set(row.stay.id, row);
            }
        }
        return Array.from(uniqueRows.values());
    }, [stayHistoryPages]);
    const pendingOnlineHistory = useMemo(() => {
        const uniqueStays = new Map<string, PendingOnlineStayDetail>();
        for (const page of pendingOnlinePages ?? []) {
            for (const stay of page.stays) {
                uniqueStays.set(stay.id, stay);
            }
        }
        return Array.from(uniqueStays.values());
    }, [pendingOnlinePages]);
    const pendingPostpaidHistory = useMemo(() => {
        const uniqueStays = new Map<string, PendingPostpaidStayDetail>();
        for (const page of pendingPostpaidPages ?? []) {
            for (const stay of page.stays) {
                uniqueStays.set(stay.id, stay);
            }
        }
        return Array.from(uniqueStays.values());
    }, [pendingPostpaidPages]);

    const stayHistoryLastPage = stayHistoryPages?.[stayHistoryPages.length - 1] ?? null;
    const pendingOnlineLastPage = pendingOnlinePages?.[pendingOnlinePages.length - 1] ?? null;
    const pendingPostpaidLastPage = pendingPostpaidPages?.[pendingPostpaidPages.length - 1] ?? null;
    const hasMoreStayHistory = Boolean(stayHistoryLastPage?.pagination.hasMore);
    const hasMorePendingOnline = Boolean(pendingOnlineLastPage?.pagination.hasMore);
    const hasMorePendingPostpaid = Boolean(pendingPostpaidLastPage?.pagination.hasMore);
    const isLoadingMoreStayHistory = isStayHistoryLoading || (stayHistoryPageCount > 0 && Boolean(stayHistoryPages) && typeof stayHistoryPages?.[stayHistoryPageCount - 1] === 'undefined');
    const isLoadingMorePendingOnline = isPendingOnlineLoading || (pendingOnlinePageCount > 0 && Boolean(pendingOnlinePages) && typeof pendingOnlinePages?.[pendingOnlinePageCount - 1] === 'undefined');
    const isLoadingMorePendingPostpaid = isPendingPostpaidLoading || (pendingPostpaidPageCount > 0 && Boolean(pendingPostpaidPages) && typeof pendingPostpaidPages?.[pendingPostpaidPageCount - 1] === 'undefined');

    const mutate = useCallback(async () => {
        const [refreshedHotel] = await Promise.all([
            mutateHotel(),
            mutateSelectedShiftLedger(),
            mutateStayHistory(),
            mutatePendingOnline(),
            mutatePendingPostpaid(),
        ]);
        return refreshedHotel;
    }, [mutateHotel, mutatePendingOnline, mutatePendingPostpaid, mutateSelectedShiftLedger, mutateStayHistory]);

    const handleAdminStayDrop = useCallback(async (targetRoomId: string, targetDay?: Date) => {
        const source = draggedBoardStay;
        setDragTargetRoomId(null);
        setDraggedBoardStay(null);
        if (!source || isMovingBoardStay) return;

        let scheduledCheckIn: string | undefined;
        let scheduledCheckOut: string | undefined;
        if (source.stay.status === 'SCHEDULED' && targetDay) {
            const currentStart = new Date(source.stay.scheduledCheckIn);
            const currentEnd = new Date(source.stay.scheduledCheckOut);
            const dayDelta = startOfLocalDay(targetDay).getTime() - startOfLocalDay(currentStart).getTime();
            scheduledCheckIn = new Date(currentStart.getTime() + dayDelta).toISOString();
            scheduledCheckOut = new Date(currentEnd.getTime() + dayDelta).toISOString();
        }
        if (source.roomId === targetRoomId && !scheduledCheckIn) return;

        const sourceRoomLabel = data?.rooms.find((room) => room.id === source.roomId)?.label ?? '—';
        const targetRoomLabel = data?.rooms.find((room) => room.id === targetRoomId)?.label ?? '—';
        const isGuestTransfer = source.stay.status === 'CHECKED_IN';
        const confirmed = await requestConfirmation({
            title: isGuestTransfer ? 'Подтвердите переселение' : 'Подтвердите перенос брони',
            description: isGuestTransfer
                ? `Гость будет переселён из №${sourceRoomLabel} в №${targetRoomLabel}. Исходный номер перейдёт в уборку.`
                : `№${sourceRoomLabel} → №${targetRoomLabel}${scheduledCheckIn && scheduledCheckOut
                    ? `\nНовые даты: ${formatDateTime(scheduledCheckIn, hotelTz)} — ${formatDateTime(scheduledCheckOut, hotelTz)}`
                    : ''}`,
            confirmLabel: isGuestTransfer ? 'Переселить' : 'Перенести',
        });
        if (!confirmed) return;

        setIsMovingBoardStay(true);
        try {
            await request(`/api/rooms/${source.roomId}/stay`, {
                body: source.stay.status === 'CHECKED_IN'
                    ? {
                        intent: 'transfer',
                        targetRoomId,
                        transferNote: 'Переселение администратором перетаскиванием',
                    }
                    : {
                        intent: 'move-booking',
                        stayId: source.stay.id,
                        targetRoomId,
                        scheduledCheckIn,
                        scheduledCheckOut,
                    },
            });
            toast(source.stay.status === 'CHECKED_IN' ? 'Гость переселён' : 'Бронь перенесена', 'success');
            await mutate();
        } catch (moveError) {
            console.error(moveError);
            toast(moveError instanceof Error ? moveError.message : 'Не удалось выполнить перенос', 'error');
        } finally {
            setIsMovingBoardStay(false);
        }
    }, [data?.rooms, draggedBoardStay, hotelTz, isMovingBoardStay, mutate, request, requestConfirmation, toast]);

    useEffect(() => {
        setIsTransactionsExpanded(false);
        void setSelectedShiftLedgerPageCount(1);
        setIsRoomHistoryExpanded(false);
        setStayHistoryQuery('');
        setStayHistoryStatus('ALL');
        setExpandedStayHistoryRooms(new Set());
        setIsOutflowModalOpen(false);
    }, [selectedShiftId, setSelectedShiftLedgerPageCount]);
    const closeOutflowModal = () => setIsOutflowModalOpen(false);

    const openAdminBoardView = useCallback(() => {
        setRoomOverviewMode('board');
        setBoardListPopup(null);
        window.requestAnimationFrame(() => {
            roomBoardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }, []);

    const bookingBoardDays = useMemo(() => {
        const hotelToday = parseDateOnly(hotelTodayKey, false, hotelTz) ?? startOfLocalDay(new Date());
        const firstDay = addDays(hotelToday, bookingBoardStartOffset);
        return Array.from({ length: bookingBoardDayCount }, (_, index) => addDays(firstDay, index));
    }, [bookingBoardDayCount, bookingBoardStartOffset, hotelTodayKey, hotelTz]);

    const bookingBoardRange = useMemo(() => {
        const start = bookingBoardDays[0] ?? startOfLocalDay(new Date());
        const end = addDays(start, bookingBoardDayCount);
        return { start, end };
    }, [bookingBoardDayCount, bookingBoardDays]);
    const bookingBoardDayWidth = bookingBoardScale === 'compact' ? 52 : bookingBoardScale === 'medium' ? 84 : 118;
    const bookingBoardGridTemplate = bookingBoardScale === 'fit'
        ? `160px repeat(${bookingBoardDayCount}, minmax(60px, 1fr))`
        : `160px repeat(${bookingBoardDayCount}, minmax(${bookingBoardDayWidth}px, 1fr))`;
    const bookingBoardContentWidth = bookingBoardScale === 'fit'
        ? '100%'
        : `${160 + bookingBoardDayCount * bookingBoardDayWidth}px`;

    const bookingBoardRows = useMemo(() => {
        const rangeStart = bookingBoardRange.start.getTime();
        const rangeEnd = bookingBoardRange.end.getTime();
        const rangeStartKey = formatDateKey(bookingBoardRange.start, hotelTz);
        const rangeStartDay = Date.parse(`${rangeStartKey}T00:00:00Z`);

        const now = new Date();

        return sortedRooms.map((room) => {
            const items = (room.stays ?? [])
                .filter((stay) => stay.status === 'SCHEDULED' || stay.status === 'CHECKED_IN')
                .map((stay) => {
                    const stayStart = Date.parse(stay.scheduledCheckIn);
                    const stayEnd = Date.parse(stay.scheduledCheckOut);
                    const effectiveStayEnd = stay.status === 'CHECKED_IN'
                        ? Math.max(stayEnd, now.getTime() + 1)
                        : stayEnd;
                    if (!Number.isFinite(stayStart) || !Number.isFinite(effectiveStayEnd) || effectiveStayEnd <= rangeStart || stayStart >= rangeEnd) {
                        return null;
                    }

                    const stayStartKey = formatDateKey(stay.scheduledCheckIn, hotelTz);
                    const naturalEndKey = formatDateKey(stay.scheduledCheckOut, hotelTz);
                    const effectiveEndKey = stay.status === 'CHECKED_IN' && stayEnd <= now.getTime()
                        ? formatDateKey(addDays(now, 1), hotelTz)
                        : naturalEndKey;
                    const stayStartDay = Date.parse(`${stayStartKey}T00:00:00Z`);
                    const stayEndDay = Date.parse(`${effectiveEndKey}T00:00:00Z`);
                    const startIndex = Math.max(0, Math.floor((stayStartDay - rangeStartDay) / 86400000));
                    const endIndex = Math.min(bookingBoardDayCount, Math.max(startIndex + 1, Math.round((stayEndDay - rangeStartDay) / 86400000)));
                    const span = Math.max(1, endIndex - startIndex);
                    const guestLabel = stay.guestName?.trim() || (stay.status === 'CHECKED_IN' ? 'Гость' : 'Бронь');
                    const checkoutTime = Date.parse(stay.scheduledCheckOut);
                    const isOverdue = stay.status === 'CHECKED_IN' && Number.isFinite(checkoutTime) && checkoutTime < now.getTime();

                    const durationMs = Math.max(stayEnd - stayStart, 1);
                    const progressPct = stay.status === 'CHECKED_IN'
                        ? Math.min(100, Math.max(0, ((now.getTime() - stayStart) / durationMs) * 100))
                        : 0;
                    const elapsedDays = Math.max(0, Math.floor((Math.min(now.getTime(), stayEnd) - stayStart) / 86400000));
                    const remainingDays = Math.max(0, Math.ceil((stayEnd - Math.max(now.getTime(), stayStart)) / 86400000));

                    return {
                        stay,
                        startIndex,
                        span,
                        isOverdue,
                        guestLabel,
                        detailLabel: [
                            stay.bookingNumber?.trim() ? `№ ${stay.bookingNumber.trim()}` : null,
                            stay.tariffPending ? 'тариф уточняется' : stay.totalAmount != null ? `тариф ${formatMoney(stay.totalAmount, hotelCur)}` : null,
                            stay.bookingSource?.trim(),
                            stay.companyName?.trim(),
                            stay.guestPhone?.trim()
                        ].filter(Boolean).join(' · '),
                        progressPct,
                        elapsedDays,
                        remainingDays
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
    }, [bookingBoardDayCount, bookingBoardRange, hotelCur, hotelTz, sortedRooms]);

    const boardStayListItems = useMemo(() => {
        return bookingBoardRows.flatMap((row) =>
            row.items.map((item) => ({
                room: row.room,
                stay: item.stay,
                isOverdue: item.isOverdue,
                guestLabel: item.guestLabel,
                detailLabel: item.detailLabel
            }))
        );
    }, [bookingBoardRows]);

    const boardScheduledItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'SCHEDULED'),
        [boardStayListItems]
    );

    const boardCheckedInItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'CHECKED_IN' && !item.isOverdue),
        [boardStayListItems]
    );

    const boardOverdueItems = useMemo(
        () => boardStayListItems.filter((item) => item.stay.status === 'CHECKED_IN' && item.isOverdue),
        [boardStayListItems]
    );

    const boardFreeDateItems = useMemo(() => {
        return bookingBoardRows.flatMap((row) => {
            const occupiedRanges = row.items
                .map((item) => ({
                    startIndex: item.startIndex,
                    endIndex: Math.min(bookingBoardDayCount, item.startIndex + item.span)
                }))
                .sort((first, second) => first.startIndex - second.startIndex);

            let cursor = 0;
            const gaps: Array<{ room: typeof row.room; startIndex: number; endIndex: number; startDate: Date; endDate: Date }> = [];

            for (const range of occupiedRanges) {
                if (range.startIndex > cursor) {
                    gaps.push({
                        room: row.room,
                        startIndex: cursor,
                        endIndex: range.startIndex,
                        startDate: addDays(bookingBoardRange.start, cursor),
                        endDate: addDays(bookingBoardRange.start, range.startIndex)
                    });
                }
                cursor = Math.max(cursor, range.endIndex);
            }

            if (cursor < bookingBoardDayCount) {
                gaps.push({
                    room: row.room,
                    startIndex: cursor,
                    endIndex: bookingBoardDayCount,
                    startDate: addDays(bookingBoardRange.start, cursor),
                    endDate: addDays(bookingBoardRange.start, bookingBoardDayCount)
                });
            }

            return gaps;
        });
    }, [bookingBoardDayCount, bookingBoardRange.start, bookingBoardRows]);

    const filteredRoomStayHistory = useMemo(() => {
        const query = stayHistoryQuery.trim().toLocaleLowerCase('ru-RU');
        const hasFilters = Boolean(query) || stayHistoryStatus !== 'ALL';
        const lazyStaysByRoom = new Map<string, RoomStayDetail[]>();
        for (const row of stayHistoryRows) {
            const roomStays = lazyStaysByRoom.get(row.roomId) ?? [];
            roomStays.push(row.stay);
            lazyStaysByRoom.set(row.roomId, roomStays);
        }

        return sortedRooms
            .map((room) => {
                const uniqueStays = new Map<string, RoomStayDetail>();
                for (const stay of [...(room.stays ?? []), ...(lazyStaysByRoom.get(room.id) ?? [])]) {
                    uniqueStays.set(stay.id, stay);
                }
                const stays = Array.from(uniqueStays.values())
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
    }, [expandedStayHistoryRooms, sortedRooms, stayHistoryQuery, stayHistoryRows, stayHistoryStatus]);

    const totalFilteredStayHistory = stayHistoryPages?.[0]?.pagination.total
        ?? filteredRoomStayHistory.reduce((total, item) => total + item.total, 0);

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
        if (!await requestConfirmation({
            title: 'Очистить закрытые смены?',
            description: 'История закрытых смен этого объекта будет удалена. Действие нельзя отменить.',
            confirmLabel: 'Очистить',
            tone: 'danger',
        })) {
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
        if (!await requestConfirmation({
            title: 'Удалить менеджера из объекта?',
            description: `${managerName} потеряет доступ к объекту. История смен и рейтинг сохранятся.`,
            confirmLabel: 'Удалить',
            tone: 'danger',
        })) {
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

    const resetEmployeeForm = () => {
        setEmployeeForm({ fullName: '', position: '', payType: 'MONTHLY', payAmount: '', bonusTiers: [], notes: '' });
        setEditingEmployeeId(null);
    };

    const handleEditEmployee = (employee: HotelDetailPayload['employees'][number]) => {
        setEditingEmployeeId(employee.id);
        setEmployeeForm({
            fullName: employee.fullName,
            position: employee.position,
            payType: employee.payType,
            payAmount: String(toMajorValue(employee.payAmount) ?? ''),
            bonusTiers: employee.bonusTiers?.length
                ? employee.bonusTiers.map((tier) => ({
                    threshold: String(toMajorValue(tier.threshold) ?? ''),
                    bonus: String(toMajorValue(tier.bonus) ?? ''),
                }))
                : employee.turnoverThreshold != null && employee.highPayAmount != null
                    ? [{
                        threshold: String(toMajorValue(employee.turnoverThreshold) ?? ''),
                        bonus: String(toMajorValue(Math.max(employee.highPayAmount - employee.payAmount, 0)) ?? ''),
                    }]
                    : [],
            notes: employee.notes ?? '',
        });
    };

    const handleSaveEmployee = async () => {
        const payAmount = toOptionalMinor(Number(employeeForm.payAmount));
        if (!employeeForm.fullName.trim() || !employeeForm.position.trim() || payAmount == null) {
            toast('Заполните имя, должность и оплату сотрудника', 'error');
            return;
        }
        const bonusTiers = employeeForm.payType === 'SHIFT'
            ? employeeForm.bonusTiers.map((tier) => ({
                threshold: toOptionalMinor(Number(tier.threshold)),
                bonus: toOptionalMinor(Number(tier.bonus)),
            }))
            : [];
        if (bonusTiers.some((tier) => tier.threshold == null || tier.bonus == null || tier.threshold <= 0 || tier.bonus <= 0)) {
            toast('Заполните порог кассы и бонус для каждого уровня', 'error');
            return;
        }
        const normalizedBonusTiers = bonusTiers.map((tier) => ({ threshold: tier.threshold!, bonus: tier.bonus! }));
        if (new Set(normalizedBonusTiers.map((tier) => tier.threshold)).size !== normalizedBonusTiers.length) {
            toast('Пороги бонусов не должны повторяться', 'error');
            return;
        }
        setSavingEmployee(true);
        try {
            await request(`/api/admin/hotels/${hotelId}/employees`, {
                method: editingEmployeeId ? 'PATCH' : 'POST',
                body: {
                    ...(editingEmployeeId ? { id: editingEmployeeId } : {}),
                    fullName: employeeForm.fullName.trim(),
                    position: employeeForm.position.trim(),
                    payType: employeeForm.payType,
                    payAmount,
                    turnoverThreshold: null,
                    highPayAmount: null,
                    bonusTiers: normalizedBonusTiers,
                    notes: employeeForm.notes.trim() || null,
                },
            });
            const wasEditing = Boolean(editingEmployeeId);
            resetEmployeeForm();
            mutate();
            toast(wasEditing ? 'Сотрудник обновлён' : 'Сотрудник добавлен', 'success');
        } catch (employeeError) {
            toast(employeeError instanceof Error ? employeeError.message : 'Не удалось сохранить сотрудника', 'error');
        } finally {
            setSavingEmployee(false);
        }
    };

    const handleEmployeeStatus = async (employeeId: string, isActive: boolean) => {
        setUpdatingEmployeeId(employeeId);
        try {
            await request(`/api/admin/hotels/${hotelId}/employees`, {
                method: 'PATCH',
                body: { id: employeeId, isActive },
            });
            mutate();
        } catch (employeeError) {
            toast(employeeError instanceof Error ? employeeError.message : 'Не удалось изменить сотрудника', 'error');
        } finally {
            setUpdatingEmployeeId(null);
        }
    };

    const handleRemoveRoom = async (roomId: string, mode: 'archive' | 'delete') => {
        const room = data?.rooms.find((item) => item.id === roomId);
        const roomLabel = room?.label ? `№ ${room.label}` : 'этот номер';
        if (!await requestConfirmation({
            title: mode === 'archive' ? `Архивировать ${roomLabel}?` : `Удалить ${roomLabel} навсегда?`,
            description: mode === 'archive'
                ? 'Номер будет скрыт из активного списка. История проживания и финансовые данные сохранятся.'
                : 'Удалить можно только пустой номер без броней, проживаний и финансовых операций. Это действие нельзя отменить.',
            confirmLabel: mode === 'archive' ? 'Архивировать' : 'Удалить навсегда',
            tone: 'danger',
        })) {
            return;
        }

        setRemovingRoomId(roomId);
        try {
            await request('/api/rooms', {
                method: 'DELETE',
                body: { roomId, mode }
            });
            mutate();
            toast(mode === 'archive' ? 'Номер перенесён в архив' : 'Номер удалён', 'success');
        } catch (roomError) {
            console.error(roomError);
            toast(
                roomError instanceof Error
                    ? roomError.message
                    : mode === 'archive' ? 'Не удалось архивировать номер' : 'Не удалось удалить номер',
                'error',
            );
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
        if (!await requestConfirmation({
            title: 'Удалить бонусный порог?',
            confirmLabel: 'Удалить',
            tone: 'danger',
        })) {
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
        if (!await requestConfirmation({
            title: 'Удалить категорию расходов?',
            description: categoryName,
            confirmLabel: 'Удалить',
            tone: 'danger',
        })) {
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

        if (!await requestConfirmation({
            title: 'Удалить кассовую операцию?',
            description: 'После удаления балансы смены будут пересчитаны.',
            confirmLabel: 'Удалить операцию',
            tone: 'danger',
        })) {
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
        setSelectedStayDetail(null);
        resetStayEditor();
    };

    const handleOpenBookingForm = (room?: HotelDetailPayload['rooms'][number], startDate?: Date) => {
        const checkIn = startDate ? new Date(startDate) : new Date();
        checkIn.setHours(14, 0, 0, 0);
        if (!startDate && checkIn.getTime() <= Date.now()) {
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
            cancellationPaymentAction: stay.cancellationPaymentAction ?? '',
            notes: stay.notes ?? ''
        });
    };

    const handleSelectStayForEdit = async (room: HotelDetailPayload['rooms'][number], stay: RoomStayDetail) => {
        if (loadingStayId === stay.id) {
            return;
        }

        try {
            setLoadingStayId(stay.id);
            const detail = await get<{ stay: RoomStayDetail }>(
                `/api/hotels/${hotelId}?view=stay&stayId=${encodeURIComponent(stay.id)}`
            );
            setSelectedStayDetail(detail.stay);
            hydrateStayEditor(room, detail.stay);
            setIsStayEditorOpen(true);
            window.setTimeout(() => stayEditForm.setFocus('guestName'), 0);
        } catch (stayDetailError) {
            console.error(stayDetailError);
            toast('Не удалось загрузить детали проживания', 'error');
        } finally {
            setLoadingStayId(null);
        }
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
        const currentPaidMinor = selectedStayForEditor
            ? (selectedStayForEditor.cashPaid ?? 0) + (selectedStayForEditor.cardPaid ?? 0) + (selectedStayForEditor.onlinePaid ?? 0)
            : 0;

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

        if (values.status === 'CANCELLED' && currentPaidMinor > 0 && !values.cancellationPaymentAction) {
            toast('Выберите, вернуть или удержать предоплату', 'error');
            return;
        }

        if (
            values.status === 'CANCELLED' &&
            values.cancellationPaymentAction === 'REFUND' &&
            ((selectedStayForEditor?.cashPaid ?? 0) > 0 || (selectedStayForEditor?.cardPaid ?? 0) > 0) &&
            !activeShiftId
        ) {
            toast('Для возврата наличной или безналичной предоплаты нужна активная смена', 'error');
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
                    totalAmount: totalAmountMinor && totalAmountMinor > 0 ? totalAmountMinor : undefined,
                    paymentMethod: values.paymentMethod === 'AUTO' || values.paymentMethod === 'ONLINE' ? null : values.paymentMethod,
                    shiftId: values.shiftId || null,
                    bookingSource: data?.usesExtranets ? normalizeOptionalText(values.bookingSource) : undefined,
                    bookingNumber,
                    cancellationPaymentAction: values.status === 'CANCELLED' && currentPaidMinor > 0 ? values.cancellationPaymentAction || undefined : undefined,
                    cancellationShiftId: values.status === 'CANCELLED' && values.cancellationPaymentAction === 'REFUND' ? activeShiftId ?? undefined : undefined
                }
            });

            await mutate();
            const updatedRoom = data?.rooms.find((room) => room.id === values.roomId);
            if (updatedRoom) {
                const detail = await get<{ stay: RoomStayDetail }>(
                    `/api/hotels/${hotelId}?view=stay&stayId=${encodeURIComponent(values.stayId)}`
                );
                setSelectedStayDetail(detail.stay);
                hydrateStayEditor(updatedRoom, detail.stay);
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

            await mutate();
            if (stayEditForm.getValues('stayId') === stay.id) {
                const updatedRoom = data?.rooms.find((candidate) => candidate.id === room.id);
                if (updatedRoom) {
                    const detail = await get<{ stay: RoomStayDetail }>(
                        `/api/hotels/${hotelId}?view=stay&stayId=${encodeURIComponent(stay.id)}`
                    );
                    setSelectedStayDetail(detail.stay);
                    hydrateStayEditor(updatedRoom, detail.stay);
                }
            }
            toast('Оплата из экстранета подтверждена', 'success');
        } catch (confirmError) {
            console.error(confirmError);
            toast('Не удалось подтвердить поступление', 'error');
        } finally {
            setConfirmingOnlineStayId(null);
        }
    };

    const handleConfirmBankTransfer = async (stay: PendingPostpaidStayDetail) => {
        const related = stay.groupRef
            ? pendingPostpaidHistory.filter((candidate) => candidate.groupRef === stay.groupRef)
            : [stay];
        const visibleOutstanding = related.reduce((sum, candidate) => sum + (candidate.pendingPostpaidAmount ?? 0), 0);
        if (visibleOutstanding <= 0) return;
        const rawAmount = window.prompt(
            stay.groupRef ? 'Сумма перевода от компании по всей группе' : 'Сумма перевода от компании',
            String(visibleOutstanding / 100)
        );
        if (rawAmount == null) return;
        const amount = toMinor(Number(rawAmount.replace(',', '.')));
        if (!Number.isFinite(amount) || amount <= 0) {
            toast('Укажите корректную сумму перевода', 'error');
            return;
        }
        const reference = window.prompt('Номер платежа или комментарий банка (необязательно)', '') ?? '';
        const key = stay.groupRef ?? stay.id;
        try {
            setConfirmingBankTransferKey(key);
            const result = await request<{ outstandingAfter: number }>(`/api/admin/hotels/${hotelId}/bank-transfer`, {
                method: 'POST',
                body: {
                    groupRef: stay.groupRef ?? undefined,
                    stayId: stay.groupRef ? undefined : stay.id,
                    amount,
                    receivedAt: new Date().toISOString(),
                    reference: reference.trim() || undefined,
                },
            });
            await Promise.all([mutate(), mutatePendingPostpaid()]);
            toast(result.outstandingAfter > 0 ? `Перевод подтверждён · остаток ${formatCurrency(result.outstandingAfter)}` : 'Банковский перевод подтверждён, постоплата закрыта', 'success');
        } catch (error) {
            console.error(error);
            toast(error instanceof Error ? error.message : 'Не удалось подтвердить банковский перевод', 'error');
        } finally {
            setConfirmingBankTransferKey(null);
        }
    };

    const handleAddManager = managerForm.handleSubmit(async (values) => {
        const shiftPayAmount = toOptionalMinorValue(values.shiftPayAmount);
        const revenueSharePct = normalizePercentage(values.revenueSharePct);

        await request('/api/hotel-assignments', {
            body: {
                hotelId,
                displayName: values.displayName.trim(),
                loginName: values.loginName.trim().toLowerCase(),
                pinCode: values.pinCode,
                shiftPayAmount: shiftPayAmount ?? undefined,
                revenueSharePct: revenueSharePct ?? undefined,
                canEditBookings: values.canEditBookings,
                canEditStayPayments: values.canEditStayPayments,
                canCancelBookings: values.canCancelBookings
            }
        });
        managerForm.reset({ displayName: '', loginName: '', pinCode: '', shiftPayAmount: undefined, revenueSharePct: undefined, canEditBookings: false, canEditStayPayments: false, canCancelBookings: false });
        mutate();
    });

    const handleUpdateManager = updateManagerForm.handleSubmit(async (values) => {
        const shiftPayAmount = toOptionalMinorValue(values.shiftPayAmount);
        const revenueSharePct = normalizePercentage(values.revenueSharePct);

        const payload = {
            assignmentId: values.assignmentId,
            displayName: values.displayName.trim() || undefined,
            loginName: values.loginName.trim().toLowerCase() || undefined,
            pinCode: values.pinCode.trim() || undefined,
            shiftPayAmount: shiftPayAmount ?? undefined,
            revenueSharePct: revenueSharePct ?? undefined,
            canEditBookings: values.canEditBookings,
            canEditStayPayments: values.canEditStayPayments,
            canCancelBookings: values.canCancelBookings
        };

        const hasUpdates =
            Boolean(payload.displayName) ||
            Boolean(payload.loginName) ||
            Boolean(payload.pinCode) ||
            shiftPayAmount !== null ||
            revenueSharePct !== null ||
            values.canEditBookings !== Boolean(selectedManager?.canEditBookings) ||
            values.canEditStayPayments !== Boolean(selectedManager?.canEditStayPayments) ||
            values.canCancelBookings !== Boolean(selectedManager?.canCancelBookings);

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
                pinCode: '',
                shiftPayAmount: undefined,
                revenueSharePct: undefined,
                canEditBookings: values.canEditBookings,
                canEditStayPayments: values.canEditStayPayments,
                canCancelBookings: values.canCancelBookings
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
            pinCode: '',
            shiftPayAmount: target?.shiftPayAmount != null ? toMajorValue(target.shiftPayAmount) : undefined,
            revenueSharePct: target?.revenueSharePct ?? undefined,
            canEditBookings: Boolean(target?.canEditBookings),
            canEditStayPayments: Boolean(target?.canEditStayPayments),
            canCancelBookings: Boolean(target?.canCancelBookings)
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
            <div className="workspace-page flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f6f7f9] py-4 text-center text-rose-700 dark:bg-[#0c0f13] dark:text-rose-200">
                <p className="text-lg font-semibold">Не удалось загрузить данные объекта</p>
                <p className="text-sm text-rose-600/80 dark:text-rose-100/70">{String(error)}</p>
                <Button type="button" variant="secondary" onClick={() => mutate()}>
                    Повторить запрос
                </Button>
            </div>
        );
    }

    if (!data || isLoading) {
        return (
            <div className="workspace-page flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f9] py-4 text-center text-slate-500 dark:bg-[#0c0f13] dark:text-white/70">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-64" />
                <p className="text-sm">Загружаем актуальные данные отеля…</p>
            </div>
        );
    }

    const occupancyRate = data.roomCount ? Math.round((data.occupiedRooms / data.roomCount) * 100) : 0;
    const managerCount = data.managers.length;
    const activeShiftLabel = data.activeShift ? `Смена №${data.activeShift.number}` : 'Нет активной смены';
    const pendingOnlineValue = data.financials.pendingOnline ?? 0;
    const pendingPostpaidValue = data.financials.pendingPostpaid ?? 0;
    const tariffPendingCount = data.financials.tariffPendingCount ?? 0;
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
                label: 'На старте',
                value: formatCurrency(selectedShiftCash.openingCash),
                valueClass: 'text-slate-900 dark:text-white'
            },
            {
                label: 'Поступления',
                value: formatCurrency(selectedShiftCash.cashIn),
                valueClass: 'text-emerald-600 dark:text-emerald-300'
            },
            {
                label: 'Списания',
                value: formatCurrency(selectedShiftExpenseOut),
                valueClass: selectedShiftExpenseOut > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'
            },
            {
                label: 'Инкассация',
                value: selectedShiftCollectionsLabel,
                valueClass: 'text-slate-900 dark:text-white'
            },
            {
                label: 'Экстранеты',
                value: formatCurrency(selectedShift.pendingOnline ?? 0),
                valueClass: (selectedShift.pendingOnline ?? 0) > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-900 dark:text-white'
            },
            {
                label: 'Компании',
                value: `${formatCurrency(selectedShift.pendingPostpaid ?? 0)}${selectedShift.tariffPendingCount ? ` · ${selectedShift.tariffPendingCount} без тарифа` : ''}`,
                valueClass: (selectedShift.pendingPostpaid ?? 0) > 0 || (selectedShift.tariffPendingCount ?? 0) > 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-900 dark:text-white'
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
    const handleAnalyzeSelectedShift = async () => {
        if (!selectedShift) {
            return;
        }

        setIsAdminAiLoading(true);
        setAdminAiError(null);
        try {
            const analysis = await request<AiShiftAnalysisResponse>(`/api/admin/shifts/${selectedShift.id}/ai-analysis`);
            setAdminAiAnalysis(analysis);
            setAdminAiShiftId(selectedShift.id);
            setIsAdminAiModalOpen(true);
        } catch (error) {
            setAdminAiError(error instanceof Error ? error.message : 'Не удалось получить AI анализ');
        } finally {
            setIsAdminAiLoading(false);
        }
    };
    const handleAnalyzeBusiness = async () => {
        setIsAdminBusinessAiLoading(true);
        setAdminBusinessAiError(null);
        try {
            const analysis = await request<AiShiftAnalysisResponse>(`/api/admin/hotels/${data.id}/ai-analysis`, {
                body: {
                    period: adminBusinessAiPeriod,
                    startDate: adminBusinessAiPeriod === 'custom' ? adminBusinessAiStartDate : null,
                    endDate: adminBusinessAiPeriod === 'custom' ? adminBusinessAiEndDate : null
                }
            });
            setAdminBusinessAiAnalysis(analysis);
            setIsAdminBusinessAiModalOpen(true);
        } catch (error) {
            setAdminBusinessAiError(error instanceof Error ? error.message : 'Не удалось получить AI аудит объекта');
        } finally {
            setIsAdminBusinessAiLoading(false);
        }
    };
    const formLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/40';
    const formPanelClass = 'mt-4 rounded-xl border p-4 sm:mt-5 sm:p-5';
    const modalLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/35';

    return (
        <>
            <div className="workspace-page flex min-h-screen w-full flex-col gap-4 bg-[#f6f7f9] pb-24 pt-4 text-slate-800 dark:bg-[#0c0f13] dark:text-slate-200 lg:gap-5 lg:py-5">
                <Card className="overflow-hidden border-slate-200/80 bg-white p-0 shadow-sm dark:border-white/[0.07] dark:bg-[#171b21] dark:shadow-none">
                    <div className="flex flex-col gap-4 p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                            <div className="min-w-0 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/45">
                                    <span>Объект</span>
                                    {data.timezone && <span>{data.timezone}</span>}
                                    {hotelCur && <span>{hotelCur}</span>}
                                </div>
                                <div className="space-y-2">
                                    <h1 className="break-words text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl dark:text-white">{data.name}</h1>
                                    <p className="max-w-2xl text-sm text-slate-600 dark:text-white/65">{data.address}</p>
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

                        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 dark:border-white/[0.07] dark:bg-white/[0.07]">
                            <div className="grid gap-px md:grid-cols-2 xl:grid-cols-4">
                                {summaryCards.map((item) => (
                                    <div
                                        key={item.label}
                                        className="min-w-0 bg-slate-50 px-3.5 py-3 dark:bg-[#171b21]"
                                    >
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/40">{item.label}</p>
                                    <p className="mt-1.5 break-words text-lg font-semibold tracking-tight text-slate-950 dark:text-white">{item.value}</p>
                                    <p className="mt-1 break-words text-xs text-slate-600 dark:text-white/55">
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
                                                    {formatCurrency(pendingOnlineValue)} экстранеты
                                                </button>
                                                {' · '}
                                                <button
                                                    type="button"
                                                    className={`rounded-lg px-1.5 py-0.5 font-semibold transition ${pendingPostpaidValue > 0 || tariffPendingCount > 0 ? 'text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800 dark:text-cyan-200 dark:hover:bg-cyan-300/10 dark:hover:text-cyan-100' : 'cursor-default text-slate-400 dark:text-white/40'}`}
                                                    onClick={() => (pendingPostpaidValue > 0 || tariffPendingCount > 0) && setIsPendingPostpaidHistoryOpen((current) => !current)}
                                                    disabled={pendingPostpaidValue <= 0 && tariffPendingCount <= 0}
                                                    aria-expanded={isPendingPostpaidHistoryOpen}
                                                >
                                                    {formatCurrency(pendingPostpaidValue)} компании{tariffPendingCount > 0 ? ` · ${tariffPendingCount} без тарифа` : ''}
                                                </button>
                                            </>
                                        ) : null}
                                    </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50 p-3.5 shadow-sm sm:p-4 dark:border-cyan-300/15 dark:bg-cyan-400/[0.07] dark:text-cyan-50 dark:shadow-none">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-950 dark:text-cyan-50">AI аудит объекта</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-cyan-50/65">
                                        Финансы, риски, источники заселений, extranet, расходы и контроль качества данных.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-black/15">
                                        {([
                                            ['week', '7 дней'],
                                            ['month', '30 дней'],
                                            ['custom', 'Период']
                                        ] as Array<[AdminAiPeriod, string]>).map(([value, label]) => (
                                            <button
                                                key={value}
                                                type="button"
                                                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${adminBusinessAiPeriod === value
                                                    ? 'bg-slate-900 text-white dark:bg-cyan-200 dark:text-slate-950'
                                                    : 'text-slate-500 hover:bg-white dark:text-white/55 dark:hover:bg-white/[0.06]'}`}
                                                onClick={() => setAdminBusinessAiPeriod(value)}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {adminBusinessAiPeriod === 'custom' ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                type="date"
                                                value={adminBusinessAiStartDate}
                                                onChange={(event) => setAdminBusinessAiStartDate(event.target.value)}
                                                className="h-9 text-xs"
                                            />
                                            <Input
                                                type="date"
                                                value={adminBusinessAiEndDate}
                                                onChange={(event) => setAdminBusinessAiEndDate(event.target.value)}
                                                className="h-9 text-xs"
                                            />
                                        </div>
                                    ) : null}
                                    <div className="flex gap-2">
                                        {adminBusinessAiAnalysis ? (
                                            <Button type="button" size="sm" variant="ghost" onClick={() => setIsAdminBusinessAiModalOpen(true)}>
                                                Открыть аудит
                                            </Button>
                                        ) : null}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleAnalyzeBusiness()} disabled={isAdminBusinessAiLoading}>
                                            {isAdminBusinessAiLoading ? 'Анализ...' : 'Провести аудит'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            {adminBusinessAiError ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-200">{adminBusinessAiError}</p> : null}
                        </div>
                        {isPendingOnlineHistoryOpen ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-50">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100/60">Оплаты из экстранетов</p>
                                        <p className="mt-1 text-lg font-semibold">{formatCurrency(pendingOnlineValue)}</p>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-50 dark:hover:bg-amber-300/10 dark:hover:text-white" onClick={() => setIsPendingOnlineHistoryOpen(false)}>
                                        Скрыть
                                    </Button>
                                </div>
                                {isPendingOnlineLoading && !pendingOnlinePages ? (
                                    <p className="mt-4 rounded-2xl border border-amber-200/80 bg-white px-3 py-3 text-sm text-amber-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-amber-50/70">
                                        Загружаем поступления…
                                    </p>
                                ) : pendingOnlineHistory.length ? (
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
                                                                <Badge label="Экстранет" tone="warning" />
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
                                                                {confirmingOnlineStayId === stay.id ? 'Подтверждаем...' : 'Подтвердить оплату экстранета'}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {hasMorePendingOnline ? (
                                            <div className="flex justify-center pt-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={isLoadingMorePendingOnline}
                                                    onClick={() => void setPendingOnlinePageCount((count) => count + 1)}
                                                >
                                                    {isLoadingMorePendingOnline ? 'Загрузка…' : 'Показать ещё'}
                                                </Button>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <p className="mt-4 rounded-2xl border border-amber-200/80 bg-white px-3 py-3 text-sm text-amber-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-amber-50/70">
                                        Ожидающих поступлений нет.
                                    </p>
                                )}
                            </div>
                        ) : null}
                        {isPendingPostpaidHistoryOpen ? (
                            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-900 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-50">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-900/55 dark:text-cyan-100/60">Оплаты от компаний</p>
                                        <p className="mt-1 text-lg font-semibold">{formatCurrency(pendingPostpaidValue)}</p>
                                        {tariffPendingCount > 0 ? <p className="mt-1 text-xs text-cyan-800/70 dark:text-cyan-100/70">{tariffPendingCount} заселений без тарифа</p> : null}
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="text-cyan-700 hover:bg-cyan-100 hover:text-cyan-900 dark:text-cyan-50 dark:hover:bg-cyan-300/10 dark:hover:text-white" onClick={() => setIsPendingPostpaidHistoryOpen(false)}>
                                        Скрыть
                                    </Button>
                                </div>
                                {isPendingPostpaidLoading && !pendingPostpaidPages ? (
                                    <p className="mt-4 rounded-2xl border border-cyan-200/80 bg-white px-3 py-3 text-sm text-cyan-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-cyan-50/70">
                                        Загружаем постоплаты…
                                    </p>
                                ) : pendingPostpaidHistory.length ? (
                                    <div className="mt-4 max-h-[440px] space-y-2 overflow-y-auto pr-1">
                                        {pendingPostpaidHistory.map((stay) => {
                                            const guestLabel = stay.guestName?.trim() || 'Гость';
                                            const roomForEdit = data.rooms.find((room) => room.id === stay.roomId);
                                            const confirmationKey = stay.groupRef ?? stay.id;
                                            const showBankTransferAction = !stay.tariffPending && (
                                                !stay.groupRef || pendingPostpaidHistory.findIndex((candidate) => candidate.groupRef === stay.groupRef) === pendingPostpaidHistory.indexOf(stay)
                                            );
                                            const detailLine = [
                                                stay.companyName?.trim() ? `компания ${stay.companyName.trim()}` : null,
                                                stay.totalAmount != null ? `тариф ${formatCurrency(stay.totalAmount)}` : 'тариф уточняется',
                                                stay.bookingNumber?.trim() ? `бронь № ${stay.bookingNumber.trim()}` : null,
                                                stay.shiftNumber ? `смена №${stay.shiftNumber}` : null,
                                                stay.shiftManagerName
                                            ].filter(Boolean).join(' · ');

                                            return (
                                                <div key={`pending-postpaid-${stay.id}`} className="rounded-2xl border border-cyan-200/80 bg-white px-3 py-3 dark:border-cyan-200/20 dark:bg-black/15">
                                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="rounded-lg bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-800 dark:bg-white/10 dark:text-cyan-50">№ {stay.roomLabel}</span>
                                                                <span className="text-sm font-semibold text-slate-950 dark:text-white">{guestLabel}</span>
                                                                <Badge label={stay.tariffPending ? 'Тариф компании уточняется' : 'Компания · постоплата'} tone={stay.tariffPending ? 'warning' : 'default'} />
                                                                {stay.status === 'CHECKED_OUT' ? <Badge label="Выселен" tone="danger" /> : null}
                                                            </div>
                                                            <p className="mt-2 text-xs text-cyan-700 dark:text-cyan-50/70">
                                                                {formatStayDate(stay.actualCheckIn ?? stay.scheduledCheckIn)} — {formatStayDate(stay.actualCheckOut ?? stay.scheduledCheckOut)}
                                                            </p>
                                                            {detailLine ? <p className="mt-1 text-xs text-cyan-700/75 dark:text-cyan-50/55">{detailLine}</p> : null}
                                                            {stay.notes?.trim() ? <p className="mt-1 text-xs text-cyan-700/75 dark:text-cyan-50/55">{stay.notes.trim()}</p> : null}
                                                        </div>
                                                        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                                                            <span className="text-sm font-semibold text-cyan-800 dark:text-cyan-100">{stay.tariffPending ? 'Сумма неизвестна' : formatCurrency(stay.pendingPostpaidAmount ?? 0)}</span>
                                                            {showBankTransferAction ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    disabled={confirmingBankTransferKey === confirmationKey}
                                                                    onClick={() => void handleConfirmBankTransfer(stay)}
                                                                >
                                                                    {confirmingBankTransferKey === confirmationKey
                                                                        ? 'Подтверждаем…'
                                                                        : stay.groupRef ? 'Подтвердить перевод компании за группу' : 'Подтвердить перевод от компании'}
                                                                </Button>
                                                            ) : null}
                                                            {roomForEdit ? (
                                                                <Button type="button" size="sm" variant="secondary" onClick={() => handleSelectStayForEdit(roomForEdit, stay)}>
                                                                    Открыть
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {hasMorePendingPostpaid ? (
                                            <div className="flex justify-center pt-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={isLoadingMorePendingPostpaid}
                                                    onClick={() => void setPendingPostpaidPageCount((count) => count + 1)}
                                                >
                                                    {isLoadingMorePendingPostpaid ? 'Загрузка…' : 'Показать ещё'}
                                                </Button>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <p className="mt-4 rounded-2xl border border-cyan-200/80 bg-white px-3 py-3 text-sm text-cyan-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-cyan-50/70">
                                        Постоплаты и тарифов на уточнении нет.
                                    </p>
                                )}
                            </div>
                        ) : null}
                        {prepaidBookingsCount > 0 ? (
                            <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 text-cyan-900 dark:border-cyan-300/15 dark:bg-cyan-400/[0.06] dark:text-cyan-50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-baseline gap-3">
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-700/60 dark:text-cyan-100/50">Предоплаты по броням</p>
                                        <p className="text-base font-semibold">{formatCurrency(prepaidBookingsTotal)}</p>
                                    </div>
                                    <span className="text-xs text-cyan-800/60 dark:text-cyan-50/45">{prepaidBookingsCount} броней</span>
                                </div>
                                <div className="mt-3 overflow-hidden rounded-xl border border-cyan-200/70 bg-white/70 dark:border-cyan-200/10 dark:bg-black/10">
                                    {prepaidBookings.map(({ room, stay }) => {
                                        const paymentParts = [
                                            (stay.cashPaid ?? 0) > 0 ? `нал ${formatCurrency(stay.cashPaid)}` : null,
                                            (stay.cardPaid ?? 0) > 0 ? `безнал ${formatCurrency(stay.cardPaid)}` : null,
                                            (stay.onlinePaid ?? 0) > 0 ? `онлайн ${formatCurrency(stay.onlinePaid)}` : null
                                        ].filter(Boolean).join(' · ');
                                        const guestLabel = stay.guestName?.trim() || 'Гость';
                                        const bookingContext = [
                                            stay.bookingNumber?.trim() ? `бронь № ${stay.bookingNumber.trim()}` : null,
                                            stay.tariffPending ? 'тариф уточняется' : stay.totalAmount != null ? `тариф ${formatCurrency(stay.totalAmount)}` : null
                                        ].filter(Boolean).join(' · ');

                                        return (
                                            <button
                                                key={`prepaid-booking-${stay.id}`}
                                                type="button"
                                                className="grid w-full min-w-0 gap-x-3 gap-y-1 border-b border-cyan-200/60 px-3 py-2 text-left transition last:border-b-0 hover:bg-cyan-100/60 dark:border-cyan-200/10 dark:hover:bg-cyan-300/[0.06] sm:grid-cols-[3.5rem_minmax(9rem,1fr)_minmax(13rem,1.2fr)_auto] sm:items-center"
                                                onClick={() => handleSelectStayForEdit(room, stay)}
                                            >
                                                <span className="w-fit rounded-md bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-800 dark:bg-white/[0.06] dark:text-cyan-50/80">
                                                    № {room.label}
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{guestLabel}</p>
                                                    {bookingContext ? (
                                                        <p className="truncate text-[11px] text-cyan-800/55 dark:text-cyan-50/40">{bookingContext}</p>
                                                    ) : null}
                                                </div>
                                                <p className="text-xs text-cyan-800/70 dark:text-cyan-50/55">
                                                    {formatStayDate(stay.scheduledCheckIn)} — {formatStayDate(stay.scheduledCheckOut)}
                                                </p>
                                                <div className="min-w-0 sm:text-right">
                                                    <p className="text-sm font-semibold text-cyan-800 dark:text-cyan-100">{formatCurrency(stay.amountPaid ?? 0)}</p>
                                                    {paymentParts ? <p className="truncate text-[11px] text-cyan-800/55 dark:text-cyan-50/40">{paymentParts}</p> : null}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {prepaidBookingsCount > prepaidBookings.length ? (
                                    <p className="mt-3 text-xs text-cyan-800/70 dark:text-cyan-50/55">
                                        Показаны ближайшие 6. Полный список доступен в истории броней.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </Card>

                <RoomEconomicsPanel
                    hotelId={data.id}
                    currency={data.currency ?? 'KGS'}
                    timezone={data.timezone ?? 'Asia/Bishkek'}
                    rooms={data.rooms.map((room) => ({
                        id: room.id,
                        label: room.label,
                        floor: room.floor ?? undefined,
                        isActive: room.isActive,
                    }))}
                    expenseCategories={data.expenseCategories ?? []}
                    onChanged={() => { void mutateHotel(); }}
                />

                <Card className="space-y-4 overflow-visible p-4 sm:p-5">
                    <div className="w-full">
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
                    </div>
                    {shiftList.length ? (
                        <div className="space-y-4">
                            <div className="w-full">
                                <label className="sr-only" htmlFor="admin-shift-select">Выбор смены</label>
                                <Select
                                    id="admin-shift-select"
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
                            <div className="min-w-0">
                                {selectedShift ? (
                                    <>
                                        <div className="w-full space-y-4">
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-white/70">
                                                            <Badge label={`Смена №${selectedShift.number}`} />
                                                            <Badge
                                                                label={selectedShift.status === 'CLOSED' ? 'Закрыта' : 'Открыта'}
                                                                tone={selectedShift.status === 'CLOSED' ? 'success' : 'warning'}
                                                            />
                                                            {selectedShift.isCurrent && <Badge label="Текущая" tone="warning" />}
                                                        </div>
                                                        <p className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white sm:text-lg">{selectedShift.manager}</p>
                                                        <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-white/60">
                                                            <p>Открыта {formatDateTime(selectedShift.openedAt, hotelTz)}</p>
                                                            {selectedShift.closedAt && <p>Закрыта {formatDateTime(selectedShift.closedAt, hotelTz)}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                                                        <div className="min-w-[140px] text-right">
                                                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400 dark:text-white/35">Касса сейчас</p>
                                                            <p className="mt-0.5 text-xl font-semibold text-emerald-600 dark:text-emerald-300">{selectedShiftCash ? formatCurrency(selectedShiftCash.currentCash) : '—'}</p>
                                                            {selectedShift.handoverCash != null && (
                                                                <p className="text-[11px] text-slate-500 dark:text-white/50">Передано {formatShiftAmount(selectedShift.handoverCash)}</p>
                                                            )}
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            onClick={() => {
                                                                if (adminAiAnalysis && adminAiShiftId === selectedShift.id) {
                                                                    setIsAdminAiModalOpen(true);
                                                                    return;
                                                                }
                                                                void handleAnalyzeSelectedShift();
                                                            }}
                                                            disabled={isAdminAiLoading}
                                                        >
                                                            {isAdminAiLoading
                                                                ? 'Анализ...'
                                                                : adminAiAnalysis && adminAiShiftId === selectedShift.id
                                                                    ? 'Открыть AI-отчёт'
                                                                    : 'AI-анализ'}
                                                        </Button>
                                                    </div>
                                                </div>
                                                {adminAiError ? <p className="px-1 text-xs text-rose-600 dark:text-rose-300">{adminAiError}</p> : null}

                                                {shiftQuickStats.length ? (
                                                    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 dark:border-white/[0.07] dark:bg-white/[0.07]">
                                                        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
                                                        {shiftQuickStats.map((item) => (
                                                            <div
                                                                key={item.label}
                                                                className="min-w-0 bg-slate-50 px-3.5 py-3 dark:bg-[#171b21]"
                                                            >
                                                                <p className="text-xs font-medium text-slate-500 dark:text-white/40">{item.label}</p>
                                                                <p className={`mt-1 truncate text-base font-semibold ${item.valueClass}`} title={item.value}>{item.value}</p>
                                                            </div>
                                                        ))}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.07] dark:bg-white/[0.02]">
                                                    <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.07]">
                                                        <div>
                                                            <p className="text-base font-semibold text-slate-900 dark:text-white">Движение средств</p>
                                                            <p className="mt-0.5 text-xs text-slate-500 dark:text-white/40">Деньги, зафиксированные в этой смене</p>
                                                        </div>
                                                        <p className="shrink-0 text-base font-semibold text-emerald-600 dark:text-emerald-300">
                                                            {isSelectedShiftLedgerLoading ? 'Загрузка…' : `+${formatCurrency(selectedShiftCash?.cashIn ?? 0)}`}
                                                        </p>
                                                    </div>

                                                    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
                                                        <div className="min-w-0">
                                                            {selectedShiftLedgerError ? (
                                                                <div className="flex items-center justify-between gap-3 px-3 py-4 text-xs text-rose-600 dark:text-rose-300">
                                                                    <span>Не удалось загрузить кассу выбранной смены.</span>
                                                                    <Button type="button" size="sm" variant="ghost" onClick={() => void mutateSelectedShiftLedger()}>Повторить</Button>
                                                                </div>
                                                            ) : isSelectedShiftLedgerLoading ? (
                                                                <p className="px-3 py-4 text-xs text-slate-500 dark:text-white/40">Загружаем точную сводку смены…</p>
                                                            ) : selectedShiftIncomeBreakdown ? (
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full min-w-[560px] text-left text-sm">
                                                                        <thead className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-white/[0.025] dark:text-white/40">
                                                                            <tr>
                                                                                <th className="px-4 py-2.5 font-medium">Источник</th>
                                                                                <th className="px-4 py-2.5 text-right font-medium">Наличные</th>
                                                                                <th className="px-4 py-2.5 text-right font-medium">Безналично</th>
                                                                                <th className="px-4 py-2.5 text-right font-medium">Итого</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-200/70 text-slate-700 dark:divide-white/[0.06] dark:text-white/70">
                                                                            <tr>
                                                                                <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">Заселения</td>
                                                                                <td className="px-4 py-2.5 text-right">{formatCurrency(selectedShiftIncomeBreakdown.stays.cash)}</td>
                                                                                <td className="px-4 py-2.5 text-right">{formatCurrency(selectedShiftIncomeBreakdown.stays.card)}</td>
                                                                                <td className="px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-white">{formatCurrency(selectedShiftIncomeBreakdown.stays.total)}</td>
                                                                            </tr>
                                                                            <tr>
                                                                                <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">Кассовые операции</td>
                                                                                <td className="px-4 py-2.5 text-right">{formatCurrency(selectedShiftIncomeBreakdown.cashbox.cash)}</td>
                                                                                <td className="px-4 py-2.5 text-right">{formatCurrency(selectedShiftIncomeBreakdown.cashbox.card)}</td>
                                                                                <td className="px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-white">{formatCurrency(selectedShiftIncomeBreakdown.cashbox.total)}</td>
                                                                            </tr>
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <p className="px-3 py-4 text-xs text-slate-500 dark:text-white/40">Поступлений в этой смене нет.</p>
                                                            )}

                                                            {(selectedShift.pendingOnline ?? 0) > 0 ? (
                                                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/15 dark:bg-amber-400/[0.07] dark:text-amber-200">
                                                                    <span><span className="font-medium">Оплата из экстранета</span> · не входит в кассу до подтверждения</span>
                                                                    <span className="font-semibold">{formatCurrency(selectedShift.pendingOnline)}</span>
                                                                </div>
                                                            ) : null}
                                                            {((selectedShift.pendingPostpaid ?? 0) > 0 || (selectedShift.tariffPendingCount ?? 0) > 0) ? (
                                                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cyan-200/80 bg-cyan-50/70 px-3 py-2 text-xs text-cyan-800 dark:border-cyan-400/15 dark:bg-cyan-400/[0.07] dark:text-cyan-200">
                                                                    <span><span className="font-medium">Оплата от компании</span>{selectedShift.tariffPendingCount ? ` · ${selectedShift.tariffPendingCount} без тарифа` : ''}</span>
                                                                    <span className="font-semibold">{formatCurrency(selectedShift.pendingPostpaid ?? 0)}</span>
                                                                </div>
                                                            ) : null}
                                                        </div>

                                                        <div className="divide-y divide-slate-200/70 border-t border-slate-200/80 text-sm dark:divide-white/[0.06] dark:border-white/[0.07] lg:border-l lg:border-t-0">
                                                            <button
                                                                type="button"
                                                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:cursor-default dark:hover:bg-white/[0.035]"
                                                                onClick={() => selectedShiftExpenseOut > 0 && setIsOutflowModalOpen(true)}
                                                                disabled={selectedShiftExpenseOut <= 0}
                                                            >
                                                                <span className="text-slate-500 dark:text-white/50">Списания</span>
                                                                <span className={selectedShiftExpenseOut > 0 ? 'font-semibold text-rose-600 dark:text-rose-300' : 'font-semibold text-slate-900 dark:text-white'}>{formatCurrency(selectedShiftExpenseOut)}</span>
                                                            </button>
                                                            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                                                                <span className="text-slate-500 dark:text-white/50">Инкассация</span>
                                                                <span className="font-semibold text-slate-900 dark:text-white">{selectedShiftCollectionsLabel}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                                                                <span className="text-slate-500 dark:text-white/50">Выплаты</span>
                                                                <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(selectedShiftCash?.payouts ?? 0)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                                                                <span className="text-slate-500 dark:text-white/50">Корректировки</span>
                                                                <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(selectedShiftCash?.adjustments ?? 0)}</span>
                                                            </div>
                                                            {selectedShift.bonus != null && selectedShift.bonus > 0 ? (
                                                                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                                                                    <span className="text-slate-500 dark:text-white/50">Бонус</span>
                                                                    <span className="font-semibold text-emerald-600 dark:text-emerald-300">+{formatCurrency(selectedShift.bonus)}</span>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </section>
                                            </div>

                                            {selectedShift.status === 'CLOSED' || shiftNoteItems.length ? (
                                                <div className={`grid gap-2 ${selectedShift.status === 'CLOSED' && shiftNoteItems.length ? 'md:grid-cols-2' : ''}`}>
                                                    {selectedShift.status === 'CLOSED' ? (
                                                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400 dark:text-white/35">Закрытие смены</p>
                                                            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                                                                <div>
                                                                    <p className="text-slate-400 dark:text-white/35">На начало</p>
                                                                    <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.openingCash)}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-slate-400 dark:text-white/35">Передано</p>
                                                                    <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.handoverCash)}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-slate-400 dark:text-white/35">Касса факт</p>
                                                                    <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">{formatShiftAmount(selectedShift.closingCash)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    {shiftNoteItems.length ? (
                                                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400 dark:text-white/35">Комментарии</p>
                                                            <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-white/65">
                                                                {shiftNoteItems.map((note) => <p key={note}>{note}</p>)}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                        <section className="mt-4 w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.07] dark:bg-white/[0.02]">
                                            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.07]">
                                                <h4 className="text-base font-semibold text-slate-900 dark:text-white">Состояние номеров</h4>
                                                <span className="text-xs text-slate-500 dark:text-white/40">Всего {sortedRooms.length}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-px bg-slate-200/80 text-xs dark:bg-white/[0.07] sm:grid-cols-5">
                                                <div className="bg-slate-50 px-3 py-2.5 dark:bg-[#171b21]">
                                                    <p className="text-slate-500 dark:text-white/40">Свободно</p>
                                                    <p className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">{roomStatusBuckets.available.length}</p>
                                                </div>
                                                <div className="bg-slate-50 px-3 py-2.5 dark:bg-[#171b21]">
                                                    <p className="text-slate-500 dark:text-white/40">Занято</p>
                                                    <p className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">{roomStatusBuckets.occupied.length}</p>
                                                </div>
                                                <div className="bg-slate-50 px-3 py-2.5 dark:bg-[#171b21]">
                                                    <p className="text-slate-500 dark:text-white/40">Не выселены</p>
                                                    <p className={`mt-0.5 text-base font-semibold ${roomStatusBuckets.overdue.length ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{roomStatusBuckets.overdue.length}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="group bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400/40 dark:bg-[#171b21] dark:hover:bg-white/[0.045]"
                                                    onClick={() => setIsDirtyRoomsOpen(true)}
                                                    aria-label={`Показать номера на уборке: ${roomStatusBuckets.dirty.length}`}
                                                >
                                                    <p className="flex items-center justify-between gap-2 text-slate-500 dark:text-white/40"><span>Уборка</span><span className="transition group-hover:translate-x-0.5">›</span></p>
                                                    <p className={`mt-0.5 text-base font-semibold ${roomStatusBuckets.dirty.length ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{roomStatusBuckets.dirty.length}</p>
                                                </button>
                                                <div className="col-span-2 bg-slate-50 px-3 py-2.5 dark:bg-[#171b21] sm:col-span-1">
                                                    <p className="text-slate-500 dark:text-white/40">Бронь</p>
                                                    <p className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">{roomStatusBuckets.hold.length}</p>
                                                </div>
                                            </div>
                                        </section>
                                        {isSelectedShiftLedgerLoading ? (
                                            <p className="mt-2 text-xs text-slate-400 dark:text-white/30">Загружаем операции выбранной смены…</p>
                                        ) : selectedShiftLedgerError ? (
                                            <div className="mt-2 flex items-center gap-2 text-xs text-rose-600 dark:text-rose-300">
                                                <span>История операций недоступна.</span>
                                                <Button type="button" size="sm" variant="ghost" onClick={() => void mutateSelectedShiftLedger()}>Повторить</Button>
                                            </div>
                                        ) : selectedShiftTransactionTotal > 0 ? (
                                            <div className="mt-4 w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.07] dark:bg-white/[0.02]">
                                                <div className="flex items-center justify-between gap-3 px-4 py-3">
                                                    <div>
                                                        <h4 className="text-base font-semibold text-slate-900 dark:text-white">
                                                            Операции <span className="text-slate-400 dark:text-white/40">{selectedShiftTransactions.length < selectedShiftTransactionTotal ? `${selectedShiftTransactions.length} из ${selectedShiftTransactionTotal}` : selectedShiftTransactionTotal}</span>
                                                        </h4>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/[0.06]"
                                                        onClick={() => setIsTransactionsExpanded((prev) => !prev)}
                                                    >
                                                        {isTransactionsExpanded ? 'Свернуть' : 'Развернуть'}
                                                    </Button>
                                                </div>
                                                {isTransactionsExpanded ? (
                                                    <div className="max-h-[420px] divide-y divide-slate-200/70 overflow-y-auto border-t border-slate-200/80 dark:divide-white/[0.06] dark:border-white/[0.07]">
                                                        {selectedShiftTransactions.map((entry) => {
                                                            const note = entry.note?.trim() || null;
                                                            const categoryName = entry.category?.name?.trim() || null;
                                                            return (
                                                                <div key={entry.id} className="px-3 py-2.5">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                                                                <p className="text-xs font-medium text-slate-900 dark:text-white">{ledgerDisplayLabel(entry)}</p>
                                                                                <span className="text-[11px] text-slate-400 dark:text-white/35">{ledgerMethodLabels[entry.method]}</span>
                                                                                {categoryName ? <span className="text-[11px] text-slate-400 dark:text-white/35">· {categoryName}</span> : null}
                                                                            </div>
                                                                            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-white/45">
                                                                                {formatDateTime(entry.recordedAt, hotelTz)} · {entry.managerName ?? 'Система'}{note ? ` · ${note}` : ''}
                                                                            </p>
                                                                        </div>
                                                                        <div className="flex shrink-0 items-center gap-2">
                                                                            <p className={`text-sm font-semibold ${ledgerDisplayAmountClass(entry)}`}>{formatLedgerAmount(entry)}</p>
                                                                        <Button
                                                                            type="button"
                                                                            size="icon"
                                                                            variant="ghost"
                                                                            className="h-7 w-7 text-slate-500 hover:bg-slate-100 dark:text-white/50 dark:hover:bg-white/[0.06]"
                                                                            onClick={() => handleSelectLedgerEntryForEdit(entry)}
                                                                            title="Редактировать операцию"
                                                                            aria-label="Редактировать операцию"
                                                                        >
                                                                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                                                        </Button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        {hasMoreSelectedShiftTransactions ? (
                                                            <div className="flex justify-center px-3 py-3">
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    disabled={isLoadingMoreSelectedShiftTransactions}
                                                                    onClick={() => void setSelectedShiftLedgerPageCount((count) => count + 1)}
                                                                >
                                                                    {isLoadingMoreSelectedShiftTransactions ? 'Загрузка…' : 'Показать ещё'}
                                                                </Button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-xs text-slate-400 dark:text-white/30">Нет операций</p>
                                        )}
                                        <div className="mt-4 space-y-4">
                                            <div ref={roomBoardRef} className="scroll-mt-5 rounded-xl border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                                    <div className="min-w-0">
                                                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                                                            Номера <span className="text-slate-400 dark:text-white/40">{sortedRooms.length}</span>
                                                        </h3>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-white/50">
                                                        <Input
                                                            className="h-9 w-full sm:w-64"
                                                            placeholder="Найти по № бронирования"
                                                            value={stayHistoryQuery}
                                                            onChange={(event) => {
                                                                setStayHistoryQuery(event.target.value);
                                                                if (event.target.value.trim()) {
                                                                    setBoardListPopup(null);
                                                                    setRoomOverviewMode('history');
                                                                    setIsRoomHistoryExpanded(true);
                                                                }
                                                            }}
                                                        />
                                                        {roomOverviewMode === 'history' && isRoomHistoryExpanded && totalFilteredStayHistory > 0 && (
                                                            <span>{totalFilteredStayHistory} записей</span>
                                                        )}
                                                        <div className="flex rounded-lg border border-slate-200/80 bg-white p-0.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                                                            <button
                                                                type="button"
                                                                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${roomOverviewMode === 'board' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white'}`}
                                                                onClick={openAdminBoardView}
                                                            >
                                                                Шахматка
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${roomOverviewMode === 'history' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white'}`}
                                                                onClick={() => {
                                                                    setBoardListPopup(null);
                                                                    setRoomOverviewMode('history');
                                                                    setIsRoomHistoryExpanded(true);
                                                                }}
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
                                                    </div>
                                                </div>
                                                {roomOverviewMode === 'board' ? (
                                                    <div className="mt-3">
                                                        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md dark:bg-[#10141d]/95">
                                                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-y border-slate-200/80 py-2 dark:border-white/[0.07]">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-cyan-900 transition break-words [overflow-wrap:anywhere] hover:bg-cyan-100 dark:border-cyan-300/35 dark:bg-cyan-400/15 dark:text-cyan-100 dark:hover:bg-cyan-400/20"
                                                                    onClick={() => setBoardListPopup('scheduled')}
                                                                >
                                                                    Бронь <span className="font-semibold">{boardScheduledItems.length}</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-amber-700 transition break-words [overflow-wrap:anywhere] hover:bg-amber-100 dark:border-amber-300/35 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/20"
                                                                    onClick={() => setBoardListPopup('checkedIn')}
                                                                >
                                                                    Заселён <span className="font-semibold">{boardCheckedInItems.length}</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-rose-700 transition break-words [overflow-wrap:anywhere] hover:bg-rose-100 dark:border-rose-300/35 dark:bg-rose-500/15 dark:text-rose-100 dark:hover:bg-rose-500/20"
                                                                    onClick={() => setBoardListPopup('overdue')}
                                                                >
                                                                    Не выселены <span className="font-semibold">{boardOverdueItems.length}</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-slate-600 transition break-words [overflow-wrap:anywhere] hover:bg-slate-100 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white/55 dark:hover:bg-white/[0.08]"
                                                                    onClick={() => setBoardListPopup('freeDates')}
                                                                >
                                                                    Свободные даты <span className="font-semibold">{boardFreeDateItems.length}</span>
                                                                </button>
                                                            </div>
                                                             <div className="flex items-center gap-2">
                                                                <select
                                                                    value={bookingBoardScale}
                                                                    onChange={(event) => {
                                                                        const value = event.target.value as 'fit' | 'compact' | 'medium' | 'wide';
                                                                        setBookingBoardScale(value);
                                                                        window.localStorage.setItem('ops-board-scale', value);
                                                                    }}
                                                                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none dark:border-white/15 dark:bg-white/[0.04] dark:text-white/75"
                                                                    title="Масштаб шахматки"
                                                                    aria-label="Масштаб шахматки"
                                                                >
                                                                    <option value="fit">По ширине</option>
                                                                    <option value="compact">Компактно</option>
                                                                    <option value="medium">Средне</option>
                                                                    <option value="wide">Широко</option>
                                                                </select>
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
                                                        <div ref={bookingBoardHeaderScrollRef} className="overflow-x-hidden rounded-t-xl border-x border-t border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
                                                            <div className="min-w-full" style={{ width: bookingBoardContentWidth }}>
                                                                <div
                                                                    className="grid border-b border-slate-200/80 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-[#151923] dark:text-white/45"
                                                                    style={{ gridTemplateColumns: bookingBoardGridTemplate }}
                                                                >
                                                                    <div className="sticky left-0 z-20 bg-slate-50 px-3 py-2 dark:bg-[#151923]">Номер</div>
                                                                    {bookingBoardDays.map((day) => (
                                                                        <div key={`board-day-${day.toISOString()}`} className="border-l border-slate-200/80 px-2 py-2 text-center dark:border-white/[0.06]">
                                                                            <p>{formatBoardDay(day, hotelTz)}</p>
                                                                            <p className="mt-0.5 font-normal normal-case tracking-normal">{formatBoardWeekday(day, hotelTz)}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        </div>
                                                        <div
                                                            className="overflow-x-auto rounded-b-xl border-x border-b border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-white/[0.02]"
                                                            onScroll={(event) => {
                                                                if (bookingBoardHeaderScrollRef.current) {
                                                                    bookingBoardHeaderScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                                                                }
                                                            }}
                                                        >
                                                            <div className="min-w-full" style={{ width: bookingBoardContentWidth }}>
                                                                {bookingBoardRows.map(({ room, items, laneCount }) => (
                                                                    <div
                                                                        key={`booking-board-row-${room.id}`}
                                                                        className={`grid min-h-[36px] border-b border-slate-200/70 transition last:border-b-0 dark:border-white/[0.05] ${
                                                                            dragTargetRoomId === room.id && draggedBoardStay?.roomId !== room.id
                                                                                ? 'bg-cyan-100/70 ring-2 ring-inset ring-cyan-400/35 dark:bg-cyan-400/10'
                                                                                : ''
                                                                        }`}
                                                                        style={{
                                                                            gridTemplateColumns: bookingBoardGridTemplate,
                                                                            gridTemplateRows: `repeat(${laneCount}, minmax(34px, auto))`
                                                                        }}
                                                                        onDragOver={(event) => {
                                                                            if (!draggedBoardStay || draggedBoardStay.roomId === room.id) return;
                                                                            event.preventDefault();
                                                                            event.dataTransfer.dropEffect = 'move';
                                                                            setDragTargetRoomId(room.id);
                                                                        }}
                                                                        onDragLeave={(event) => {
                                                                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                                                                setDragTargetRoomId((current) => current === room.id ? null : current);
                                                                            }
                                                                        }}
                                                                        onDrop={(event) => {
                                                                            event.preventDefault();
                                                                            void handleAdminStayDrop(room.id);
                                                                        }}
                                                                    >
                                                                        <div className="sticky left-0 z-20 flex items-center gap-2 border-r border-slate-200/80 bg-white px-3 py-1 dark:border-white/[0.06] dark:bg-[#10141d]" style={{ gridRow: `1 / span ${laneCount}` }}>
                                                                            <div className="flex min-w-0 items-center gap-1.5">
                                                                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={`№ ${room.label}`}>№ {room.label}</p>
                                                                                {room.floor ? <span className="shrink-0 text-[10px] text-slate-400 dark:text-white/30">{room.floor}</span> : null}
                                                                                {room.status === 'DIRTY' ? <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Ожидает уборки"><span className="sr-only">Ожидает уборки</span></span> : null}
                                                                                {room.status === 'OCCUPIED' ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Сейчас занят"><span className="sr-only">Сейчас занят</span></span> : null}
                                                                            </div>
                                                                        </div>
                                                                        {bookingBoardDays.map((day, dayIndex) => {
                                                                            const isToday = startOfLocalDay(new Date()).getTime() === startOfLocalDay(day).getTime();
                                                                            return (
                                                                                <div
                                                                                    key={`booking-board-cell-${room.id}-${dayIndex}`}
                                                                                    className={`border-l border-slate-200/60 dark:border-white/[0.04] ${isToday ? 'bg-amber-50/70 dark:bg-amber-400/[0.05]' : ''}`}
                                                                                    style={{ gridColumn: dayIndex + 2, gridRow: `1 / span ${laneCount}` }}
                                                                                    onDragOver={(event) => {
                                                                                        if (!draggedBoardStay) return;
                                                                                        if (draggedBoardStay.roomId === room.id && draggedBoardStay.stay.status !== 'SCHEDULED') return;
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        event.dataTransfer.dropEffect = 'move';
                                                                                        setDragTargetRoomId(room.id);
                                                                                    }}
                                                                                    onDrop={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        void handleAdminStayDrop(room.id, day);
                                                                                    }}
                                                                                />
                                                                            );
                                                                        })}
                                                                        {items.map((item) => (
                                                                            <button
                                                                                key={`booking-board-stay-${item.stay.id}`}
                                                                                type="button"
                                                                                draggable={(item.stay.status === 'SCHEDULED' || item.stay.status === 'CHECKED_IN') && !isMovingBoardStay}
                                                                                className={`relative z-10 m-0.5 min-w-0 cursor-grab overflow-hidden rounded-md border px-2 py-0.5 text-left text-[11px] leading-tight shadow-sm transition hover:scale-[1.01] active:cursor-grabbing ${
                                                                                    draggedBoardStay?.stay.id === item.stay.id ? 'opacity-45' : ''
                                                                                } ${item.stay.tariffPending ? tariffPendingBookingBoardClass : bookingBoardStatusClass[item.stay.status]}`}
                                                                                style={{ gridColumn: `${item.startIndex + 2} / span ${item.span}`, gridRow: item.lane + 1 }}
                                                                                onDragStart={(event) => {
                                                                                    event.dataTransfer.effectAllowed = 'move';
                                                                                    event.dataTransfer.setData('text/plain', item.stay.id);
                                                                                    setDraggedBoardStay({ roomId: room.id, stay: item.stay });
                                                                                }}
                                                                                onDragEnd={() => {
                                                                                    setDraggedBoardStay(null);
                                                                                    setDragTargetRoomId(null);
                                                                                }}
                                                                                onClick={() => handleSelectStayForEdit(room, item.stay)}
                                                                                title={[
                                                                                    item.guestLabel,
                                                                                    stayStatusLabels[item.stay.status],
                                                                                    item.detailLabel,
                                                                                    item.stay.notes?.trim()
                                                                                ].filter(Boolean).join(' · ')}
                                                                            >
                                                                                {item.stay.status === 'CHECKED_IN' ? (
                                                                                    <span className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-400/20 transition-[width]" style={{ width: `${item.progressPct}%` }} />
                                                                                ) : null}
                                                                                <span className="relative block truncate font-semibold">{item.guestLabel}</span>
                                                                                <span className="relative mt-0.5 flex items-center justify-between gap-2 text-[10px] font-medium opacity-90">
                                                                                    <span className="truncate">Заезд {formatBoardDay(new Date(item.stay.scheduledCheckIn), hotelTz)}</span>
                                                                                    <span className="shrink-0">Выезд {formatBoardDay(new Date(item.stay.scheduledCheckOut), hotelTz)}</span>
                                                                                </span>
                                                                            </button>
                                                                        ))}
                                                                        {!items.length ? (
                                                                            <button
                                                                                type="button"
                                                                                className="z-10 col-start-2 col-end-[-1] m-1 rounded-xl border border-dashed border-slate-200/90 px-2 py-1 text-left text-[11px] text-slate-300 transition hover:border-slate-300 hover:text-slate-500 dark:border-white/[0.06] dark:text-white/20 dark:hover:text-white/45"
                                                                                onClick={() => handleOpenBookingForm(room)}
                                                                            >
                                                                                {room.status === 'OCCUPIED'
                                                                                    ? 'Активное проживание — данные обновляются'
                                                                                    : room.status === 'DIRTY'
                                                                                        ? 'Свободно, ожидает уборки'
                                                                                        : 'Свободно в выбранном периоде'}
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
                                                            <p className="self-center text-xs text-slate-500 dark:text-white/40">
                                                                Поиск также находит гостя, телефон, компанию, источник и номер комнаты.
                                                            </p>
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
                                                                            {room.isActive ? <button
                                                                                type="button"
                                                                                className="grid h-7 w-7 place-items-center rounded-lg text-amber-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:text-amber-300/70 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                                                                                onClick={() => handleRemoveRoom(room.id, 'archive')}
                                                                                disabled={removingRoomId === room.id}
                                                                                title="Архивировать номер"
                                                                                aria-label="Архивировать номер"
                                                                            >
                                                                                {removingRoomId === room.id ? '…' : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                                                                            </button> : null}
                                                                            <button
                                                                                type="button"
                                                                                className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-rose-300/70 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                                                                                onClick={() => handleRemoveRoom(room.id, 'delete')}
                                                                                disabled={removingRoomId === room.id}
                                                                                title="Удалить номер навсегда"
                                                                                aria-label="Удалить номер навсегда"
                                                                            >
                                                                                {removingRoomId === room.id ? '…' : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
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
                                                                                    const cancellationLabel = stayEntry.status === 'CANCELLED' && stayEntry.cancellationPaymentAction
                                                                                        ? `${stayEntry.cancellationPaymentAction === 'REFUND' ? 'предоплата возвращена' : 'предоплата удержана'} · ${formatCurrency(stayEntry.cancellationAmount ?? 0)}`
                                                                                        : undefined;
                                                                                    const phoneLabel = stayEntry.guestPhone?.trim() ? `тел. ${stayEntry.guestPhone.trim()}` : undefined;
                                                                                    const companyLabel = stayEntry.companyName?.trim() ? `компания ${stayEntry.companyName.trim()}` : undefined;
                                                                                    const transferLabel = stayEntry.transfers?.length
                                                                                        ? stayEntry.transfers
                                                                                            .map((transfer) => `переселение ${transfer.fromRoomLabel}→${transfer.toRoomLabel}`)
                                                                                            .join(' · ')
                                                                                        : undefined;

                                                                                    return (
                                                                                        <div key={stayEntry.id} className={`rounded-xl border px-2.5 py-2 ${stayEntry.tariffPending ? 'border-fuchsia-200 bg-fuchsia-50/90 dark:border-fuchsia-300/20 dark:bg-fuchsia-400/10' : 'border-slate-200/80 bg-white dark:border-white/[0.06] dark:bg-white/[0.03]'}`}>
                                                                                            <div className="flex items-center justify-between gap-2">
                                                                                                <span className="text-xs font-medium text-slate-900 dark:text-white">{guestLabel}</span>
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <Badge label={stayStatusLabels[stayEntry.status]} tone={stayStatusTone[stayEntry.status]} />
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-white/40 dark:hover:bg-white/[0.06] dark:hover:text-white"
                                                                                                        onClick={() => handleSelectStayForEdit(room, stayEntry)}
                                                                                                        title="Редактировать проживание"
                                                                                                        aria-label="Редактировать проживание"
                                                                                                    >
                                                                                                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                                                                                                {checkInLabel} — {checkOutLabel}
                                                                                                {stayEntry.tariffPending ? (
                                                                                                    <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-200"> · тариф уточняется</span>
                                                                                                ) : tariffAmount != null ? (
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
                                                                                            {cancellationLabel ? (
                                                                                                <p className={`mt-1 text-[11px] font-semibold ${stayEntry.cancellationPaymentAction === 'REFUND' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>{cancellationLabel}</p>
                                                                                            ) : null}
                                                                                            {(phoneLabel || companyLabel || stayEntry.notes) ? (
                                                                                                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                                                                                                    {[companyLabel, phoneLabel, stayEntry.notes?.trim()].filter(Boolean).join(' · ')}
                                                                                                </p>
                                                                                            ) : null}
                                                                                            {onlinePortion > 0 && stayEntry.status !== 'CANCELLED' ? (
                                                                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                                                                                    <span className="font-medium">Ожидает подтверждения из экстранета: {formatCurrency(onlinePortion)}</span>
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
                                                                <p className="py-3 text-xs text-slate-400 dark:text-white/40">
                                                                    {isStayHistoryLoading ? 'Загружаем историю…' : 'По фильтрам ничего не найдено'}
                                                                </p>
                                                            )}
                                                            {hasMoreStayHistory ? (
                                                                <div className="flex justify-center py-3">
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        disabled={isLoadingMoreStayHistory}
                                                                        onClick={() => void setStayHistoryPageCount((count) => count + 1)}
                                                                    >
                                                                        {isLoadingMoreStayHistory ? 'Загрузка…' : 'Показать более ранние записи'}
                                                                    </Button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="h-9 w-9 border border-white/15 text-white/80 hover:bg-white/[0.06]"
                                                onClick={() => handleSelectShiftForEdit(selectedShift)}
                                                title="Редактировать смену"
                                                aria-label="Редактировать смену"
                                            >
                                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-500 dark:text-white/60">Выберите смену.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 dark:text-white/60">Смен пока нет.</p>
                    )}

                    {editingShift && (
                        <div className={`${formPanelClass} w-full border-amber-200/70 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-500/8`}>
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
                                                {manager.displayName || manager.loginName || 'Менеджер'}
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
                                    size="icon"
                                    variant="danger"
                                    className="mt-4 h-9 w-9"
                                    onClick={() => setConfirmDeleteShift(true)}
                                    title="Удалить смену"
                                    aria-label="Удалить смену"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
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
                        <div className={`${formPanelClass} w-full border-emerald-200/70 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/8`}>
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
                                                {manager.displayName || manager.loginName || 'Менеджер'}
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
                                {selectedStayForEditor?.tariffPending ? (
                                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                        Тариф по этому проживанию ещё уточняется. Укажите общую сумму тарифа и сохраните, чтобы убрать его из списка ожидания.
                                    </div>
                                ) : null}
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
                                {stayFormValues.status === 'CANCELLED' && selectedStayForEditor && (
                                    ((selectedStayForEditor.cashPaid ?? 0) + (selectedStayForEditor.cardPaid ?? 0) + (selectedStayForEditor.onlinePaid ?? 0)) > 0
                                ) ? (
                                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
                                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Что сделать с предоплатой {formatCurrency((selectedStayForEditor.cashPaid ?? 0) + (selectedStayForEditor.cardPaid ?? 0) + (selectedStayForEditor.onlinePaid ?? 0))}?</p>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                            <label className={`cursor-pointer rounded-xl border p-3 text-sm transition ${stayFormValues.cancellationPaymentAction === 'REFUND' ? 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100' : 'border-amber-200 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70'}`}>
                                                <input type="radio" value="REFUND" className="sr-only" {...stayEditForm.register('cancellationPaymentAction')} />
                                                <span className="block font-semibold">Вернуть гостю</span>
                                                <span className="mt-1 block text-xs opacity-65">Возврат попадёт в расход активной смены.</span>
                                            </label>
                                            <label className={`cursor-pointer rounded-xl border p-3 text-sm transition ${stayFormValues.cancellationPaymentAction === 'RETAIN' ? 'border-amber-400 bg-amber-100/70 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100' : 'border-amber-200 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70'}`}>
                                                <input type="radio" value="RETAIN" className="sr-only" {...stayEditForm.register('cancellationPaymentAction')} />
                                                <span className="block font-semibold">Удержать</span>
                                                <span className="mt-1 block text-xs opacity-65">Сумма останется учтённой как удержанная.</span>
                                            </label>
                                        </div>
                                        {stayFormValues.cancellationPaymentAction === 'REFUND' && ((selectedStayForEditor.cashPaid ?? 0) > 0 || (selectedStayForEditor.cardPaid ?? 0) > 0) && !activeShiftId ? (
                                            <p className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-300">Сначала откройте смену объекта для возврата.</p>
                                        ) : null}
                                    </div>
                                ) : null}
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
                                    {(data?.allowOnlinePayments !== false || (selectedStayForEditor?.onlinePaid ?? 0) > 0) && <div className="space-y-1">
                                        <label className={modalLabelClass}>{`На сайте (${hotelCur || 'KZT'})`}</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            disabled={data?.allowOnlinePayments === false}
                                            {...stayEditForm.register('onlinePaid', { valueAsNumber: true })}
                                        />
                                    </div>}
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
                                                Ожидает подтверждения оплаты из экстранета: {formatCurrency(selectedStayForEditor?.onlinePaid ?? 0)}
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
                                                    <p className="font-semibold text-emerald-600 dark:text-emerald-300">{formatLedgerAmount(entry)}</p>
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
                                        {ledgerDisplayLabel(editingLedgerEntry)} · {formatLedgerAmount(editingLedgerEntry)}
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
                                <Card className="border-slate-200 bg-white dark:border-white/[0.055] dark:bg-white/[0.03]">
                                    <CardHeader title="Сотрудники" />
                                    <div className="space-y-3">
                                        {(data.employees ?? []).map((employee) => (
                                            <div key={employee.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-white/[0.07]">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{employee.fullName}</p>
                                                        <Badge label={employee.isActive ? 'Работает' : 'Не работает'} tone={employee.isActive ? 'success' : 'default'} />
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-white/50">
                                                        {employee.position} · {({
                                                            MONTHLY: 'в месяц',
                                                            SHIFT: 'за смену',
                                                            ROOM: 'за номер',
                                                            PERCENT: 'процент',
                                                            OTHER: 'другое',
                                                        } as Record<string, string>)[employee.payType] ?? employee.payType}: {employee.payType === 'PERCENT' ? formatPercentage(employee.payAmount / 100) : formatCurrency(employee.payAmount)}
                                                    </p>
                                                    {employee.payType === 'SHIFT' && (employee.bonusTiers?.length || (employee.turnoverThreshold != null && employee.highPayAmount != null)) ? (
                                                        <p className="text-xs text-slate-500 dark:text-white/50">
                                                            Бонусы за кассу: {(employee.bonusTiers?.length
                                                                ? employee.bonusTiers
                                                                : [{ threshold: employee.turnoverThreshold!, bonus: Math.max(employee.highPayAmount! - employee.payAmount, 0) }]
                                                            ).map((tier) => `от ${formatCurrency(tier.threshold)} +${formatCurrency(tier.bonus)}`).join(' · ')}
                                                        </p>
                                                    ) : null}
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                    <Button type="button" size="sm" variant="ghost" onClick={() => handleEditEmployee(employee)}>
                                                        Редактировать
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        disabled={updatingEmployeeId === employee.id}
                                                        onClick={() => handleEmployeeStatus(employee.id, !employee.isActive)}
                                                    >
                                                        {employee.isActive ? 'Не работает' : 'Вернуть'}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2 dark:border-white/[0.07]">
                                            {editingEmployeeId ? (
                                                <div className="flex items-center justify-between gap-2 sm:col-span-2">
                                                    <p className="text-sm font-medium text-slate-900 dark:text-white">Редактирование сотрудника</p>
                                                    <Button type="button" size="sm" variant="ghost" onClick={resetEmployeeForm}>Отмена</Button>
                                                </div>
                                            ) : null}
                                            <Input value={employeeForm.fullName} onChange={(event) => setEmployeeForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Имя сотрудника" />
                                            <Input value={employeeForm.position} onChange={(event) => setEmployeeForm((current) => ({ ...current, position: event.target.value }))} placeholder="Должность: горничная, маркетолог…" />
                                            <Select value={employeeForm.payType} onChange={(event) => setEmployeeForm((current) => ({ ...current, payType: event.target.value }))}>
                                                <option value="MONTHLY">Фиксированно в месяц</option>
                                                <option value="SHIFT">За смену</option>
                                                <option value="ROOM">За убранный номер</option>
                                                <option value="PERCENT">Процент</option>
                                                <option value="OTHER">Другая схема</option>
                                            </Select>
                                            <Input type="number" min="0" step="0.01" value={employeeForm.payAmount} onChange={(event) => setEmployeeForm((current) => ({ ...current, payAmount: event.target.value }))} placeholder={employeeForm.payType === 'PERCENT' ? 'Процент' : 'Сумма'} />
                                            {employeeForm.payType === 'SHIFT' ? (
                                                <>
                                                    <div className="sm:col-span-2">
                                                        <p className="text-sm font-medium text-slate-900 dark:text-white">Бонусы за кассу</p>
                                                        <p className="text-xs text-slate-500 dark:text-white/50">Добавьте уровни как у менеджеров. Применится самый высокий достигнутый бонус.</p>
                                                    </div>
                                                    {employeeForm.bonusTiers.map((tier, index) => (
                                                        <div key={index} className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto]">
                                                            <Input type="number" min="0" step="0.01" value={tier.threshold} onChange={(event) => setEmployeeForm((current) => ({ ...current, bonusTiers: current.bonusTiers.map((item, itemIndex) => itemIndex === index ? { ...item, threshold: event.target.value } : item) }))} placeholder="Порог кассы, например 30000" />
                                                            <Input type="number" min="0" step="0.01" value={tier.bonus} onChange={(event) => setEmployeeForm((current) => ({ ...current, bonusTiers: current.bonusTiers.map((item, itemIndex) => itemIndex === index ? { ...item, bonus: event.target.value } : item) }))} placeholder="Бонус, например 500" />
                                                            <Button type="button" size="sm" variant="ghost" onClick={() => setEmployeeForm((current) => ({ ...current, bonusTiers: current.bonusTiers.filter((_, itemIndex) => itemIndex !== index) }))}>
                                                                Удалить
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    <Button type="button" size="sm" variant="ghost" className="sm:col-span-2" disabled={employeeForm.bonusTiers.length >= 10} onClick={() => setEmployeeForm((current) => ({ ...current, bonusTiers: [...current.bonusTiers, { threshold: '', bonus: '' }] }))}>
                                                        Добавить порог бонуса
                                                    </Button>
                                                </>
                                            ) : null}
                                            <Input className="sm:col-span-2" value={employeeForm.notes} onChange={(event) => setEmployeeForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Комментарий" />
                                            <Button type="button" className="sm:col-span-2" disabled={savingEmployee} onClick={handleSaveEmployee}>
                                                {savingEmployee ? 'Сохраняем…' : editingEmployeeId ? 'Сохранить изменения' : 'Добавить сотрудника'}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
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
                                                                PIN {manager.hasPin ? 'настроен' : 'не задан'}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                Ставка: {manager.shiftPayAmount != null ? formatCurrency(manager.shiftPayAmount) : '—'} •
                                                                Процент: {manager.revenueSharePct != null ? formatPercentage(manager.revenueSharePct) : '—'}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-white/50">
                                                                Права: {[
                                                                    manager.canEditBookings ? 'бронь' : null,
                                                                    manager.canEditStayPayments ? 'оплаты' : null,
                                                                    manager.canCancelBookings ? 'отмена' : null
                                                                ].filter(Boolean).join(' · ') || 'только основные операции'}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                                            <Badge label="Менеджер" />
                                                            {manager.canEditBookings ? <Badge label="Брони" tone="success" /> : null}
                                                            {manager.canEditStayPayments ? <Badge label="Оплаты" tone="success" /> : null}
                                                            {manager.canCancelBookings ? <Badge label="Отмена" tone="warning" /> : null}
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 border border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/[0.06]"
                                                                onClick={() => handleSelectManagerForEdit(manager.assignmentId)}
                                                                title="Редактировать менеджера"
                                                                aria-label="Редактировать менеджера"
                                                            >
                                                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 border border-rose-300/60 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                                                onClick={() => handleRemoveManager(manager.assignmentId)}
                                                                disabled={removingManagerId === manager.assignmentId}
                                                                title="Удалить менеджера"
                                                                aria-label="Удалить менеджера"
                                                            >
                                                                {removingManagerId === manager.assignmentId ? '…' : <Trash2 className="h-4 w-4" aria-hidden="true" />}
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
                                                    <p className="text-xs text-slate-500 dark:text-white/60">Имя, логин и PIN</p>
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
                                                            type="password"
                                                            maxLength={6}
                                                            inputMode="numeric"
                                                            autoComplete="new-password"
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
                                                        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-white/40">Дополнительные права</p>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...managerForm.register('canEditBookings')} />
                                                                <span>Редактировать данные и даты броней</span>
                                                            </label>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...managerForm.register('canEditStayPayments')} />
                                                                <span>Изменять суммы и способы оплаты</span>
                                                            </label>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...managerForm.register('canCancelBookings')} />
                                                                <span>Отменять будущие брони</span>
                                                            </label>
                                                        </div>
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
                                                            placeholder={selectedManager?.hasPin ? 'Новый PIN (пусто — без изменений)' : 'Новый PIN (6 цифр)'}
                                                            type="password"
                                                            maxLength={6}
                                                            inputMode="numeric"
                                                            autoComplete="new-password"
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
                                                        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-white/40">Дополнительные права</p>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...updateManagerForm.register('canEditBookings')} />
                                                                <span>Редактировать данные и даты броней</span>
                                                            </label>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...updateManagerForm.register('canEditStayPayments')} />
                                                                <span>Изменять суммы и способы оплаты</span>
                                                            </label>
                                                            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/70">
                                                                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...updateManagerForm.register('canCancelBookings')} />
                                                                <span>Отменять будущие брони</span>
                                                            </label>
                                                        </div>
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
                                                                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 border border-slate-200/80 dark:border-white/15" onClick={() => handleStartEditExpenseCategory(category)} title="Изменить категорию" aria-label="Изменить категорию">
                                                                            <Pencil className="h-4 w-4" aria-hidden="true" />
                                                                        </Button>
                                                                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 border border-rose-200/80 text-rose-600 hover:bg-rose-50 dark:border-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/10" disabled={isRemoving} onClick={() => handleDeleteExpenseCategory(category.id)} title="Удалить категорию" aria-label="Удалить категорию">
                                                                            {isRemoving ? '…' : <Trash2 className="h-4 w-4" aria-hidden="true" />}
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
                                                                className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-rose-300/70 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                                                                onClick={() => handleDeleteBonusTier(tier.id)}
                                                                disabled={removingTierId === tier.id}
                                                                title="Удалить бонусный порог"
                                                                aria-label="Удалить бонусный порог"
                                                            >
                                                                {removingTierId === tier.id ? '…' : <Trash2 className="h-4 w-4" aria-hidden="true" />}
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
                                                                className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white"
                                                                onClick={() => handleStartEditRoom(room)}
                                                                title="Редактировать номер"
                                                                aria-label="Редактировать номер"
                                                            >
                                                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                                            </button>
                                                            {room.isActive ? <button
                                                                type="button"
                                                                className="grid h-8 w-8 place-items-center rounded-lg text-amber-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:text-amber-300/70 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                                                                onClick={() => handleRemoveRoom(room.id, 'archive')}
                                                                disabled={removingRoomId === room.id}
                                                                title="Архивировать номер"
                                                                aria-label="Архивировать номер"
                                                            >
                                                                {removingRoomId === room.id ? '…' : <Archive className="h-4 w-4" aria-hidden="true" />}
                                                            </button> : null}
                                                            <button
                                                                type="button"
                                                                className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-rose-300/70 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                                                                onClick={() => handleRemoveRoom(room.id, 'delete')}
                                                                disabled={removingRoomId === room.id}
                                                                title="Удалить номер навсегда"
                                                                aria-label="Удалить номер навсегда"
                                                            >
                                                                {removingRoomId === room.id ? '…' : <Trash2 className="h-4 w-4" aria-hidden="true" />}
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
                {isDirtyRoomsOpen ? (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm"
                        onClick={() => setIsDirtyRoomsOpen(false)}
                    >
                        <Card
                            className="flex max-h-[82dvh] w-full max-w-md flex-col overflow-hidden border-slate-700/55 bg-[#10141b] p-0 text-slate-100 shadow-2xl dark:bg-[#10141b]"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-start justify-between gap-3 border-b border-slate-700/55 px-4 py-3 sm:px-5">
                                <div className="min-w-0">
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{data.name}</p>
                                    <h3 className="mt-1 text-lg font-semibold">Номера на уборке</h3>
                                    <p className="mt-1 text-xs text-slate-400">{dirtyRooms.length} {dirtyRooms.length === 1 ? 'номер' : 'номеров'} ожидают уборку</p>
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setIsDirtyRoomsOpen(false)} aria-label="Закрыть список">
                                    ×
                                </Button>
                            </div>

                            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                                {dirtyRooms.length ? (
                                    <div className="space-y-2">
                                        {dirtyRooms.map((room) => (
                                            <div key={`dirty-room-${room.id}`} className="rounded-xl border border-rose-300/15 bg-rose-400/[0.07] px-3 py-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-white">№ {room.label}</p>
                                                        <p className="mt-0.5 text-xs text-slate-400">{room.floor?.trim() || 'Этаж не указан'}</p>
                                                    </div>
                                                    <span className="shrink-0 rounded-full bg-rose-400/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200">Уборка</span>
                                                </div>
                                                {room.notes?.trim() ? <p className="mt-2 text-xs leading-relaxed text-slate-300">{room.notes.trim()}</p> : null}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/[0.07] px-4 py-6 text-center">
                                        <p className="text-sm font-semibold text-emerald-200">Все номера убраны</p>
                                        <p className="mt-1 text-xs text-slate-400">Сейчас номеров со статусом уборки нет.</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-end gap-2 border-t border-slate-700/55 px-4 py-3">
                                <Button type="button" variant="ghost" size="sm" onClick={() => setIsDirtyRoomsOpen(false)}>Закрыть</Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        setIsDirtyRoomsOpen(false);
                                        openAdminBoardView();
                                    }}
                                >
                                    Открыть шахматку
                                </Button>
                            </div>
                        </Card>
                    </div>
                ) : null}
                {boardListPopup && (() => {
                    const isFreeDatesPopup = boardListPopup === 'freeDates';
                    const stayItems = boardListPopup === 'scheduled'
                        ? boardScheduledItems
                        : boardListPopup === 'checkedIn'
                            ? boardCheckedInItems
                            : boardOverdueItems;
                    const title = boardListPopup === 'scheduled'
                        ? 'Брони'
                        : boardListPopup === 'checkedIn'
                            ? 'Заселённые'
                            : boardListPopup === 'overdue'
                                ? 'Незакрытые проживания'
                                : 'Свободные даты';
                    const count = isFreeDatesPopup ? boardFreeDateItems.length : stayItems.length;
                    const periodLabel = `${formatBoardDay(bookingBoardRange.start, hotelTz)} - ${formatBoardDay(addDays(bookingBoardRange.end, -1), hotelTz)}`;

                    return (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm">
                            <Card className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden border-slate-700/55 bg-[#10141b] p-0 text-slate-100 shadow-2xl dark:bg-[#10141b]">
                                <div className="flex items-start justify-between gap-3 border-b border-slate-700/55 px-4 py-3 sm:px-5">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                                            {boardListPopup === 'overdue' ? 'На текущий момент' : `Шахматка · ${periodLabel}`}
                                        </p>
                                        <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                                        <p className="mt-1 text-xs text-slate-400">{count} записей</p>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setBoardListPopup(null)}>
                                        ×
                                    </Button>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                                    {boardListPopup === 'overdue' ? (
                                        <p className="mb-3 rounded-xl border border-amber-300/15 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-100/75">
                                            Эти гости всё ещё имеют статус «Заселён». Старые даты, включая майские, показываются независимо от выбранного периода, пока проживание не будет закрыто фактическим выселением.
                                        </p>
                                    ) : null}
                                    {isFreeDatesPopup ? (
                                        boardFreeDateItems.length ? (
                                            <div className="space-y-2">
                                                {boardFreeDateItems.map((item) => {
                                                    const lastFreeDay = addDays(item.endDate, -1);
                                                    const rangeLabel = item.startIndex + 1 === item.endIndex
                                                        ? formatBoardDay(item.startDate, hotelTz)
                                                        : `${formatBoardDay(item.startDate, hotelTz)} - ${formatBoardDay(lastFreeDay, hotelTz)}`;

                                                    return (
                                                        <button
                                                            key={`admin-free-${item.room.id}-${item.startIndex}-${item.endIndex}`}
                                                            type="button"
                                                            className="w-full rounded-xl border border-slate-700/55 bg-slate-800/45 px-3 py-2.5 text-left transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
                                                            onClick={() => {
                                                                setBoardListPopup(null);
                                                                handleOpenBookingForm(item.room, item.startDate);
                                                            }}
                                                        >
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-semibold">№ {item.room.label}</p>
                                                                    {item.room.floor ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.room.floor}</p> : null}
                                                                </div>
                                                                <p className="shrink-0 text-xs font-semibold text-cyan-100">{rangeLabel}</p>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="py-8 text-center text-sm text-slate-400">Свободных интервалов в этом периоде нет.</p>
                                        )
                                    ) : stayItems.length ? (
                                        <div className="space-y-2">
                                            {stayItems.map((item) => (
                                                <button
                                                    key={`admin-board-list-${item.room.id}-${item.stay.id}`}
                                                    type="button"
                                                    className="w-full rounded-xl border border-slate-700/55 bg-slate-800/45 px-3 py-2.5 text-left transition hover:border-slate-500 hover:bg-slate-800/70"
                                                    onClick={() => {
                                                        setBoardListPopup(null);
                                                        handleSelectStayForEdit(item.room, item.stay);
                                                    }}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-semibold">№ {item.room.label} · {item.guestLabel}</p>
                                                            <p className="mt-1 truncate text-xs text-slate-400">{item.detailLabel || stayStatusLabels[item.stay.status]}</p>
                                                        </div>
                                                        <Badge
                                                            label={item.isOverdue ? 'Не выселен' : item.stay.status === 'SCHEDULED' ? 'Бронь' : stayStatusLabels[item.stay.status]}
                                                            tone={item.isOverdue ? 'danger' : item.stay.status === 'CHECKED_IN' ? 'warning' : 'default'}
                                                        />
                                                    </div>
                                                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                                                        <span>Заезд: <span className="text-slate-200">{formatDateTime(item.stay.scheduledCheckIn, hotelTz)}</span></span>
                                                        <span>Выезд: <span className="text-slate-200">{formatDateTime(item.stay.scheduledCheckOut, hotelTz)}</span></span>
                                                    </div>
                                                    {item.stay.tariffPending ? (
                                                        <p className="mt-1 rounded-lg border border-fuchsia-300/25 bg-fuchsia-400/10 px-2 py-1 text-[11px] font-semibold text-fuchsia-100">Тариф уточняется</p>
                                                    ) : item.stay.totalAmount != null ? (
                                                        <p className="mt-1 text-[11px] text-cyan-100/80">Тариф: {formatMoney(item.stay.totalAmount, hotelCur)} · оплачено {formatMoney(item.stay.amountPaid ?? 0, hotelCur)}</p>
                                                    ) : (item.stay.amountPaid ?? 0) > 0 ? (
                                                        <p className="mt-1 text-[11px] text-emerald-200/80">Оплата: {formatMoney(item.stay.amountPaid ?? 0, hotelCur)}</p>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="py-8 text-center text-sm text-slate-400">Записей в этом периоде нет.</p>
                                    )}
                                </div>
                            </Card>
                        </div>
                    );
                })()}
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
                                                <p className="mt-2 text-lg font-semibold text-rose-300">{formatLedgerAmount(entry)}</p>
                                                <p className="text-xs text-slate-500 dark:text-white/50">{ledgerMethodLabels[entry.method]}</p>
                                                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">{note || categoryName || 'Расход'}</p>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-sm text-slate-400 dark:text-white/30">
                                        {hasMoreSelectedShiftTransactions ? 'Старые списания ещё не загружены.' : 'Нет записей'}
                                    </p>
                                )}
                                {hasMoreSelectedShiftTransactions ? (
                                    <div className="flex justify-center pt-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            disabled={isLoadingMoreSelectedShiftTransactions}
                                            onClick={() => void setSelectedShiftLedgerPageCount((count) => count + 1)}
                                        >
                                            {isLoadingMoreSelectedShiftTransactions ? 'Загрузка…' : 'Загрузить более ранние операции'}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                )}
                <AiAnalysisModal
                    analysis={adminAiAnalysis && adminAiShiftId === selectedShift?.id ? adminAiAnalysis : null}
                    isOpen={isAdminAiModalOpen && Boolean(adminAiAnalysis && adminAiShiftId === selectedShift?.id)}
                    title={selectedShift ? `AI анализ смены №${selectedShift.number}` : 'AI анализ смены'}
                    subtitle={data?.name}
                    onClose={() => setIsAdminAiModalOpen(false)}
                    onRefresh={() => void handleAnalyzeSelectedShift()}
                    isRefreshing={isAdminAiLoading}
                />
                <AiAnalysisModal
                    analysis={adminBusinessAiAnalysis}
                    isOpen={isAdminBusinessAiModalOpen && Boolean(adminBusinessAiAnalysis)}
                    title={`AI аудит объекта: ${data.name}`}
                    subtitle={adminBusinessAiAnalysis?.dashboard
                        ? `${adminBusinessAiAnalysis.dashboard.period.label} · ${adminBusinessAiAnalysis.dashboard.period.startDate} - ${adminBusinessAiAnalysis.dashboard.period.endDate}`
                        : data.address}
                    onClose={() => setIsAdminBusinessAiModalOpen(false)}
                    onRefresh={() => void handleAnalyzeBusiness()}
                    isRefreshing={isAdminBusinessAiLoading}
                />
                {confirmationDialog}
            </div>
        </>
    );
};
