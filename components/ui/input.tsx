'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-10 w-full min-w-0 rounded-xl border border-slate-400 bg-white px-3 text-sm text-light-text shadow-[0_12px_28px_-24px_rgba(15,23,42,0.42)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-600 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 sm:h-11 sm:rounded-2xl sm:px-3.5 dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/15 dark:focus:bg-white/[0.08] dark:focus:ring-white/[0.06]',
            className
        )}
        {...props}
    />
));
Input.displayName = 'Input';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 3, ...props }, ref) => (
    <textarea
        ref={ref}
        rows={rows}
        className={cn(
            'w-full min-w-0 resize-none rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-sm text-light-text shadow-[0_12px_28px_-24px_rgba(15,23,42,0.42)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-600 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 sm:rounded-2xl sm:px-3.5 sm:py-3 dark:border-white/[0.055] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/15 dark:focus:bg-white/[0.08] dark:focus:ring-white/[0.06]',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
