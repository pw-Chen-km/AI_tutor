/**
 * Subject skill catalog — scans .skills/subject-* folders at runtime.
 *
 * Progressive disclosure layers:
 *   L1  metadata (SKILL.md frontmatter) — always cheap to broadcast
 *   L2  SKILL.md body — loaded after subject is chosen
 *   L3  references/*.md — loaded on demand per question type
 *   L4  scripts/* — deterministic post-processing (never guessed by LLM)
 */

import * as fs from 'fs';
import * as path from 'path';

const SKILL_FOLDER_PREFIX = 'subject-';

export interface SubjectSkillMetadata {
  folderName: string;
  id: string;
  name: string;
  description: string;
  skillPath: string;
  references: SubjectReferenceIndex[];
  scripts: SubjectScriptIndex[];
}

export interface SubjectReferenceIndex {
  fileName: string;
  relativePath: string;
  title: string;
  summary: string;
}

export interface SubjectScriptIndex {
  fileName: string;
  relativePath: string;
  purpose: string;
}

export interface SubjectSkillPack {
  metadata: SubjectSkillMetadata;
  skillBody: string;
  loadedReferences: Array<{ fileName: string; content: string }>;
  referencesText: string;
  profile: import('../skills/subject-profile-loader').SubjectProfile;
}

function getSkillsRoot(): string {
  return path.join(process.cwd(), '.skills');
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith('---')) return {};
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = markdown.slice(4, end).trim();
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\s+/, '');
}

function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function extractReferenceSummary(content: string): { title: string; summary: string } {
  const lines = content.split('\n');
  let title = '';
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)/);
    if (m) {
      title = m[1].trim();
      break;
    }
  }
  const body = lines
    .filter((l) => !l.startsWith('#') && l.trim())
    .join(' ')
    .trim();
  const summary = body.slice(0, 180) + (body.length > 180 ? '…' : '');
  return { title: title || 'Reference', summary };
}

function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

function listScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|js|mjs)$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

function scriptPurpose(fileName: string): string {
  const base = fileName.replace(/\.(ts|js|mjs)$/, '');
  if (base === 'format-question') return 'Deterministic markdown structure for generated questions';
  if (base === 'validate-question') return 'Validate question contract before display';
  if (base === 'normalize-options') return 'Normalize multiple-choice option strings';
  return `Script: ${base}`;
}

export function listSubjectSkillFolders(): string[] {
  const root = getSkillsRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(SKILL_FOLDER_PREFIX))
    .map((e) => e.name)
    .sort();
}

export function loadSubjectSkillMetadata(folderName: string): SubjectSkillMetadata | null {
  const skillDir = path.join(getSkillsRoot(), folderName);
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;

  const raw = readTextSafe(skillMdPath);
  const frontmatter = parseFrontmatter(raw);
  const id = folderName.startsWith(SKILL_FOLDER_PREFIX)
    ? folderName.slice(SKILL_FOLDER_PREFIX.length)
    : folderName;

  const referencesDir = path.join(skillDir, 'references');
  const scriptsDir = path.join(skillDir, 'scripts');

  const references: SubjectReferenceIndex[] = listMdFiles(referencesDir).map((fileName) => {
    const content = readTextSafe(path.join(referencesDir, fileName));
    const { title, summary } = extractReferenceSummary(content);
    return {
      fileName,
      relativePath: `references/${fileName}`,
      title,
      summary,
    };
  });

  const scripts: SubjectScriptIndex[] = listScriptFiles(scriptsDir).map((fileName) => ({
    fileName,
    relativePath: `scripts/${fileName}`,
    purpose: scriptPurpose(fileName),
  }));

  return {
    folderName,
    id,
    name: frontmatter.name || id,
    description: frontmatter.description || '',
    skillPath: skillMdPath,
    references,
    scripts,
  };
}

export function scanSubjectSkillCatalog(): SubjectSkillMetadata[] {
  return listSubjectSkillFolders()
    .map((folder) => loadSubjectSkillMetadata(folder))
    .filter((m): m is SubjectSkillMetadata => Boolean(m));
}

export function formatMetadataCatalogForPrompt(catalog: SubjectSkillMetadata[]): string {
  if (catalog.length === 0) return 'No subject skills found under .skills/subject-* folders.';

  return catalog
    .map((skill) => {
      const refList =
        skill.references.length > 0
          ? skill.references
              .map((r) => `    - ${r.fileName}: ${r.title}${r.summary ? ` — ${r.summary}` : ''}`)
              .join('\n')
          : '    (no references)';
      const scriptList =
        skill.scripts.length > 0
          ? skill.scripts.map((s) => `    - ${s.fileName}: ${s.purpose}`).join('\n')
          : '    (no scripts)';
      return [
        `### ${skill.id}`,
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        `references (load after choosing this subject):`,
        refList,
        `scripts (runtime only — do NOT invent formatting):`,
        scriptList,
      ].join('\n');
    })
    .join('\n\n');
}

export function loadSkillBody(subjectId: string): string {
  const folderName = `${SKILL_FOLDER_PREFIX}${subjectId}`;
  const skillMdPath = path.join(getSkillsRoot(), folderName, 'SKILL.md');
  const raw = readTextSafe(skillMdPath);
  return stripFrontmatter(raw);
}

export function loadReferenceFiles(
  subjectId: string,
  fileNames: string[]
): Array<{ fileName: string; content: string }> {
  const folderName = `${SKILL_FOLDER_PREFIX}${subjectId}`;
  const referencesDir = path.join(getSkillsRoot(), folderName, 'references');
  const loaded: Array<{ fileName: string; content: string }> = [];

  for (const fileName of fileNames) {
    const safe = path.basename(fileName);
    const fullPath = path.join(referencesDir, safe);
    if (!fullPath.startsWith(referencesDir)) continue;
    const content = readTextSafe(fullPath);
    if (content.trim()) {
      loaded.push({ fileName: safe, content });
    }
  }
  return loaded;
}

export function buildReferencesText(loaded: Array<{ fileName: string; content: string }>): string {
  if (loaded.length === 0) return '';
  return loaded
    .map((ref) => `<!-- reference: ${ref.fileName} -->\n${ref.content.trim()}`)
    .join('\n\n---\n\n');
}

export function resolveReferenceFilesForQuestionType(
  metadata: SubjectSkillMetadata,
  questionType: string,
  options?: { allowHardFallback?: boolean }
): string[] {
  const normalized = String(questionType || '').toLowerCase();
  const allowHardFallback = options?.allowHardFallback !== false;
  const aliases: Record<string, string[]> = {
    multiple_choice: ['multiple-choice.md', 'multiple_choice.md'],
    mcq: ['multiple-choice.md'],
    fill_in_blank: ['fill-in-blank.md', 'fill_in_blank.md', 'cloze.md', 'process.md', 'question-types.md', 'overview.md'],
    short_answer: ['short-answer.md', 'short_answer.md', 'process.md', 'conceptual.md', 'question-types.md', 'overview.md'],
    coding: ['coding.md'],
    debugging: ['debugging.md'],
    trace: ['trace.md'],
    design: ['design.md'],
    cloze: ['cloze.md'],
    reading_comprehension: ['reading-comprehension.md'],
    translation: ['translation.md'],
    grammar_correction: ['grammar-correction.md'],
    essay: ['essay.md', 'reading-comprehension.md'],
    calculation: ['calculation.md'],
    case_study: ['case-study.md'],
    data_analysis: ['data-analysis.md', 'map-data.md', 'ratio-analysis.md'],
    proof: ['proof.md', 'question-types.md', 'overview.md'],
    derivation: ['derivation.md', 'question-types.md', 'overview.md'],
  };

  const candidates = aliases[normalized] || [];
  const available = new Set(metadata.references.map((r) => r.fileName));
  const picked: string[] = [];
  for (const c of candidates) {
    if (available.has(c) && !picked.includes(c)) picked.push(c);
  }

  if (picked.length === 0) {
    const keywordFallbacks: Record<string, string[]> = {
      multiple_choice: ['multiple-choice', 'mcq'],
      mcq: ['multiple-choice', 'mcq'],
      fill_in_blank: ['fill-in-blank', 'fill_in_blank', 'cloze', 'process', 'pathway'],
      short_answer: ['short-answer', 'short_answer', 'process', 'conceptual', 'pathway'],
      essay: ['essay'],
      calculation: ['calculation', 'ratio-analysis', 'stoichiometry'],
      case_study: ['case-study'],
      data_analysis: ['data-analysis', 'map-data', 'ratio-analysis'],
      proof: ['proof'],
      derivation: ['derivation'],
      translation: ['translation'],
      reading_comprehension: ['reading-comprehension', 'source-analysis'],
      grammar_correction: ['grammar-correction'],
      coding: ['coding'],
      debugging: ['debugging'],
      trace: ['trace'],
      design: ['design'],
    };
    const hints = keywordFallbacks[normalized] || [];
    const byKeyword = metadata.references
      .map((r) => r.fileName)
      .filter((fileName) => hints.some((hint) => fileName.includes(hint)));
    for (const fileName of byKeyword) {
      if (!picked.includes(fileName)) picked.push(fileName);
    }
  }

  if (allowHardFallback) {
    if (picked.length === 0 && available.has('overview.md')) picked.push('overview.md');
    if (picked.length === 0 && metadata.references.length > 0) {
      picked.push(metadata.references[0].fileName);
    }
  }
  return picked;
}

export function folderNameFromSubjectId(subjectId: string): string {
  const id = String(subjectId || 'default').trim().toLowerCase();
  return `${SKILL_FOLDER_PREFIX}${id}`;
}

export function metadataById(catalog: SubjectSkillMetadata[], subjectId: string): SubjectSkillMetadata | null {
  const id = String(subjectId || '').trim().toLowerCase();
  return catalog.find((s) => s.id === id) || null;
}
