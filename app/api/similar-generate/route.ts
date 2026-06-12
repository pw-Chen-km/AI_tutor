import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { recordUsage } from '@/lib/payments/usage-tracker';
import { jsonrepair } from 'jsonrepair';
import promptTemplates from '@/lib/llm/prompt-templates.json';
import { getRequiredPlatformLLMConfig } from '@/lib/llm/platform';
import { logServerError, publicErrorMessage } from '@/lib/server/api';
import OpenAI from 'openai';

export const runtime = 'nodejs';

interface SimilarGenerateRequest {
    originalItem: any;
    moduleType: 'drills' | 'labs' | 'homework' | 'exams';
    primaryLanguage: string;
    secondaryLanguage: string;
}

function parseJsonContent(raw: string) {
    const text = String(raw || '').trim();
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i)?.[1]
        ?? text.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
    const candidate = (fenced ?? text).trim();
    try {
        return JSON.parse(candidate);
    } catch {
        return JSON.parse(jsonrepair(candidate));
    }
}

async function callPlatformJson(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
    const llmConfig = getRequiredPlatformLLMConfig();
    const isGemini = llmConfig.baseURL?.includes('generativelanguage.googleapis.com') || llmConfig.model?.includes('gemini');

    if (isGemini) {
        const geminiBase = (llmConfig.baseURL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
        const apiVersion = 'v1beta';
        const geminiModel = (llmConfig.model || 'gemini-1.5-flash').replace(/^models\//, '');
        const apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(llmConfig.apiKey)}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: messages.map((msg) => ({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.role === 'system' ? `SYSTEM:\n${msg.content}` : msg.content }],
                })),
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8000,
                    responseMimeType: 'application/json',
                },
            }),
        });
        if (!response.ok) throw new Error(`AI service error (${response.status})`);
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
            parsed: parseJsonContent(content),
            tokenUsage: data.usageMetadata
                ? {
                    promptTokens: data.usageMetadata.promptTokenCount || 0,
                    candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
                }
                : null,
            model: llmConfig.model,
        };
    }

    const client = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseURL || 'https://api.openai.com/v1' });
    const response = await client.chat.completions.create({
        model: llmConfig.model || 'gpt-5.5',
        messages,
        response_format: { type: 'json_object' },
        max_completion_tokens: 8000,
    });
    const content = response.choices[0]?.message?.content || '';
    return {
        parsed: parseJsonContent(content),
        tokenUsage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens || 0,
                completionTokens: response.usage.completion_tokens || 0,
            }
            : null,
        model: llmConfig.model,
    };
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body: SimilarGenerateRequest = await req.json();
        const { originalItem, moduleType, primaryLanguage, secondaryLanguage } = body;

        if (!originalItem || !moduleType) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const hasSecondary = secondaryLanguage && secondaryLanguage !== 'none';

        // Build the prompt using the similar_generate template
        const similarTemplate = (promptTemplates as any).similar_generate;
        
        const systemPrompt = `${similarTemplate.system}

LANGUAGE REQUIREMENTS:
- PRIMARY language for all content: ${primaryLanguage}
${hasSecondary ? `- SECONDARY language: ${secondaryLanguage}. Generate ALL fields in BOTH languages. Use *_secondary suffix for secondary language fields.` : ''}

Output VALID JSON only, no markdown fences.`;

        const userPrompt = `Generate a SIMILAR variant of the following question.

ORIGINAL QUESTION:
${JSON.stringify(originalItem, null, 2)}

Create a new question that:
1. Tests the same concept but uses a different real-world scenario
2. Has different variable/class/function names
3. Uses different numeric values
4. Requires the same algorithmic approach but with new specifics
5. Maintains the same difficulty level
6. Has the same structure and format

${hasSecondary ? `Generate content in BOTH ${primaryLanguage} and ${secondaryLanguage}. Include *_secondary fields for all text content.` : ''}

Output the new question in the SAME JSON format as the original (single object, not array).`;

        const { parsed, tokenUsage, model } = await callPlatformJson([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ]);
        
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('No valid content received from LLM');
        }

        // Record token usage if available
        if (tokenUsage && session?.user?.id) {
            try {
                const usage = tokenUsage as any;
                const inputTokens = usage.promptTokens || usage.prompt_tokens || 0;
                const outputTokens = usage.candidatesTokens || usage.completionTokens || usage.completion_tokens || 0;
                
                if (inputTokens > 0 || outputTokens > 0) {
                    await recordUsage(
                        session.user.id,
                        moduleType,
                        inputTokens,
                        outputTokens,
                        model || 'unknown'
                    );
                }
            } catch (usageError: any) {
                // Don't fail the request if usage recording fails
                logServerError('[similar-generate] Failed to record token usage:', usageError);
            }
        } else if (session?.user?.id) {
            // Fallback: estimate tokens if not provided by API
            try {
                const estimatedInput = JSON.stringify([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]).length / 4;
                const estimatedOutput = JSON.stringify(parsed).length / 4;
                await recordUsage(
                    session.user.id,
                    moduleType,
                    Math.round(estimatedInput),
                    Math.round(estimatedOutput),
                    model || 'unknown'
                );
            } catch (usageError: any) {
                logServerError('[similar-generate] Failed to record estimated token usage:', usageError);
            }
        }

        // Generate a unique variant ID
        const variantId = `v${Date.now().toString(36)}`;
        
        // Preserve original number but mark as variant
        const variant = {
            ...parsed,
            variantId,
            isVariant: true,
            originalNumber: originalItem.number || originalItem.problem_number,
            generatedAt: new Date().toISOString(),
        };

        return NextResponse.json({ variant }, { status: 200 });
    } catch (error: any) {
        logServerError('Similar generate error:', error);
        return NextResponse.json(
            { error: publicErrorMessage(error, 'Failed to generate similar question') },
            { status: 500 }
        );
    }
}
