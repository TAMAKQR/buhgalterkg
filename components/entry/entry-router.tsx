'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

import { AdminLoginGate } from '@/components/modules/admin-login';
import { ManagerPinLogin } from '@/components/modules/manager-pin-login';
import { ObserverLogin } from '@/components/modules/observer-login';
import { useManualSession } from '@/hooks/useManualSession';

const RoleScreenLoading = () => (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#0c0f13]" role="status" aria-label="Загрузка интерфейса">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
    </div>
);

const AdminDashboard = dynamic(
    () => import('@/components/modules/admin-dashboard').then((module) => module.AdminDashboard),
    { ssr: false, loading: RoleScreenLoading }
);

const ManagerScreen = dynamic(
    () => import('@/components/modules/manager-screen').then((module) => module.ManagerScreen),
    { ssr: false, loading: RoleScreenLoading }
);

const ObserverScreen = dynamic(
    () => import('@/components/modules/observer-screen').then((module) => module.ObserverScreen),
    { ssr: false, loading: RoleScreenLoading }
);

export const EntryRouter = () => {
    const { user, loading, mutate } = useManualSession();
    const [mode, setMode] = useState<'manager' | 'admin' | 'observer'>('manager');

    const role = user?.role;

    const handleLogout = useCallback(async () => {
        try {
            await fetch('/api/session/logout', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store'
            });
        } finally {
            await mutate({ user: null }, false);
        }
    }, [mutate]);

    const view = useMemo(() => {
        if (!user) return null;
        if (role === 'ADMIN') return <AdminDashboard user={user} onLogout={handleLogout} />;
        if (role === 'MANAGER') return <ManagerScreen user={user} onLogout={handleLogout} />;
        if (role === 'OBSERVER') return <ObserverScreen user={user} onLogout={handleLogout} />;
        return null;
    }, [role, user, handleLogout]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#0c0f13]">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            </div>
        );
    }

    if (!view) {
        if (mode === 'admin') {
            return <AdminLoginGate onBack={() => setMode('manager')} />;
        }
        if (mode === 'observer') {
            return <ObserverLogin onBack={() => setMode('manager')} />;
        }
        return <ManagerPinLogin onAdminMode={() => setMode('admin')} onObserverMode={() => setMode('observer')} />;
    }

    return view;
};
