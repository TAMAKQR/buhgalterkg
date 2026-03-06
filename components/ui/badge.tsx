import { cn } from '@/lib/utils';

export const Badge = ({ label, tone = 'default' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'default' }) => {
    const toneClasses: Record<string, string> = {
        default: 'bg-slate-200 dark:bg-white/[0.08] text-slate-600 dark:text-white/70',
        success: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        warning: 'bg-amber-100 dark:bg-amber/15 text-amber-700 dark:text-amber',
        danger: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400'
    };

    return <span className={cn('inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-medium', toneClasses[tone])}>{label}</span>;
};
