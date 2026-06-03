import { NextRequest, NextResponse } from 'next/server';
import { getActiveLLMConfig } from '@/lib/llm/config';
import { skillRegistry } from '@/lib/llm/agent-skills/registry';

export const runtime = 'nodejs';
export const maxDuration = 120;

function hasPages(intake: any) {
  return intake && Array.isArray(intake.pages) && intake.pages.length > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      fileType,
      intake,
      llmConfig: rawLLMConfig,
      languageConfig,
      subject,
    } = body || {};

    const normalizedFileName = String(fileName || intake?.fileName || '').trim();
    const normalizedFileType = String(fileType || intake?.fileType || '').trim().toLowerCase();

    if (!normalizedFileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }
    if (!hasPages(intake)) {
      return NextResponse.json({ error: 'intake.pages is required' }, { status: 400 });
    }
    if (!['pdf', 'pptx'].includes(normalizedFileType)) {
      return NextResponse.json(
        { error: `Outline refinement is only supported for PDF/PPTX, got: ${normalizedFileType || 'unknown'}` },
        { status: 400 }
      );
    }

    const llmConfig = getActiveLLMConfig(rawLLMConfig);
    if (!llmConfig?.apiKey) {
      return NextResponse.json({ error: 'LLM API key is required for outline refinement' }, { status: 400 });
    }

    const documentPreprocessor = skillRegistry.getSkill('document_preprocessor');
    const outlineRefiner = skillRegistry.getSkill('outline_refiner');
    if (!documentPreprocessor || !outlineRefiner) {
      return NextResponse.json({ error: 'Outline skills are not available' }, { status: 500 });
    }

    const skillContext = {
      llmConfig: {
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL || 'https://api.openai.com/v1',
        model: llmConfig.model || 'gpt-5.5',
        provider: llmConfig.provider || 'openai',
      },
      languageConfig: {
        primaryLanguage: languageConfig?.primaryLanguage || 'English',
        secondaryLanguage: languageConfig?.secondaryLanguage || 'none',
      },
      subject: subject || 'computer_science',
      additionalParams: {},
    };

    const preprocessed = await documentPreprocessor.execute({
      fileName: normalizedFileName,
      fileType: normalizedFileType,
      intake,
      targetMinutes: 30,
    }, skillContext);

    if (!preprocessed.success || !preprocessed.data) {
      return NextResponse.json(
        { error: preprocessed.error || 'Document preprocessing failed' },
        { status: 400 }
      );
    }

    const refined = await outlineRefiner.execute({
      fileName: normalizedFileName,
      fileType: normalizedFileType,
      pages: preprocessed.data.pages,
      roughOutline: preprocessed.data.rough_outline || preprocessed.data.outline,
    }, skillContext);

    if (!refined.success || !refined.data?.chapters) {
      return NextResponse.json(
        { error: refined.error || 'Outline refinement failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileName: normalizedFileName,
      fileType: normalizedFileType,
      roughOutline: preprocessed.data.rough_outline || preprocessed.data.outline,
      refinedOutline: refined.data,
      outlineSource: 'llm_refined',
      tokensUsed: refined.tokensUsed || 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Outline refinement API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to refine outline' },
      { status: 500 }
    );
  }
}
