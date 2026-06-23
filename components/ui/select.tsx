'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(
            'h-10 w-full min-w-0 rounded-lg border border-slate-200/90 bg-[#f9fafb] px-3 text-sm text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)] transition-[border-color,box-shadow,background-color] focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-slate-500/10 sm:h-11 sm:px-3.5 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:focus:border-slate-500 dark:focus:bg-slate-800/70 dark:focus:ring-slate-500/10',
            className
        )}
        {...props}
    >
        {children}
    </select>
));
Select.displayName = 'Select';
