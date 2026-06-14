'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const buttonStyles = cva(
    'inline-flex min-w-0 max-w-full items-center justify-center rounded-xl text-center font-medium leading-tight transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-1 focus-visible:ring-offset-light-bg dark:focus-visible:ring-amber/50 dark:focus-visible:ring-offset-night disabled:pointer-events-none disabled:opacity-40 active:scale-[0.985] sm:rounded-2xl [&>svg]:shrink-0',
    {
        variants: {
            variant: {
                primary: 'bg-blue-700 text-white shadow-[0_18px_34px_-18px_rgba(29,78,216,0.78)] hover:bg-blue-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100',
                secondary: 'border border-slate-400 bg-white text-slate-800 shadow-[0_14px_28px_-22px_rgba(15,23,42,0.44)] hover:border-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:border-white/[0.07] dark:bg-white/[0.05] dark:text-white/90 dark:hover:bg-white/[0.1]',
                ghost: 'text-slate-800 hover:bg-slate-200/80 hover:text-slate-950 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white',
                danger: 'border border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200 dark:border-rose-400/20 dark:bg-rose-500/12 dark:text-rose-300 dark:hover:bg-rose-500/18'
            },
            size: {
                md: 'min-h-10 px-4 py-2 text-sm break-words [overflow-wrap:anywhere] sm:min-h-11 sm:px-5',
                sm: 'min-h-9 px-3.5 py-1.5 text-xs break-words [overflow-wrap:anywhere]',
                icon: 'h-10 w-10 shrink-0'
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
