/**
 * Deterministic question formatter — generic / default subject.
 * Do not rely on LLM for section headings or list structure.
 */

export interface FormatQuestionInput {
  questionText: string;
  questionType: string;
  metadata?: Record<string, any>;
}

const HEADING_LABELS = new Set([
  'Task', 'Context', 'Question', 'Expected Answer', 'Example', 'Requirements', 'Requirement',
]);

export function formatQuestion(input: FormatQuestionInput): string {
  const raw = String(input.questionText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return raw;
  if (/^#{2,3}\s+/m.test(raw)) return collapseBlankLines(raw);

  const lines = raw.split('\n').map((l) => l.trimEnd());
  if (!lines.some((l) => HEADING_LABELS.has(l.trim()))) return raw;

  const out: string[] = [];
  let section = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    if (HEADING_LABELS.has(t)) {
      section = t;
      out.push(`## ${t}`);
      continue;
    }
    if (['Requirements', 'Requirement', 'Context'].includes(section) && !/^[-*]\s+/.test(t)) {
      out.push(`- ${t}`);
    } else {
      out.push(line);
    }
  }
  return collapseBlankLines(out.join('\n'));
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
