'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-11 w-full rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/78 dark:bg-white/[0.05] px-3.5 text-sm text-light-text dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 shadow-[0_8px_22px_-20px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow,background-color] focus:border-slate-300 dark:focus:border-white/15 focus:bg-white/95 dark:focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-slate-200/50 dark:focus:ring-white/[0.06]',
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
            'w-full rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/78 dark:bg-white/[0.05] px-3.5 py-3 text-sm text-light-text dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 shadow-[0_8px_22px_-20px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow,background-color] focus:border-slate-300 dark:focus:border-white/15 focus:bg-white/95 dark:focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-slate-200/50 dark:focus:ring-white/[0.06] resize-none',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
