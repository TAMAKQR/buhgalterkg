'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-10 w-full rounded-xl bg-slate-100 dark:bg-white/[0.06] px-3.5 text-sm text-light-text dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 transition-colors focus:bg-slate-200 dark:focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-white/20 border border-slate-200 dark:border-transparent',
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
            'w-full rounded-xl bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2.5 text-sm text-light-text dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 transition-colors focus:bg-slate-200 dark:focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-white/20 resize-none border border-slate-200 dark:border-transparent',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
