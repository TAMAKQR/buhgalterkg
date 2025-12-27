'use client';

import { useMemo } from 'react';
import { useTelegramContext } from '@/components/providers/telegram-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminDashboard } from '@/components/modules/admin-dashboard';
import { AdminLoginGate } from '@/components/modules/admin-login';
import { ManagerScreen } from '@/components/modules/manager-screen';

export const EntryRouter = () => {
    const { user, loading, error } = useTelegramContext();

    const role = user?.role;

    const view = useMemo(() => {
        if (!user) return null;
        if (role === 'ADMIN') return <AdminDashboard user={user} />;
        return <ManagerScreen user={user} />;
    }, [role, user]);

    if (loading) {
        return (
            <div className="flex min-h-screen flex-col gap-4 p-6">
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center text-rose-300">
                <p className="text-lg font-semibold">Не удалось подключиться к Telegram</p>
                <p className="text-sm text-white/60">{error}</p>
            </div>
        );
    }

    if (!view) {
        return <AdminLoginGate />;
    }

    return view;
};
