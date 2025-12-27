import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

export const Card = ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-panel backdrop-blur', className)} {...props}>
        {children}
    </div>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
    <div className="mb-6 flex items-center justify-between gap-4">
        <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">{subtitle}</p>
            <h3 className="mt-1 text-xl font-semibold text-white">{title}</h3>
        </div>
        {actions}
    </div>
);
