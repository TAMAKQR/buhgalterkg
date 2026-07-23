'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type ConfirmTone = 'primary' | 'danger';

export interface ConfirmDialogOptions {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
}

export const useConfirmDialog = () => {
    const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
    const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

    const close = useCallback((confirmed: boolean) => {
        resolverRef.current?.(confirmed);
        resolverRef.current = null;
        setOptions(null);
    }, []);

    const confirm = useCallback((nextOptions: ConfirmDialogOptions) => {
        resolverRef.current?.(false);
        setOptions(nextOptions);
        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
        });
    }, []);

    useEffect(() => {
        if (!options) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [close, options]);

    useEffect(() => () => resolverRef.current?.(false), []);

    const confirmationDialog = options ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
            <button
                type="button"
                className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
                aria-label="Закрыть подтверждение"
                onClick={() => close(false)}
            />
            <Card
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby={options.description ? 'confirm-dialog-description' : undefined}
                className="relative z-10 w-full max-w-md space-y-4 rounded-2xl p-5 shadow-2xl"
            >
                <div>
                    <p id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-white">
                        {options.title}
                    </p>
                    {options.description ? (
                        <p id="confirm-dialog-description" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-500 dark:text-white/55">
                            {options.description}
                        </p>
                    ) : null}
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="flex-1" onClick={() => close(false)}>
                        {options.cancelLabel ?? 'Отмена'}
                    </Button>
                    <Button
                        type="button"
                        variant={options.tone === 'danger' ? 'danger' : 'primary'}
                        className="flex-1"
                        autoFocus
                        onClick={() => close(true)}
                    >
                        {options.confirmLabel ?? 'Подтвердить'}
                    </Button>
                </div>
            </Card>
        </div>
    ) : null;

    return { confirm, confirmationDialog };
};
