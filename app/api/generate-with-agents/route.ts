/**
 * Generate Content Using Agent Skills
 * 
 * This is the new API endpoint for all content generation.
 * It uses the agent skills orchestrator instead of monolithic prompts.
 */

import { NextRequest, NextResponse } from 'next/server';
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
export const maxDuration = 120; // 120 seconds timeout (increased for web search)

// Helper function to call LLM for extracting web queries
async function extractWebQueries(params: {
  context: string;
  apiKey: string;
  baseURL: string;
  model: string;
}): Promise<string[]> {
  const { context, apiKey, baseURL, model } = params;
  
  try {
    const isGemini = baseURL?.includes('generativelanguage.googleapis.com') || model?.includes('gemini');
    const client = new OpenAI({
      apiKey,
      baseURL: isGemini ? undefined : baseURL,
    });

    const prompt = `Analyze the following educational context and extract 3-6 key technical terms or concepts that would benefit from web search. Return ONLY a JSON array of short search queries (2-8 words each), suitable for searching official documentation (e.g., "Promise JavaScript", "fetch API", "Big-O notation").

Context:
${context.substring(0, 10000)}

Return ONLY a JSON array like: ["query1", "query2", "query3"]`;

    if (isGemini) {
      const geminiBase = baseURL.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
      const apiVersion = 'v1beta';
      let geminiModel = (model || '').trim() || 'gemini-1.5-flash';
      const apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const repaired = jsonrepair(text);
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed.filter((q: any) => typeof q === 'string') : [];
    } else {
      const response = await client.chat.completions.create({
        model: model || 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that extracts search queries from educational content. Return ONLY a JSON array.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        // gpt-5.4-mini may reject `max_tokens`; use `max_completion_tokens`.
        max_completion_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '';
      const repaired = jsonrepair(content);
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed.filter((q: any) => typeof q === 'string') : [];
    }
  } catch (error) {
    console.error('Failed to extract web queries:', error);
    // Fallback: simple keyword extraction
    const contextLower = context.toLowerCase();
    const commonTerms = ['promise', 'async', 'await', 'react', 'vue', 'angular', 'nodejs', 'express', 'mongodb', 'sql', 'api', 'rest', 'graphql', 'javascript', 'typescript', 'python', 'java', 'algorithm', 'data structure'];
    const queries: string[] = [];
    for (const term of commonTerms) {
      if (contextLower.includes(term) && queries.length < 6) {
        queries.push(term);
      }
    }
    return queries;
  }
}

export async function POST(req: NextRequest) {
  console.log('[generate-with-agents] ====== REQUEST RECEIVED ======');
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      console.error('[generate-with-agents] Unauthorized: no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[generate-with-agents] User ID:', session.user.id);

    // Check subscription plan for web search access
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperUser: true },
    });

    const plan = subscription?.plan || 'free';
    const planConfig = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG];
    const hasWebSearchAccess = user?.isSuperUser || planConfig?.features?.webSearch || false;

    const body = await req.json();
    console.log('[generate-with-agents] Request body:', {
      moduleType: body.moduleType,
      numberOfItems: body.numberOfItems,
      action: body.action,
      contextLength: body.context?.length || 0,
      hasTaskParams: !!body.taskParams,
      hasLLMConfig: !!body.llmConfig,
    });
    
    const {
      moduleType,
      numberOfItems,
      context,
      taskParams,
      llmConfig,
      languageConfig,
      subject,
      includeWebResources, // Get from body
      action = 'generate', // 'generate' or 'regenerate'
      originalItem, // for regenerate action
    } = body;

    // Validate web search access
    if (includeWebResources && !hasWebSearchAccess) {
      return NextResponse.json(
        { error: 'Web Search is only available for Pro and Premium plans. Please upgrade your subscription.' },
        { status: 403 }
      );
    }

    // Validate required fields
    if (!moduleType) {
      return NextResponse.json({ error: 'moduleType is required' }, { status: 400 });
    }

    if (!llmConfig?.apiKey) {
      return NextResponse.json({ error: 'LLM API key is required' }, { status: 400 });
    }

    if (action === 'generate' && !numberOfItems) {
      return NextResponse.json({ error: 'numberOfItems is required for generate action' }, { status: 400 });
    }

    if (action === 'regenerate' && !originalItem) {
      return NextResponse.json({ error: 'originalItem is required for regenerate action' }, { status: 400 });
    }

    // Extract web queries and gather web sources if enabled
    let webSources: any[] = [];
    if (includeWebResources && hasWebSearchAccess && context) {
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
      } catch (error) {
        console.error('Web search error:', error);
        // Continue without web sources if search fails
      }
    }

    // Build skill context with web sources
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
      additionalParams: {
        ...taskParams,
        webSources: webSources.length > 0 ? webSources : undefined, // Pass web sources to skills
      },
    };

    let results: any;
    let totalTokensUsed = 0;

    if (action === 'regenerate') {
      // Regenerate a single item
      const { item, tokensUsed } = await orchestrator.regenerateItem({
        moduleType,
        originalItem,
        context: context || '',
        taskParams: taskParams || {},
        llmContext: skillContext,
      });
      results = [item];
      totalTokensUsed = tokensUsed;
    } else {
      // Generate multiple items
      console.log('[generate-with-agents] Calling orchestrator.generateQuestions...');
      console.log('[generate-with-agents] Parameters:', {
        moduleType,
        numberOfItems,
        contextLength: context?.length || 0,
        taskParamsKeys: Object.keys(taskParams || {}),
        typeCounts: taskParams?.typeCounts,
      });
      
      const { results: generatedResults, totalTokensUsed: tokens } = await orchestrator.generateQuestions({
        moduleType,
        numberOfItems,
        context: context || '',
        taskParams: taskParams || {},
        llmContext: skillContext,
      });
      
      console.log('[generate-with-agents] Orchestrator returned:', {
        resultsCount: generatedResults?.length || 0,
        totalTokensUsed: tokens,
        firstResultKeys: generatedResults?.[0] ? Object.keys(generatedResults[0]) : [],
        firstResultQuestion: generatedResults?.[0]?.question?.substring(0, 100) || 'NO QUESTION',
        firstResultSolution: generatedResults?.[0]?.solution?.substring(0, 100) || 'NO SOLUTION',
      });
      
      results = generatedResults;
      totalTokensUsed = tokens;
    }

    // Record token usage
    try {
      // Estimate input/output tokens (rough split: 60% input, 40% output)
      const inputTokens = Math.round(totalTokensUsed * 0.6);
      const outputTokens = Math.round(totalTokensUsed * 0.4);
      
      await recordUsage(
        session.user.id,
        moduleType,
        inputTokens,
        outputTokens,
        llmConfig.model || 'unknown'
      );
      
      console.log(`[generate-with-agents] Recorded ${totalTokensUsed} tokens for ${moduleType} (input: ${inputTokens}, output: ${outputTokens})`);
    } catch (usageError: any) {
      // Don't fail the request if usage recording fails
      console.error('[generate-with-agents] Failed to record token usage:', usageError);
    }

    console.log('[generate-with-agents] Final results before returning:', {
      resultsCount: results?.length || 0,
      resultsSample: results?.[0] ? JSON.stringify(results[0]).substring(0, 500) : 'NO RESULTS',
    });

    return NextResponse.json({
      success: true,
      results,
      webSources: webSources.length > 0 ? webSources : undefined, // Include web sources in response
      stats: {
        generated: results.length,
        requested: numberOfItems || 1,
        tokensUsed: totalTokensUsed,
      },
    });

  } catch (error: any) {
    console.error('Agent generation error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to generate content',
        details: error.stack,
      },
      { status: 500 }
    );
  }
}



