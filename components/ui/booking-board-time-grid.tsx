export type BookingBoardScale = 'hours' | 'days' | 'weeks' | 'month';

export const BOOKING_BOARD_SCALES: Record<BookingBoardScale, { dayCount: number; dayWidth: number; hourStep: number | null }> = {
    hours: { dayCount: 3, dayWidth: 480, hourStep: 4 },
    days: { dayCount: 7, dayWidth: 240, hourStep: 4 },
    weeks: { dayCount: 14, dayWidth: 84, hourStep: null },
    month: { dayCount: 31, dayWidth: 52, hourStep: null },
};

export const normalizeBookingBoardScale = (value: string | null): BookingBoardScale => {
    if (value === 'hours' || value === 'days' || value === 'weeks' || value === 'month') return value;
    if (value === 'wide') return 'days';
    if (value === 'compact') return 'month';
    return 'weeks';
};

export const BookingBoardTimeRuler = ({ hourStep }: { hourStep: number | null }) => {
    const hours = hourStep
        ? Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => hour % hourStep === 0)
        : [0];

    return (
        <div className="pointer-events-none relative mt-1 h-4 border-t border-slate-300/80 dark:border-white/20" aria-hidden="true">
            {hours.map((hour) => (
                <span
                    key={hour}
                    className="absolute top-0 h-2 w-px bg-slate-500/70 dark:bg-white/30"
                    style={{ left: `${(hour / 24) * 100}%` }}
                >
                    {hourStep ? (
                        <span className="absolute left-1 top-1 whitespace-nowrap text-[10px] font-semibold leading-none text-slate-600 dark:text-slate-300">
                            {String(hour).padStart(2, '0')}:00
                        </span>
                    ) : null}
                </span>
            ))}
        </div>
    );
};

export const BookingBoardTimeGuides = () => (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((step) => (
            <span key={step} className="absolute inset-y-0 w-px bg-slate-300/35 dark:bg-white/[0.035]" style={{ left: `${(step / 6) * 100}%` }} />
        ))}
    </div>
);
