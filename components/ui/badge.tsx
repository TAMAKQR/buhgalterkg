import { cn } from '@/lib/utils';

export const Badge = ({ label, tone = 'default' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'default' }) => {
    const toneClasses: Record<string, string> = {
        default: 'bg-white/10 text-white',
        success: 'bg-emerald-500/20 text-emerald-300',
        warning: 'bg-amber/20 text-amber',
        danger: 'bg-rose-500/20 text-rose-300'
    };

    return <span className={cn('rounded-full px-3 py-1 text-xs font-medium', toneClasses[tone])}>{label}</span>;
};
