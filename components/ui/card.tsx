import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('min-w-0 overflow-hidden rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.45)] sm:rounded-3xl sm:p-4 dark:border-white/[0.055] dark:bg-white/[0.04] dark:shadow-none', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 sm:mb-4">
        <div className="min-w-0 flex-1">
            {subtitle && <p className="break-words text-[11px] uppercase tracking-widest text-slate-700 [overflow-wrap:anywhere] dark:text-white/40">{subtitle}</p>}
            <h3 className="break-words text-base font-semibold leading-tight text-light-text [overflow-wrap:anywhere] dark:text-white sm:text-lg">{title}</h3>
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
);
