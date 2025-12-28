'use client';

import { useMemo, useState } from 'react';
import { useTelegramContext } from '@/components/providers/telegram-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminDashboard } from '@/components/modules/admin-dashboard';
import { AdminLoginGate } from '@/components/modules/admin-login';
import { ManagerScreen } from '@/components/modules/manager-screen';
import { ManagerPinLogin } from '@/components/modules/manager-pin-login';

export const EntryRouter = () => {
    const { user, loading, error } = useTelegramContext();
    const [mode, setMode] = useState<'manager' | 'admin'>('manager');

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

    if (!view) {
        if (mode === 'admin') {
            return (
                <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
                    <AdminLoginGate embed onBack={() => setMode('manager')} contextError={error} />
                </div>
            );
        }
        return <ManagerPinLogin onAdminMode={() => setMode('admin')} contextError={error} />;
    }

    return view;
};
