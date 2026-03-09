'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { SessionUser } from '@/lib/types';
import { useCountryContext } from '@/hooks/useCountryContext';

interface SessionResponse {
    user: SessionUser | null;
}

export function useManualSession() {
    const [loading, setLoading] = useState(true);
    const { country, withCountry } = useCountryContext();

    const { data, error, mutate } = useSWR<SessionResponse>(
        ['manual-session', country],
        async () => {
            const res = await fetch(withCountry('/api/session/verify'), {
                credentials: 'include', // Include cookies
                cache: 'no-store'
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
