import { Suspense } from 'react';

import { EntryRouter } from '@/components/entry/entry-router';

export default function Home() {
    return (
        <Suspense fallback={null}>
            <EntryRouter />
        </Suspense>
    );
}
