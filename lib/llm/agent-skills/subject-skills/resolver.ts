/**
 * Subject skill resolver — progressive disclosure agent for question generation.
 *
 * Flow (no separate detector skill):
 *   1. Scan .skills/subject-* folders and build metadata catalog (L1)
 *   2. LLM routing call: metadata + source excerpt → subject_id + reference_files
 *   3. Load SKILL.md body (L2) + selected references (L3)
 *   4. Return pack for question_generator; formatting uses scripts (L4) after generation
 */

import OpenAI from 'openai';
import { SkillContext } from '../types';
import { loadSubjectProfile, SubjectProfile } from '../skills/subject-profile-loader';
import {
  scanSubjectSkillCatalog,
  formatMetadataCatalogForPrompt,
  loadSkillBody,
  loadReferenceFiles,
  buildReferencesText,
  resolveReferenceFilesForQuestionType,
  metadataById,
  SubjectSkillMetadata,
} from './catalog';

export interface SubjectRoutingDecision {
  subjectId: string;
  referenceFiles: string[];
  effectiveQuestionType?: string;
  rationale: string;
  confidence?: number;
}

export interface SubjectSkillAgentPack {
  subjectId: string;
  profile: SubjectProfile;
  metadata: SubjectSkillMetadata;
  skillBody: string;
  loadedReferences: Array<{ fileName: string; content: string }>;
  referencesText: string;
  routing: SubjectRoutingDecision;
  catalogMetadataBlock: string;
  tokensUsedRouting: number;
}

function buildSourceExcerpt(context: string, maxChars = 3500): string {
  return String(context || '').trim().slice(0, maxChars);
}

function normalizeSubjectId(raw: string, catalog: SubjectSkillMetadata[]): string {
  const id = String(raw || '').trim().toLowerCase();
  if (catalog.some((s) => s.id === id)) return id;
  if (id === 'cs' || id === 'computer_science') return 'computer-science';
  return 'default';
}

function heuristicRoute(params: {
  context: string;
  questionType: string;
  catalog: SubjectSkillMetadata[];
  subjectHint?: string;
}): SubjectRoutingDecision {
  const { context, questionType, catalog, subjectHint } = params;
  const lower = `${context} ${subjectHint || ''}`.toLowerCase();

  const score = (skill: SubjectSkillMetadata) => {
    let s = 0;
    for (const ref of skill.references) {
      for (const word of ref.title.toLowerCase().split(/\s+/)) {
        if (word.length > 3 && lower.includes(word)) s += 1;
      }
    }
    if (skill.description) {
      for (const token of skill.description.toLowerCase().split(/[^a-z0-9]+/)) {
        if (token.length > 4 && lower.includes(token)) s += 0.5;
      }
    }
    return s;
  };

  let best = catalog.find((s) => s.id === 'default') || catalog[0];
  let bestScore = -1;
  for (const skill of catalog) {
    if (skill.id === 'default') continue;
    const sc = score(skill);
    if (sc > bestScore) {
      bestScore = sc;
      best = skill;
    }
  }

  if (subjectHint && bestScore <= 0) {
    const hinted = normalizeSubjectId(subjectHint, catalog);
    const meta = metadataById(catalog, hinted);
    if (meta) best = meta;
  }

  const referenceFiles = resolveReferenceFilesForQuestionType(best, questionType);
  return {
    subjectId: best.id,
    referenceFiles,
    effectiveQuestionType: questionType,
    rationale:
      bestScore > 0
        ? `Heuristic match on source keywords for subject '${best.id}'.`
        : `No strong keyword signal; using '${best.id}'.`,
    confidence: bestScore > 0 ? 0.6 : 0.35,
  };
}

async function routeSubjectWithLLM(params: {
  context: string;
  questionType: string;
  taskType: string;
  catalog: SubjectSkillMetadata[];
  skillContext: SkillContext;
  subjectHint?: string;
  allowReferenceFallback?: boolean;
}): Promise<{ decision: SubjectRoutingDecision; tokensUsed: number }> {
  const { context, questionType, taskType, catalog, skillContext, subjectHint, allowReferenceFallback } = params;
  const apiKey = skillContext?.llmConfig?.apiKey;
  if (!apiKey) {
    return { decision: heuristicRoute({ context, questionType, catalog, subjectHint }), tokensUsed: 0 };
  }

  const catalogBlock = formatMetadataCatalogForPrompt(catalog);
  const allowedIds = catalog.map((s) => s.id);

  const client = new OpenAI({
    apiKey,
    baseURL: skillContext.llmConfig.baseURL || 'https://api.openai.com/v1',
  });

  const model = skillContext.llmConfig.model || 'gpt-4.1-mini';
  const chatRequest: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a subject-skill router for an educational question generator.

PROGRESSIVE DISCLOSURE RULES:
- You are only given LAYER 1 (metadata) for each subject skill below.
- Pick exactly ONE subject_id that best fits the source excerpt semantically.
- Pick 1-3 reference_files from that subject's list that are needed for the requested question type.
- Do NOT invent reference file names — only use names listed under the chosen subject.
- Scripts are handled by the runtime; you never output script code.
- Treat user_subject_hint as a weak hint only; override it when the excerpt clearly matches another subject.
- Natural-language grammar, vocabulary, translation, literature, and foreign-language learning material should route to language.
- Mathematics requires actual mathematical notation, numeric calculation, equations, functions, probability/statistics, proof, or symbolic reasoning. Do not choose mathematics just because the excerpt contains words like expression, cause, structure, or derivation.

AVAILABLE SUBJECT SKILLS (metadata only):
${catalogBlock}

Return ONLY valid JSON:
{
  "subject_id": "<one of: ${allowedIds.join(', ')}>",
  "reference_files": ["file1.md", "file2.md"],
  "effective_question_type": "${questionType}",
  "rationale": "one sentence citing evidence from the excerpt",
  "confidence": 0.0
}`,
      },
      {
        role: 'user',
        content: `taskType: ${taskType}
requested_question_type: ${questionType}
${subjectHint ? `user_subject_hint: ${subjectHint}\n` : ''}
SOURCE EXCERPT:
---
${buildSourceExcerpt(context)}
---

Choose subject_id and reference_files.`,
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 600,
  };

  const normalizedModel = String(model).toLowerCase();
  if (!normalizedModel.startsWith('gpt-5')) {
    (chatRequest as any).temperature = 0;
  }

  try {
    const response = await client.chat.completions.create(chatRequest);
    const raw = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const subjectId = normalizeSubjectId(parsed.subject_id || parsed.subjectId, catalog);
    const meta = metadataById(catalog, subjectId) || catalog[0];
    let referenceFiles = Array.isArray(parsed.reference_files)
      ? parsed.reference_files.map((f: any) => pathBasename(String(f)))
      : [];
    const available = new Set(meta.references.map((r) => r.fileName));
    referenceFiles = referenceFiles.filter((f: string) => available.has(f));
    if (referenceFiles.length === 0) {
      referenceFiles = resolveReferenceFilesForQuestionType(meta, questionType, {
        allowHardFallback: allowReferenceFallback !== false,
      });
    }

    const tokensUsed = response.usage?.total_tokens || 0;
    return {
      decision: {
        subjectId: meta.id,
        referenceFiles,
        effectiveQuestionType: String(parsed.effective_question_type || questionType),
        rationale: String(parsed.rationale || 'LLM routing').trim(),
        confidence: Number(parsed.confidence) || 0.7,
      },
      tokensUsed,
    };
  } catch {
    return { decision: heuristicRoute({ context, questionType, catalog, subjectHint }), tokensUsed: 0 };
  }
}

function pathBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

export async function assembleSubjectSkillPack(params: {
  context: string;
  questionType: string;
  taskType: string;
  skillContext: SkillContext;
  subjectHint?: string;
  /** Allow hard fallback to overview/first reference when no match. */
  allowReferenceFallback?: boolean;
  /** Skip LLM routing when caller already resolved subject (e.g. cached from upload). */
  preselectedSubjectId?: string;
  preselectedReferenceFiles?: string[];
}): Promise<SubjectSkillAgentPack> {
  const catalog = scanSubjectSkillCatalog();
  const catalogMetadataBlock = formatMetadataCatalogForPrompt(catalog);

  let routing: SubjectRoutingDecision;
  let tokensUsedRouting = 0;

  if (params.preselectedSubjectId) {
    const meta =
      metadataById(catalog, params.preselectedSubjectId) ||
      metadataById(catalog, 'default') ||
      catalog[0];
    const referenceFiles =
      params.preselectedReferenceFiles?.length
        ? params.preselectedReferenceFiles
        : resolveReferenceFilesForQuestionType(meta, params.questionType, {
            allowHardFallback: params.allowReferenceFallback !== false,
          });
    routing = {
      subjectId: meta.id,
      referenceFiles,
      effectiveQuestionType: params.questionType,
      rationale: 'Subject preselected by caller (cached or explicit).',
      confidence: 1,
    };
  } else {
    const routed = await routeSubjectWithLLM({
      context: params.context,
      questionType: params.questionType,
      taskType: params.taskType,
      catalog,
      skillContext: params.skillContext,
      subjectHint: params.subjectHint,
      allowReferenceFallback: params.allowReferenceFallback,
    });
    routing = routed.decision;
    tokensUsedRouting = routed.tokensUsed;
  }

  const metadata =
    metadataById(catalog, routing.subjectId) ||
    metadataById(catalog, 'default') ||
    catalog[0];

  const skillBody = loadSkillBody(metadata.id);
  const loadedReferences = loadReferenceFiles(metadata.id, routing.referenceFiles);
  const referencesText = buildReferencesText(loadedReferences);
  const profile = loadSubjectProfile(metadata.id);

  return {
    subjectId: metadata.id,
    profile: { ...profile, skillBody },
    metadata,
    skillBody,
    loadedReferences,
    referencesText,
    routing,
    catalogMetadataBlock,
    tokensUsedRouting,
  };
}
