import { cn } from '@/lib/utils';

export const Skeleton = ({ className }: { className?: string }) => (
    <div className={cn('animate-pulse rounded-xl bg-slate-200 dark:bg-white/[0.06]', className)} />
);
