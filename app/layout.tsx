import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TelegramProvider } from '@/components/providers/telegram-provider';
import { Space_Grotesk } from 'next/font/google';

const grotesk = Space_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });

export const metadata: Metadata = {
    title: 'Hotel Ops Telegram WebApp',
    description: 'Operational control panel for hotel managers running inside Telegram.',
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
                <TelegramProvider>{children}</TelegramProvider>
            </body>
        </html>
    );
}
