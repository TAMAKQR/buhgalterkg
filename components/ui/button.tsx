'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const buttonStyles = cva(
    'inline-flex min-w-0 max-w-full items-center justify-center rounded-lg text-center font-medium leading-tight transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-1 focus-visible:ring-offset-light-bg dark:focus-visible:ring-white/30 dark:focus-visible:ring-offset-night disabled:pointer-events-none disabled:opacity-40 active:scale-[0.985] [&>svg]:shrink-0',
    {
        variants: {
            variant: {
                primary: 'bg-slate-800 text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.5)] hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-slate-300',
                secondary: 'border border-slate-200/90 bg-[#f9fafb] text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.32)] hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700/65 dark:bg-slate-800/45 dark:text-slate-200 dark:hover:bg-slate-700/50',
                ghost: 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/55 dark:hover:text-slate-200',
                danger: 'border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-400/20 dark:bg-rose-500/12 dark:text-rose-300 dark:hover:bg-rose-500/18'
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
