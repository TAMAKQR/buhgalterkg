import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Space_Grotesk } from 'next/font/google';
import { ToastProvider } from '@/components/ui/toast';

const grotesk = Space_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });

export const metadata: Metadata = {
    title: 'Hotel Ops',
    description: 'Панель управления отелями для администраторов и менеджеров.',
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
    initialScale: 1,
    maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={grotesk.variable}>
            <body className="min-h-screen bg-night text-mist antialiased font-sans">
                <ToastProvider>
                    {children}
                </ToastProvider>
            </body>
        </html>
    );
}
