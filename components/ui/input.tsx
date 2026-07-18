'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-10 w-full min-w-0 rounded-lg border border-slate-200/90 bg-[#f9fafb] px-3 text-sm text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-blue-400/60 dark:focus:bg-slate-800/70 dark:focus:ring-blue-400/10',
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
            'w-full min-w-0 resize-none rounded-lg border border-slate-200/90 bg-[#f9fafb] px-3 py-2.5 text-sm text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)] transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-blue-400/60 dark:focus:bg-slate-800/70 dark:focus:ring-blue-400/10',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
