/**
 * Deterministic formatter — language / literature subjects.
 * Never wrap passages in code fences; use block quotes.
 */

export interface FormatQuestionInput {
  questionText: string;
  questionType: string;
  metadata?: Record<string, any>;
}

const HEADING_LABELS = new Set([
  'Passage', 'Context', 'Vocabulary', 'Grammar Point', 'Instructions',
  'Question', 'Choices', 'Source Text', 'Target Language', 'Reading', 'Comprehension', 'Prompt',
]);

const QUOTE_SECTIONS = new Set(['Passage', 'Source Text', 'Sentence', 'Context']);
const LIST_SECTIONS = new Set(['Choices', 'Vocabulary', 'Instructions']);

export function formatQuestion(input: FormatQuestionInput): string {
  let raw = String(input.questionText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return raw;

  // Strip erroneous code fences around non-code content
  raw = raw.replace(/```[a-z]*\n([\s\S]*?)```/gi, (_, inner) => {
    if (/^(def |class |import |function )/m.test(inner)) return '```\n' + inner + '\n```';
    return inner.split('\n').map((l: string) => (l.startsWith('>') ? l : `> ${l}`)).join('\n');
  });

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
    if (QUOTE_SECTIONS.has(section) && !t.startsWith('>') && !t.startsWith('##')) {
      out.push(t.split('\n').map((l) => (l.startsWith('>') ? l : `> ${l}`)).join('\n'));
    } else if (LIST_SECTIONS.has(section) && !/^[-*]\s+/.test(t) && !/^[A-D][\).]/.test(t)) {
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
