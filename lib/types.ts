import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus, StayStatus, UserRole } from '@prisma/client';

export type SessionUser = {
    id: string;
    telegramId: string;
    displayName: string;
    username?: string | null;
    avatarUrl?: string | null;
    role: UserRole;
    hotels: Array<{ id: string; name: string; address: string }>;
};

export type ShiftSummary = {
    id: string;
    hotelId: string;
    managerId: string;
    openedAt: string;
    status: ShiftStatus;
    openingCash: number;
    closingCash?: number | null;
    handoverCash?: number | null;
    number: number;
};

export type LedgerEntryInput = {
    hotelId: string;
    shiftId?: string;
    amount: number;
    method: PaymentMethod;
    entryType: LedgerEntryType;
    note?: string;
};

export type RoomViewModel = {
    id: string;
    label: string;
    status: RoomStatus;
    stay?: {
        id: string;
        guestName?: string | null;
        guestPhone?: string | null;
        companyName?: string | null;
        bookingNumber?: string | null;
        scheduledCheckIn: string;
        scheduledCheckOut: string;
        status: StayStatus;
        amountPaid?: number | null;
        totalAmount?: number | null;
    } | null;
};
