type LedgerCollectionCandidate = {
    entryType?: string;
    note?: string | null;
    categoryName?: string | null;
    category?: { name?: string | null } | null;
    expenseCategory?: { name?: string | null } | null;
};

const normalizeLedgerText = (value?: string | null) => value?.trim().toLocaleLowerCase('ru-RU') ?? '';

export const STAY_INCOME_PREFIXES = [
    'заселение',
    'продление',
    'групповой заезд',
    'предоплата группы',
    'предоплата бронь',
    'пред оплата бронь',
] as const;

const isCollectionText = (value?: string | null) => {
    const normalized = normalizeLedgerText(value);
    return (
        normalized.includes('инкассац') ||
        normalized.includes('инкасац') ||
        normalized.includes('inkass') ||
        normalized.includes('incass') ||
        normalized.includes('collection')
    );
};

export const isCollectionLedgerEntry = (entry: LedgerCollectionCandidate) =>
    entry.entryType === 'CASH_OUT' &&
    (
        isCollectionText(entry.categoryName) ||
        isCollectionText(entry.category?.name) ||
        isCollectionText(entry.expenseCategory?.name) ||
        isCollectionText(entry.note)
    );

export const isStayIncomeNote = (note?: string | null) => {
    const normalized = normalizeLedgerText(note);
    return STAY_INCOME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};
