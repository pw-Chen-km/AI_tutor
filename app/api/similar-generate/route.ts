import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { recordUsage } from '@/lib/payments/usage-tracker';
import { jsonrepair } from 'jsonrepair';
import promptTemplates from '@/lib/llm/prompt-templates.json';

export const runtime = 'nodejs';

interface SimilarGenerateRequest {
    originalItem: any;
    moduleType: 'drills' | 'labs' | 'homework' | 'exams';
    llmConfig: {
        apiKey: string;
        baseURL: string;
        model: string;
    };
    primaryLanguage: string;
    secondaryLanguage: string;
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body: SimilarGenerateRequest = await req.json();
        const { originalItem, moduleType, llmConfig, primaryLanguage, secondaryLanguage } = body;

        if (!originalItem || !moduleType || !llmConfig?.apiKey) {
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

        // Use internal proxy-llm route to handle different LLM providers (Gemini, OpenAI, etc.)
        // Get the request URL to construct the proxy URL
        const baseUrl = req.url ? new URL(req.url).origin : 'http://localhost:3000';
        const proxyUrl = `${baseUrl}/api/proxy-llm`;
        
        console.log('[similar-generate] Calling proxy-llm with:', {
            model: llmConfig.model,
            baseURL: llmConfig.baseURL?.substring(0, 50) + '...',
            hasApiKey: !!llmConfig.apiKey
        });

        const proxyResponse = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: llmConfig.apiKey,
                baseURL: llmConfig.baseURL,
                model: llmConfig.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
        });

        if (!proxyResponse.ok) {
            const errorText = await proxyResponse.text().catch(() => '');
            console.error('[similar-generate] Proxy error:', errorText);
            throw new Error(`LLM API error (${proxyResponse.status}): ${errorText}`);
        }

        // proxy-llm returns JSON object with optional _tokenUsage
        const proxyData = await proxyResponse.json();
        console.log('[similar-generate] Raw proxy response:', JSON.stringify(proxyData).substring(0, 500));
        
        const parsed = proxyData.content || proxyData;
        const tokenUsage = proxyData._tokenUsage;
        
        console.log('[similar-generate] Parsed content:', JSON.stringify(parsed).substring(0, 500));
        
        if (!parsed || typeof parsed !== 'object') {
            console.error('[similar-generate] Invalid parsed content:', parsed);
            throw new Error('No valid content received from LLM');
        }

        // Record token usage if available
        if (tokenUsage && session?.user?.id) {
            try {
                const inputTokens = tokenUsage.promptTokens || tokenUsage.prompt_tokens || 0;
                const outputTokens = tokenUsage.candidatesTokens || tokenUsage.completionTokens || tokenUsage.completion_tokens || 0;
                
                if (inputTokens > 0 || outputTokens > 0) {
                    await recordUsage(
                        session.user.id,
                        moduleType,
                        inputTokens,
                        outputTokens,
                        llmConfig.model || 'unknown'
                    );
                    console.log(`[similar-generate] Recorded ${inputTokens + outputTokens} tokens for ${moduleType}`);
                }
            } catch (usageError: any) {
                // Don't fail the request if usage recording fails
                console.error('[similar-generate] Failed to record token usage:', usageError);
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
                    llmConfig.model || 'unknown'
                );
                console.log(`[similar-generate] Recorded estimated ${Math.round(estimatedInput + estimatedOutput)} tokens for ${moduleType}`);
            } catch (usageError: any) {
                console.error('[similar-generate] Failed to record estimated token usage:', usageError);
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
        console.error('Similar generate error:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to generate similar question' },
            { status: 500 }
        );
    }
}

