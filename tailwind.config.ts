import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-sans)', 'Space Grotesk', 'sans-serif']
            },
            colors: {
                night: '#0a0a0f',
                ink: '#141420',
                mist: '#e2e8f0',
                amber: '#f4a259',
                jade: '#0fa3b1',
                surface: 'rgba(255,255,255,0.04)',
                'surface-hover': 'rgba(255,255,255,0.07)',
                border: 'rgba(255,255,255,0.08)'
            },
            borderRadius: {
                xl: '1rem',
                '2xl': '1.25rem'
            },
            boxShadow: {
                panel: '0 8px 32px rgba(0, 0, 0, 0.3)',
                glow: '0 0 24px rgba(244, 162, 89, 0.15)'
            },
            spacing: {
                'safe-b': 'env(safe-area-inset-bottom, 0px)'
            }
        }
    },
    plugins: []
};

export default config;
