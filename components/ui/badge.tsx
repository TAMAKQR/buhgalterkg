import { cn } from '@/lib/utils';

export const Badge = ({ label, tone = 'default' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'default' }) => {
    const toneClasses: Record<string, string> = {
        default: 'bg-white/[0.08] text-white/70',
        success: 'bg-emerald-500/15 text-emerald-400',
        warning: 'bg-amber/15 text-amber',
        danger: 'bg-rose-500/15 text-rose-400'
    };

    return <span className={cn('inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-medium', toneClasses[tone])}>{label}</span>;
};
