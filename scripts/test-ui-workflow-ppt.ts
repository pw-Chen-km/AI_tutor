import fs from 'node:fs';
import path from 'node:path';
import { orchestrator } from '../lib/llm/agent-skills';
import { getDrillsTypes, mapSkillSubjectToUiSubject } from '../lib/subjects';

function readOpenAIKeyFromEnvFile(): string {
  const envPath = '/Users/patrick/Desktop/AI_tutor/.env';
  const envText = fs.readFileSync(envPath, 'utf8');
  const match = envText.match(/^OPENAI_API_KEY\s*=\s*"?([^\n"]+)"?/m);
  return (match?.[1] || '').trim();
}

async function main() {
  const apiKey = readOpenAIKeyFromEnvFile();
  if (!apiKey) throw new Error('OPENAI_API_KEY not found in /Users/patrick/Desktop/AI_tutor/.env');

  const filePath = '/Users/patrick/Desktop/AI_tutor/lecture/CH2-final.pptx';
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const log: any = {
    timestamp: new Date().toISOString(),
    file: { path: filePath, sizeBytes: fileBuffer.length },
    steps: [],
  };

  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      const result = await fn();
      const ended = Date.now();
      log.steps.push({
        name,
        status: 'ok',
        durationMs: ended - started,
      });
      return result;
    } catch (error: any) {
      const ended = Date.now();
      log.steps.push({
        name,
        status: 'error',
        durationMs: ended - started,
        error: error?.message || String(error),
      });
      throw error;
    }
  };

  const parseResult = await timed('parse-file', async () => {
    const blob = new Blob([fileBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('intent', 'generic');

    const response = await fetch('http://localhost:3000/api/parse-file', { method: 'POST', body: formData });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'parse-file failed');

    log.parse = {
      status: response.status,
      strategy: data.strategy,
      contentLength: (data.content || '').length,
      pages: Array.isArray(data.pages) ? data.pages.length : 0,
      warnings: data.warnings || [],
      metadata: data.metadata || {},
      sample: String(data.content || '').slice(0, 280),
    };
    return data;
  });

  const intake = {
    fileName: parseResult.fileName || fileName,
    fileType: parseResult.fileType || 'pptx',
    intent: parseResult.intent || 'generic',
    content: parseResult.content || '',
    strategy: parseResult.strategy,
    pages: parseResult.pages || [],
    warnings: parseResult.warnings || [],
    metadata: parseResult.metadata || {},
  };

  let refineResult: any = null;
  try {
    refineResult = await timed('refine-outline', async () => {
      const response = await fetch('http://localhost:3000/api/refine-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: intake.fileName,
          fileType: intake.fileType,
          intake,
          llmConfig: {
            provider: 'openai',
            apiKey,
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-5.5',
          },
          languageConfig: { primaryLanguage: 'English', secondaryLanguage: 'none' },
          subject: 'computer_science',
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'refine-outline failed');
      log.refine = {
        status: response.status,
        outlineSource: data.outlineSource || null,
        tokensUsed: data.tokensUsed || 0,
        chapterCount: Array.isArray(data?.refinedOutline?.chapters) ? data.refinedOutline.chapters.length : 0,
      };
      return data;
    });
  } catch (error: any) {
    log.refine = { status: 'error', error: error?.message || String(error) };
  }

  const detectResult = await timed('detect-subject', async () => {
    const detectionIntake = {
      ...intake,
      metadata: {
        ...(intake.metadata || {}),
        roughOutline: refineResult?.roughOutline,
        refinedOutline: refineResult?.refinedOutline,
        outlineSource: refineResult?.outlineSource,
      },
    };
    const response = await fetch('http://localhost:3000/api/detect-subject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: intake.fileName,
        fileType: intake.fileType,
        intake: detectionIntake,
        llmConfig: {
          provider: 'openai',
          apiKey,
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-5.5',
        },
        languageConfig: { primaryLanguage: 'English', secondaryLanguage: 'none' },
        subjectHint: 'computer_science',
      }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'detect-subject failed');
    log.detect = {
      status: response.status,
      subjectId: data.subjectId,
      confidence: data.confidence,
      source: data.source,
      reason: data.reason,
      candidateScores: data.candidateScores || [],
    };
    return data;
  });

  const hasHighConfidence = Boolean(
    detectResult?.subjectId &&
      detectResult.subjectId !== 'default' &&
      Number(detectResult.confidence || 0) >= 0.6
  );
  const detectedUiSubject = hasHighConfidence ? mapSkillSubjectToUiSubject(detectResult.subjectId) : null;
  const effectiveSubject = detectedUiSubject || 'computer_science';
  const drillTypes = getDrillsTypes(effectiveSubject);
  const typeCounts = Object.fromEntries(drillTypes.map((t) => [t.id, 1]));
  const numberOfItems = drillTypes.length;

  const sourceDocuments = [
    {
      name: fileName,
      type: 'pptx',
      rawBase64: fileBuffer.toString('base64'),
      intake: {
        ...intake,
        metadata: {
          ...(intake.metadata || {}),
          detectedSubjectId: detectResult?.subjectId || 'default',
          detectedSubjectConfidence: Number(detectResult?.confidence || 0),
          detectedSubjectSource: detectResult?.source || 'fallback',
          detectedSubjectReason: detectResult?.reason || '',
        },
      },
    },
  ];

  const progress: Array<{ current: number; total: number; message: string }> = [];
  const generationResult = await timed('orchestrator.generateQuestions', async () => {
    return orchestrator.generateQuestions({
      moduleType: 'drills',
      numberOfItems,
      context: intake.content || '',
      taskParams: {
        minutesPerProblem: 8,
        subject: effectiveSubject,
        typeCounts,
        availableFiles: [fileName],
        sourceDocuments,
        debugAllowFallback: false,
      },
      llmContext: {
        llmConfig: {
          apiKey,
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-5.5',
          provider: 'openai',
        },
        languageConfig: { primaryLanguage: 'English', secondaryLanguage: 'none' },
        subject: effectiveSubject,
        additionalParams: {},
      },
      onProgress: (current, total, message) => {
        progress.push({ current, total, message });
      },
    });
  });

  const results = Array.isArray(generationResult.results) ? generationResult.results : [];
  log.workflow = {
    selectedSubjectBeforeDetection: 'computer_science',
    detectedSubjectSkillId: detectResult?.subjectId || 'default',
    detectedConfidence: Number(detectResult?.confidence || 0),
    effectiveUiSubject: effectiveSubject,
    drillTypes: drillTypes.map((t) => t.id),
    typeCounts,
    numberOfItems,
  };
  log.generation = {
    generatedCount: results.length,
    tokensUsed: generationResult.totalTokensUsed || 0,
    progress,
    items: results.map((item: any, index: number) => ({
      index: index + 1,
      type: item?.format || item?.type || '',
      concept: item?.concept_name || '',
      questionPreview: String(item?.question || '').replace(/\s+/g, ' ').slice(0, 240),
      solutionPreview: String(item?.solution || '').replace(/\s+/g, ' ').slice(0, 240),
      metadata: {
        subject_skill_id: item?.metadata?.subject_skill_id,
        effective_question_type: item?.metadata?.effective_question_type,
        original_requested_type: item?.metadata?.original_requested_type,
        strict_type_enforcement: item?.metadata?.strict_type_enforcement,
        subject_skill_references: item?.metadata?.subject_skill_references || [],
      },
    })),
  };

  console.log(JSON.stringify(log, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
