import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';

interface AuthShellProps {
    title: string;
    description: string;
    icon: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onBack?: () => void;
}

export function AuthShell({ title, description, icon, children, footer, onBack }: AuthShellProps) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-900 dark:bg-[#0c0f13] dark:text-white">
            <div className="w-full max-w-[360px]">
                <div className="mb-6 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm dark:bg-blue-500">
                        {icon}
                    </div>
                    <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
                </div>

                <Card className="space-y-5 p-5 sm:p-6">
                    {onBack ? (
                        <button
                            type="button"
                            className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            onClick={onBack}
                        >
                            ← Назад
                        </button>
                    ) : null}
                    {children}
                    {footer ? <div className="border-t border-slate-200 pt-4 dark:border-white/[0.07]">{footer}</div> : null}
                </Card>

                <p className="mt-5 text-center text-[11px] text-slate-400 dark:text-slate-600">Hotel Ops</p>
            </div>
        </div>
    );
}
