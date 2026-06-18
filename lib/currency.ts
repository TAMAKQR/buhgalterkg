export type CashCurrency = 'KGS' | 'KZT' | 'USD';

export type MoneyBreakdown = {
    accountingAmount: number;
    originalAmount: number;
    originalCurrency: CashCurrency;
    exchangeRate: number | null;
};

export const normalizeCurrencyCode = (value?: string | null, fallback = 'KGS'): CashCurrency => {
    const normalized = (value || fallback).trim().toUpperCase();
    if (normalized === 'KZT') {
        return 'KZT';
    }
    return normalized === 'USD' ? 'USD' : 'KGS';
};

export const convertCashToAccounting = ({
    amount,
    currency,
    exchangeRate,
    accountingCurrency = 'KGS'
}: {
    amount: number;
    currency?: string | null;
    exchangeRate?: number | null;
    accountingCurrency?: string | null;
}): MoneyBreakdown => {
    const originalCurrency = normalizeCurrencyCode(currency, accountingCurrency ?? 'KGS');
    const targetCurrency = normalizeCurrencyCode(accountingCurrency, 'KGS');
    const originalAmount = Math.max(Math.round(amount || 0), 0);

    if (originalCurrency === targetCurrency) {
        return {
            accountingAmount: originalAmount,
            originalAmount,
            originalCurrency,
            exchangeRate: null
        };
    }

    if (!exchangeRate || exchangeRate <= 0) {
        throw new Error('Для оплаты в долларах укажите курс');
    }

    return {
        accountingAmount: Math.round((originalAmount * exchangeRate) / 100),
        originalAmount,
        originalCurrency,
        exchangeRate
    };
};

export const makeDefaultMoneyBreakdown = (amount: number, accountingCurrency?: string | null): MoneyBreakdown => ({
    accountingAmount: Math.max(Math.round(amount || 0), 0),
    originalAmount: Math.max(Math.round(amount || 0), 0),
    originalCurrency: normalizeCurrencyCode(accountingCurrency, 'KGS'),
    exchangeRate: null
});

export const addToCurrencyMap = (map: Record<string, number>, currency: string | null | undefined, amount: number) => {
    const key = normalizeCurrencyCode(currency, 'KGS');
    map[key] = (map[key] ?? 0) + amount;
};
