import { prisma } from '@/lib/db';

export interface BonusResult {
    threshold: number;
    bonus: number;
    bonusPct: number | null;
    computed: number; // actual bonus amount to pay
}

/**
 * Calculate the bonus for a given shift based on its STAY REVENUE
 * (sum of amountPaid from RoomStay) and the hotel's bonus tiers configuration.
 *
 * Returns the highest matching tier's bonus, or null if no tier matched.
 */
export async function calculateShiftBonus(
    shiftId: string,
    hotelId: string
): Promise<BonusResult | null> {
    const [stayRevenueResult, tiers] = await Promise.all([
        prisma.roomStay.aggregate({
            where: { shiftId, hotelId },
            _sum: { amountPaid: true },
        }),
        prisma.bonusTier.findMany({
            where: { hotelId },
            orderBy: { threshold: 'desc' },
        }),
    ]);

    const totalStayRevenue = stayRevenueResult._sum.amountPaid ?? 0;

    if (!tiers.length || totalStayRevenue <= 0) return null;

    // Find the highest tier whose threshold is <= totalStayRevenue
    const matchedTier = tiers.find((tier) => totalStayRevenue >= tier.threshold);

    if (!matchedTier) return null;

    // Calculate actual bonus: fixed amount or percentage of stay revenue
    const computed = matchedTier.bonusPct != null && matchedTier.bonusPct > 0
        ? Math.round((totalStayRevenue * matchedTier.bonusPct) / 10000)
        : matchedTier.bonus;

    return {
        threshold: matchedTier.threshold,
        bonus: matchedTier.bonus,
        bonusPct: matchedTier.bonusPct,
        computed,
    };
}

/**
 * Calculate bonus for a given stay revenue amount against tiers array (no DB call).
 * Useful when tiers are already loaded.
 */
export function calculateBonusFromTiers(
    stayRevenue: number,
    tiers: Array<{ threshold: number; bonus: number; bonusPct: number | null }>
): BonusResult | null {
    if (!tiers.length || stayRevenue <= 0) return null;

    const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
    const matched = sorted.find((t) => stayRevenue >= t.threshold);

    if (!matched) return null;

    const computed = matched.bonusPct != null && matched.bonusPct > 0
        ? Math.round((stayRevenue * matched.bonusPct) / 10000)
        : matched.bonus;

    return {
        threshold: matched.threshold,
        bonus: matched.bonus,
        bonusPct: matched.bonusPct,
        computed,
    };
}
