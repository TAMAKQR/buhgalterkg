'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

const buttonStyles = cva(
    'inline-flex items-center justify-center rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70 disabled:opacity-50 disabled:pointer-events-none',
    {
        variants: {
            variant: {
                primary: 'bg-amber text-ink hover:bg-amber/90',
                secondary: 'bg-white/10 text-white hover:bg-white/20',
                ghost: 'text-mist hover:bg-white/10'
            },
            size: {
                md: 'h-11 px-6 text-sm',
                sm: 'h-9 px-4 text-xs',
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
