import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Hotel Ops',
        short_name: 'Hotel Ops',
        description: 'Управление отелями, сменами и складами.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#020617',
        theme_color: '#0f172a',
        orientation: 'portrait-primary',
        categories: ['productivity', 'business'],
        icons: [
            {
                src: '/icons/pen-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icons/pen-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icons/pen-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            },
            {
                src: '/icons/pen.svg',
                sizes: '512x512',
                type: 'image/svg+xml',
                purpose: 'any'
            }
        ]
    };
}
