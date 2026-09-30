import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('min-w-0 overflow-hidden rounded-xl border border-slate-300/90 bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_16px_34px_-28px_rgba(15,23,42,0.34)] sm:p-4 dark:border-white/[0.07] dark:bg-[#171b21] dark:shadow-none', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
            {subtitle && <p className="break-words text-[11px] font-medium uppercase tracking-[0.14em] text-slate-600 [overflow-wrap:anywhere] dark:text-white/[0.36]">{subtitle}</p>}
            <h3 className="break-words text-base font-semibold leading-tight text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">{title}</h3>
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
);
