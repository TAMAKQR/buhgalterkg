import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('sm:rounded-2xl bg-white/[0.04] p-3 sm:p-4', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
            {subtitle && <p className="text-[11px] uppercase tracking-widest text-white/40">{subtitle}</p>}
            <h3 className="text-lg font-semibold text-white truncate">{title}</h3>
        </div>
        {actions}
    </div>
);
