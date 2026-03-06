'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(
            'h-11 w-full rounded-2xl border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-white/[0.05] px-3.5 text-sm text-light-text dark:text-white shadow-[0_6px_18px_-16px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow,background-color] focus:border-slate-300 dark:focus:border-white/15 focus:bg-white dark:focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-slate-200/70 dark:focus:ring-white/[0.06]',
            className
        )}
        {...props}
    >
        {children}
    </select>
));
Select.displayName = 'Select';
