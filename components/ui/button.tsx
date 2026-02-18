'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const buttonStyles = cva(
    'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-1 focus-visible:ring-offset-night disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]',
    {
        variants: {
            variant: {
                primary: 'bg-amber text-ink hover:bg-amber/85',
                secondary: 'bg-white/[0.07] text-white/90 hover:bg-white/[0.12]',
                ghost: 'text-white/60 hover:text-white hover:bg-white/[0.06]',
                danger: 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
            },
            size: {
                md: 'h-10 px-5 text-sm',
                sm: 'h-8 px-3 text-xs',
                icon: 'h-9 w-9'
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
