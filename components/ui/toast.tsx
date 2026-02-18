'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => { } });

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const toast = useCallback((message: string, type: ToastType = 'info') => {
        const id = ++nextId;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 2800);
    }, []);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}
            {toasts.length > 0 && (
                <div className="fixed bottom-4 left-1/2 z-[999] flex -translate-x-1/2 flex-col gap-2">
                    {toasts.map((t) => {
                        const bg =
                            t.type === 'success'
                                ? 'bg-emerald-500/90 text-white'
                                : t.type === 'error'
                                    ? 'bg-rose-500/90 text-white'
                                    : 'bg-white/[0.12] text-white backdrop-blur-md';
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => dismiss(t.id)}
                                className={`animate-slide-up rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${bg}`}
                            >
                                {t.message}
                            </button>
                        );
                    })}
                </div>
            )}
        </ToastContext.Provider>
    );
}
