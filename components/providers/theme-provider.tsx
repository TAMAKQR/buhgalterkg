'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const applyTheme = (theme: Theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f172a' : '#e9eff6');
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [theme, setTheme] = useState<Theme>('dark');

    useEffect(() => {
        let initialTheme: Theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        try {
            const stored = localStorage.getItem('theme');
            if (stored === 'light' || stored === 'dark') initialTheme = stored;
        } catch {
            // Keep the theme already applied by the pre-hydration initializer.
        }
        setTheme(initialTheme);
        applyTheme(initialTheme);
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme((currentTheme) => {
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            try {
                localStorage.setItem('theme', newTheme);
            } catch {
                // The visual theme can still change when storage is unavailable.
            }
            applyTheme(newTheme);
            return newTheme;
        });
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};
