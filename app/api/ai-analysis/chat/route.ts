import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/server/session';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1400)
});

const requestSchema = z.object({
    question: z.string().trim().min(2).max(800),
    title: z.string().trim().max(160).optional(),
    subtitle: z.string().trim().max(220).optional().nullable(),
    analysis: z.unknown(),
    history: z.array(chatMessageSchema).max(8).optional()
});

const getOpenAiModel = () => process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

const clampText = (value: string, maxLength: number) => value.trim().replace(/\s+/g, ' ').slice(0, maxLength);

const fallbackAnswer = (question: string) => (
    `ИИ сейчас недоступен, но отчет уже рассчитан по базе. По вопросу "${question}" ориентируйтесь на блоки "Индекс риска", "Контрольные точки", "Куда уходят деньги" и "Что сделать": там показаны причины риска, суммы и первые действия.`
);

export async function POST(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        const payload = requestSchema.parse(await request.json());
        const apiKey = process.env.OPENAI_API_KEY?.trim();

        if (!apiKey) {
            return NextResponse.json({
                answer: fallbackAnswer(payload.question),
                source: 'rules',
                configured: false,
                generatedAt: new Date().toISOString()
            });
        }

        const model = getOpenAiModel();
        const context = {
            userRole: session.role,
            reportTitle: payload.title,
            reportSubtitle: payload.subtitle,
            report: payload.analysis,
            history: payload.history ?? [],
            question: payload.question
        };

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
                        content: 'Ты экспертный помощник внутри отчета мини-отеля. Отвечай только на русском, коротко и практично. Объясняй причины простыми словами, ссылайся на цифры и блоки отчета. Не выдумывай факты, которых нет в переданном отчете. Если просят совет, дай 2-4 конкретных шага.'
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(context)
                    }
                ]
            })
        });

        if (!response.ok) {
            return NextResponse.json({
                answer: fallbackAnswer(payload.question),
                source: 'rules',
                configured: false,
                generatedAt: new Date().toISOString()
            });
        }

        const data = await response.json() as {
            output_text?: string;
            output?: Array<{ content?: Array<{ text?: string }> }>;
        };
        const outputText = data.output_text
            ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean)
            ?? '';

        return NextResponse.json({
            answer: clampText(outputText || fallbackAnswer(payload.question), 1800),
            source: 'openai',
            configured: true,
            model,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to answer AI analysis question');
    }
}
