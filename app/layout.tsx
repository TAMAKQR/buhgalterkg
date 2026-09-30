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

const themeInitializer = `
    (() => {
        try {
            const storedTheme = localStorage.getItem('theme');
            const theme = storedTheme === 'light' ? 'light' : 'dark';
            document.documentElement.classList.toggle('dark', theme === 'dark');
            document.documentElement.style.colorScheme = theme;
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f172a' : '#e9eff6');
        } catch (_) {
            document.documentElement.classList.add('dark');
            document.documentElement.style.colorScheme = 'dark';
        }
    })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ru" className="min-h-full bg-light-bg dark dark:bg-[#0c0f13]" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
            </head>
            <body className="min-h-screen bg-light-bg font-sans text-light-text antialiased dark:bg-[#0c0f13] dark:text-mist">
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
