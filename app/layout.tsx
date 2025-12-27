import type { Metadata } from 'next';
import './globals.css';
import { TelegramProvider } from '@/components/providers/telegram-provider';
import { Space_Grotesk } from 'next/font/google';

const grotesk = Space_Grotesk({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });

export const metadata: Metadata = {
    title: 'Hotel Ops Telegram WebApp',
    description: 'Operational control panel for hotel managers running inside Telegram.'
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
