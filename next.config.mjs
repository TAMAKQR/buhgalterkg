import withPWAInit from '@ducanh2912/next-pwa';

const runtimeCaching = [
    {
        urlPattern: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
        method: 'GET'
    },
    {
        urlPattern: /\/_next\/static\/.*\.js$/i,
        handler: 'CacheFirst',
        options: {
            cacheName: 'next-static-js-assets',
            expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 }
        }
    },
    {
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
            cacheName: 'static-image-assets',
            expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 }
        }
    },
    {
        urlPattern: /\.(?:js|css)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
            cacheName: 'static-code-assets',
            expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 }
        }
    },
    {
        urlPattern: ({ request, sameOrigin, url: { pathname } }) =>
            request.headers.get('RSC') === '1' && sameOrigin && !pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
            cacheName: 'pages-rsc',
            expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 }
        }
    },
    {
        urlPattern: ({ request, sameOrigin, url: { pathname } }) =>
            request.mode === 'navigate' && sameOrigin && !pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
            cacheName: 'pages',
            expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 }
        }
    }
];

const withPWA = withPWAInit({
    dest: 'public',
    register: true,
    reloadOnOnline: false,
    workboxOptions: {
        runtimeCaching,
        importScripts: ['/sw-cache-cleanup.js'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true
    },
    disable: process.env.NODE_ENV === 'development'
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    distDir: process.env.NEXT_DIST_DIR || '.next',
    reactStrictMode: true,
    poweredByHeader: false,
    async headers() {
        return [{
            source: '/:path*',
            headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
                { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }
            ]
        }];
    },
    experimental: {
        serverActions: {
            bodySizeLimit: '2mb'
        }
    }
};

export default withPWA(nextConfig);
