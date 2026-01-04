'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { SessionUser } from '@/lib/types';

interface SessionResponse {
    user: SessionUser | null;
}

export function useManualSession() {
    const [loading, setLoading] = useState(true);

    const { data, error, mutate } = useSWR<SessionResponse>(
        '/api/session/verify',
        async (url) => {
            const res = await fetch(url, {
                credentials: 'include' // Include cookies
            });
            if (!res.ok) return { user: null };
            return res.json();
        },
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            shouldRetryOnError: false
        }
    );

    useEffect(() => {
        if (data !== undefined || error !== undefined) {
            setLoading(false);
        }
    }, [data, error]);

    return {
        user: data?.user ?? null,
        loading,
        mutate
    };
}
