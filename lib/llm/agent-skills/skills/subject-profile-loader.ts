/**
 * Subject Profile Loader Skill
 *
 * Reads .skills/subject-<id>/profile.json (machine-readable runtime contract)
 * and .skills/subject-<id>/SKILL.md (LLM-facing markdown body) and returns a
 * unified SubjectProfile that downstream skills (question_generator,
 * content_formatter) can use to produce subject-aware questions and formatting.
 *
 * This is the runtime bridge between Anthropic-style .skills/ packages and the
 * TypeScript orchestration pipeline. Adding a new subject = adding a new
 * .skills/subject-<id>/ folder; no TS change needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export interface SubjectProfile {
  id: string;
  label: string;
  aliases: string[];
  supportedQuestionTypes: string[];
  preferredQuestionTypes: string[];
  sectionLabels: string[];
  questionShapes: Record<string, string>;
  formatting: {
    codeLanguage?: string | null;
    preferCodeFences?: boolean;
    exampleStyle?: string;
    wrapExampleInCode?: boolean;
    quoteWith?: string;
    useMarkdownTables?: boolean;
    currencyRequired?: boolean;
    [key: string]: any;
  };
  promptAddendum: string;
  structuredExamples: Array<{ type: string; question: string; [key: string]: any }>;
  skillBody?: string;
  source: 'file' | 'fallback';
}

const PROFILE_CACHE = new Map<string, SubjectProfile>();
const SKILL_FOLDER_PREFIX = 'subject-';

function getSkillsRoot(): string {
  // Resolve relative to the Next.js project root. cwd() is the project root
  // when the app runs via `next dev` / `next start`.
  return path.join(process.cwd(), '.skills');
}

function readJsonSafe(filePath: string): any | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\s+/, '');
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizeRecordString(value: any): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && v.trim()) {
      out[k] = v;
    }
  }
  return out;
}

function buildProfileFromFiles(subjectId: string): SubjectProfile | null {
  const folder = path.join(getSkillsRoot(), `${SKILL_FOLDER_PREFIX}${subjectId}`);
  if (!fs.existsSync(folder)) return null;

  const profileJson = readJsonSafe(path.join(folder, 'profile.json'));
  if (!profileJson || typeof profileJson !== 'object') return null;

  const skillMd = readTextSafe(path.join(folder, 'SKILL.md'));
  const skillBody = skillMd ? stripFrontmatter(skillMd) : '';

  return {
    id: String(profileJson.id || subjectId),
    label: String(profileJson.label || subjectId),
    aliases: normalizeStringArray(profileJson.aliases),
    supportedQuestionTypes: normalizeStringArray(profileJson.supportedQuestionTypes),
    preferredQuestionTypes: normalizeStringArray(profileJson.preferredQuestionTypes),
    sectionLabels: normalizeStringArray(profileJson.sectionLabels),
    questionShapes: normalizeRecordString(profileJson.questionShapes),
    formatting:
      profileJson.formatting && typeof profileJson.formatting === 'object'
        ? profileJson.formatting
        : {},
    promptAddendum: String(profileJson.promptAddendum || '').trim(),
    structuredExamples: Array.isArray(profileJson.structuredExamples)
      ? profileJson.structuredExamples
      : [],
    skillBody,
    source: 'file',
  };
}

function buildFallbackDefaultProfile(): SubjectProfile {
  return {
    id: 'default',
    label: 'Generic',
    aliases: ['general', 'default', 'mixed'],
    supportedQuestionTypes: [
      'multiple_choice',
      'fill_in_blank',
      'short_answer',
      'calculation',
      'proof',
      'derivation',
      'coding',
      'debugging',
      'trace',
      'design',
      'data_analysis',
      'case_study',
    ],
    preferredQuestionTypes: ['multiple_choice', 'short_answer', 'fill_in_blank'],
    sectionLabels: ['Task', 'Context', 'Question', 'Expected Answer', 'Example', 'Requirements'],
    questionShapes: {},
    formatting: {
      codeLanguage: null,
      preferCodeFences: false,
      exampleStyle: 'neutral',
      wrapExampleInCode: false,
    },
    promptAddendum: '',
    structuredExamples: [],
    skillBody: '',
    source: 'fallback',
  };
}

function loadProfileById(subjectId: string): SubjectProfile {
  const normalizedId = String(subjectId || 'default').trim().toLowerCase();
  const cached = PROFILE_CACHE.get(normalizedId);
  if (cached) return cached;

  const fromFile = buildProfileFromFiles(normalizedId);
  if (fromFile) {
    PROFILE_CACHE.set(normalizedId, fromFile);
    return fromFile;
  }

  if (normalizedId !== 'default') {
    const fallback = loadProfileById('default');
    return fallback;
  }

  const fallback = buildFallbackDefaultProfile();
  PROFILE_CACHE.set('default', fallback);
  return fallback;
}

function listAvailableSubjectIds(): string[] {
  try {
    const root = getSkillsRoot();
    if (!fs.existsSync(root)) return ['default'];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(SKILL_FOLDER_PREFIX))
      .map((entry) => entry.name.slice(SKILL_FOLDER_PREFIX.length).toLowerCase())
      .filter(Boolean);
    return ids.length > 0 ? ids : ['default'];
  } catch {
    return ['default'];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function tokenAppearsAsWord(hint: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  // Use word boundaries to avoid 'irr' matching inside 'irrelevant', or 'cs'
  // matching inside 'process'.
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`, 'i');
  return pattern.test(hint);
}

function matchSubjectIdByAlias(rawHint: string, available: string[]): string | null {
  const hint = String(rawHint || '').trim().toLowerCase();
  if (!hint) return null;

  if (available.includes(hint)) return hint;

  // Exact alias / label match wins first.
  for (const id of available) {
    const profile = loadProfileById(id);
    if (profile.aliases.some((alias) => alias.toLowerCase() === hint)) {
      return id;
    }
    if (profile.label.toLowerCase() === hint) return id;
  }

  // Word-boundary substring match: alias must appear as a whole word/phrase in
  // the hint to count. Prevents 'irr' matching inside 'irrelevant', 'cs'
  // matching inside 'process', etc.
  for (const id of available) {
    if (id === 'default') continue;
    const profile = loadProfileById(id);
    if (profile.aliases.some((alias) => tokenAppearsAsWord(hint, alias))) {
      return id;
    }
    if (tokenAppearsAsWord(hint, id)) return id;
  }

  return null;
}

export function loadSubjectProfile(subjectHint?: string | null): SubjectProfile {
  const available = listAvailableSubjectIds();
  const matched = matchSubjectIdByAlias(String(subjectHint || ''), available);
  if (matched) return loadProfileById(matched);
  return loadProfileById('default');
}

export function listSubjectProfiles(): SubjectProfile[] {
  return listAvailableSubjectIds().map((id) => loadProfileById(id));
}

export function clearSubjectProfileCache(): void {
  PROFILE_CACHE.clear();
}

export class SubjectProfileLoaderSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'subject_profile_loader',
    description:
      'Load a subject-specific question/formatting profile from .skills/subject-<id>/. Falls back to subject-default when no match is found.',
    category: 'orchestration',
    version: '1.0.0',
    estimatedTokens: 0,
    requiredInputs: [],
    optionalInputs: ['subjectId', 'subjectHint'],
  };

  async execute(input: SkillInput, _context: SkillContext): Promise<SkillOutput> {
    try {
      const hint =
        typeof input.subjectId === 'string' && input.subjectId.trim()
          ? input.subjectId
          : typeof input.subjectHint === 'string'
          ? input.subjectHint
          : '';

      const available = listAvailableSubjectIds();
      const profile = loadSubjectProfile(hint);

      return this.success(
        {
          profile,
          available,
          requestedHint: hint || null,
          matchedId: profile.id,
        },
        0,
        { subjectId: profile.id, subjectSource: profile.source }
      );
    } catch (error: any) {
      this.log('error', 'Failed to load subject profile', error);
      return this.error(`Failed to load subject profile: ${error?.message || error}`);
    }
  }
}
