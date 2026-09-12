'use client';

import { useEffect, useState } from 'react';

import { formatDateKey } from '@/lib/timezone';

export const useHotelToday = (timezone?: string) => {
    const [todayKey, setTodayKey] = useState(() => formatDateKey(new Date(), timezone));

    useEffect(() => {
        const updateToday = () => setTodayKey(formatDateKey(new Date(), timezone));
        updateToday();
        const intervalId = window.setInterval(updateToday, 60_000);
        return () => window.clearInterval(intervalId);
    }, [timezone]);

    return todayKey;
};

export const useHotelNow = () => {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(intervalId);
    }, []);

    return now;
};
