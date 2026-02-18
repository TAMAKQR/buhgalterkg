import { prisma } from '@/lib/db';

export interface BonusResult {
    threshold: number;
    bonus: number;
    bonusPct: number | null;
    computed: number; // actual bonus amount to pay
}

/**
 * Calculate the bonus for a given shift based on its CASH_IN total
 * and the hotel's bonus tiers configuration.
 *
 * Returns the highest matching tier's bonus, or null if no tier matched.
 */
export async function calculateShiftBonus(
    shiftId: string,
    hotelId: string
): Promise<BonusResult | null> {
    const [cashInResult, tiers] = await Promise.all([
        prisma.cashEntry.aggregate({
            where: { shiftId, entryType: 'CASH_IN' },
            _sum: { amount: true },
        }),
        prisma.bonusTier.findMany({
            where: { hotelId },
            orderBy: { threshold: 'desc' },
        }),
    ]);

    const totalCashIn = cashInResult._sum.amount ?? 0;

    if (!tiers.length || totalCashIn <= 0) return null;

    // Find the highest tier whose threshold is <= totalCashIn
    const matchedTier = tiers.find((tier) => totalCashIn >= tier.threshold);

    if (!matchedTier) return null;

    // Calculate actual bonus: fixed amount or percentage of cashIn
    const computed = matchedTier.bonusPct != null && matchedTier.bonusPct > 0
        ? Math.round((totalCashIn * matchedTier.bonusPct) / 10000)
        : matchedTier.bonus;

    return {
        threshold: matchedTier.threshold,
        bonus: matchedTier.bonus,
        bonusPct: matchedTier.bonusPct,
        computed,
    };
}

/**
 * Calculate bonus for a given cashIn amount against tiers array (no DB call).
 * Useful when tiers are already loaded.
 */
export function calculateBonusFromTiers(
    totalCashIn: number,
    tiers: Array<{ threshold: number; bonus: number; bonusPct: number | null }>
): BonusResult | null {
    if (!tiers.length || totalCashIn <= 0) return null;

    const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
    const matched = sorted.find((t) => totalCashIn >= t.threshold);

    if (!matched) return null;

    const computed = matched.bonusPct != null && matched.bonusPct > 0
        ? Math.round((totalCashIn * matched.bonusPct) / 10000)
        : matched.bonus;

    return {
        threshold: matched.threshold,
        bonus: matched.bonus,
        bonusPct: matched.bonusPct,
        computed,
    };
}
