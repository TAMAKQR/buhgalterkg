import type { SessionUser } from './types';
import { SessionError } from './server/errors';

export const assertAdmin = (user: SessionUser) => {
    if (user.role !== 'ADMIN') {
        throw new SessionError('Admin access required', 403);
    }
};

export const assertOperationalRole = (user: SessionUser) => {
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
        throw new SessionError('Manager access required', 403);
    }
};

export const assertHotelAccess = (user: SessionUser, hotelId: string) => {
    if (user.role === 'ADMIN') return;
    const allowed = user.hotels.some((hotel) => hotel.id === hotelId);
    if (!allowed) {
        throw new SessionError('You are not assigned to this hotel', 403);
    }
};

export const assertHotelOperatorAccess = (user: SessionUser, hotelId: string) => {
    assertOperationalRole(user);
    assertHotelAccess(user, hotelId);
};
