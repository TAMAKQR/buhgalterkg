import { LedgerEntryType, PaymentMethod, RoomStatus, ShiftStatus } from '@prisma/client';
import type { SessionUser } from '@/lib/types';
import { prisma } from '@/lib/db';
import { assertHotelAccess } from '@/lib/permissions';
import { formatDateTime, formatMoney } from '@/lib/timezone';
import { isCollectionLedgerEntry, isStayIncomeNote } from '@/lib/ledger';

type AiTone = 'success' | 'warning' | 'danger' | 'default';

export type AiShiftInsight = {
    title: string;
    detail: string;
    tone: AiTone;
};

export type AiShiftAnalysis = {
    configured: boolean;
    source: 'openai' | 'rules';
    model?: string;
    diagnostic?: string;
    generatedAt: string;
    summary: string;
    highlights: string[];
    risks: AiShiftInsight[];
    nextActions: string[];
};

type ShiftAnalysisMode = 'admin' | 'manager';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

const getOpenAiModel = () => process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

const clampText = (value: string, maxLength: number) => value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
const summarizeOpenAiError = (status: number, body: string) => {
    const message = body
        .replace(/\s+/g, ' ')
        .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
        .trim()
        .slice(0, 220);
    return message ? `OpenAI ${status}: ${message}` : `OpenAI ${status}`;
};

const asNumber = (value?: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const aiTextReplacements: Array<[string, string]> = [
    ['tariffPendingCount', 'количество проживаний без тарифа'],
    ['pendingPostpaid', 'постоплата к получению'],
    ['pendingOnline', 'онлайн-оплаты к подтверждению'],
    ['cashDifference', 'расхождение по кассе'],
    ['MANAGER_PAYOUT', 'выплата менеджеру'],
    ['expectedCash', 'ожидаемые наличные'],
    ['openingCash', 'наличные на старте'],
    ['closingCash', 'фактическая касса при закрытии'],
    ['cardRevenue', 'безналичная выручка'],
    ['cashRevenue', 'наличная выручка'],
    ['stayRevenue', 'выручка по проживаниям'],
    ['adjustments', 'корректировки'],
    ['collections', 'инкассация'],
    ['CHECKED_OUT', 'выселен'],
    ['CHECKED_IN', 'заселен'],
    ['SCHEDULED', 'бронь'],
    ['CASH_OUT', 'расход'],
    ['CASH_IN', 'поступление'],
    ['ADJUSTMENT', 'корректировка'],
    ['closedAt', 'время закрытия'],
    ['expenses', 'расходы'],
    ['revenue', 'выручка'],
    ['payouts', 'выплаты'],
    ['ledger', 'журнал операций'],
    ['stays', 'проживания'],
    ['rooms', 'номера'],
    ['CLOSED', 'закрыта'],
    ['OPEN', 'открыта']
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const humanizeAiText = (value: string) => {
    let result = value;
    for (const [technicalName, humanName] of aiTextReplacements) {
        result = result.replace(new RegExp(`\\b${escapeRegExp(technicalName)}\\b`, 'g'), humanName);
    }
    return result.replace(/`([^`]+)`/g, '$1');
};

const cleanAiText = (value: string, maxLength: number) => clampText(humanizeAiText(value), maxLength);

const parseAiJson = (text: string): Partial<Pick<AiShiftAnalysis, 'summary' | 'highlights' | 'risks' | 'nextActions'>> | null => {
    try {
        const parsed = JSON.parse(text) as Partial<Pick<AiShiftAnalysis, 'summary' | 'highlights' | 'risks' | 'nextActions'>>;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const normalizeAiResult = (
    value: Partial<Pick<AiShiftAnalysis, 'summary' | 'highlights' | 'risks' | 'nextActions'>> | null,
    fallback: AiShiftAnalysis,
    model: string
): AiShiftAnalysis => ({
    configured: true,
    source: 'openai',
    model,
    generatedAt: new Date().toISOString(),
    summary: cleanAiText(typeof value?.summary === 'string' ? value.summary : fallback.summary, 600),
    highlights: Array.isArray(value?.highlights)
        ? value.highlights.filter((item): item is string => typeof item === 'string').map((item) => cleanAiText(item, 220)).slice(0, 5)
        : fallback.highlights,
    risks: Array.isArray(value?.risks)
        ? value.risks
            .filter((item): item is AiShiftInsight => (
                item &&
                typeof item === 'object' &&
                typeof item.title === 'string' &&
                typeof item.detail === 'string'
            ))
            .map((item) => ({
                title: cleanAiText(item.title, 80),
                detail: cleanAiText(item.detail, 260),
                tone: ['success', 'warning', 'danger', 'default'].includes(item.tone) ? item.tone : 'default'
            }))
            .slice(0, 5)
        : fallback.risks,
    nextActions: Array.isArray(value?.nextActions)
        ? value.nextActions.filter((item): item is string => typeof item === 'string').map((item) => cleanAiText(item, 220)).slice(0, 6)
        : fallback.nextActions
});

const fetchOpenAiAnalysis = async (mode: ShiftAnalysisMode, context: unknown, fallback: AiShiftAnalysis) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        return {
            ...fallback,
            diagnostic: 'OPENAI_API_KEY не найден в окружении сервера'
        };
    }

    const model = getOpenAiModel();
    const roleInstruction = mode === 'admin'
        ? 'Ты финансовый ассистент администратора мини-отеля. Проверь смену, кассу, оплаты, долги и операционные риски.'
        : 'Ты помощник менеджера мини-отеля на смене. Дай короткие практичные подсказки, что проверить до закрытия смены.';

    try {
        const response = await fetch(OPENAI_RESPONSES_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                input: [
                    {
                        role: 'system',
                        content: `${roleInstruction} Отвечай только на русском. Не выдумывай факты: если данных нет, так и скажи. Данные приходят в техническом JSON, но в пользовательском тексте запрещено писать JSON-ключи и enum-значения вроде openingCash, expectedCash, pendingPostpaid, CASH_IN, OPEN. Используй понятные русские названия: наличные на старте, ожидаемые наличные, постоплата, поступление, открыта. Верни только JSON по схеме.`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(context)
                    }
                ],
                text: {
                    format: {
                        type: 'json_schema',
                        name: 'shift_ai_analysis',
                        strict: true,
                        schema: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['summary', 'highlights', 'risks', 'nextActions'],
                            properties: {
                                summary: { type: 'string' },
                                highlights: {
                                    type: 'array',
                                    maxItems: 5,
                                    items: { type: 'string' }
                                },
                                risks: {
                                    type: 'array',
                                    maxItems: 5,
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['title', 'detail', 'tone'],
                                        properties: {
                                            title: { type: 'string' },
                                            detail: { type: 'string' },
                                            tone: { type: 'string', enum: ['success', 'warning', 'danger', 'default'] }
                                        }
                                    }
                                },
                                nextActions: {
                                    type: 'array',
                                    maxItems: 6,
                                    items: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            })
        });

        if (!response.ok) {
            const diagnostic = summarizeOpenAiError(response.status, await response.text());
            console.error('[OpenAI] shift analysis failed', { mode, model, diagnostic });
            return {
                ...fallback,
                diagnostic,
                risks: [
                    {
                        title: 'ИИ временно недоступен',
                        detail: `${diagnostic}. Показана локальная проверка по правилам.`,
                        tone: 'warning'
                    },
                    ...fallback.risks
                ].slice(0, 5)
            };
        }

        const data = await response.json() as {
            output_text?: string;
            output?: Array<{ content?: Array<{ text?: string }> }>;
        };
        const outputText = data.output_text
            ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean)
            ?? '';

        return normalizeAiResult(parseAiJson(outputText), fallback, model);
    } catch (error) {
        const diagnostic = error instanceof Error ? error.message : 'Неизвестная ошибка запроса OpenAI';
        console.error('[OpenAI] shift analysis request failed', { mode, model, diagnostic });
        return {
            ...fallback,
            diagnostic,
            risks: [
                {
                    title: 'ИИ временно недоступен',
                    detail: `${diagnostic}. Показана локальная проверка по правилам.`,
                    tone: 'warning'
                },
                ...fallback.risks
            ].slice(0, 5)
        };
    }
};

export const buildShiftAnalysis = async (shiftId: string, mode: ShiftAnalysisMode, user: SessionUser, country?: string) => {
    const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
        include: {
            hotel: true,
            manager: { select: { id: true, displayName: true } },
            ledger: {
                orderBy: { recordedAt: 'asc' },
                include: {
                    expenseCategory: { select: { name: true } }
                }
            },
            stays: {
                orderBy: { scheduledCheckIn: 'asc' },
                include: {
                    room: { select: { label: true, floor: true } }
                }
            }
        }
    });

    if (!shift || (country && shift.hotel.country !== country)) {
        return null;
    }

    assertHotelAccess(user, shift.hotelId);

    if (mode === 'manager' && shift.managerId !== user.id) {
        throw new Error('Можно анализировать только свою смену');
    }

    const rooms = await prisma.room.findMany({
        where: { hotelId: shift.hotelId },
        orderBy: { label: 'asc' },
        include: {
            currentStay: true
        }
    });

    const now = new Date();
    const ledgerTotals: Record<LedgerEntryType, number> = {
        [LedgerEntryType.CASH_IN]: 0,
        [LedgerEntryType.CASH_OUT]: 0,
        [LedgerEntryType.MANAGER_PAYOUT]: 0,
        [LedgerEntryType.ADJUSTMENT]: 0
    };
    const methodTotals: Record<PaymentMethod, number> = {
        [PaymentMethod.CASH]: 0,
        [PaymentMethod.CARD]: 0
    };
    let collections = 0;
    let realExpenses = 0;

    for (const entry of shift.ledger) {
        ledgerTotals[entry.entryType] += entry.amount;
        if (entry.entryType === LedgerEntryType.CASH_IN || entry.entryType === LedgerEntryType.ADJUSTMENT) {
            methodTotals[entry.method] += entry.amount;
        }
        if (entry.entryType === LedgerEntryType.CASH_OUT && isCollectionLedgerEntry(entry)) {
            collections += entry.amount;
        } else if (entry.entryType === LedgerEntryType.CASH_OUT) {
            realExpenses += entry.amount;
        }
    }

    const expectedCash =
        shift.openingCash +
        shift.ledger.reduce((total, entry) => {
            if (entry.method !== PaymentMethod.CASH) {
                return total;
            }
            if (entry.entryType === LedgerEntryType.CASH_IN || entry.entryType === LedgerEntryType.ADJUSTMENT) {
                return total + entry.amount;
            }
            return total - entry.amount;
        }, 0);
    const closingCash = shift.status === ShiftStatus.CLOSED ? shift.closingCash : null;
    const cashDifference = typeof closingCash === 'number' ? closingCash - expectedCash : null;
    const stayRevenue = shift.ledger.reduce(
        (total, entry) => entry.entryType === LedgerEntryType.CASH_IN && isStayIncomeNote(entry.note) ? total + entry.amount : total,
        0
    );
    const pendingOnline = shift.stays.reduce((total, stay) => total + asNumber(stay.onlinePaid), 0);
    const pendingPostpaid = shift.stays.reduce(
        (total, stay) => total + Math.max(asNumber(stay.totalAmount) - asNumber(stay.amountPaid), 0),
        0
    );
    const tariffPendingCount = shift.stays.filter((stay) => stay.tariffPending).length;
    const overdueRooms = rooms
        .filter((room) => room.status === RoomStatus.OCCUPIED && room.currentStay?.scheduledCheckOut && room.currentStay.scheduledCheckOut < now)
        .map((room) => room.label);
    const dirtyRooms = rooms.filter((room) => room.status === RoomStatus.DIRTY).map((room) => room.label);

    const context = {
        mode,
        hotel: {
            name: shift.hotel.name,
            currency: shift.hotel.currency,
            timezone: shift.hotel.timezone
        },
        shift: {
            number: shift.number,
            status: shift.status,
            manager: shift.manager.displayName,
            openedAt: formatDateTime(shift.openedAt, shift.hotel.timezone),
            closedAt: formatDateTime(shift.closedAt, shift.hotel.timezone, undefined, ''),
            openingCash: formatMoney(shift.openingCash, shift.hotel.currency),
            expectedCash: formatMoney(expectedCash, shift.hotel.currency),
            closingCash: closingCash == null ? null : formatMoney(closingCash, shift.hotel.currency),
            cashDifference: cashDifference == null ? null : formatMoney(cashDifference, shift.hotel.currency),
            notes: [shift.openingNote, shift.handoverNote, shift.closingNote].filter(Boolean)
        },
        totals: {
            revenue: formatMoney(ledgerTotals.CASH_IN, shift.hotel.currency),
            stayRevenue: formatMoney(stayRevenue, shift.hotel.currency),
            cashRevenue: formatMoney(methodTotals.CASH, shift.hotel.currency),
            cardRevenue: formatMoney(methodTotals.CARD, shift.hotel.currency),
            expenses: formatMoney(realExpenses, shift.hotel.currency),
            collections: formatMoney(collections, shift.hotel.currency),
            payouts: formatMoney(ledgerTotals.MANAGER_PAYOUT, shift.hotel.currency),
            adjustments: formatMoney(ledgerTotals.ADJUSTMENT, shift.hotel.currency),
            pendingOnline: formatMoney(pendingOnline, shift.hotel.currency),
            pendingPostpaid: formatMoney(pendingPostpaid, shift.hotel.currency),
            tariffPendingCount
        },
        rooms: {
            total: rooms.length,
            occupied: rooms.filter((room) => room.status === RoomStatus.OCCUPIED).length,
            available: rooms.filter((room) => room.status === RoomStatus.AVAILABLE).length,
            dirty: dirtyRooms,
            overdue: overdueRooms
        },
        stays: shift.stays.map((stay) => ({
            room: stay.room.label,
            guest: stay.guestName || 'Гость',
            status: stay.status,
            checkIn: formatDateTime(stay.actualCheckIn ?? stay.scheduledCheckIn, shift.hotel.timezone),
            checkOut: formatDateTime(stay.actualCheckOut ?? stay.scheduledCheckOut, shift.hotel.timezone),
            paid: formatMoney(asNumber(stay.amountPaid), shift.hotel.currency),
            total: stay.totalAmount == null ? null : formatMoney(stay.totalAmount, shift.hotel.currency),
            online: stay.onlinePaid ? formatMoney(stay.onlinePaid, shift.hotel.currency) : null,
            tariffPending: stay.tariffPending,
            bookingSource: stay.bookingSource,
            note: stay.notes
        })).slice(0, 60),
        ledger: shift.ledger.map((entry) => ({
            type: entry.entryType,
            method: entry.method,
            amount: formatMoney(entry.amount, shift.hotel.currency),
            note: entry.note,
            category: entry.expenseCategory?.name,
            at: formatDateTime(entry.recordedAt, shift.hotel.timezone)
        })).slice(-80)
    };

    const highlights = [
        `Выручка за смену: ${formatMoney(ledgerTotals.CASH_IN, shift.hotel.currency)}.`,
        `Ожидаемые наличные: ${formatMoney(expectedCash, shift.hotel.currency)}.`,
        `Расходы без инкассации: ${formatMoney(realExpenses, shift.hotel.currency)}.`
    ];

    const risks: AiShiftInsight[] = [];
    const nextActions: string[] = [];

    if (cashDifference !== null && Math.abs(cashDifference) > 0) {
        risks.push({
            title: 'Расхождение по кассе',
            detail: `Факт отличается от расчёта на ${formatMoney(cashDifference, shift.hotel.currency)}.`,
            tone: Math.abs(cashDifference) >= 10000 ? 'danger' : 'warning'
        });
        nextActions.push('Сверить наличные, корректировки и списания перед подтверждением смены.');
    }
    if (pendingOnline > 0) {
        risks.push({
            title: 'Есть оплаты с сайта',
            detail: `Ожидает подтверждения ${formatMoney(pendingOnline, shift.hotel.currency)}.`,
            tone: 'warning'
        });
        nextActions.push('Проверить поступления с сайта или эквайринга и отметить подтверждённые оплаты.');
    }
    if (pendingPostpaid > 0 || tariffPendingCount > 0) {
        risks.push({
            title: 'Постоплата или тариф без суммы',
            detail: `${formatMoney(pendingPostpaid, shift.hotel.currency)} к доплате, тариф уточняется по ${tariffPendingCount} заселениям.`,
            tone: 'warning'
        });
        nextActions.push('Уточнить тарифы и остатки по гостям с постоплатой.');
    }
    if (overdueRooms.length) {
        risks.push({
            title: 'Просроченные выезды',
            detail: `Номера: ${overdueRooms.join(', ')}.`,
            tone: 'danger'
        });
        nextActions.push('Связаться с гостями по просроченным выездам и обновить статус номеров.');
    }
    if (dirtyRooms.length) {
        risks.push({
            title: 'Есть номера на уборке',
            detail: `Номера: ${dirtyRooms.join(', ')}.`,
            tone: 'default'
        });
        nextActions.push('Проверить уборку перед продажей свободных номеров.');
    }

    if (!risks.length) {
        risks.push({
            title: 'Критичных замечаний нет',
            detail: 'По локальным правилам касса, оплаты и номера выглядят спокойно.',
            tone: 'success'
        });
        nextActions.push('Перед закрытием смены сделать финальную сверку наличных и комментария передачи.');
    }

    const fallback: AiShiftAnalysis = {
        configured: false,
        source: 'rules',
        model: getOpenAiModel(),
        diagnostic: 'Локальная проверка: OpenAI не использовался',
        generatedAt: new Date().toISOString(),
        summary: mode === 'admin'
            ? `Смена №${shift.number}: ${formatMoney(ledgerTotals.CASH_IN, shift.hotel.currency)} поступлений, ${formatMoney(realExpenses, shift.hotel.currency)} расходов, ожидаемая касса ${formatMoney(expectedCash, shift.hotel.currency)}.`
            : `По смене №${shift.number} проверьте кассу ${formatMoney(expectedCash, shift.hotel.currency)}, оплаты с сайта и статусы номеров перед закрытием.`,
        highlights,
        risks: risks.slice(0, 5),
        nextActions: nextActions.slice(0, 6)
    };

    return fetchOpenAiAnalysis(mode, context, fallback);
};
