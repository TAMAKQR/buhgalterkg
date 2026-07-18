import type { Config } from 'tailwindcss';

const config: Config = {
    darkMode: 'class',
    content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
    theme: {
        screens: {
            xs: '420px',
            sm: '640px',
            md: '768px',
            lg: '1024px',
            xl: '1280px',
            '2xl': '1536px'
        },
        extend: {
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif']
            },
            colors: {
                night: '#1a1a24',
                ink: '#0f0f18',
                mist: '#e2e8f0',
                amber: '#f4a259',
                jade: '#0fa3b1',
                surface: 'rgba(255,255,255,0.04)',
                'surface-hover': 'rgba(255,255,255,0.07)',
                border: 'rgba(255,255,255,0.08)',
                // Light theme colors
                'light-bg': '#f8f9fa',
                'light-surface': '#ffffff',
                'light-border': '#e2e8f0',
                'light-text': '#0f172a'
            },
            borderRadius: {
                xl: '1rem',
                '2xl': '1.25rem'
            },
            boxShadow: {
                panel: '0 8px 32px var(--shadow)',
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
