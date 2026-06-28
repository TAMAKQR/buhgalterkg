'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';

export type AiInsightTone = 'success' | 'warning' | 'danger' | 'default';

export interface AiShiftAnalysisResponse {
    configured: boolean;
    source: 'openai' | 'rules';
    model?: string;
    generatedAt: string;
    summary: string;
    highlights: string[];
    risks: Array<{
        title: string;
        detail: string;
        tone: AiInsightTone;
    }>;
    nextActions: string[];
    dashboard?: {
        period: {
            label: string;
            startDate: string;
            endDate: string;
            days: number;
        };
        riskScore: {
            value: number;
            label: string;
            tone: AiInsightTone;
        };
        kpis: Array<{ label: string; value: string; caption?: string; tone?: AiInsightTone }>;
        moneyFlow: Array<{ label: string; value: number; formatted: string; tone: AiInsightTone }>;
        dailySeries: Array<{ date: string; revenue: number; expenses: number; net: number }>;
        bookingSources: Array<{ label: string; count: number; revenue: number; formattedRevenue: string; share: number; tone?: AiInsightTone }>;
        expenseBreakdown: Array<{ label: string; value: number; formatted: string; share: number; tone?: AiInsightTone }>;
        extranet: {
            enabled: boolean;
            configured: string[];
            coveredCount: number;
            missingConfigured: string[];
            unknownSources: string[];
            withoutSourceCount: number;
        };
        riskChecks: Array<{ label: string; status: 'ok' | 'warn' | 'danger'; value: string; detail: string }>;
    };
}

interface AiAnalysisModalProps {
    analysis: AiShiftAnalysisResponse | null;
    isOpen: boolean;
    title: string;
    subtitle?: string;
    onClose: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

type AiChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

type AiChatResponse = {
    answer: string;
    source: 'openai' | 'rules';
    configured: boolean;
    model?: string;
    generatedAt: string;
};

const aiToneClass: Record<AiInsightTone, string> = {
    success: 'border-emerald-400/30 bg-emerald-950/55 text-emerald-50',
    warning: 'border-amber-400/35 bg-amber-950/55 text-amber-50',
    danger: 'border-rose-400/35 bg-rose-950/55 text-rose-50',
    default: 'border-slate-700 bg-slate-900 text-slate-100'
};

const aiToneSoftClass: Record<AiInsightTone, string> = {
    success: 'border-emerald-400/25 bg-emerald-950/45 text-emerald-50',
    warning: 'border-amber-400/30 bg-amber-950/45 text-amber-50',
    danger: 'border-rose-400/30 bg-rose-950/45 text-rose-50',
    default: 'border-slate-700 bg-slate-900 text-slate-100'
};

const riskStatusClass: Record<'ok' | 'warn' | 'danger', string> = {
    ok: 'border-emerald-400/25 bg-emerald-950/45 text-emerald-50',
    warn: 'border-amber-400/30 bg-amber-950/45 text-amber-50',
    danger: 'border-rose-400/30 bg-rose-950/45 text-rose-50'
};

const barToneClass: Record<AiInsightTone, string> = {
    success: 'bg-emerald-300',
    warning: 'bg-amber-300',
    danger: 'bg-rose-300',
    default: 'bg-cyan-200'
};

const formatGeneratedAt = (value?: string | null) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

const compactAnalysisForChat = (analysis: AiShiftAnalysisResponse) => ({
    summary: analysis.summary,
    highlights: analysis.highlights,
    risks: analysis.risks,
    nextActions: analysis.nextActions,
    dashboard: analysis.dashboard
        ? {
            period: analysis.dashboard.period,
            riskScore: analysis.dashboard.riskScore,
            kpis: analysis.dashboard.kpis,
            moneyFlow: analysis.dashboard.moneyFlow,
            bookingSources: analysis.dashboard.bookingSources,
            expenseBreakdown: analysis.dashboard.expenseBreakdown,
            extranet: analysis.dashboard.extranet,
            riskChecks: analysis.dashboard.riskChecks,
            dailySeries: analysis.dashboard.dailySeries.slice(-14)
        }
        : null
});

export const AiAnalysisModal = ({
    analysis,
    isOpen,
    title,
    subtitle,
    onClose,
    onRefresh,
    isRefreshing = false
}: AiAnalysisModalProps) => {
    const { request } = useApi();
    const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
    const [chatDraft, setChatDraft] = useState('');
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);

    const chatContext = useMemo(() => analysis ? compactAnalysisForChat(analysis) : null, [analysis]);

    useEffect(() => {
        setChatMessages([]);
        setChatDraft('');
        setChatError(null);
    }, [analysis?.generatedAt, title]);

    if (!isOpen || !analysis) {
        return null;
    }

    const generatedAt = formatGeneratedAt(analysis.generatedAt);
    const dashboard = analysis.dashboard;
    const maxMoneyFlow = Math.max(...(dashboard?.moneyFlow.map((item) => Math.abs(item.value)) ?? [0]), 1);
    const maxDaily = Math.max(...(dashboard?.dailySeries.flatMap((item) => [item.revenue, item.expenses]) ?? [0]), 1);
    const suggestedQuestions = dashboard
        ? ['Почему такой риск?', 'Куда уходят деньги?', 'Что сделать первым?']
        : ['Объясни простыми словами', 'Какие риски главные?', 'Что проверить сейчас?'];

    const askAi = async (question: string) => {
        const trimmedQuestion = question.trim();
        if (!trimmedQuestion || !chatContext) {
            return;
        }

        const history = chatMessages.slice(-8);
        setChatMessages((current) => [...current, { role: 'user', content: trimmedQuestion }]);
        setChatDraft('');
        setChatError(null);
        setIsChatLoading(true);
        try {
            const response = await request<AiChatResponse>('/api/ai-analysis/chat', {
                body: {
                    question: trimmedQuestion,
                    title,
                    subtitle,
                    analysis: chatContext,
                    history
                }
            });
            setChatMessages((current) => [...current, { role: 'assistant', content: response.answer }]);
        } catch (error) {
            setChatError(error instanceof Error ? error.message : 'Не удалось получить ответ');
            setChatMessages((current) => [...current, {
                role: 'assistant',
                content: 'Не удалось получить ответ модели. Попробуйте переформулировать вопрос или обновить отчет.'
            }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void askAi(chatDraft);
    };

    return (
        <div className="fixed inset-0 z-[80] bg-[#0b111d] text-slate-100">
            <div className="flex h-full flex-col">
                <header className="shrink-0 border-b border-slate-700 bg-[#0f1726] px-4 py-3 sm:px-6">
                    <div className="mx-auto flex max-w-6xl items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">AI отчет</p>
                            <h2 className="mt-1 break-words text-xl font-semibold tracking-normal sm:text-2xl">{title}</h2>
                            {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1">
                                    {analysis.configured ? 'Ответ модели' : 'Локальная проверка'}
                                </span>
                                {analysis.model ? (
                                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1">{analysis.model}</span>
                                ) : null}
                                {generatedAt ? (
                                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1">{generatedAt}</span>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {onRefresh ? (
                                <Button type="button" size="sm" variant="secondary" onClick={onRefresh} disabled={isRefreshing}>
                                    {isRefreshing ? 'Обновляем...' : 'Обновить'}
                                </Button>
                            ) : null}
                            <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Закрыть AI отчет">
                                <X className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                        {dashboard ? (
                            <section className="grid gap-3 lg:col-span-2">
                                <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
                                    <div className={`rounded-2xl border p-4 ${aiToneSoftClass[dashboard.riskScore.tone]}`}>
                                        <p className="text-[11px] uppercase tracking-[0.22em] opacity-60">Индекс риска</p>
                                        <div className="mt-3 flex items-end justify-between gap-3">
                                            <p className="text-4xl font-semibold tracking-normal">{dashboard.riskScore.value}</p>
                                            <p className="pb-1 text-sm font-semibold">{dashboard.riskScore.label}</p>
                                        </div>
                                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                                            <div
                                                className={`h-full rounded-full ${barToneClass[dashboard.riskScore.tone]}`}
                                                style={{ width: `${Math.min(Math.max(dashboard.riskScore.value, 0), 100)}%` }}
                                            />
                                        </div>
                                        <p className="mt-3 text-xs opacity-65">{dashboard.period.label}: {dashboard.period.startDate} - {dashboard.period.endDate}</p>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                        {dashboard.kpis.map((item) => (
                                            <div key={item.label} className={`rounded-2xl border px-3 py-3 ${aiToneSoftClass[item.tone ?? 'default']}`}>
                                                <p className="text-[10px] uppercase tracking-[0.2em] opacity-55">{item.label}</p>
                                                <p className="mt-2 break-words text-lg font-semibold tracking-normal">{item.value}</p>
                                                {item.caption ? <p className="mt-1 text-xs opacity-65">{item.caption}</p> : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Динамика периода</p>
                                        {dashboard.dailySeries.length ? (
                                            <div className="mt-4 flex h-44 items-end gap-1.5 overflow-x-auto pb-1">
                                                {dashboard.dailySeries.map((item) => {
                                                    const revenueHeight = Math.max(4, Math.round((item.revenue / maxDaily) * 100));
                                                    const expenseHeight = Math.max(4, Math.round((item.expenses / maxDaily) * 100));
                                                    return (
                                                        <div key={item.date} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-1">
                                                            <div className="flex h-32 items-end gap-1">
                                                                <span className="w-2 rounded-t bg-emerald-300/85" style={{ height: `${revenueHeight}%` }} title={`Выручка: ${item.revenue}`} />
                                                                <span className="w-2 rounded-t bg-rose-300/80" style={{ height: `${expenseHeight}%` }} title={`Расходы: ${item.expenses}`} />
                                                            </div>
                                                            <span className="max-w-12 truncate text-[10px] text-slate-500">{item.date.slice(5)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="mt-4 text-sm text-slate-400">Нет движения по дням за период.</p>
                                        )}
                                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-300" />Выручка</span>
                                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-300" />Расходы</span>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Куда уходят деньги</p>
                                        <div className="mt-4 space-y-3">
                                            {dashboard.moneyFlow.map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                                        <span className="text-slate-300">{item.label}</span>
                                                        <span className="font-semibold">{item.formatted}</span>
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                                        <div className={`h-full rounded-full ${barToneClass[item.tone]}`} style={{ width: `${Math.max(3, Math.round((Math.abs(item.value) / maxMoneyFlow) * 100))}%` }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-3 xl:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Источники заселений</p>
                                        <div className="mt-4 space-y-3">
                                            {dashboard.bookingSources.length ? dashboard.bookingSources.map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                                        <span className="truncate text-slate-200">{item.label}</span>
                                                        <span className="shrink-0 text-slate-400">{item.count} · {item.formattedRevenue}</span>
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                                        <div className={`h-full rounded-full ${barToneClass[item.tone ?? 'success']}`} style={{ width: `${Math.max(3, Math.round(item.share * 100))}%` }} />
                                                    </div>
                                                </div>
                                            )) : <p className="text-sm text-slate-400">Источников за период нет.</p>}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Extranet и качество данных</p>
                                        <div className="mt-4 grid gap-2 text-sm">
                                            <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
                                                Подключено: <span className="font-semibold text-white">{dashboard.extranet.enabled ? dashboard.extranet.configured.join(', ') || 'список пуст' : 'extranet выключен'}</span>
                                            </div>
                                            <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
                                                Используется в периоде: <span className="font-semibold text-white">{dashboard.extranet.coveredCount}/{dashboard.extranet.configured.length}</span>
                                            </div>
                                            {dashboard.extranet.unknownSources.length ? (
                                                <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-amber-50">
                                                    Добавить/нормализовать: {dashboard.extranet.unknownSources.join(', ')}
                                                </div>
                                            ) : null}
                                            {dashboard.extranet.missingConfigured.length ? (
                                                <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300">
                                                    Без броней: {dashboard.extranet.missingConfigured.join(', ')}
                                                </div>
                                            ) : null}
                                            {dashboard.extranet.withoutSourceCount ? (
                                                <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-amber-50">
                                                    Без источника: {dashboard.extranet.withoutSourceCount}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-3 xl:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Статьи расходов</p>
                                        <div className="mt-4 space-y-3">
                                            {dashboard.expenseBreakdown.length ? dashboard.expenseBreakdown.map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                                        <span className="truncate text-slate-200">{item.label}</span>
                                                        <span className="shrink-0 text-slate-400">{item.formatted}</span>
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                                        <div className="h-full rounded-full bg-rose-300/85" style={{ width: `${Math.max(3, Math.round(item.share * 100))}%` }} />
                                                    </div>
                                                </div>
                                            )) : <p className="text-sm text-slate-400">Расходов за период нет.</p>}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-slate-700 bg-[#111827] p-4">
                                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Контрольные точки</p>
                                        <div className="mt-4 grid gap-2">
                                            {dashboard.riskChecks.map((item) => (
                                                <div key={item.label} className={`rounded-xl border px-3 py-2 ${riskStatusClass[item.status]}`}>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-sm font-semibold">{item.label}</p>
                                                        <p className="text-xs opacity-75">{item.value}</p>
                                                    </div>
                                                    <p className="mt-1 text-xs leading-5 opacity-72">{item.detail}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </section>
                        ) : null}

                        <section className="rounded-2xl border border-cyan-400/25 bg-cyan-950/45 p-4 sm:p-5">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">Краткий вывод</p>
                            <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-cyan-50 sm:text-lg">{analysis.summary}</p>
                        </section>

                        <section className="rounded-2xl border border-slate-700 bg-[#111827] p-4 sm:p-5">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Что сделать</p>
                            {analysis.nextActions.length ? (
                                <div className="mt-3 space-y-2">
                                    {analysis.nextActions.map((action, index) => (
                                        <div key={`${index}-${action}`} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm leading-6 text-slate-100">
                                            {action}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-slate-400">Нет отдельных действий.</p>
                            )}
                        </section>

                        <section className="rounded-2xl border border-slate-700 bg-[#111827] p-4 sm:p-5 lg:col-span-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Чат по отчету</p>
                                    <h3 className="mt-1 text-base font-semibold text-slate-100">Спросить AI, что к чему</h3>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {suggestedQuestions.map((question) => (
                                        <button
                                            key={question}
                                            type="button"
                                            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-100 disabled:opacity-45"
                                            onClick={() => void askAi(question)}
                                            disabled={isChatLoading}
                                        >
                                            {question}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                                {chatMessages.length ? chatMessages.map((message, index) => (
                                    <div
                                        key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                                        className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm leading-6 ${message.role === 'user'
                                            ? 'ml-auto border-cyan-400/25 bg-cyan-950/45 text-cyan-50'
                                            : 'border-slate-700 bg-slate-900 text-slate-100'}`}
                                    >
                                        <p className="mb-1 text-[10px] uppercase tracking-[0.18em] opacity-55">{message.role === 'user' ? 'Вопрос' : 'AI'}</p>
                                        <p className="whitespace-pre-wrap">{message.content}</p>
                                    </div>
                                )) : (
                                    <p className="py-4 text-center text-sm text-slate-400">
                                        Задайте вопрос по этому отчету: про риски, деньги, источники, расходы или первые действия.
                                    </p>
                                )}
                                {isChatLoading ? (
                                    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                                        AI разбирает отчет...
                                    </div>
                                ) : null}
                            </div>

                            <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleChatSubmit}>
                                <textarea
                                    value={chatDraft}
                                    onChange={(event) => setChatDraft(event.target.value)}
                                    placeholder="Например: почему расходы такие большие?"
                                    rows={2}
                                    className="min-h-11 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/55"
                                    disabled={isChatLoading}
                                />
                                <Button type="submit" variant="secondary" disabled={isChatLoading || !chatDraft.trim()}>
                                    Спросить
                                </Button>
                            </form>
                            {chatError ? <p className="mt-2 text-xs text-rose-300">{chatError}</p> : null}
                        </section>

                        {analysis.highlights.length ? (
                            <section className="rounded-2xl border border-slate-700 bg-[#111827] p-4 sm:p-5 lg:col-span-2">
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Главное по цифрам</p>
                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    {analysis.highlights.map((item, index) => (
                                        <div key={`${index}-${item}`} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm leading-6 text-slate-100">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        <section className="rounded-2xl border border-slate-700 bg-[#111827] p-4 sm:p-5 lg:col-span-2">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Риски и замечания</p>
                            {analysis.risks.length ? (
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    {analysis.risks.map((item, index) => (
                                        <article key={`${index}-${item.title}-${item.detail}`} className={`rounded-xl border px-4 py-3 ${aiToneClass[item.tone]}`}>
                                            <h3 className="text-sm font-semibold">{item.title}</h3>
                                            <p className="mt-2 text-sm leading-6 opacity-80">{item.detail}</p>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-slate-400">Критичных замечаний нет.</p>
                            )}
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
};
