'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            'h-10 w-full rounded-xl bg-white/[0.06] px-3.5 text-sm text-white placeholder:text-white/35 transition-colors focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-white/20',
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
            'w-full rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 transition-colors focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-white/20 resize-none',
            className
        )}
        {...props}
    />
));
TextArea.displayName = 'TextArea';
