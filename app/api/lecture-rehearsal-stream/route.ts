import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { recordUsage } from '@/lib/payments/usage-tracker';
import { gatherWebSources as gatherWebSourcesShared } from '@/lib/web-search/web-search';
import { intakeDocument, type DocumentIntakeResult } from '@/lib/document-intake';
import promptTemplates from '@/lib/llm/prompt-templates.json';

export const runtime = 'nodejs';

const STAGE_CONTEXT_LIMIT = 20000;
const WEB_SOURCES_STAGE_LIMIT = 6000;

interface WebSource {
  term: string;
  title: string;
  url: string;
  extract: string;
  provider?: string;
}

type LectureDocumentInput = {
  name: string;
  type?: string;
  content?: string;
  rawBase64?: string;
  intake?: Partial<DocumentIntakeResult> | null;
};

type NormalizedLectureDocument = DocumentIntakeResult & {
  rawBase64?: string;
};

type IntakeLLMConfig = {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
};

function getLectureAddon(): { system: string; user: string } {
  const raw: any = promptTemplates as any;
  const tpl = raw?.lecture_rehearsal || {};
  return {
    system: typeof tpl?.system === 'string' ? tpl.system : '',
    user: typeof tpl?.user === 'string' ? tpl.user : '',
  };
}

function buildFallbackSkeleton(params: {
  title: string;
  outline?: string[];
  keyTerms?: string[];
  targetMinutes: number;
  audienceLevel: string;
}) {
  const { title, outline, keyTerms, targetMinutes, audienceLevel } = params;
  const mainFlow = (outline || []).slice(0, 5).map((item) => `- ${item}`).join('\n') || '- Introduce the topic\n- Explain the core ideas\n- Walk through one example';
  const terms = (keyTerms || []).slice(0, 5).join(', ');
  return [
    `# ${title || 'Lecture Rehearsal'}`,
    '',
    `## Opening`,
    `- Audience level: ${audienceLevel}`,
    `- Target duration: ${targetMinutes} minutes`,
    terms ? `- Key terms to preview: ${terms}` : `- Preview the key terms and learning goals`,
    '',
    `## Main Flow`,
    mainFlow,
    '',
    `## Recap`,
    `- Revisit the main idea`,
    `- Check understanding with 2-3 quick questions`,
  ].join('\n');
}

function buildContextFromDocuments(documents: NormalizedLectureDocument[]) {
  return documents.map((doc) => `FILE: ${doc.fileName}\n${doc.content || ''}`).join('\n\n---\n\n');
}

function buildDocumentContext(doc: NormalizedLectureDocument) {
  const metadata = {
    fileType: doc.fileType,
    strategy: doc.strategy,
    warnings: doc.warnings,
    metadata: doc.metadata,
  };

  return [
    `FILE: ${doc.fileName}`,
    `INTAKE: ${JSON.stringify(metadata, null, 2)}`,
    '',
    doc.content || '',
  ].join('\n').trim();
}

function buildSlidesFromDocument(doc: NormalizedLectureDocument, startIndex = 0) {
  return (doc.pages || []).map((page, index) => {
    const slideNumber = startIndex + index + 1;
    const pageText = [
      page.text || '',
      page.notes ? `[SPEAKER NOTES]\n${page.notes}` : '',
    ].filter(Boolean).join('\n\n');

    return {
      slide_number: slideNumber,
      original_slide_number: Number(page.pageNumber) || index + 1,
      source_file: doc.fileName,
      text: pageText,
      textLen: Number(page.textLen) || pageText.length,
      features: page.features || {},
      isCover: index === 0 && (Number(page.textLen) || pageText.length) < 30,
    };
  });
}

function getIntakeTextLen(intake: Partial<DocumentIntakeResult> | null): number {
  const pages = Array.isArray(intake?.pages) ? intake.pages : [];
  return pages.reduce((sum, page: any) => sum + Number(page?.textLen || String(page?.text || '').length || 0), 0);
}

function isBlankPdfFallbackIntake(intake: Partial<DocumentIntakeResult> | null, type: string): boolean {
  if (type !== 'pdf' || !intake || !Array.isArray(intake.pages) || intake.pages.length === 0) {
    return false;
  }
  if (getIntakeTextLen(intake) > 0) return false;

  const strategy = String((intake as any).strategy || '').toLowerCase();
  const content = String((intake as any).content || '').toLowerCase();
  const warnings = Array.isArray((intake as any).warnings) ? (intake as any).warnings.join('\n').toLowerCase() : '';
  return strategy.includes('page-count-fallback')
    || content.includes('pdf text extraction failed')
    || warnings.includes('pdf text extraction failed');
}

async function normalizeLectureDocuments(
  inputs: LectureDocumentInput[],
  llmConfig?: IntakeLLMConfig
): Promise<NormalizedLectureDocument[]> {
  const documents: NormalizedLectureDocument[] = [];

  for (const input of inputs) {
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : 'document';
    const type = String(input?.type || name.split('.').pop() || 'unknown').toLowerCase();
    const rawBase64 = typeof input?.rawBase64 === 'string' ? input.rawBase64 : '';
    const intake = input?.intake && typeof input.intake === 'object' ? input.intake : null;
    const blankPdfFallback = isBlankPdfFallbackIntake(intake, type);

    if (intake && Array.isArray(intake.pages) && !blankPdfFallback) {
      const content = String((intake as any).content || input.content || '').trim();
      const pages = intake.pages.length > 0
        ? intake.pages as any
        : content
          ? [{ pageNumber: 1, text: content, textLen: content.length }]
          : [];
      documents.push({
        fileName: name,
        fileType: String((intake as any).fileType || type),
        intent: 'read_for_script_generation',
        strategy: String(intake.strategy || 'client-intake'),
        content,
        pages,
        warnings: Array.isArray(intake.warnings) ? intake.warnings : [],
        metadata: intake.metadata || {},
        rawBase64,
      });
      continue;
    }

    if (rawBase64) {
      const parsed = await intakeDocument({
        fileName: name,
        buffer: Buffer.from(rawBase64, 'base64'),
        intent: 'read_for_script_generation',
        llmConfig,
      });
      documents.push({
        ...parsed,
        warnings: blankPdfFallback
          ? [...(parsed.warnings || []), 'Existing blank PDF page-count fallback was ignored and the raw PDF was reprocessed.']
          : parsed.warnings,
        rawBase64,
      });
      continue;
    }

    const content = String(input?.content || '').trim();
    if (content) {
      documents.push({
        fileName: name,
        fileType: type,
        intent: 'read_for_script_generation',
        strategy: 'client-content-fallback',
        content,
        pages: [{ pageNumber: 1, text: content, textLen: content.length }],
        warnings: [],
        metadata: {},
      });
    }
  }

  return documents.filter((doc) => doc.content.trim() || doc.pages.length > 0);
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (data: { type: string; current?: number; total?: number; message?: string; data?: any }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const session = await getServerSession(authOptions);
        const body = await req.json();
        const apiKey = (body?.apiKey || '').toString();
        const baseURL = (body?.baseURL || '').toString();
        const model = (body?.model || '').toString();
        const provider = (body?.provider || 'openai').toString();
        const apiKeys = body?.apiKeys as Record<string, string> | undefined;
        const providerModels = body?.providerModels as Record<string, string> | undefined;
        const primaryLanguage = (body?.primaryLanguage || 'English').toString();
        const secondaryLanguage = (body?.secondaryLanguage || 'none').toString();
        const includeWebResources = Boolean(body?.includeWebResources);
        const audienceLevel = (body?.audienceLevel || 'beginner').toString();
        const targetMinutes = Number(body?.targetMinutes) || 45;
        const lectureDocumentsInput = Array.isArray(body?.lectureDocuments) ? body.lectureDocuments : [];

        const lectureRoute = await import('../lecture-rehearsal/route');
        const buildLLMPool = (lectureRoute as any).buildLLMPool;
        const callLLMJson = (lectureRoute as any).callLLMJson;
        const buildSlideScriptsBatched = (lectureRoute as any).buildSlideScriptsBatched;
        const translateMarkdown = (lectureRoute as any).translateMarkdown;

        const llmPool = buildLLMPool ? buildLLMPool(apiKeys, provider, baseURL, model, providerModels) : [];
        let effectiveProvider = provider;
        let effectiveApiKey = apiKey;
        let effectiveBaseURL = baseURL;
        let effectiveModel = model;

        if (!effectiveApiKey && llmPool.length > 0) {
          const defaultConfig = llmPool[0];
          effectiveProvider = defaultConfig.provider;
          effectiveApiKey = defaultConfig.apiKey;
          effectiveBaseURL = defaultConfig.baseURL;
          effectiveModel = defaultConfig.model;
        }

        if (!effectiveApiKey && llmPool.length === 0) {
          sendProgress({ type: 'error', message: 'API Key is missing' });
          controller.close();
          return;
        }

        sendProgress({ type: 'progress', message: 'Preparing lecture documents...', current: 0, total: 100 });
        const documents = await normalizeLectureDocuments(lectureDocumentsInput, {
          provider: effectiveProvider,
          apiKey: effectiveApiKey,
          baseURL: effectiveBaseURL,
          model: effectiveModel,
        });
        if (documents.length === 0) {
          sendProgress({ type: 'error', message: 'No lecture documents were provided.' });
          controller.close();
          return;
        }

        const context = buildContextFromDocuments(documents);
        const addon = getLectureAddon();
        const addonSystem = addon.system.trim();
        const addonUser = addon.user.trim();
        const langHintPrimary = `PRIMARY language: ${primaryLanguage}`;
        const langHintSecondary = secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? `SECONDARY language: ${secondaryLanguage}` : 'No secondary language.';
        let totalTokensUsed = 0;

        const buildSecondaryMarkdown = async (markdown: string, label: string) => {
          if (!secondaryLanguage || secondaryLanguage.toLowerCase() === 'none' || !markdown.trim()) {
            return { text: '', tokensUsed: 0 };
          }
          try {
            return await translateMarkdown({
              apiKey: effectiveApiKey,
              baseURL: effectiveBaseURL,
              model: effectiveModel,
              primaryLanguage,
              secondaryLanguage,
              markdown,
              label,
            });
          } catch (error) {
            console.error('[Lecture Rehearsal Stream] Secondary translation failed, continuing with primary only:', error);
            return { text: '', tokensUsed: 0 };
          }
        };

        sendProgress({ type: 'progress', message: 'Planning lecture outline...', current: 5, total: 100 });
        const stage1Schema = `Return JSON with exactly:
{
  "title": "string",
  "outline": ["string"],
  "key_terms": ["string"],
  "web_queries": ["string"]
}
Rules:
- key_terms/web_queries: pick up to 8 items; prefer terms that a beginner may not know.`;

        const stage1Result = await callLLMJson({
          apiKey: effectiveApiKey,
          baseURL: effectiveBaseURL,
          model: effectiveModel,
          maxCompletionTokens: 900,
          messages: [
            {
              role: 'system',
              content:
                `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
                (addonSystem ? `\n\n${addonSystem}` : '') +
                `\n\n${stage1Schema}`,
            },
            {
              role: 'user',
              content:
                `Context (normalized document intake):\n${context.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                `Task: Build a lecture rehearsal plan for an ${audienceLevel} audience, target duration ~${targetMinutes} minutes.\n\n` +
                (audienceLevel === 'beginner'
                  ? `AUDIENCE LEVEL: BEGINNER\n- Students have NO prior knowledge of this topic.\n- Explain EVERY term and concept from first principles.\n- Use simple analogies and step-by-step explanations.\n`
                  : `AUDIENCE LEVEL: INTERMEDIATE\n- Students have BASIC knowledge of the topic but need deeper understanding.\n- Focus on connections, patterns, applications, and trade-offs.\n`) +
                `TARGET DURATION: ${targetMinutes} minutes\n- Plan content to fit within this timeframe.\n\n` +
                `${langHintPrimary}\n${langHintSecondary}\n` +
                (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
            },
          ],
        });
        const stage1 = stage1Result.data;
        totalTokensUsed += stage1Result.tokensUsed || 0;

        const title = typeof stage1?.title === 'string' && stage1.title.trim() ? stage1.title.trim() : 'Lecture Rehearsal';
        const webQueries: string[] = Array.isArray(stage1?.web_queries) ? stage1.web_queries.filter((x: any) => typeof x === 'string') : [];
        const web_sources: WebSource[] = [];
        if (includeWebResources && webQueries.length > 0) {
          sendProgress({ type: 'progress', message: `Searching web for ${webQueries.length} terms...`, current: 15, total: 100 });
          const sources = await gatherWebSourcesShared({ queries: webQueries, primaryLanguage });
          web_sources.push(...sources);
        }

        const results = [];
        let globalSlideOffset = 0;
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          const documentContext = buildDocumentContext(doc);
          const slidesFromPpt = buildSlidesFromDocument(doc, documents.length > 1 ? 0 : globalSlideOffset);
          globalSlideOffset += slidesFromPpt.length;
          if (slidesFromPpt.length === 0) continue;

          sendProgress({
            type: 'progress',
            message: `Generating lecture skeleton for ${doc.fileName}...`,
            current: 25 + Math.round((i / Math.max(documents.length, 1)) * 15),
            total: 100,
          });

          const stage2Schema = `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slide/page notes will be generated separately.
- Keep script_markdown compact: max 260 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap`;

          const stage2Result = await callLLMJson({
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            model: effectiveModel,
            maxCompletionTokens: 1400,
            messages: [
              {
                role: 'system',
                content:
                  `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
                  (addonSystem ? `\n\n${addonSystem}` : '') +
                  `\n\n${stage2Schema}`,
              },
              {
                role: 'user',
                content:
                  `Document context:\n${documentContext.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                  `Lecture plan:\n${JSON.stringify({
                    title,
                    outline: stage1?.outline,
                    key_terms: stage1?.key_terms,
                  }, null, 2).substring(0, 12000)}\n\n---\n\n` +
                  `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                  `This document has ${slidesFromPpt.length} normalized pages/slides from strategy "${doc.strategy}".\n` +
                  `Write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n` +
                  `${langHintPrimary}\n${langHintSecondary}\n` +
                  (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
              },
            ],
          });
          const stage2 = stage2Result.data;
          totalTokensUsed += stage2Result.tokensUsed || 0;

          const script_markdown =
            typeof stage2?.script_markdown === 'string'
              ? stage2.script_markdown
              : typeof stage2?.__raw_text === 'string'
              ? stage2.__raw_text
              : buildFallbackSkeleton({
                  title: doc.fileName,
                  outline: Array.isArray(stage1?.outline) ? stage1.outline : [],
                  keyTerms: Array.isArray(stage1?.key_terms) ? stage1.key_terms : [],
                  targetMinutes,
                  audienceLevel,
                });
          const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${doc.fileName} lecture skeleton`);
          totalTokensUsed += secondaryResult.tokensUsed || 0;

          sendProgress({
            type: 'progress',
            message: `Writing page notes for ${doc.fileName}...`,
            current: 45 + Math.round((i / Math.max(documents.length, 1)) * 45),
            total: 100,
          });

          const batchResult = await buildSlideScriptsBatched({
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            model: effectiveModel,
            primaryLanguage,
            secondaryLanguage,
            audienceLevel,
            targetMinutes,
            addonSystem,
            addonUser,
            context: documentContext,
            slidesFromPpt,
            web_sources,
            llmPool,
            onProgress: (current: number, total: number) => {
              const fileStart = 45 + (i / Math.max(documents.length, 1)) * 45;
              const fileEnd = 45 + ((i + 1) / Math.max(documents.length, 1)) * 45;
              const p = total ? fileStart + (current / total) * (fileEnd - fileStart) : fileStart;
              sendProgress({ type: 'progress', message: `Processing ${doc.fileName}: page ${current}/${total}...`, current: Math.round(p), total: 100 });
            },
          });
          totalTokensUsed += batchResult.tokensUsed || 0;

          const pageTextByNumber = new Map<number, string>();
          slidesFromPpt.forEach((slide) => pageTextByNumber.set(slide.slide_number, slide.text));

          results.push({
            title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : doc.fileName,
            source_file: doc.fileName,
            script_markdown,
            script_markdown_secondary: secondaryResult.text,
            slides: batchResult.slides.map((slide: any) => ({
              ...slide,
              slide_text: pageTextByNumber.get(slide.slide_number) || '',
            })),
            web_sources,
            intake: {
              strategy: doc.strategy,
              warnings: doc.warnings,
              metadata: doc.metadata,
            },
          });
        }

        if (results.length === 0) {
          throw new Error('No usable pages/slides were found in the provided documents.');
        }

        if (session?.user?.id && totalTokensUsed > 0) {
          try {
            const inputTokens = Math.round(totalTokensUsed * 0.6);
            const outputTokens = Math.round(totalTokensUsed * 0.4);
            await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
          } catch (usageError: any) {
            console.error('[lecture-rehearsal-stream] Failed to record token usage:', usageError);
          }
        }

        sendProgress({
          type: 'complete',
          data: results.length === 1 ? results[0] : { results },
        });
      } catch (error: any) {
        console.error('[Lecture Rehearsal Stream] Error:', error);
        sendProgress({ type: 'error', message: error?.message || 'Lecture rehearsal failed' });
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
