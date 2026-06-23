import { cn } from '@/lib/utils';

export const Badge = ({ label, tone = 'default' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'default' }) => {
    const toneClasses: Record<string, string> = {
        default: 'border border-slate-200 bg-slate-50 text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.06] dark:text-white/62',
        success: 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/55 dark:bg-[#123428] dark:text-emerald-100',
        warning: 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/50 dark:bg-[#3b2b12] dark:text-amber-100',
        danger: 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/55 dark:bg-[#3b1620] dark:text-rose-100'
    };

    return (
        <span className={cn('inline-flex min-w-0 max-w-full items-center rounded-md px-2.5 py-0.5 text-[11px] font-semibold leading-tight break-words [overflow-wrap:anywhere]', toneClasses[tone])}>
            {label}
        </span>
    );
};
