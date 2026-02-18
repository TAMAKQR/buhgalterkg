'use client';

import { useCallback, useMemo, useState } from 'react';
import { AdminDashboard } from '@/components/modules/admin-dashboard';
import { AdminLoginGate } from '@/components/modules/admin-login';
import { ManagerPinLogin } from '@/components/modules/manager-pin-login';
import { ManagerScreen } from '@/components/modules/manager-screen';
import { useManualSession } from '@/hooks/useManualSession';

export const EntryRouter = () => {
    const { user, loading, mutate } = useManualSession();
    const [mode, setMode] = useState<'manager' | 'admin'>('manager');

    const role = user?.role;

    const handleLogout = useCallback(async () => {
        // Immediately set user to null to trigger re-render
        await mutate({ user: null }, false);
    }, [mutate]);

    const view = useMemo(() => {
        if (!user) return null;
        if (role === 'ADMIN') return <AdminDashboard user={user} onLogout={handleLogout} />;
        if (role === 'MANAGER') return <ManagerScreen user={user} onLogout={handleLogout} />;
        return null;
    }, [role, user, handleLogout]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-night">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            </div>
        );
    }

    if (!view) {
        if (mode === 'admin') {
            return (
                <div className="flex min-h-screen items-center justify-center bg-night px-4">
                    <AdminLoginGate embed onBack={() => setMode('manager')} />
                </div>
            );
        }
        return <ManagerPinLogin onAdminMode={() => setMode('admin')} />;
    }

    return view;
};
