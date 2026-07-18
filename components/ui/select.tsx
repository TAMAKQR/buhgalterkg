'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
    <span className="relative block w-full min-w-0">
        <select
            ref={ref}
            className={cn(
                'h-10 w-full min-w-0 appearance-none rounded-lg border border-slate-200/90 bg-[#f9fafb] px-3 pr-9 text-sm text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)] transition-[border-color,box-shadow,background-color] focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:focus:border-blue-400/60 dark:focus:bg-slate-800/70 dark:focus:ring-blue-400/10',
                className
            )}
            {...props}
        >
            {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
    </span>
));
Select.displayName = 'Select';
