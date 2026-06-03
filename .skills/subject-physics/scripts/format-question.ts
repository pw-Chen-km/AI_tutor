/**
 * Deterministic formatter — physics.
 */

export interface FormatQuestionInput {
  questionText: string;
  questionType: string;
  metadata?: Record<string, any>;
}

const HEADING_LABELS = new Set([
  'Scenario', 'Given Data', 'Diagram Description', 'Assumptions', 'Required',
  'Units', 'Question', 'Physical Principle', 'Problem', 'Given',
]);

const LIST_SECTIONS = new Set(['Given Data', 'Assumptions', 'Required', 'Given']);

export function formatQuestion(input: FormatQuestionInput): string {
  let raw = String(input.questionText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return raw;
  raw = raw.replace(/```[a-z]*\n([\s\S]*?)```/gi, '$1');
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
    if (LIST_SECTIONS.has(section) && !/^[-*]\s+/.test(t)) {
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
