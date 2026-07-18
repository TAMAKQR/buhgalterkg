'use client';

import { useEffect } from 'react';

export function ServiceWorkerMaintenance() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'development' || !('serviceWorker' in navigator)) {
            return;
        }

        void navigator.serviceWorker.getRegistrations().then((registrations) =>
            Promise.all(registrations.map((registration) => registration.unregister()))
        );

        if ('caches' in window) {
            void window.caches.delete('apis');
        }
    }, []);

    return null;
}
