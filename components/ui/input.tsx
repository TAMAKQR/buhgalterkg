'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-white/50 focus:border-amber focus:outline-none',
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
            'w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-amber focus:outline-none',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
