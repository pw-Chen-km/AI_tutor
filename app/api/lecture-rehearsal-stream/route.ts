import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { recordUsage } from '@/lib/payments/usage-tracker';
import { extractSlidesFromPptx } from '@/lib/parsers/pptx';
import { gatherWebSources as gatherWebSourcesShared } from '@/lib/web-search/web-search';
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

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (data: { type: string; current?: number; total?: number; message?: string; data?: any }) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Get session for token recording
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
        const context = (body?.context || '').toString();
        const pptxBase64 = typeof body?.pptxBase64 === 'string' ? body.pptxBase64 : '';
        const pptxFiles = Array.isArray(body?.pptxFiles) ? body.pptxFiles : [];
        const pptxFileContexts = Array.isArray(body?.pptxFileContexts) ? body.pptxFileContexts : [];
        const pdfFiles = Array.isArray(body?.pdfFiles) ? body.pdfFiles : [];

        // Import LLM pool helpers from main route
        const lectureRouteModule = await import('../lecture-rehearsal/route');
        const buildLLMPool = (lectureRouteModule as any).buildLLMPool;
        const getLLMConfigFromPool = (lectureRouteModule as any).getLLMConfigFromPool;
        
        // Build LLM pool for parallel processing
        const llmPool = buildLLMPool ? buildLLMPool(apiKeys, provider, baseURL, model, providerModels) : [];
        const hasMultipleLLMs = llmPool.length > 1;
        
        // If we have a pool but apiKey is empty, use the first pool entry as default
        let effectiveApiKey = apiKey;
        let effectiveBaseURL = baseURL;
        let effectiveModel = model;
        
        if (!effectiveApiKey && llmPool.length > 0) {
          const defaultConfig = llmPool[0];
          effectiveApiKey = defaultConfig.apiKey;
          effectiveBaseURL = defaultConfig.baseURL;
          effectiveModel = defaultConfig.model;
          console.log(`[Lecture Rehearsal Stream] Using ${defaultConfig.provider} as default LLM provider`);
        }
        
        if (hasMultipleLLMs) {
          console.log(`[Lecture Rehearsal Stream] Multiple LLM providers available: ${llmPool.map((p: any) => p.provider).join(', ')}`);
        }

        if (!effectiveApiKey && llmPool.length === 0) {
          sendProgress({ type: 'error', message: 'API Key is missing' });
          controller.close();
          return;
        }
        if (!context.trim()) {
          sendProgress({ type: 'error', message: 'Context is empty' });
          controller.close();
          return;
        }
        
        let totalTokensUsed = 0;

        const addon = getLectureAddon();
        const addonSystem = addon.system.trim();
        const addonUser = addon.user.trim();

        const langHintPrimary = `PRIMARY language: ${primaryLanguage}`;
        const langHintSecondary = secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? `SECONDARY language: ${secondaryLanguage}` : 'No secondary language.';
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

        const mergeRollingMemory = (memory: any, update: any, coveredPages: number[]) => {
          const toArray = (value: any) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []);
          const mergedTerms = new Map<string, string>();
          for (const item of Array.isArray(memory?.key_terms) ? memory.key_terms : []) {
            if (item?.term) mergedTerms.set(String(item.term), String(item.meaning || ''));
          }
          for (const item of Array.isArray(update?.new_terms) ? update.new_terms : []) {
            if (item?.term) mergedTerms.set(String(item.term), String(item.meaning || ''));
          }
          return {
            document_title: typeof memory?.document_title === 'string' && memory.document_title.trim()
              ? memory.document_title
              : (typeof update?.window_title === 'string' ? update.window_title : 'Lecture Rehearsal'),
            main_theme: typeof update?.main_theme === 'string' && update.main_theme.trim()
              ? update.main_theme
              : (memory?.main_theme || ''),
            teaching_goal: typeof update?.teaching_goal === 'string' && update.teaching_goal.trim()
              ? update.teaching_goal
              : (memory?.teaching_goal || ''),
            section_progress: Array.from(new Set([...toArray(memory?.section_progress), ...toArray(update?.section_progress)])).slice(-12),
            key_terms: Array.from(mergedTerms.entries()).map(([term, meaning]) => ({ term, meaning })).slice(-24),
            open_loops: Array.from(new Set([...toArray(memory?.open_loops), ...toArray(update?.open_loops)])).slice(-12),
            covered_pages: Array.from(new Set([...(Array.isArray(memory?.covered_pages) ? memory.covered_pages : []), ...coveredPages])).sort((a: number, b: number) => a - b),
            next_batch_focus: Array.from(new Set([...toArray(memory?.next_batch_focus), ...toArray(update?.next_batch_focus)])).slice(-8),
          };
        };

        const extractStage2Text = (stage2: any) =>
          typeof stage2?.script_markdown === 'string'
            ? stage2.script_markdown
            : typeof stage2?.__raw_text === 'string'
            ? stage2.__raw_text
            : typeof stage2?.script === 'string'
            ? stage2.script
            : '';

        const getExpectedPageNumbers = (startPage: number, endPage: number) =>
          Array.from({ length: endPage - startPage + 1 }, (_, idx) => startPage + idx);

        const collectValidSlidesForWindow = (slides: any[], startPage: number, endPage: number) => {
          const expected = new Set(getExpectedPageNumbers(startPage, endPage));
          const deduped = new Map<number, { slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }>();

          for (const item of Array.isArray(slides) ? slides : []) {
            const slide_number = Number(item?.slide_number) || 0;
            if (!expected.has(slide_number) || deduped.has(slide_number)) continue;
            deduped.set(slide_number, {
              slide_number,
              slide_title: typeof item?.slide_title === 'string' ? item.slide_title : `Page ${slide_number}`,
              script_markdown: typeof item?.script_markdown === 'string' ? item.script_markdown : '',
              script_markdown_secondary: typeof item?.script_markdown_secondary === 'string' ? item.script_markdown_secondary : '',
            });
          }

          return deduped;
        };

        const getMissingPageNumbers = (slidesMap: Map<number, any>, startPage: number, endPage: number) =>
          getExpectedPageNumbers(startPage, endPage).filter((page) => !slidesMap.has(page));

        const directOpenAIPdfStage2 = async (params: {
          pdfName: string;
          pdfBase64: string;
          pageCount: number;
          stage1: any;
        }) => {
          const { pdfName, pdfBase64, pageCount, stage1 } = params;
          const stage2Schema = `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`;

          const canTryFullPass = shouldAttemptOpenAIFullPdfPass({
            pageCount,
            targetMinutes,
            audienceLevel,
          });

          if (canTryFullPass) {
            try {
              sendProgress({ type: 'progress', message: 'Stage 2: trying full-document PDF pass...', current: 28, total: 100 });
              const fullPass = await callOpenAIResponsesJson({
                apiKey: effectiveApiKey,
                baseURL: effectiveBaseURL,
                model: effectiveModel,
                maxOutputTokens: 1400,
                instructions:
                  `You are an expert teaching assistant. Output VALID JSON only (no markdown fences).` +
                  (addonSystem ? `\n\n${addonSystem}` : '') +
                  `\n\n${stage2Schema}`,
                promptText:
                  `You are given a PDF document directly.\n\n` +
                  `Lecture plan (from model):\n${JSON.stringify(
                    {
                      title,
                      outline: stage1?.outline,
                      key_terms: stage1?.key_terms,
                    },
                    null,
                    2
                  ).substring(0, 12000)}\n\n---\n\n` +
                  `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                  `Now write a lecture rehearsal skeleton for a ${audienceLevel} audience, target ~${targetMinutes} minutes.\n` +
                  `PRIMARY language: ${primaryLanguage}\nSECONDARY language: ${secondaryLanguage}\n` +
                  `Do NOT include slide-by-slide notes here. Only return the compact lecture skeleton JSON.\n` +
                  (addonUser ? `\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
                pdfFileData: pdfBase64,
                pdfFilename: pdfName,
              });

              const stage2 = fullPass.data;
              const stage2Text = extractStage2Text(stage2);
              if (stage2Text.trim()) {
                return { stage2, tokensUsed: fullPass.tokensUsed || 0, mode: 'full_pdf' as const };
              }
            } catch (error: any) {
              console.warn('[Lecture Rehearsal Stream] Full PDF stage2 failed, falling back to windows:', error?.message || error);
            }
          }

          sendProgress({ type: 'progress', message: 'Stage 2: switching to windowed PDF pass...', current: 30, total: 100 });
          const windows = await splitPdfBase64IntoWindows({
            pdfBase64,
            filename: pdfName,
            windowSize: 5,
            overlap: 1,
          });

          let rollingMemory: any = {
            document_title: typeof stage1?.title === 'string' ? stage1.title : title,
            main_theme: '',
            teaching_goal: '',
            section_progress: [],
            key_terms: Array.isArray(stage1?.key_terms)
              ? stage1.key_terms.map((term: string) => ({ term, meaning: '' }))
              : [],
            open_loops: [],
            covered_pages: [],
            next_batch_focus: Array.isArray(stage1?.outline) ? stage1.outline.slice(0, 3) : [],
          };
          const windowSummaries: string[] = [];
          let previousResponseId = '';
          let totalWindowTokens = 0;

          for (let idx = 0; idx < windows.length; idx++) {
            const win = windows[idx];
            const coveredPages = Array.from({ length: win.endPage - win.startPage + 1 }, (_, offset) => win.startPage + offset);
            sendProgress({
              type: 'progress',
              message: `Summarizing PDF window ${idx + 1}/${windows.length} (pages ${win.startPage}-${win.endPage})...`,
              current: 30 + Math.round(((idx + 1) / Math.max(windows.length, 1)) * 20),
              total: 100,
            });

            const windowResult = await callOpenAIResponsesJson({
              apiKey: effectiveApiKey,
              baseURL: effectiveBaseURL,
              model: effectiveModel,
              maxOutputTokens: 900,
              previousResponseId,
              instructions:
                `You are an expert teaching assistant. Output VALID JSON only.` +
                `\nReturn JSON with exactly:\n{\n  "window_title": "string",\n  "window_summary": "string",\n  "main_theme": "string",\n  "teaching_goal": "string",\n  "section_progress": ["string"],\n  "new_terms": [ { "term": "string", "meaning": "string" } ],\n  "open_loops": ["string"],\n  "next_batch_focus": ["string"]\n}`,
              promptText:
                `This is a rolling-memory pass for a PDF lecture.\n\n` +
                `Global lecture plan:\n${JSON.stringify(
                  {
                    title,
                    outline: stage1?.outline,
                    key_terms: stage1?.key_terms,
                  },
                  null,
                  2
                ).substring(0, 9000)}\n\n---\n\n` +
                `Current rolling memory:\n${JSON.stringify(rollingMemory, null, 2).substring(0, 9000)}\n\n---\n\n` +
                `Current PDF window pages: ${win.startPage}-${win.endPage}\n` +
                `Task:\n- Summarize only this window.\n- Preserve continuity with the rolling memory.\n- Note concepts introduced here and what should carry into the next window.\n- Keep window_summary concise but useful for final lecture skeleton synthesis.\n`,
              pdfFileData: win.fileData,
              pdfFilename: win.filename,
            });

            previousResponseId = windowResult.responseId || previousResponseId;
            totalWindowTokens += windowResult.tokensUsed || 0;
            const update = windowResult.data || {};
            const windowSummary =
              typeof update?.window_summary === 'string'
                ? update.window_summary.trim()
                : typeof update?.__raw_text === 'string'
                ? update.__raw_text.trim()
                : '';
            if (windowSummary) {
              windowSummaries.push(`Pages ${win.startPage}-${win.endPage}: ${windowSummary}`);
            }
            rollingMemory = mergeRollingMemory(rollingMemory, update, coveredPages);
          }

          const finalStage2 = await callLLMJson({
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            model: effectiveModel,
            maxCompletionTokens: 1200,
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
                  `Lecture plan:\n${JSON.stringify(
                    {
                      title,
                      outline: stage1?.outline,
                      key_terms: stage1?.key_terms,
                    },
                    null,
                    2
                  ).substring(0, 12000)}\n\n---\n\n` +
                  `Rolling memory:\n${JSON.stringify(rollingMemory, null, 2).substring(0, 12000)}\n\n---\n\n` +
                  `Window summaries:\n${windowSummaries.join('\n\n').substring(0, 14000)}\n\n---\n\n` +
                  `Write the final lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n` +
                  `PRIMARY language: ${primaryLanguage}\nSECONDARY language: ${secondaryLanguage}\n` +
                  `Return only the compact stage 2 JSON.\n` +
                  (addonUser ? `\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
              },
            ],
          });

          return {
            stage2: finalStage2.data,
            tokensUsed: totalWindowTokens + (finalStage2.tokensUsed || 0),
            mode: 'window_pdf' as const,
          };
        };

        // Import functions from main route
        const lectureRoute = await import('../lecture-rehearsal/route');
        const callLLMJson = (lectureRoute as any).callLLMJson;
        const buildSlideScriptsBatched = (lectureRoute as any).buildSlideScriptsBatched;
        const splitContextByFile = (lectureRoute as any).splitContextByFile;
        const extractPdfPagesFromContent = (lectureRoute as any).extractPdfPagesFromContent;
        const extractPdfPagesFromBase64 = (lectureRoute as any).extractPdfPagesFromBase64;
        const buildCompactPdfContext = (lectureRoute as any).buildCompactPdfContext;
        const buildSlidePlan = (lectureRoute as any).buildSlidePlan;
        const splitPdfBase64IntoWindows = (lectureRoute as any).splitPdfBase64IntoWindows;
        const getPdfPageCountFromBase64 = (lectureRoute as any).getPdfPageCountFromBase64;
        const extractSinglePdfPageBase64 = (lectureRoute as any).extractSinglePdfPageBase64;
        const shouldAttemptOpenAIFullPdfPass = (lectureRoute as any).shouldAttemptOpenAIFullPdfPass;
        const callOpenAIResponsesJson = (lectureRoute as any).callOpenAIResponsesJson;
        const translateMarkdown = (lectureRoute as any).translateMarkdown;

        const directPdfCandidate =
          provider === 'openai' && pptxFiles.length === 0 && pdfFiles.length === 1
            ? pdfFiles[0]
            : null;

        if (directPdfCandidate) {
          const pdfName = typeof directPdfCandidate?.name === 'string' ? directPdfCandidate.name : 'lecture.pdf';
          const pdfBase64 = typeof directPdfCandidate?.base64 === 'string' ? directPdfCandidate.base64 : '';
          if (!pdfBase64) {
            sendProgress({ type: 'error', message: 'PDF base64 is missing for direct PDF mode.' });
            controller.close();
            return;
          }
          const windows = await splitPdfBase64IntoWindows({
            pdfBase64,
            filename: pdfName,
            windowSize: 5,
            overlap: 1,
          });
          const pageCount = await getPdfPageCountFromBase64(pdfBase64);
          const pdfPages = await extractPdfPagesFromBase64(pdfBase64);
          const directSlidePlans = buildSlidePlan({
            slidesFromPpt: pdfPages.map((page: any) => ({
              slide_number: page.page,
              text: page.text,
              textLen: page.textLen,
              isCover: page.page === 1 && page.textLen < 30,
            })),
            audienceLevel,
            targetMinutes,
          });
          const directSlidePlanByPage = new Map<number, any>(
            directSlidePlans.map((plan: any) => [Number(plan.slide_number) || 0, plan])
          );
          const pdfPageTextByPage = new Map<number, string>(
            pdfPages.map((page: any) => [Number(page.page) || 0, typeof page.text === 'string' ? page.text : ''])
          );
          let rollingMemory: any = {
            document_title: pdfName.replace(/\.pdf$/i, ''),
            main_theme: '',
            teaching_goal: '',
            section_progress: [],
            key_terms: [],
            open_loops: [],
            covered_pages: [],
            next_batch_focus: [],
          };
          const slidesMap = new Map<number, { slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }>();
          const windowSummaries: string[] = [];
          let previousResponseId = '';

          sendProgress({ type: 'progress', message: 'Generating rolling-window PDF notes...', current: 0, total: 100 });

          for (let idx = 0; idx < windows.length; idx++) {
            const win = windows[idx];
            const coveredPages = Array.from({ length: win.endPage - win.startPage + 1 }, (_, offset) => win.startPage + offset);
            const windowPlans = coveredPages.map((pageNumber) => {
              const plan = directSlidePlanByPage.get(pageNumber);
              return {
                slide_number: pageNumber,
                slide_type: plan?.slide_type || 'concept',
                target_words: plan?.target_words || 120,
                must_cover: Array.isArray(plan?.must_cover) ? plan.must_cover : [],
                topic_labels: Array.isArray(plan?.topic_labels) ? plan.topic_labels : [],
              };
            });
            sendProgress({
              type: 'progress',
              message: `Analyzing PDF window ${idx + 1}/${windows.length} (pages ${win.startPage}-${win.endPage})...`,
              current: 5 + Math.round(((idx + 1) / Math.max(windows.length, 1)) * 80),
              total: 100,
            });

            let windowResult: any = null;
            let update: any = null;
            let validSlides = new Map<number, { slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }>();
            const maxRetries = 2;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              windowResult = await callOpenAIResponsesJson({
                apiKey: effectiveApiKey,
                baseURL: effectiveBaseURL,
                model: effectiveModel,
                maxOutputTokens: secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? 3200 : 2200,
                previousResponseId,
                instructions:
                  `You are an expert teaching assistant. Output VALID JSON only.` +
                  (addonSystem ? `\n\n${addonSystem}` : '') +
                  `\nReturn JSON with exactly:\n{\n  "window_title": "string",\n  "window_summary": "string",\n  "teaching_goal": "string",\n  "section_progress": ["string"],\n  "new_terms": [ { "term": "string", "meaning": "string" } ],\n  "open_loops": ["string"],\n  "next_batch_focus": ["string"],\n  "slides": [\n    {\n      "slide_number": number,\n      "slide_title": "string",\n      "script_markdown": "string",\n      "script_markdown_secondary": "string"\n    }\n  ]\n}\n` +
                  `Rules:\n- First analyze the current window and infer a mini skeleton for these pages.\n- Then produce page notes for each PDF page in this window.\n- You MUST return EVERY page number from ${win.startPage} to ${win.endPage} exactly once.\n- Do not skip any page, even if it looks like a divider or cover.\n- slide_number must use the original PDF page number.\n- script_markdown must be grounded in that page only.\n- Respect each page's heuristic plan: slide_type, target_words, must_cover, topic_labels.\n- transition pages should be brief cue notes rather than full explanations.\n- concept pages can be fuller explanations.\n- example pages should explain what the example demonstrates.\n- summary pages should recap and connect.\n- script_markdown_secondary should be "" when no secondary language is enabled.\n`,
                promptText:
                  `This is a rolling-window lecture generation pass.\n\n` +
                  `Current rolling memory:\n${JSON.stringify(rollingMemory, null, 2).substring(0, 9000)}\n\n---\n\n` +
                  `Window heuristic plan:\n${JSON.stringify(windowPlans, null, 2).substring(0, 9000)}\n\n---\n\n` +
                  `Current PDF window pages: ${win.startPage}-${win.endPage} of ${pageCount}\n` +
                  `Audience: ${audienceLevel}. Target duration overall ~${targetMinutes} minutes.\n` +
                  `${langHintPrimary}\n${langHintSecondary}\n` +
                  `Task:\n1. Analyze these pages and infer the local skeleton / teaching purpose.\n2. Update rolling memory.\n3. Produce page notes for every page in this window while following the heuristic plan.\n4. Keep continuity with previous windows, but do not repeat earlier explanations unnecessarily.\n\n` +
                  `Required example shape:\n` +
                  `{\n` +
                  `  "window_title": "Example Window",\n` +
                  `  "window_summary": "Pages ${win.startPage}-${win.endPage} introduce X, then explain Y, then wrap up with Z.",\n` +
                  `  "teaching_goal": "Help learners understand the concept progression in this window.",\n` +
                  `  "section_progress": ["Introduce concept X", "Explain concept Y", "Reinforce with example Z"],\n` +
                  `  "new_terms": [{"term": "X", "meaning": "short definition"}],\n` +
                  `  "open_loops": [],\n` +
                  `  "next_batch_focus": ["Continue from the last concept"],\n` +
                  `  "slides": [\n` +
                  `    {"slide_number": ${win.startPage}, "slide_title": "Page ${win.startPage}", "script_markdown": "Brief cue notes for a transition page or fuller notes for a concept page, depending on the heuristic plan.", "script_markdown_secondary": ""},\n` +
                  `    {"slide_number": ${Math.min(win.startPage + 1, win.endPage)}, "slide_title": "Page ${Math.min(win.startPage + 1, win.endPage)}", "script_markdown": "Notes that cover the required must_cover items and fit the target_words guidance.", "script_markdown_secondary": ""}\n` +
                  `  ]\n` +
                  `}\n\n` +
                  `Validation rule: your "slides" array must contain all page numbers ${win.startPage}-${win.endPage}.` +
                  (attempt > 0 ? `\n\nRetry ${attempt}/${maxRetries}: your previous answer missed one or more required page numbers. Return a complete set now.` : '') +
                  (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
                pdfFileData: win.fileData,
                pdfFilename: win.filename,
              });

              update = windowResult.data || {};
              validSlides = collectValidSlidesForWindow(update?.slides, win.startPage, win.endPage);
              const missingPages = getMissingPageNumbers(validSlides, win.startPage, win.endPage);
              if (missingPages.length === 0) {
                break;
              }
              if (attempt === maxRetries) {
                console.warn(`[Lecture Rehearsal Stream] Window ${win.startPage}-${win.endPage} still missing pages after retries: ${missingPages.join(', ')}`);
              } else {
                console.warn(`[Lecture Rehearsal Stream] Window ${win.startPage}-${win.endPage} missing pages: ${missingPages.join(', ')}. Retrying...`);
              }
            }

            let nextPreviousResponseId = windowResult?.responseId || previousResponseId;
            const finalMissingPages = getMissingPageNumbers(validSlides, win.startPage, win.endPage);
            if (finalMissingPages.length > 0) {
              console.warn(`[Lecture Rehearsal Stream] Attempting single-page rescue for window ${win.startPage}-${win.endPage}: ${finalMissingPages.join(', ')}`);

              for (const missingPage of finalMissingPages) {
                sendProgress({
                  type: 'progress',
                  message: `Recovering missing PDF page ${missingPage}...`,
                  current: 5 + Math.round(((idx + 1) / Math.max(windows.length, 1)) * 80),
                  total: 100,
                });

                try {
                  const singlePagePdf = await extractSinglePdfPageBase64({
                    pdfBase64,
                    filename: pdfName,
                    pageNumber: missingPage,
                  });
                  const pagePlan = directSlidePlanByPage.get(missingPage);
                  const pageTextPreview = (pdfPageTextByPage.get(missingPage) || '').trim().slice(0, 2500);

                  const rescueResult = await callOpenAIResponsesJson({
                    apiKey: effectiveApiKey,
                    baseURL: effectiveBaseURL,
                    model: effectiveModel,
                    maxOutputTokens: secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? 1600 : 1000,
                    previousResponseId: nextPreviousResponseId,
                    instructions:
                      `You are an expert teaching assistant. Output VALID JSON only.` +
                      (addonSystem ? `\n\n${addonSystem}` : '') +
                      `\nReturn JSON with exactly:\n{\n  "slides": [\n    {\n      "slide_number": number,\n      "slide_title": "string",\n      "script_markdown": "string",\n      "script_markdown_secondary": "string"\n    }\n  ]\n}\n` +
                      `Rules:\n- This is a single-page rescue pass for a missing PDF page.\n- You MUST return exactly one slide.\n- That slide_number MUST be ${missingPage}.\n- Ground the notes in this page only.\n- Respect the page heuristic plan.\n- If the page is a transition/divider page, keep the notes brief and cue-based.\n- script_markdown_secondary should be "" when no secondary language is enabled.\n`,
                    promptText:
                      `This page was missing from a previous window response and must now be recovered.\n\n` +
                      `Current rolling memory:\n${JSON.stringify(rollingMemory, null, 2).substring(0, 6000)}\n\n---\n\n` +
                      `Page heuristic plan:\n${JSON.stringify({
                        slide_number: missingPage,
                        slide_type: pagePlan?.slide_type || 'concept',
                        target_words: pagePlan?.target_words || 120,
                        must_cover: Array.isArray(pagePlan?.must_cover) ? pagePlan.must_cover : [],
                        topic_labels: Array.isArray(pagePlan?.topic_labels) ? pagePlan.topic_labels : [],
                      }, null, 2)}\n\n---\n\n` +
                      `Extracted page text preview (from backend PDF text extraction, use this as a coverage check):\n${pageTextPreview || '[No extractable text found on this page]'}\n\n---\n\n` +
                      `Current PDF page: ${missingPage} of ${pageCount}\n` +
                      `Audience: ${audienceLevel}. Target duration overall ~${targetMinutes} minutes.\n` +
                      `${langHintPrimary}\n${langHintSecondary}\n` +
                      `Task:\n1. Infer this page's local role from the PDF page and the heuristic plan.\n2. Produce notes for this page only.\n3. Make sure the notes cover the page's visible content and any must_cover items.\n\n` +
                      `Required example shape:\n` +
                      `{\n` +
                      `  "slides": [\n` +
                      `    {"slide_number": ${missingPage}, "slide_title": "Page ${missingPage}", "script_markdown": "Page-specific notes that match the heuristic plan and extracted text preview.", "script_markdown_secondary": ""}\n` +
                      `  ]\n` +
                      `}\n` +
                      (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
                    pdfFileData: singlePagePdf.fileData,
                    pdfFilename: singlePagePdf.filename,
                  });

                  totalTokensUsed += rescueResult?.tokensUsed || 0;
                  nextPreviousResponseId = rescueResult?.responseId || nextPreviousResponseId;

                  const rescuedSlides = collectValidSlidesForWindow(
                    rescueResult?.data?.slides,
                    missingPage,
                    missingPage
                  );
                  const rescuedSlide = rescuedSlides.get(missingPage);
                  if (rescuedSlide) {
                    validSlides.set(missingPage, rescuedSlide);
                  } else {
                    console.warn(`[Lecture Rehearsal Stream] Single-page rescue did not return page ${missingPage}`);
                  }
                } catch (rescueError: any) {
                  console.warn(
                    `[Lecture Rehearsal Stream] Single-page rescue failed for page ${missingPage}:`,
                    rescueError?.message || rescueError
                  );
                }
              }

              const unresolvedPages = getMissingPageNumbers(validSlides, win.startPage, win.endPage);
              if (unresolvedPages.length > 0) {
                throw new Error(`Direct PDF window ${win.startPage}-${win.endPage} is missing required page notes for pages: ${unresolvedPages.join(', ')}`);
              }
            }

            previousResponseId = nextPreviousResponseId;
            totalTokensUsed += windowResult?.tokensUsed || 0;
            const summary =
              typeof update?.window_summary === 'string'
                ? update.window_summary.trim()
                : typeof update?.__raw_text === 'string'
                ? update.__raw_text.trim()
                : '';
            if (summary) {
              windowSummaries.push(`Pages ${win.startPage}-${win.endPage}: ${summary}`);
            }
            rollingMemory = mergeRollingMemory(rollingMemory, update, coveredPages);
            for (const [slide_number, slideData] of validSlides.entries()) {
              if (slidesMap.has(slide_number)) continue;
              slidesMap.set(slide_number, slideData);
            }
          }

          const title = rollingMemory.document_title || pdfName.replace(/\.pdf$/i, '');
          const script_markdown = buildFallbackSkeleton({
            title,
            outline: rollingMemory.section_progress,
            keyTerms: Array.isArray(rollingMemory.key_terms) ? rollingMemory.key_terms.map((item: any) => item.term).filter(Boolean) : [],
            targetMinutes,
            audienceLevel,
          }) + (windowSummaries.length > 0 ? `\n\n## Window Flow\n${windowSummaries.map((item) => `- ${item}`).join('\n')}` : '');
          const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${title} lecture skeleton`);
          totalTokensUsed += secondaryResult.tokensUsed || 0;
          const script_markdown_secondary = secondaryResult.text;
          const slides = Array.from(slidesMap.values()).sort((a, b) => a.slide_number - b.slide_number);

          if (session?.user?.id && totalTokensUsed > 0) {
            try {
              const inputTokens = Math.round(totalTokensUsed * 0.6);
              const outputTokens = Math.round(totalTokensUsed * 0.4);
              await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
            } catch (usageError: any) {
              console.error('[lecture-rehearsal-stream] Failed to record usage for direct PDF mode:', usageError);
            }
          }

          sendProgress({
            type: 'complete',
            data: {
              title,
              source_file: pdfName,
              script_markdown,
              script_markdown_secondary,
              slides,
              web_sources: [],
            },
          });
          controller.close();
          return;
        }
        
        // Stage 1: decide outline + key terms to lookup
        sendProgress({ type: 'progress', message: 'Planning lecture outline...', current: 0, total: 100 });
        
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
                `Context (may contain slides/notes/code):\n${context.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                `Task: Build a lecture rehearsal plan for an ${audienceLevel} audience, target duration ~${targetMinutes} minutes.\n\n` +
                (audienceLevel === 'beginner'
                  ? `AUDIENCE LEVEL: BEGINNER\n- Students have NO prior knowledge of this topic.\n- Explain EVERY term and concept from first principles (what it is, why it exists, how it works).\n- Use simple analogies and real-world examples that beginners can relate to.\n- Break down complex ideas into smaller, digestible pieces.\n- Avoid jargon without explanation. If you must use technical terms, define them immediately.\n- Assume students need step-by-step guidance.\n- Use "think of it like..." or "imagine that..." frequently.\n`
                  : `AUDIENCE LEVEL: INTERMEDIATE\n- Students have BASIC knowledge of the topic but need deeper understanding.\n- You can reference fundamental concepts without full explanation (e.g., "as you know, variables store data...").\n- Focus on connections, patterns, and advanced applications rather than basic definitions.\n- Use technical terminology appropriately; only explain new or complex terms.\n- Assume students can follow logical reasoning and make connections.\n- Discuss trade-offs, best practices, and real-world applications.\n- Can introduce related concepts and show how they integrate.\n`) +
                `TARGET DURATION: ${targetMinutes} minutes\n- Plan content to fit within this timeframe.\n- Allocate time per section (e.g., "Section 1: Introduction (5 min)", "Section 2: Core Concepts (15 min)").\n- If target is ≤30 minutes: Keep explanations concise, focus on key points only.\n- If target is 45-60 minutes: Provide moderate detail with examples.\n- If target is ≥90 minutes: Include comprehensive explanations, multiple examples, and deeper discussions.\n- Adjust slide-by-slide script length accordingly (shorter time = shorter per-slide scripts, longer time = more detailed per-slide scripts).\n\n` +
                `${langHintPrimary}\n${langHintSecondary}\n` +
                (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
            },
          ],
        });
        const stage1 = stage1Result.data;
        totalTokensUsed += stage1Result.tokensUsed || 0;

        const title = typeof stage1?.title === 'string' && stage1.title.trim() ? stage1.title.trim() : 'Lecture Rehearsal';
        const webQueries: string[] = Array.isArray(stage1?.web_queries) ? stage1.web_queries.filter((x: any) => typeof x === 'string') : [];
        const fileBlocks = splitContextByFile(context);
        const pdfBlocks = fileBlocks.filter((b: any) => b.fileName.toLowerCase().endsWith('.pdf'));

        // Web lookup
        const web_sources: WebSource[] = [];
        if (includeWebResources && webQueries.length > 0) {
          sendProgress({ type: 'progress', message: `Searching web for ${webQueries.length} terms...`, current: 20, total: 100 });
          const sources = await gatherWebSourcesShared({ queries: webQueries, primaryLanguage });
          web_sources.push(...sources);
        }

        // Mixed files: generate each file separately (each file's slides use llmPool for parallel batch processing)
        if ((pptxFiles.length > 1) || (pdfBlocks.length > 1) || (pptxFiles.length > 0 && pdfBlocks.length > 0)) {
          const results: any[] = [];
          const totalFilesForProgress = pptxFiles.length + pdfBlocks.length;

          for (let i = 0; i < pptxFiles.length; i++) {
            const f: any = pptxFiles[i];
            const name = typeof f?.name === 'string' ? f.name : `pptx-${i + 1}`;
            const base64 = typeof f?.base64 === 'string' ? f.base64 : '';
            const ctx = pptxFileContexts.find((c: any) => c?.name === name)?.context || context;
            if (!base64) continue;

            sendProgress({ type: 'progress', message: `Parsing ${name}...`, current: 10, total: 100 });
            const buf = Buffer.from(base64, 'base64');
            const slides = await extractSlidesFromPptx(buf);
            const slidesFromPptFile = slides.map((s: any) => ({
              slide_number: Number(s.slideNum) || 0,
              original_slide_number: Number(s.slideNum) || 0,
              source_file: name,
              text: s.text || '',
              textLen: s.textLen || 0,
              features: s.features || {},
              isCover: Number(s.slideNum) === 1 && (s.textLen || 0) < 30,
            }));

            sendProgress({ type: 'progress', message: `Generating scripts for ${name}...`, current: 40, total: 100 });
            const stage2Schema = `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slides will be generated separately.
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`;

            const stage2Result = await callLLMJson({
              apiKey: effectiveApiKey,
              baseURL: effectiveBaseURL,
              model: effectiveModel,
              maxCompletionTokens: 1200,
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
                    `Context:\n${ctx.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                    `PPT slides detected (${slidesFromPptFile.length} slides). You should write a general lecture script that covers this PPTX content only.\n\n---\n\n` +
                    `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                    (audienceLevel === 'beginner'
                      ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script length: ~200-350 words per slide (more detailed explanations).\n`
                      : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script length: ~150-250 words per slide (more focused, less repetition).\n`) +
                    `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n- Calculate: ~${Math.round(targetMinutes / Math.max(slidesFromPptFile.length, 1))} minutes per slide on average.\n- Shorter time (≤30 min): Concise explanations, key points only.\n- Medium time (45-60 min): Balanced detail with examples.\n- Longer time (≥90 min): Comprehensive coverage with multiple examples.\n\n` +
                    `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
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
                : '';
            const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${name} lecture skeleton`);
            totalTokensUsed += secondaryResult.tokensUsed || 0;
            const script_markdown_secondary = secondaryResult.text;

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
              context: ctx,
              slidesFromPpt: slidesFromPptFile,
              web_sources,
              llmPool,
              onProgress: (current, total) => {
                const fileStart = 40 + (i / totalFilesForProgress) * 50;
                const fileEnd = 40 + ((i + 1) / totalFilesForProgress) * 50;
                const p = total ? fileStart + (current / total) * (fileEnd - fileStart) : fileStart;
                sendProgress({ type: 'progress', message: `Processing ${name}: slide ${current}/${total}...`, current: Math.round(p), total: 100 });
              },
            });
            totalTokensUsed += batchResult.tokensUsed || 0;

            results.push({
              title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : name,
              script_markdown,
              script_markdown_secondary,
              slides: batchResult.slides,
              web_sources,
              source_file: name,
            });
          }

          for (let i = 0; i < pdfBlocks.length; i++) {
            const block = pdfBlocks[i];
            const name = block.fileName || `pdf-${i + 1}`;
            sendProgress({ type: 'progress', message: `Parsing ${name}...`, current: 10, total: 100 });

            const pages = extractPdfPagesFromContent(block.content);
            if (pages.length === 0) continue;
            const slidesFromPdf = pages.map((p: any) => ({
              slide_number: p.page,
              original_slide_number: p.page,
              source_file: name,
              text: p.text,
              textLen: p.textLen,
            }));
            const contextForFile = buildCompactPdfContext(name, pages);

            sendProgress({ type: 'progress', message: `Generating scripts for ${name}...`, current: 40, total: 100 });
            const stage2Schema = `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slides will be generated separately.
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`;

            const stage2Result = await callLLMJson({
              apiKey: effectiveApiKey,
              baseURL: effectiveBaseURL,
              model: effectiveModel,
              maxCompletionTokens: 1200,
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
                    `Context:\n${contextForFile.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                    `PDF pages detected (${slidesFromPdf.length} pages). You should write a general lecture script that covers this PDF content only.\n\n---\n\n` +
                    `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                    (audienceLevel === 'beginner'
                      ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script length: ~200-350 words per page (more detailed explanations).\n`
                      : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script length: ~150-250 words per page (more focused, less repetition).\n`) +
                    `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n- Calculate: ~${Math.round(targetMinutes / Math.max(slidesFromPdf.length, 1))} minutes per page on average.\n- Shorter time (≤30 min): Concise explanations, key points only.\n- Medium time (45-60 min): Balanced detail with examples.\n- Longer time (≥90 min): Comprehensive coverage with multiple examples.\n\n` +
                    `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
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
                : '';
            const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${name} lecture skeleton`);
            totalTokensUsed += secondaryResult.tokensUsed || 0;
            const script_markdown_secondary = secondaryResult.text;

            const pageTextByNumber = new Map<number, string>();
            pages.forEach((p: any) => pageTextByNumber.set(p.page, p.text));

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
              context: contextForFile,
              slidesFromPpt: slidesFromPdf,
              web_sources,
              llmPool,
              onProgress: (current, total) => {
                const fileIndex = pptxFiles.length + i;
                const fileStart = 40 + (fileIndex / totalFilesForProgress) * 50;
                const fileEnd = 40 + ((fileIndex + 1) / totalFilesForProgress) * 50;
                const p = total ? fileStart + (current / total) * (fileEnd - fileStart) : fileStart;
                sendProgress({ type: 'progress', message: `Processing ${name}: slide ${current}/${total}...`, current: Math.round(p), total: 100 });
              },
            });
            totalTokensUsed += batchResult.tokensUsed || 0;

            results.push({
              title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : name,
              script_markdown,
              script_markdown_secondary,
              slides: batchResult.slides.map((s: any) => ({
                ...s,
                slide_text: pageTextByNumber.get(s.slide_number) || '',
              })),
              web_sources,
              source_file: name,
            });
          }

          if (session?.user?.id && totalTokensUsed > 0) {
            try {
              const inputTokens = Math.round(totalTokensUsed * 0.6);
              const outputTokens = Math.round(totalTokensUsed * 0.4);
              await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
              console.log(`[lecture-rehearsal-stream] Recorded ${totalTokensUsed} tokens (multi-file, input: ${inputTokens}, output: ${outputTokens})`);
            } catch (usageError: any) {
              console.error('[lecture-rehearsal-stream] Failed to record token usage:', usageError);
            }
          }

          sendProgress({ type: 'complete', data: { results } });
          controller.close();
          return;
        }

        // Parse PPTX if provided
        let slidesFromPpt: Array<{ slide_number: number; original_slide_number: number; source_file: string; text: string; textLen?: number; features?: any; isCover?: boolean }> = [];
        let totalSlides = 0;
        let pdfPageTextByNumber: Map<number, string> | null = null;
        let contextForSlides = context;
        let directPdfSource: { name: string; base64: string } | null = null;
        
        if (pptxFiles.length > 0 || pptxBase64) {
          sendProgress({ type: 'progress', message: 'Parsing PowerPoint slides...', current: 10, total: 100 });
          try {
            if (pptxFiles.length > 1) {
              // Multiple PPTX files: process separately and return multiple results
              const results: any[] = [];
              for (let i = 0; i < pptxFiles.length; i++) {
                const f: any = pptxFiles[i];
                const name = typeof f?.name === 'string' ? f.name : `pptx-${i + 1}`;
                const base64 = typeof f?.base64 === 'string' ? f.base64 : '';
                const ctx = pptxFileContexts.find((c: any) => c?.name === name)?.context || context;
                if (!base64) continue;
                
                sendProgress({ type: 'progress', message: `Parsing ${name}...`, current: 10, total: 100 });
                const buf = Buffer.from(base64, 'base64');
                const slides = await extractSlidesFromPptx(buf);
                const slidesFromPptFile = slides.map((s: any) => ({
                  slide_number: Number(s.slideNum) || 0,
                  original_slide_number: Number(s.slideNum) || 0,
                  source_file: name,
                  text: s.text || '',
                  textLen: s.textLen || 0,
                  features: s.features || {},
                  isCover: Number(s.slideNum) === 1 && (s.textLen || 0) < 30,
                }));
                
                sendProgress({ type: 'progress', message: `Generating scripts for ${name}...`, current: 40, total: 100 });
                // Generate full lecture script for this PPTX
                const stage2Schema = `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slides will be generated separately.
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`;
                
                const stage2Result = await callLLMJson({
                  apiKey: effectiveApiKey,
                  baseURL: effectiveBaseURL,
                  model: effectiveModel,
                  maxCompletionTokens: 1200,
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
                        `Context:\n${ctx.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                        `PPT slides detected (${slidesFromPptFile.length} slides). You should write a general lecture script that covers this PPTX content only.\n\n---\n\n` +
                        `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n` +
                        `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
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
                    : '';
                const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${name} lecture skeleton`);
                totalTokensUsed += secondaryResult.tokensUsed || 0;
                const script_markdown_secondary = secondaryResult.text;
                
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
                  context: ctx,
                  slidesFromPpt: slidesFromPptFile,
                  web_sources,
                  llmPool,
                  onProgress: (current, total) => {
                    const fileStart = 40 + (i / pptxFiles.length) * 50;
                    const fileEnd = 40 + ((i + 1) / pptxFiles.length) * 50;
                    const p = total ? fileStart + (current / total) * (fileEnd - fileStart) : fileStart;
                    sendProgress({ type: 'progress', message: `Processing ${name}: slide ${current}/${total}...`, current: Math.round(p), total: 100 });
                  },
                });
                totalTokensUsed += batchResult.tokensUsed || 0;
                
                results.push({
                  title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : name,
                  script_markdown,
                  script_markdown_secondary,
                  slides: batchResult.slides,
                  web_sources,
                  source_file: name,
                });
              }
              
              if (session?.user?.id && totalTokensUsed > 0) {
                try {
                  const inputTokens = Math.round(totalTokensUsed * 0.6);
                  const outputTokens = Math.round(totalTokensUsed * 0.4);
                  await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
                  console.log(`[lecture-rehearsal-stream] Recorded ${totalTokensUsed} tokens (multi-PPTX, input: ${inputTokens}, output: ${outputTokens})`);
                } catch (usageError: any) {
                  console.error('[lecture-rehearsal-stream] Failed to record token usage:', usageError);
                }
              }

              sendProgress({ 
                type: 'complete', 
                data: { results }
              });
              controller.close();
              return;
            } else if (pptxFiles.length === 1) {
              const name = typeof pptxFiles[0]?.name === 'string' ? pptxFiles[0].name : 'pptx';
              const base64 = typeof pptxFiles[0]?.base64 === 'string' ? pptxFiles[0].base64 : '';
              if (base64) {
                const buf = Buffer.from(base64, 'base64');
                const slides = await extractSlidesFromPptx(buf);
                slidesFromPpt = slides.map((s: any) => ({
                  slide_number: Number(s.slideNum) || 0,
                  original_slide_number: Number(s.slideNum) || 0,
                  source_file: name,
                  text: s.text || '',
                  textLen: s.textLen || 0,
                  features: s.features || {},
                  isCover: Number(s.slideNum) === 1 && (s.textLen || 0) < 30,
                }));
              }
            } else if (pptxBase64) {
              const buf = Buffer.from(pptxBase64, 'base64');
              const slides = await extractSlidesFromPptx(buf);
              let globalSlide = 0;
              for (const s of slides) {
                globalSlide += 1;
                const isCover = Number(s.slideNum) === 1 && (s.textLen || 0) < 30;
                slidesFromPpt.push({
                  slide_number: globalSlide,
                  original_slide_number: Number(s.slideNum) || 0,
                  source_file: 'pptx',
                  text: s.text || '',
                  textLen: s.textLen || 0,
                  features: s.features || {},
                  isCover,
                });
              }
            }
            totalSlides = slidesFromPpt.length;
            sendProgress({ type: 'progress', message: `Found ${totalSlides} slides`, current: 15, total: 100 });
          } catch (e) {
            console.error('extractSlidesFromPptx failed:', e);
          }
        } else if (pdfBlocks.length === 1) {
          const pdf = pdfBlocks[0];
          const pages = extractPdfPagesFromContent(pdf.content);
          if (pages.length > 0) {
            pdfPageTextByNumber = new Map<number, string>();
            pages.forEach((p: any) => pdfPageTextByNumber?.set(p.page, p.text));
            contextForSlides = buildCompactPdfContext(pdf.fileName, pages);
            const matchingPdf = pdfFiles.find((f: any) => f?.name === pdf.fileName && typeof f?.base64 === 'string' && f.base64.length > 0);
            if (provider === 'openai' && matchingPdf) {
              directPdfSource = { name: pdf.fileName, base64: matchingPdf.base64 };
            }
            slidesFromPpt = pages.map((p: any) => ({
              slide_number: p.page,
              original_slide_number: p.page,
              source_file: pdf.fileName,
              text: p.text,
              textLen: p.textLen,
            }));
            totalSlides = slidesFromPpt.length;
            sendProgress({ type: 'progress', message: `Found ${totalSlides} pages`, current: 15, total: 100 });
          }
        }

        // Stage 2: write the full lecture script
        // If PPT is provided, don't ask for slides in stage2 (they'll be generated separately)
        const stage2Schema = slidesFromPpt.length > 0
          ? `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slides will be generated separately.
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`
          : `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string",
  "slides": [ { "slide_number": number, "slide_title": "string", "script_markdown": "string", "script_markdown_secondary": "string" } ]
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- If slides are provided in the prompt, you MUST fill the "slides" array with one item per slide (same slide_number).
- Keep script_markdown compact: max 220 words total.
- Format as a short lecture skeleton, not a full script.
- Include only these sections:
  1. Opening
  2. Main Flow
  3. Recap
- Use short bullets, not long paragraphs.`;

        let stage2: any;
        let stage2Tokens = 0;
        try {
          if (directPdfSource && slidesFromPpt.length > 0) {
            const directStage2 = await directOpenAIPdfStage2({
              pdfName: directPdfSource.name,
              pdfBase64: directPdfSource.base64,
              pageCount: slidesFromPpt.length,
              stage1,
            });
            stage2 = directStage2.stage2;
            stage2Tokens = directStage2.tokensUsed || 0;
            totalTokensUsed += stage2Tokens;
          } else {
            const stage2Result = await callLLMJson({
              apiKey: effectiveApiKey,
              baseURL: effectiveBaseURL,
              model: effectiveModel,
              maxCompletionTokens: 1200,
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
                    `Context:\n${context.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                    (slidesFromPpt.length > 0
                      ? `PPT slides detected (${slidesFromPpt.length} slides). You should write a general lecture script that covers the overall content. Individual slide-by-slide scripts will be generated separately.\n\n---\n\n`
                      : '') +
                    `Lecture plan (from model):\n${JSON.stringify(
                      {
                        title,
                        outline: stage1?.outline,
                        key_terms: stage1?.key_terms,
                      },
                      null,
                      2
                    ).substring(0, 12000)}\n\n---\n\n` +
                    `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                    `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                    (audienceLevel === 'beginner'
                      ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script should be comprehensive and detailed.\n`
                      : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script should be focused and efficient.\n`) +
                    `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n` +
                    (targetMinutes <= 30
                      ? `- SHORT LECTURE: Keep explanations concise, focus on key points only.\n`
                      : targetMinutes <= 60
                      ? `- MEDIUM LECTURE: Provide balanced detail with examples.\n`
                      : `- LONG LECTURE: Provide comprehensive coverage with multiple examples and deeper discussions.\n`) +
                    `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
                    (slidesFromPpt.length > 0 
                      ? `\n\nIMPORTANT: Do NOT include a "slides" array in your JSON response. Only return "title", "script_markdown", and "script_markdown_secondary".`
                      : '') +
                    (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
                },
              ],
            });
            stage2 = stage2Result.data;
            stage2Tokens = stage2Result.tokensUsed || 0;
            totalTokensUsed += stage2Tokens;
          }
        } catch (stage2Error: any) {
          console.error('[Lecture Rehearsal Stream] Stage 2 JSON parsing failed:', stage2Error);
          if (String(stage2Error?.message || '').includes('finish_reason: length')) {
            stage2 = {
              title,
              script_markdown: buildFallbackSkeleton({
                title,
                outline: Array.isArray(stage1?.outline) ? stage1.outline : [],
                keyTerms: Array.isArray(stage1?.key_terms) ? stage1.key_terms : [],
                targetMinutes,
                audienceLevel,
              }),
              script_markdown_secondary: '',
            };
          } else {
            sendProgress({ 
              type: 'error', 
              message: `Failed to generate lecture script. The response was too long or malformed. ${stage2Error?.message || 'Unknown error'}. Please try with fewer slides or shorter content.` 
            });
            controller.close();
            return;
          }
        }

        // Align with main route: prefer script_markdown, then __raw_text (from safeParseLLMJson), then script
        const script_markdown =
          typeof stage2?.script_markdown === 'string'
            ? stage2.script_markdown
            : typeof stage2?.__raw_text === 'string'
            ? stage2.__raw_text
            : typeof stage2?.script === 'string'
            ? stage2.script
            : '';
        if (!script_markdown.trim()) {
          const rawHint = typeof stage2?.__raw_text === 'string' && stage2.__raw_text.length > 50
            ? ' Model returned non-JSON or unexpected format; try again or use a different model.'
            : '';
          sendProgress({ type: 'error', message: `LLM returned empty script_markdown.${rawHint}` });
          controller.close();
          return;
        }
        
        const secondaryResult = await buildSecondaryMarkdown(script_markdown, `${title} lecture skeleton`);
        totalTokensUsed += secondaryResult.tokensUsed || 0;
        const script_markdown_secondary = secondaryResult.text;
        
        // Only parse slides from stage2 if PPT was NOT provided (slides will be generated separately via buildSlideScriptsBatched)
        let slides: Array<{ slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }> = [];
        if (slidesFromPpt.length === 0) {
          // No PPT provided, use slides from stage2 if available
          slides =
            Array.isArray(stage2?.slides)
              ? stage2.slides
                  .map((s: any) => ({
                    slide_number: Number(s?.slide_number) || 0,
                    slide_title: typeof s?.slide_title === 'string' ? s.slide_title : '',
                    script_markdown: typeof s?.script_markdown === 'string' ? s.script_markdown : '',
                    script_markdown_secondary:
                      secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' && typeof s?.script_markdown_secondary === 'string'
                        ? s.script_markdown_secondary
                        : '',
                  }))
                  .filter((s: any) => s.slide_number > 0 && s.script_markdown)
              : [];
        }

        // If PPT was provided, generate slide-by-slide scripts with progress
        if (slidesFromPpt.length > 0) {
          sendProgress({ type: 'progress', message: `Generating scripts for ${totalSlides} slides...`, current: 50, total: 100 });
          
          if (!buildSlideScriptsBatched) {
            throw new Error('buildSlideScriptsBatched function not found');
          }
          
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
            context: contextForSlides,
            slidesFromPpt,
            web_sources,
            llmPool,
            onProgress: (current, total) => {
              // Calculate progress: 50% base + 50% for slides (0-50% range)
              const slideProgress = Math.floor((current / total) * 50);
              sendProgress({ 
                type: 'progress', 
                message: `Processing slide ${current} of ${total}...`, 
                current: 50 + slideProgress, 
                total: 100 
              });
            },
          });
          slides = pdfPageTextByNumber
            ? batchResult.slides.map((s: any) => ({
                ...s,
                slide_text: pdfPageTextByNumber?.get(s.slide_number) || '',
              }))
            : batchResult.slides;
          totalTokensUsed += batchResult.tokensUsed;
        }

        // Record token usage
        if (session?.user?.id && totalTokensUsed > 0) {
          try {
            // Estimate input/output tokens (rough split: 60% input, 40% output)
            const inputTokens = Math.round(totalTokensUsed * 0.6);
            const outputTokens = Math.round(totalTokensUsed * 0.4);
            
            await recordUsage(
              session.user.id,
              'lecture_rehearsal',
              inputTokens,
              outputTokens,
              model || 'unknown'
            );
            
            console.log(`[lecture-rehearsal-stream] Recorded ${totalTokensUsed} tokens (input: ${inputTokens}, output: ${outputTokens})`);
          } catch (usageError: any) {
            // Don't fail the request if usage recording fails
            console.error('[lecture-rehearsal-stream] Failed to record token usage:', usageError);
          }
        }

        // Send final result
        // Get source_file from slides (all slides should have the same source_file)
        const sourceFile = slidesFromPpt.length > 0 ? slidesFromPpt[0].source_file : '';
        
        sendProgress({ 
          type: 'complete', 
          data: {
            title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : title,
            source_file: sourceFile,
            script_markdown,
            script_markdown_secondary,
            slides,
            web_sources,
          }
        });
        
        controller.close();
      } catch (error: any) {
        console.error('Lecture rehearsal stream error:', error);
        sendProgress({ type: 'error', message: error?.message || 'Lecture rehearsal failed' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
