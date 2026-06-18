import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { convertCashToAccounting, makeDefaultMoneyBreakdown } from '@/lib/currency';

export const dynamic = 'force-dynamic';

const expenseSchema = z.object({
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid().optional(),
    categoryId: z.string().cuid().optional(),
    amount: z.number().int().positive().optional(),
    method: z.nativeEnum(PaymentMethod),
    currency: z.enum(['KGS', 'KZT', 'USD']).optional(),
    exchangeRate: z.number().int().positive().optional(),
    entryType: z.nativeEnum(LedgerEntryType),
    note: z.string().optional()
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = expenseSchema.parse(body);

        assertHotelAccess(session, payload.hotelId);

        if (payload.categoryId && payload.entryType !== LedgerEntryType.CASH_OUT) {
            return new NextResponse('Категорию можно указать только для расходов', { status: 400 });
        }

        if (payload.entryType !== LedgerEntryType.MANAGER_PAYOUT && !payload.amount) {
            return new NextResponse('Укажите сумму операции', { status: 400 });
        }

        let managerId = session.id;
        let shiftId = payload.shiftId;
        const hotel = await prisma.hotel.findUnique({
            where: { id: payload.hotelId },
            select: { currency: true }
        });
        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }
        if (payload.shiftId) {
            const shift = await prisma.shift.findUnique({ where: { id: payload.shiftId } });
            if (!shift || shift.hotelId !== payload.hotelId) {
                return new NextResponse('Смена не найдена или принадлежит другой точке', { status: 400 });
            }
            managerId = shift.managerId;
            shiftId = shift.id;
        }

        let categoryId: string | undefined;
        if (payload.categoryId) {
            const category = await prisma.expenseCategory.findFirst({
                where: {
                    id: payload.categoryId,
                    hotelId: payload.hotelId,
                },
                select: { id: true },
            });
            if (!category) {
                return new NextResponse('Категория расходов не найдена', { status: 400 });
            }
            categoryId = category.id;
        }

        let amount = payload.amount ?? 0;
        let note = payload.note;
        let money = payload.method === PaymentMethod.CASH
            ? convertCashToAccounting({
                amount,
                currency: payload.currency ?? hotel.currency,
                exchangeRate: payload.exchangeRate,
                accountingCurrency: hotel.currency
            })
            : makeDefaultMoneyBreakdown(amount, hotel.currency);

        if (payload.entryType === LedgerEntryType.MANAGER_PAYOUT) {
            if (!shiftId) {
                return new NextResponse('Для выплаты менеджеру нужна активная смена', { status: 400 });
            }

            const [assignment, ledgerGroups, bonusTiers, stayRevenue] = await Promise.all([
                prisma.hotelAssignment.findFirst({
                    where: { hotelId: payload.hotelId, userId: managerId, isActive: true },
                    select: { shiftPayAmount: true, revenueSharePct: true }
                }),
                prisma.cashEntry.groupBy({
                    by: ['entryType'],
                    where: { shiftId },
                    _sum: { amount: true }
                }),
                prisma.bonusTier.findMany({
                    where: { hotelId: payload.hotelId },
                    orderBy: { threshold: 'asc' }
                }),
                prisma.roomStay.aggregate({
                    where: { shiftId, hotelId: payload.hotelId },
                    _sum: { amountPaid: true, onlinePaid: true }
                })
            ]);

            if (!assignment) {
                return new NextResponse('Для менеджера не настроены ставки на этой точке', { status: 400 });
            }

            const cashIn = ledgerGroups.find((group) => group.entryType === LedgerEntryType.CASH_IN)?._sum.amount ?? 0;
            const payouts = ledgerGroups.find((group) => group.entryType === LedgerEntryType.MANAGER_PAYOUT)?._sum.amount ?? 0;
            const settledStayRevenue = Math.max((stayRevenue._sum.amountPaid ?? 0) - (stayRevenue._sum.onlinePaid ?? 0), 0);
            const shiftBonus = calculateBonusFromTiers(settledStayRevenue, bonusTiers);
            const payout = calculateManagerPayout({
                shiftPayAmount: assignment.shiftPayAmount,
                revenueSharePct: assignment.revenueSharePct,
                bonusAmount: shiftBonus?.computed ?? 0,
                cashIn,
                payouts,
            });

            if (payout.pending <= 0) {
                return new NextResponse('По текущим ставкам выплата уже закрыта', { status: 400 });
            }

            amount = payout.pending;
            note = payload.note?.trim() || 'Выплата по ставке';
            money = makeDefaultMoneyBreakdown(amount, hotel.currency);
        }

        const entry = await prisma.cashEntry.create({
            data: {
                hotelId: payload.hotelId,
                shiftId,
                managerId,
                categoryId,
                recordedAt: new Date(),
                amount: money.accountingAmount,
                originalAmount: money.originalAmount,
                originalCurrency: money.originalCurrency,
                exchangeRate: money.exchangeRate,
                method: payload.method,
                entryType: payload.entryType,
                note,
                // cashDelta can be derived later from payment method
            }
        });

        return NextResponse.json(entry, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Error && error.message === 'Для оплаты в долларах укажите курс') {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to record expense');
    }
}
