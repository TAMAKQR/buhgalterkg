import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('sm:rounded-3xl bg-white/96 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.06] p-3 sm:p-4 shadow-[0_14px_38px_-26px_rgba(15,23,42,0.28)] dark:shadow-none backdrop-blur-sm', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
            {subtitle && <p className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-white/40">{subtitle}</p>}
            <h3 className="text-lg font-semibold text-light-text dark:text-white truncate">{title}</h3>
        </div>
        {actions}
    </div>
);
