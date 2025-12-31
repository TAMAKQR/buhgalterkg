import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
    width: 512,
    height: 512
};

export const contentType = 'image/png';

export default function Icon() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                        'radial-gradient(circle at 20% 20%, #0ea5e9 0%, #020617 45%, #020617 100%)',
                    borderRadius: '28%'
                }}
            >
                <svg viewBox="0 0 512 512" width="400" height="400" role="img" aria-hidden="true">
                    <g transform="rotate(-45 256 256)">
                        <rect x="220" y="90" width="72" height="280" rx="30" fill="#38bdf8" />
                        <rect x="220" y="70" width="72" height="46" rx="18" fill="#bae6fd" />
                        <path d="M256 370 L300 440 L212 440 Z" fill="#f8fafc" />
                        <path d="M262 398 L286 432" stroke="#94a3b8" strokeWidth="10" strokeLinecap="round" />
                    </g>
                </svg>
            </div>
        ),
        size
    );
}
