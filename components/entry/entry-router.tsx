'use client';

import { useMemo, useState } from 'react';
import { AdminDashboard } from '@/components/modules/admin-dashboard';
import { AdminLoginGate } from '@/components/modules/admin-login';
import { ManagerPinLogin } from '@/components/modules/manager-pin-login';
import { ManagerScreen } from '@/components/modules/manager-screen';
import { useManualSession } from '@/hooks/useManualSession';

export const EntryRouter = () => {
    const { user, loading, mutate } = useManualSession();
    const [mode, setMode] = useState<'manager' | 'admin'>('manager');

    const role = user?.role;

    const handleLogout = async () => {
        // Immediately set user to null to trigger re-render
        await mutate(null, false);
    };

    const view = useMemo(() => {
        if (!user) return null;
        if (role === 'ADMIN') return <AdminDashboard user={user} onLogout={handleLogout} />;
        if (role === 'MANAGER') return <ManagerScreen user={user} onLogout={handleLogout} />;
        return null;
    }, [role, user]);

    if (loading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 px-3 py-6 sm:px-6">
                <p className="text-white/60">Загрузка...</p>
            </div>
        );
    }

    if (!view) {
        if (mode === 'admin') {
            return (
                <div className="flex min-h-screen items-center justify-center bg-slate-900 px-3 py-6 sm:px-6">
                    <AdminLoginGate embed onBack={() => setMode('manager')} />
                </div>
            );
        }
        return <ManagerPinLogin onAdminMode={() => setMode('admin')} />;
    }

    return view;
};
