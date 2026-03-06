import { cn } from '@/lib/utils';

export const Badge = ({ label, tone = 'default' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'default' }) => {
    const toneClasses: Record<string, string> = {
        default: 'border border-slate-200/80 bg-slate-100/80 text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.08] dark:text-white/70',
        success: 'border border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400',
        warning: 'border border-amber-200/70 bg-amber-50 text-amber-700 dark:border-amber/15 dark:bg-amber/15 dark:text-amber',
        danger: 'border border-rose-200/70 bg-rose-50 text-rose-700 dark:border-rose-500/15 dark:bg-rose-500/15 dark:text-rose-400'
    };

    return <span className={cn('inline-flex items-center rounded-2xl px-2.5 py-1 text-[11px] font-medium', toneClasses[tone])}>{label}</span>;
};
