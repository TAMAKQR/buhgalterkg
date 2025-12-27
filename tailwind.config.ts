import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-sans)', 'Space Grotesk', 'sans-serif']
            },
            colors: {
                night: '#05060a',
                ink: '#0f172a',
                mist: '#e2e8f0',
                amber: '#f4a259',
                jade: '#0fa3b1'
            },
            borderRadius: {
                xl: '1.5rem'
            },
            boxShadow: {
                panel: '0 20px 60px rgba(15, 23, 42, 0.35)'
            }
        }
    },
    plugins: []
};

export default config;
