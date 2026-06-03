/**
 * Subject Detector Skill
 *
 * Decides which subject skill best fits a piece of uploaded teaching
 * material. Uses two strategies in order:
 *
 *  1. Agent-style LLM routing over the subject skill metadata catalog
 *     (`SKILL.md` frontmatter + reference index).
 *  2. Heuristic fallback when LLM routing is unavailable or fails.
 *
 * Output is always one of the registered subject profile ids (see
 * .skills/subject-*). Falls back to 'default' if nothing matches.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';
import { listSubjectProfiles, loadSubjectProfile, SubjectProfile } from './subject-profile-loader';
import {
  formatMetadataCatalogForPrompt,
  metadataById,
  scanSubjectSkillCatalog,
} from '../subject-skills/catalog';

interface DetectionInput {
  fileName?: string;
  fileType?: string;
  outline?: any;
  pages?: Array<{ index?: number; page_number?: number; title?: string; text?: string; topic_labels?: string[] }>;
  subjectHint?: string;
  maxSampleChars?: number;
}

interface DetectionResult {
  subjectId: string;
  confidence: number;
  source: 'llm' | 'heuristic' | 'fallback';
  reason: string;
  candidateScores: Array<{ subjectId: string; score: number }>;
}

const MIN_LLM_SAMPLE_CHARS = 200;
const STRONG_HEURISTIC_MIN_SCORE = 3;

function gatherSampleText(input: DetectionInput): string {
  const parts: string[] = [];
  if (input.fileName) parts.push(`FILE: ${input.fileName}`);

  const outline = input.outline;
  if (outline && Array.isArray(outline.chapters)) {
    for (const chapter of outline.chapters.slice(0, 5)) {
      const title = String(chapter?.title || '').trim();
      if (title) parts.push(`CHAPTER: ${title}`);
      if (Array.isArray(chapter?.sections)) {
        for (const section of chapter.sections.slice(0, 3)) {
          const stitle = String(section?.title || '').trim();
          if (stitle) parts.push(`SECTION: ${stitle}`);
        }
      }
    }
  }

  const pages = Array.isArray(input.pages) ? input.pages : [];
  const sampled = pages.length > 6 ? pickEvenlySpacedSamples(pages, 6) : pages;
  for (const page of sampled) {
    const title = String(page?.title || '').trim();
    if (title) parts.push(`PAGE TITLE: ${title}`);
    const labels = Array.isArray(page?.topic_labels) ? page.topic_labels : [];
    if (labels.length > 0) parts.push(`TOPICS: ${labels.slice(0, 5).join(', ')}`);
    const text = String(page?.text || '').trim();
    if (text) parts.push(text.slice(0, 600));
  }

  const cap = Math.max(400, Number(input.maxSampleChars) || 2400);
  return parts.join('\n').slice(0, cap);
}

function pickEvenlySpacedSamples<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}

function scoreProfileMatch(text: string, profile: SubjectProfile): number {
  if (profile.id === 'default') return 0;
  const lower = text.toLowerCase();
  if (!lower) return 0;

  let score = 0;
  for (const alias of profile.aliases) {
    const a = alias.toLowerCase();
    if (!a) continue;
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}([^a-z0-9]|$)`, 'g');
    const matches = lower.match(pattern);
    if (matches) score += matches.length;
  }
  return score;
}

function escapeRegex(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function pickHeuristicWinner(text: string, profiles: SubjectProfile[]): {
  winner: SubjectProfile;
  score: number;
  candidateScores: Array<{ subjectId: string; score: number }>;
} {
  const candidateScores = profiles.map((profile) => ({
    subjectId: profile.id,
    score: scoreProfileMatch(text, profile),
  }));

  const sorted = [...candidateScores].sort((a, b) => b.score - a.score);
  const topCandidate = sorted[0];
  const topScore = topCandidate?.score ?? 0;
  const runnerUpScore = sorted[1]?.score ?? 0;

  const totalSignal = candidateScores.reduce((sum, c) => sum + c.score, 0);
  if (topScore === 0 || totalSignal === 0) {
    return {
      winner: loadSubjectProfile('default'),
      score: 0,
      candidateScores,
    };
  }

  const confidence = topScore >= STRONG_HEURISTIC_MIN_SCORE
    ? topScore / Math.max(topScore + runnerUpScore + 1, 1)
    : Math.min(0.45, topScore / Math.max(topScore + runnerUpScore + 2, 1));
  const winnerProfile = profiles.find((p) => p.id === topCandidate.subjectId) || loadSubjectProfile('default');
  return {
    winner: winnerProfile,
    score: confidence,
    candidateScores,
  };
}

function normalizeSubjectId(raw: string, allowedIds: string[]): string {
  const id = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (allowedIds.includes(id)) return id;
  if (id === 'cs') return 'computer-science';
  return 'default';
}

export class SubjectDetectorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'subject_detector',
    description:
      'Detect the subject domain (computer science / language / finance / generic) of an uploaded document by inspecting outline + sample pages. Returns a subject id that can be fed to subject_profile_loader.',
    category: 'orchestration',
    version: '1.0.0',
    estimatedTokens: 400,
    requiredInputs: [],
    optionalInputs: ['fileName', 'fileType', 'outline', 'pages', 'subjectHint', 'maxSampleChars'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    try {
      const detectionInput: DetectionInput = {
        fileName: typeof input.fileName === 'string' ? input.fileName : '',
        fileType: typeof input.fileType === 'string' ? input.fileType : '',
        outline: input.outline ?? null,
        pages: Array.isArray(input.pages) ? input.pages : [],
        subjectHint: typeof input.subjectHint === 'string' ? input.subjectHint : '',
        maxSampleChars: Number(input.maxSampleChars) || undefined,
      };

      const profiles = listSubjectProfiles();
      const sampleText = gatherSampleText(detectionInput);
      const heuristic = pickHeuristicWinner(sampleText, profiles);
      const apiKey = context?.llmConfig?.apiKey || '';
      const canCallLLM = Boolean(apiKey) && sampleText.length >= MIN_LLM_SAMPLE_CHARS;

      if (canCallLLM) {
        try {
          const catalog = scanSubjectSkillCatalog();
          const allowedIds = catalog.map((skill) => skill.id);
          const catalogBlock = formatMetadataCatalogForPrompt(catalog);
          const messages = [
            {
              role: 'system',
              content: `You are an agent-style skill router for educational uploads.

You are given only LAYER 1 metadata for each subject skill: name, description, references, and runtime scripts. Choose the one subject skill whose description best matches the uploaded material.

Routing rules:
- Decide semantically from the excerpt and skill descriptions, not by keyword count.
- Treat subject_hint as a weak UI hint only. Override it when the excerpt clearly fits another subject.
- Natural-language grammar, vocabulary, translation, literary passages, and foreign-language learning materials should route to the language skill.
- Mathematical routing requires math content such as equations, functions, proofs, calculations, probability, or symbolic reasoning. Do not pick mathematics merely because the text uses words like structure, expression, derivation, or cause.
- Use default only when the material is genuinely unclear or mixed.

AVAILABLE SUBJECT SKILLS:
${catalogBlock}

Return ONLY valid JSON:
{
  "subjectId": "<one of: ${allowedIds.join(', ')}>",
  "confidence": <number between 0 and 1>,
  "reason": "<one sentence citing concrete evidence from the excerpt and skill metadata>"
}`,
            },
            {
              role: 'user',
              content: `FILE: ${detectionInput.fileName || '(unknown)'}
fileType: ${detectionInput.fileType || '(unknown)'}
subject_hint: ${detectionInput.subjectHint || '(none)'}

EXCERPT TO ROUTE:
---
${sampleText}
---

Choose the subject skill.`,
            },
          ];

          const { content, tokensUsed } = await this.callLLM(messages, context, {
            temperature: 0,
            maxTokens: 500,
          });

          const rawId = String(content?.subjectId || content?.subject_id || '').trim();
          const subjectId = normalizeSubjectId(rawId, allowedIds);
          const subjectMeta = metadataById(catalog, subjectId) || metadataById(catalog, 'default') || catalog[0];
          const confidence = Number(content?.confidence);
          const result: DetectionResult = {
            subjectId: subjectMeta?.id || 'default',
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
            source: 'llm',
            reason: String(content?.reason || 'LLM metadata routing').trim(),
            candidateScores: heuristic.candidateScores,
          };
          return this.success(result, tokensUsed || 0, { subjectId: result.subjectId });
        } catch (error: any) {
          this.log('warn', 'LLM subject routing failed; falling back to heuristic', error);
        }
      }

      const fallbackProfile = heuristic.winner.id !== 'default'
        ? heuristic.winner
        : loadSubjectProfile('default');
      const result: DetectionResult = {
        subjectId: fallbackProfile.id,
        confidence: Number(heuristic.score.toFixed(3)),
        source: fallbackProfile.id === 'default' ? 'fallback' : 'heuristic',
        reason:
          fallbackProfile.id === 'default'
            ? 'LLM routing unavailable or failed and no reliable alias match was found; using default profile.'
            : `LLM routing unavailable or failed; weak alias fallback selected '${fallbackProfile.id}' with confidence ${heuristic.score.toFixed(2)}.`,
        candidateScores: heuristic.candidateScores,
      };
      return this.success(result, 0, { subjectId: fallbackProfile.id });
    } catch (error: any) {
      this.log('error', 'Subject detection failed', error);
      const fallback = loadSubjectProfile('default');
      const result: DetectionResult = {
        subjectId: fallback.id,
        confidence: 0,
        source: 'fallback',
        reason: `Detection failed: ${error?.message || error}`,
        candidateScores: [],
      };
      return this.success(result, 0, { subjectId: fallback.id });
    }
  }
}
