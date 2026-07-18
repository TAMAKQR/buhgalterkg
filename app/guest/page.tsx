import Script from 'next/script';

import { GuestApp } from '@/components/modules/guest-app';

export default function GuestPage() {
    return (
        <>
            <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
            <GuestApp />
        </>
    );
}
