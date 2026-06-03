import { NextRequest, NextResponse } from 'next/server';
import { getActiveLLMConfig } from '@/lib/llm/config';
import { skillRegistry } from '@/lib/llm/agent-skills/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      fileType,
      intake,
      llmConfig: rawLLMConfig,
      languageConfig,
      subjectHint,
    } = body || {};

    if (!intake || typeof intake !== 'object') {
      return NextResponse.json({ error: 'intake is required' }, { status: 400 });
    }

    const detector = skillRegistry.getSkill('subject_detector');
    if (!detector) {
      return NextResponse.json({ error: 'subject_detector skill is unavailable' }, { status: 500 });
    }

    const llmConfig = getActiveLLMConfig(rawLLMConfig);
    const skillContext = {
      llmConfig: {
        apiKey: llmConfig?.apiKey || '',
        baseURL: llmConfig?.baseURL || 'https://api.openai.com/v1',
        model: llmConfig?.model || 'gpt-5.5',
        provider: llmConfig?.provider || 'openai',
      },
      languageConfig: {
        primaryLanguage: languageConfig?.primaryLanguage || 'English',
        secondaryLanguage: languageConfig?.secondaryLanguage || 'none',
      },
      subject: typeof subjectHint === 'string' ? subjectHint : '',
      additionalParams: {},
    };

    const result = await detector.execute({
      fileName: String(fileName || intake?.fileName || ''),
      fileType: String(fileType || intake?.fileType || ''),
      outline: intake?.metadata?.refinedOutline || intake?.metadata?.roughOutline || null,
      pages: Array.isArray(intake?.pages) ? intake.pages : [],
      subjectHint: typeof subjectHint === 'string' ? subjectHint : '',
      maxSampleChars: 6000,
    }, skillContext as any);

    if (!result.success || !result.data) {
      return NextResponse.json({ error: result.error || 'Subject detection failed' }, { status: 400 });
    }

    return NextResponse.json({
      subjectId: result.data.subjectId || 'default',
      confidence: Number(result.data.confidence || 0),
      source: result.data.source || 'fallback',
      reason: result.data.reason || '',
      candidateScores: Array.isArray(result.data.candidateScores) ? result.data.candidateScores : [],
      tokensUsed: result.tokensUsed || 0,
      detectedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('detect-subject API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to detect subject' },
      { status: 500 }
    );
  }
}

