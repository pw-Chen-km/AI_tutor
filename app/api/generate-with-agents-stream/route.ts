/**
 * Generate Content Using Agent Skills (Streaming)
 *
 * SSE endpoint for drills/labs/homework/exams with progress updates.
 * Streams: { type: 'progress', current, total, message } then { type: 'complete', results, ... }.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { PLAN_CONFIG } from '@/lib/db/schema';
import { orchestrator } from '@/lib/llm/agent-skills';
import { gatherWebSources } from '@/lib/web-search/web-search';
import { recordUsage } from '@/lib/payments/usage-tracker';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function extractWebQueries(params: {
  context: string;
  apiKey: string;
  baseURL: string;
  model: string;
}): Promise<string[]> {
  const { context, apiKey, baseURL, model } = params;
  try {
    const isGemini =
      baseURL?.includes('generativelanguage.googleapis.com') || model?.includes('gemini');
    const client = new OpenAI({
      apiKey,
      baseURL: isGemini ? undefined : baseURL,
    });
    const prompt = `Analyze the following educational context and extract 3-6 key technical terms or concepts that would benefit from web search. Return ONLY a JSON array of short search queries (2-8 words each).

Context:
${context.substring(0, 10000)}

Return ONLY a JSON array like: ["query1", "query2", "query3"]`;

    if (isGemini) {
      const geminiBase = (baseURL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
      const apiVersion = 'v1beta';
      const geminiModel = (model || '').trim() || 'gemini-1.5-flash';
      const apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(jsonrepair(text));
      return Array.isArray(parsed) ? parsed.filter((q: any) => typeof q === 'string') : [];
    } else {
      const response = await client.chat.completions.create({
        model: model || 'gpt-4',
        messages: [
          { role: 'system', content: 'Return ONLY a JSON array of search queries.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        // gpt-5.4-mini may reject `max_tokens`; use `max_completion_tokens` instead.
        max_completion_tokens: 500,
      });
      const content = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(jsonrepair(content));
      return Array.isArray(parsed) ? parsed.filter((q: any) => typeof q === 'string') : [];
    }
  } catch {
    const ctx = context.toLowerCase();
    const terms = ['promise', 'async', 'react', 'vue', 'nodejs', 'sql', 'api', 'javascript', 'python', 'algorithm'];
    const out: string[] = [];
    for (const t of terms) {
      if (ctx.includes(t) && out.length < 6) out.push(t);
    }
    return out;
  }
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const send = (ctrl: ReadableStreamDefaultController<Uint8Array>, obj: object) => {
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
          send(controller, { type: 'error', message: 'Unauthorized' });
          controller.close();
          return;
        }

        const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
        const user = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { isSuperUser: true },
        });
        const plan = sub?.plan || 'free';
        const planConfig = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG];
        const hasWebSearch = user?.isSuperUser || planConfig?.features?.webSearch || false;

        const body = await req.json();
        const {
          moduleType,
          numberOfItems,
          context,
          taskParams,
          llmConfig,
          languageConfig,
          subject,
          includeWebResources,
        } = body;

        if (!moduleType || !llmConfig?.apiKey) {
          send(controller, { type: 'error', message: 'moduleType and LLM API key are required' });
          controller.close();
          return;
        }
        if (!numberOfItems || numberOfItems < 1) {
          send(controller, { type: 'error', message: 'numberOfItems is required for generate' });
          controller.close();
          return;
        }
        if (includeWebResources && !hasWebSearch) {
          send(controller, { type: 'error', message: 'Web Search requires Pro or Premium plan' });
          controller.close();
          return;
        }

        let webSources: any[] = [];
        if (includeWebResources && hasWebSearch && context) {
          try {
            const queries = await extractWebQueries({
              context,
              apiKey: llmConfig.apiKey,
              baseURL: llmConfig.baseURL || 'https://api.openai.com/v1',
              model: llmConfig.model || 'gpt-4',
            });
            if (queries.length > 0) {
              webSources = await gatherWebSources({
                queries,
                primaryLanguage: languageConfig?.primaryLanguage || 'English',
              });
            }
          } catch (e) {
            console.error('Web search error:', e);
          }
        }

        const skillContext = {
          llmConfig: {
            apiKey: llmConfig.apiKey,
            baseURL: llmConfig.baseURL || 'https://api.openai.com/v1',
            model: llmConfig.model || 'gpt-4',
            provider: llmConfig.provider || 'openai',
          },
          languageConfig: {
            primaryLanguage: languageConfig?.primaryLanguage || 'English',
            secondaryLanguage: languageConfig?.secondaryLanguage || 'none',
          },
          subject: subject || 'computer_science',
          additionalParams: { ...taskParams, webSources: webSources.length > 0 ? webSources : undefined },
        };

        send(controller, {
          type: 'progress',
          current: 0,
          total: numberOfItems,
          message: `Generating 1/${numberOfItems}...`,
        });

        const { results, totalTokensUsed } = await orchestrator.generateQuestions({
          moduleType,
          numberOfItems,
          context: context || '',
          taskParams: taskParams || {},
          llmContext: skillContext,
          onProgress: (current, total, message) => {
            send(controller, { type: 'progress', current, total, message });
          },
        });

        // ALWAYS record tokens usage, even if generation failed or returned empty results
        // This ensures tokens are tracked for all API calls
        try {
          if (totalTokensUsed > 0) {
            const inputTokens = Math.round(totalTokensUsed * 0.6);
            const outputTokens = Math.round(totalTokensUsed * 0.4);
            await recordUsage(session.user.id, moduleType, inputTokens, outputTokens, llmConfig.model || 'unknown');
            console.log(`[generate-with-agents-stream] Recorded ${totalTokensUsed} tokens (input: ${inputTokens}, output: ${outputTokens}) for ${moduleType}`);
          } else {
            console.warn(`[generate-with-agents-stream] No tokens used reported (totalTokensUsed: ${totalTokensUsed})`);
          }
        } catch (e) {
          console.error('[generate-with-agents-stream] Failed to record usage:', e);
          // Don't throw - we still want to return results even if usage recording fails
        }

        send(controller, {
          type: 'complete',
          results,
          totalTokensUsed,
          webSources: webSources.length > 0 ? webSources : undefined,
          stats: { generated: results.length, requested: numberOfItems, tokensUsed: totalTokensUsed },
        });
      } catch (err: any) {
        console.error('[generate-with-agents-stream] Error:', err);
        send(controller, { type: 'error', message: err?.message || 'Failed to generate content' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
