'use client';

import { type ReactNode } from 'react';

interface DesktopLayoutProps {
    children: ReactNode;
    sidebar?: ReactNode;
    header?: ReactNode;
}

export const DesktopLayout = ({ children, sidebar, header }: DesktopLayoutProps) => {
    return (
        <div className="min-h-screen bg-night">
            {/* Desktop Header */}
            {header && (
                <header className="sticky top-0 z-50 border-b border-white/5 bg-night/95 backdrop-blur-sm lg:block hidden">
                    <div className="desktop-container px-4 py-3">
                        {header}
                    </div>
                </header>
            )}

            {/* Main Content Area */}
            <div className="desktop-container">
                <div className="flex">
                    {/* Sidebar - Desktop Only */}
                    {sidebar && (
                        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 flex-shrink-0 border-r border-white/5 lg:block">
                            <div className="h-full overflow-y-auto p-4">
                                {sidebar}
                            </div>
                        </aside>
                    )}

                    {/* Main Content */}
                    <main className="flex-1 lg:p-6 p-0">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
};
