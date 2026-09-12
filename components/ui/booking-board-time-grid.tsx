export type BookingBoardScale = 'hours' | 'days' | 'weeks' | 'month';

export const BOOKING_BOARD_SCALES: Record<BookingBoardScale, { dayCount: number; dayWidth: number; hourStep: number | null }> = {
    hours: { dayCount: 3, dayWidth: 480, hourStep: 4 },
    days: { dayCount: 7, dayWidth: 144, hourStep: 6 },
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
        ? Array.from({ length: 25 }, (_, hour) => hour).filter((hour) => hour % hourStep === 0)
        : [0, 24];

    return (
        <div className="pointer-events-none relative mt-1 h-3 border-t border-slate-300/60 dark:border-white/10" aria-hidden="true">
            {hours.map((hour) => (
                <span
                    key={hour}
                    className="absolute top-0 h-1.5 w-px bg-slate-400/60 dark:bg-white/20"
                    style={{ left: `${(hour / 24) * 100}%` }}
                >
                    {hourStep ? (
                        <span className={`${hour === 24 ? '-translate-x-full' : 'translate-x-0.5'} absolute top-0.5 whitespace-nowrap text-[8px] font-normal leading-none text-slate-400 dark:text-white/30`}>
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
        {[25, 50, 75].map((left) => (
            <span key={left} className="absolute inset-y-0 w-px bg-slate-300/35 dark:bg-white/[0.035]" style={{ left: `${left}%` }} />
        ))}
    </div>
);
