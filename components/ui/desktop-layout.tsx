'use client';

import { type ReactNode } from 'react';

interface DesktopLayoutProps {
    children: ReactNode;
    sidebar?: ReactNode;
    header?: ReactNode;
}

export const DesktopLayout = ({ children, sidebar, header }: DesktopLayoutProps) => {
    return (
        <div className="min-h-screen bg-light-bg text-slate-900 dark:bg-[#0c0f13] dark:text-slate-200">
            {/* Desktop Header */}
            {header && (
                <header className="sticky top-0 z-50 hidden border-b border-slate-300 bg-white/95 backdrop-blur-sm dark:border-white/5 dark:bg-night/95 lg:block">
                    <div className="workspace-page py-3">
                        {header}
                    </div>
                </header>
            )}

            {/* Main Content Area */}
            <div className="desktop-container">
                <div className="flex">
                    {/* Sidebar - Desktop Only */}
                    {sidebar && (
                        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 flex-shrink-0 border-r border-slate-300 dark:border-white/5 lg:block">
                            <div className="h-full overflow-y-auto p-4">
                                {sidebar}
                            </div>
                        </aside>
                    )}

                    {/* Main Content */}
                    <main className="workspace-page min-w-0 flex-1 py-3 lg:py-5">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
};
