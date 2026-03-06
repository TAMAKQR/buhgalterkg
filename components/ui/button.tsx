'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const buttonStyles = cva(
    'inline-flex items-center justify-center rounded-2xl font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-1 focus-visible:ring-offset-light-bg dark:focus-visible:ring-offset-night disabled:opacity-40 disabled:pointer-events-none active:scale-[0.985]',
    {
        variants: {
            variant: {
                primary: 'bg-slate-900 text-white shadow-[0_16px_30px_-18px_rgba(15,23,42,0.62)] hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100',
                secondary: 'border border-slate-200/80 bg-white text-slate-700 shadow-[0_10px_26px_-20px_rgba(15,23,42,0.22)] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-white/[0.07] dark:bg-white/[0.05] dark:text-white/90 dark:hover:bg-white/[0.1]',
                ghost: 'text-slate-600 dark:text-white/60 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]',
                danger: 'border border-rose-200/70 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-400/20 dark:bg-rose-500/12 dark:text-rose-300 dark:hover:bg-rose-500/18'
            },
            size: {
                md: 'h-11 px-5 text-sm',
                sm: 'h-9 px-3.5 text-xs',
                icon: 'h-10 w-10'
            }
        },
        defaultVariants: {
            variant: 'primary',
            size: 'md'
        }
    }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export const Button = ({ className, size, variant, ...props }: ButtonProps) => {
    return <button className={cn(buttonStyles({ size, variant }), className)} {...props} />;
};
