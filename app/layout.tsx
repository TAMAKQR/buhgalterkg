import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { ServiceWorkerMaintenance } from '@/components/providers/service-worker-maintenance';

export const metadata: Metadata = {
    title: 'Hotel Ops',
    description: 'Панель управления отелем для администраторов и менеджеров.',
    applicationName: 'Hotel Ops',
    manifest: '/manifest.webmanifest',
    icons: {
        icon: [
            { url: '/icons/pen-192.png', sizes: '192x192', type: 'image/png' },
            { url: '/icons/pen-512.png', sizes: '512x512', type: 'image/png' }
        ],
        apple: { url: '/icons/pen-512.png', sizes: '512x512', type: 'image/png' }
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent'
    },
    other: {
        'mobile-web-app-capable': 'yes'
    }
};

export const viewport: Viewport = {
    themeColor: '#0f172a',
    width: 'device-width',
    initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ru" className="min-h-full bg-[#f4f6f8] dark dark:bg-[#0c0f13]" suppressHydrationWarning>
            <body className="min-h-screen bg-[#f4f6f8] font-sans text-light-text antialiased dark:bg-[#0c0f13] dark:text-mist">
                <ServiceWorkerMaintenance />
                <ThemeProvider>
                    <ToastProvider>
                        {children}
                    </ToastProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
