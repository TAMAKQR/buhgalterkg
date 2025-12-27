import type { SessionUser } from './types';

export const assertAdmin = (user: SessionUser) => {
    if (user.role !== 'ADMIN') {
        throw new Error('Admin access required');
    }
};

export const assertHotelAccess = (user: SessionUser, hotelId: string) => {
    if (user.role === 'ADMIN') return;
    const allowed = user.hotels.some((hotel) => hotel.id === hotelId);
    if (!allowed) {
        throw new Error('You are not assigned to this hotel');
    }
};
