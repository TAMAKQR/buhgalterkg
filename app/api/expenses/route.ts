import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertHotelOperatorAccess } from '@/lib/permissions';
import { LedgerEntryType, PaymentMethod, Prisma } from '@prisma/client';
import type { CashEntry } from '@prisma/client';
import { handleApiError } from '@/lib/server/errors';
import { calculateManagerPayout } from '@/lib/manager-payout';
import { calculateBonusFromTiers } from '@/lib/bonus';
import { convertCashToAccounting, makeDefaultMoneyBreakdown } from '@/lib/currency';

export const dynamic = 'force-dynamic';

const expenseSchema = z.object({
    hotelId: z.string().cuid(),
    shiftId: z.string().cuid().optional(),
    categoryId: z.string().cuid().optional(),
    roomId: z.string().cuid().optional(),
    employeeId: z.string().cuid().optional(),
    amount: z.number().int().positive().optional(),
    method: z.nativeEnum(PaymentMethod),
    currency: z.enum(['KGS', 'KZT', 'USD']).optional(),
    exchangeRate: z.number().int().positive().optional(),
    entryType: z.nativeEnum(LedgerEntryType),
    note: z.string().optional(),
    recordedAt: z.string().datetime().optional(),
});

const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

class ExpenseResponseError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 403 | 409
    ) {
        super(message);
        this.name = 'ExpenseResponseError';
    }
}

type LockedShift = {
    id: string;
    hotelId: string;
    managerId: string;
    status: string;
};

type NormalizedIdempotencyPayload = {
    hotelId: string;
    shiftId: string | null;
    categoryId: string | null;
    roomId: string | null;
    employeeId: string | null;
    entryType: LedgerEntryType;
    method: PaymentMethod;
    amount: number | null;
    originalAmount: number | null;
    originalCurrency: string | null;
    exchangeRate: number | null;
    note: string | null;
    recordedAt: Date | null;
};

const normalizeNote = (value?: string | null) => value?.trim() || null;

const assertIdempotencyPayloadMatches = (
    entry: CashEntry,
    expected: NormalizedIdempotencyPayload,
) => {
    if (entry.hotelId !== expected.hotelId) {
        throw new ExpenseResponseError('Ключ операции уже использован', 409);
    }

    const moneyMatches = expected.amount === null || (
        entry.amount === expected.amount
        && (entry.originalAmount ?? entry.amount) === expected.originalAmount
        && entry.originalCurrency === expected.originalCurrency
        && entry.exchangeRate === expected.exchangeRate
    );
    const payloadMatches = entry.entryType === expected.entryType
        && entry.method === expected.method
        && entry.shiftId === expected.shiftId
        && entry.categoryId === expected.categoryId
        && entry.roomId === expected.roomId
        && entry.employeeId === expected.employeeId
        && moneyMatches
        && normalizeNote(entry.note) === expected.note
        && (expected.recordedAt === null || entry.recordedAt.getTime() === expected.recordedAt.getTime());

    if (!payloadMatches) {
        throw new ExpenseResponseError('Ключ операции уже использован для других данных', 409);
    }
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const session = await getSessionUser(request);
        const payload = expenseSchema.parse(body);
        const rawIdempotencyKey = request.headers.get('idempotency-key')?.trim();
        const idempotencyKey = rawIdempotencyKey
            ? idempotencyKeySchema.parse(rawIdempotencyKey)
            : undefined;

        assertHotelOperatorAccess(session, payload.hotelId);

        if (payload.roomId && payload.entryType !== LedgerEntryType.CASH_OUT) {
            return new NextResponse('Комнату можно указать только для расходов', { status: 400 });
        }
        if (payload.employeeId && payload.entryType !== LedgerEntryType.CASH_OUT) {
            return new NextResponse('Выплата сотруднику должна быть расходом', { status: 400 });
        }
        if (payload.recordedAt && (session.role !== 'ADMIN' || payload.entryType !== LedgerEntryType.CASH_OUT)) {
            return new NextResponse('Дату операции может указывать только администратор для расхода', { status: 403 });
        }

        const recordedAt = payload.recordedAt ? new Date(payload.recordedAt) : new Date();
        if (recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
            return new NextResponse('Фактический расход нельзя записать будущей датой', { status: 400 });
        }

        if (payload.categoryId && payload.entryType !== LedgerEntryType.CASH_OUT) {
            return new NextResponse('Категорию можно указать только для расходов', { status: 400 });
        }

        if (payload.entryType !== LedgerEntryType.MANAGER_PAYOUT && !payload.employeeId && !payload.amount) {
            return new NextResponse('Укажите сумму операции', { status: 400 });
        }

        const hotel = await prisma.hotel.findUnique({
            where: { id: payload.hotelId },
            select: { currency: true }
        });
        if (!hotel) {
            return new NextResponse('Отель не найден', { status: 404 });
        }

        const amount = payload.amount ?? 0;
        const note = normalizeNote(payload.note);
        const money = payload.method === PaymentMethod.CASH
            ? convertCashToAccounting({
                amount,
                currency: payload.currency ?? hotel.currency,
                exchangeRate: payload.exchangeRate,
                accountingCurrency: hotel.currency
            })
            : makeDefaultMoneyBreakdown(amount, hotel.currency);
        const isAutomaticPayout = payload.entryType === LedgerEntryType.MANAGER_PAYOUT || Boolean(payload.employeeId);
        const normalizedIdempotencyPayload: NormalizedIdempotencyPayload = {
            hotelId: payload.hotelId,
            shiftId: payload.shiftId ?? null,
            categoryId: payload.categoryId ?? null,
            roomId: payload.roomId ?? null,
            employeeId: payload.employeeId ?? null,
            entryType: payload.entryType,
            method: payload.method,
            amount: isAutomaticPayout ? null : money.accountingAmount,
            originalAmount: isAutomaticPayout ? null : money.originalAmount,
            originalCurrency: isAutomaticPayout ? null : money.originalCurrency,
            exchangeRate: isAutomaticPayout ? null : money.exchangeRate,
            note: payload.entryType === LedgerEntryType.MANAGER_PAYOUT
                ? note ?? 'Выплата по ставке'
                : payload.employeeId
                    ? note ?? 'Выплата сотруднику'
                    : note,
            recordedAt: payload.recordedAt ? recordedAt : null,
        };

        const existingIdempotentEntry = idempotencyKey
            ? await prisma.cashEntry.findUnique({
                where: { clientOperationId: idempotencyKey }
            })
            : null;

        if (existingIdempotentEntry) {
            assertIdempotencyPayloadMatches(existingIdempotentEntry, normalizedIdempotencyPayload);
            return NextResponse.json(existingIdempotentEntry, {
                headers: { 'X-Idempotent-Replay': 'true' }
            });
        }

        let managerId: string | null = session.role === 'MANAGER' ? session.id : null;
        let shiftId = payload.shiftId;
        if (session.role === 'MANAGER' && !payload.shiftId) {
            return new NextResponse('Операция менеджера должна относиться к открытой смене', { status: 400 });
        }

        let roomId: string | undefined;
        if (payload.roomId) {
            const room = await prisma.room.findFirst({
                where: {
                    id: payload.roomId,
                    hotelId: payload.hotelId,
                    isActive: true,
                },
                select: { id: true },
            });
            if (!room) {
                return new NextResponse('Комната не найдена, неактивна или принадлежит другому объекту', { status: 400 });
            }
            roomId = room.id;
        }

        if (payload.shiftId) {
            const shift = await prisma.shift.findUnique({ where: { id: payload.shiftId } });
            if (!shift || shift.hotelId !== payload.hotelId) {
                return new NextResponse('Смена не найдена или принадлежит другой точке', { status: 400 });
            }
            if (shift.status !== 'OPEN') {
                return new NextResponse('Закрытую смену нельзя изменять', { status: 409 });
            }
            if (session.role === 'MANAGER' && shift.managerId !== session.id) {
                return new NextResponse('Можно изменять только свою открытую смену', { status: 403 });
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

        if (payload.entryType === LedgerEntryType.MANAGER_PAYOUT) {
            if (!shiftId) {
                return new NextResponse('Для выплаты менеджеру нужна активная смена', { status: 400 });
            }
            if (!managerId) {
                return new NextResponse('Для выплаты менеджеру не найден владелец смены', { status: 400 });
            }

            const payoutShiftId = shiftId;
            try {
                const result = await prisma.$transaction(async (tx) => {
                    // This must be the first operation in the transaction. Every payout for a
                    // shift takes the same row lock, so its balance is recalculated serially.
                    const [lockedShift] = await tx.$queryRaw<LockedShift[]>(Prisma.sql`
                        SELECT "id", "hotelId", "managerId", "status"
                        FROM "Shift"
                        WHERE "id" = ${payoutShiftId}
                        FOR UPDATE
                    `);

                    if (!lockedShift || lockedShift.hotelId !== payload.hotelId) {
                        throw new ExpenseResponseError('Смена не найдена или принадлежит другой точке', 400);
                    }
                    if (lockedShift.status !== 'OPEN') {
                        throw new ExpenseResponseError('Закрытую смену нельзя изменять', 409);
                    }
                    if (session.role === 'MANAGER' && lockedShift.managerId !== session.id) {
                        throw new ExpenseResponseError('Можно изменять только свою открытую смену', 403);
                    }

                    if (idempotencyKey) {
                        const existingEntry = await tx.cashEntry.findUnique({
                            where: { clientOperationId: idempotencyKey }
                        });
                        if (existingEntry) {
                            assertIdempotencyPayloadMatches(existingEntry, normalizedIdempotencyPayload);
                            return { entry: existingEntry, replay: true as const };
                        }
                    }

                    const [assignment, ledgerGroups, bonusTiers, stayRevenue] = await Promise.all([
                        tx.hotelAssignment.findFirst({
                            where: { hotelId: payload.hotelId, userId: lockedShift.managerId, isActive: true },
                            select: { shiftPayAmount: true, revenueSharePct: true }
                        }),
                        tx.cashEntry.groupBy({
                            by: ['entryType'],
                            where: { shiftId: payoutShiftId },
                            _sum: { amount: true }
                        }),
                        tx.bonusTier.findMany({
                            where: { hotelId: payload.hotelId },
                            orderBy: { threshold: 'asc' }
                        }),
                        tx.roomStay.aggregate({
                            where: { shiftId: payoutShiftId, hotelId: payload.hotelId },
                            _sum: { amountPaid: true, onlinePaid: true }
                        })
                    ]);

                    if (!assignment) {
                        throw new ExpenseResponseError('Для менеджера не настроены ставки на этой точке', 400);
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
                        throw new ExpenseResponseError('По текущим ставкам выплата уже закрыта', 400);
                    }

                    const payoutMoney = makeDefaultMoneyBreakdown(payout.pending, hotel.currency);
                    const entry = await tx.cashEntry.create({
                        data: {
                            hotelId: payload.hotelId,
                            shiftId: payoutShiftId,
                            managerId: lockedShift.managerId,
                            categoryId,
                            clientOperationId: idempotencyKey,
                            recordedAt: new Date(),
                            amount: payoutMoney.accountingAmount,
                            originalAmount: payoutMoney.originalAmount,
                            originalCurrency: payoutMoney.originalCurrency,
                            exchangeRate: payoutMoney.exchangeRate,
                            method: payload.method,
                            entryType: payload.entryType,
                            note: payload.note?.trim() || 'Выплата по ставке',
                        }
                    });

                    return { entry, replay: false as const };
                });

                return NextResponse.json(result.entry, result.replay
                    ? { headers: { 'X-Idempotent-Replay': 'true' } }
                    : { status: 201 });
            } catch (error) {
                if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    const replayEntry = await prisma.cashEntry.findUnique({
                        where: { clientOperationId: idempotencyKey }
                    });
                    if (replayEntry) {
                        assertIdempotencyPayloadMatches(replayEntry, normalizedIdempotencyPayload);
                        return NextResponse.json(replayEntry, {
                            headers: { 'X-Idempotent-Replay': 'true' }
                        });
                    }
                }
                throw error;
            }
        }

        if (payload.employeeId) {
            if (!shiftId) return new NextResponse('Для выплаты сотруднику нужна активная смена', { status: 400 });
            const payoutShiftId = shiftId;
            const employeeId = payload.employeeId;
            const entry = await prisma.$transaction(async (tx) => {
                const [lockedShift] = await tx.$queryRaw<LockedShift[]>(Prisma.sql`
                    SELECT "id", "hotelId", "managerId", "status"
                    FROM "Shift" WHERE "id" = ${payoutShiftId} FOR UPDATE
                `);
                if (!lockedShift || lockedShift.hotelId !== payload.hotelId || lockedShift.status !== 'OPEN') {
                    throw new ExpenseResponseError('Активная смена не найдена', 409);
                }
                if (session.role === 'MANAGER' && lockedShift.managerId !== session.id) {
                    throw new ExpenseResponseError('Можно изменять только свою открытую смену', 403);
                }
                if (idempotencyKey) {
                    const existingEntry = await tx.cashEntry.findUnique({ where: { clientOperationId: idempotencyKey } });
                    if (existingEntry) {
                        assertIdempotencyPayloadMatches(existingEntry, normalizedIdempotencyPayload);
                        return existingEntry;
                    }
                }
                const employee = await tx.hotelEmployee.findFirst({
                    where: { id: employeeId, hotelId: payload.hotelId, isActive: true },
                    select: {
                        fullName: true,
                        payType: true,
                        payAmount: true,
                        turnoverThreshold: true,
                        highPayAmount: true,
                        bonusTiers: { orderBy: { threshold: 'desc' }, select: { threshold: true, bonus: true } },
                    }
                });
                if (!employee) throw new ExpenseResponseError('Сотрудник не найден или не работает', 400);
                if (employee.payType !== 'SHIFT') {
                    throw new ExpenseResponseError('Автовыплата доступна сотрудникам со ставкой за смену', 400);
                }
                const alreadyPaid = await tx.cashEntry.findFirst({
                    where: { shiftId: payoutShiftId, employeeId },
                    select: { id: true }
                });
                if (alreadyPaid) throw new ExpenseResponseError('Этому сотруднику уже выплачено за текущую смену', 400);
                const revenue = await tx.cashEntry.aggregate({
                    where: { shiftId: payoutShiftId, entryType: LedgerEntryType.CASH_IN },
                    _sum: { amount: true }
                });
                const turnover = revenue._sum.amount ?? 0;
                const matchedTier = employee.bonusTiers.find((tier) => turnover >= tier.threshold);
                const legacyBonus = !matchedTier
                    && employee.turnoverThreshold != null
                    && employee.highPayAmount != null
                    && turnover >= employee.turnoverThreshold
                    ? Math.max(employee.highPayAmount - employee.payAmount, 0)
                    : 0;
                const cashBonus = matchedTier?.bonus ?? legacyBonus;
                const payoutAmount = employee.payAmount + cashBonus;
                if (payoutAmount <= 0) throw new ExpenseResponseError('Для сотрудника не настроена ставка', 400);
                return tx.cashEntry.create({
                    data: {
                        hotelId: payload.hotelId,
                        shiftId: payoutShiftId,
                        managerId: lockedShift.managerId,
                        employeeId,
                        clientOperationId: idempotencyKey,
                        categoryId,
                        amount: payoutAmount,
                        originalAmount: payoutAmount,
                        originalCurrency: hotel.currency,
                        method: payload.method,
                        entryType: LedgerEntryType.CASH_OUT,
                        note: payload.note?.trim() || 'Выплата сотруднику',
                        meta: {
                            kind: 'EMPLOYEE_PAYOUT',
                            turnover,
                            threshold: matchedTier?.threshold ?? employee.turnoverThreshold,
                            basePay: employee.payAmount,
                            cashBonus,
                            rate: cashBonus > 0 ? 'BONUS' : 'BASE'
                        }
                    }
                });
            });
            return NextResponse.json(entry, { status: 201 });
        }

        const entryData: Prisma.CashEntryUncheckedCreateInput = {
            hotelId: payload.hotelId,
            shiftId,
            managerId,
            categoryId,
            roomId,
            clientOperationId: idempotencyKey,
            recordedAt,
            amount: money.accountingAmount,
            originalAmount: money.originalAmount,
            originalCurrency: money.originalCurrency,
            exchangeRate: money.exchangeRate,
            method: payload.method,
            entryType: payload.entryType,
            note,
        };

        let entry;
        try {
            if (shiftId) {
                const lockedResult = await prisma.$transaction(async (tx) => {
                    const [lockedShift] = await tx.$queryRaw<LockedShift[]>(Prisma.sql`
                        SELECT "id", "hotelId", "managerId", "status"
                        FROM "Shift"
                        WHERE "id" = ${shiftId}
                        FOR UPDATE
                    `);

                    if (!lockedShift || lockedShift.hotelId !== payload.hotelId) {
                        throw new ExpenseResponseError('Смена не найдена или принадлежит другой точке', 400);
                    }
                    if (lockedShift.status !== 'OPEN') {
                        throw new ExpenseResponseError('Закрытую смену нельзя изменять', 409);
                    }
                    if (session.role === 'MANAGER' && lockedShift.managerId !== session.id) {
                        throw new ExpenseResponseError('Можно изменять только свою открытую смену', 403);
                    }

                    if (idempotencyKey) {
                        const existingEntry = await tx.cashEntry.findUnique({
                            where: { clientOperationId: idempotencyKey }
                        });
                        if (existingEntry) {
                            assertIdempotencyPayloadMatches(existingEntry, normalizedIdempotencyPayload);
                            return { entry: existingEntry, replay: true as const };
                        }
                    }

                    const createdEntry = await tx.cashEntry.create({
                        data: { ...entryData, managerId: lockedShift.managerId }
                    });
                    return { entry: createdEntry, replay: false as const };
                });

                if (lockedResult.replay) {
                    return NextResponse.json(lockedResult.entry, {
                        headers: { 'X-Idempotent-Replay': 'true' }
                    });
                }
                entry = lockedResult.entry;
            } else {
                entry = await prisma.cashEntry.create({ data: entryData });
            }
        } catch (error) {
            if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const replayEntry = await prisma.cashEntry.findUnique({
                    where: { clientOperationId: idempotencyKey }
                });
                if (replayEntry) {
                    assertIdempotencyPayloadMatches(replayEntry, normalizedIdempotencyPayload);
                    return NextResponse.json(replayEntry, {
                        headers: { 'X-Idempotent-Replay': 'true' }
                    });
                }
            }
            throw error;
        }

        return NextResponse.json(entry, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof Error && error.message === 'Для оплаты в долларах укажите курс') {
            return new NextResponse(error.message, { status: 400 });
        }
        if (error instanceof ExpenseResponseError) {
            return new NextResponse(error.message, { status: error.status });
        }
        return handleApiError(error, 'Failed to record expense');
    }
}
