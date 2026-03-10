export const calculateManagerPayout = ({
    shiftPayAmount,
    revenueSharePct,
    bonusAmount,
    cashIn,
    payouts,
}: {
    shiftPayAmount?: number | null;
    revenueSharePct?: number | null;
    bonusAmount?: number | null;
    cashIn: number;
    payouts: number;
}) => {
    const fixed = shiftPayAmount ?? 0;
    const sharePct = revenueSharePct ?? 0;
    const bonus = bonusAmount ?? 0;
    const variable = sharePct ? Math.round((cashIn * sharePct) / 100) : 0;
    const expected = fixed + variable + bonus;
    const paid = payouts;
    const pending = expected > paid ? expected - paid : 0;

    return { expected, paid, pending };
};