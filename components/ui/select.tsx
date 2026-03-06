'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(
            'h-10 w-full rounded-xl bg-slate-100 dark:bg-white/[0.06] px-3.5 text-sm text-light-text dark:text-white transition-colors focus:bg-slate-200 dark:focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-white/20 border border-slate-200 dark:border-transparent',
            className
        )}
        {...props}
    >
        {children}
    </select>
));
Select.displayName = 'Select';
