'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-10 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-500 hover:border-slate-500 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-blue-400/60 dark:focus:bg-slate-800/70 dark:focus:ring-blue-400/10',
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
            'w-full min-w-0 resize-none rounded-lg border border-[var(--border-strong)] bg-white px-3 py-2.5 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-500 hover:border-slate-500 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-blue-400/60 dark:focus:bg-slate-800/70 dark:focus:ring-blue-400/10',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
