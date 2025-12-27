'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(
            'h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-white/50 focus:border-amber focus:outline-none',
            className
        )}
        {...props}
    >
        {children}
    </select>
));
Select.displayName = 'Select';
