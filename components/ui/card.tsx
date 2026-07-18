import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4 dark:border-white/[0.07] dark:bg-[#171b21] dark:shadow-none', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
            {subtitle && <p className="break-words text-[11px] uppercase tracking-[0.14em] text-slate-500 [overflow-wrap:anywhere] dark:text-white/36">{subtitle}</p>}
            <h3 className="break-words text-base font-semibold leading-tight text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100">{title}</h3>
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
);
