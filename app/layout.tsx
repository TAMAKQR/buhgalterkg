import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Space_Grotesk } from 'next/font/google';
import Script from 'next/script';
import { ToastProvider } from '@/components/ui/toast';
import { ThemeProvider } from '@/components/providers/theme-provider';

const grotesk = Space_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });

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
    initialScale: 1,
    maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ru" className={`${grotesk.variable} dark`} suppressHydrationWarning>
            <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
            <body className="min-h-screen bg-night dark:bg-night bg-light-bg text-light-text dark:text-mist antialiased font-sans">
                <ThemeProvider>
                    <ToastProvider>
                        {children}
                    </ToastProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
