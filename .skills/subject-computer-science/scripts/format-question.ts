/**
 * Deterministic formatter — computer science (coding / debugging / trace).
 */

export interface FormatQuestionInput {
  questionText: string;
  questionType: string;
  metadata?: Record<string, any>;
}

const HEADING_LABELS = new Set([
  'Task', 'Inputs', 'Input', 'Output', 'Requirements', 'Requirement',
  'Example', 'Examples', 'Expected Behavior', 'Debugging Focus', 'Code',
  'Initial State', 'Trace Target',
]);

const LIST_SECTIONS = new Set([
  'Inputs', 'Input', 'Output', 'Requirements', 'Requirement',
  'Expected Behavior', 'Debugging Focus',
]);

export function formatQuestion(input: FormatQuestionInput): string {
  const type = String(input.questionType || '').toLowerCase();
  const raw = String(input.questionText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return raw;
  if (/^#{2,3}\s+/m.test(raw)) return collapseBlankLines(raw);

  const meta = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const lines = raw.split('\n').map((l) => l.trimEnd());
  if (!lines.some((l) => HEADING_LABELS.has(l.trim()))) {
    return formatFromMetadata(type, raw, meta);
  }

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
    } else if (['Example', 'Examples'].includes(section) && !t.startsWith('```') && looksLikeCode(t)) {
      out.push('```python\n' + t.replace(/\s*->\s*/g, '\n# returns ') + '\n```');
    } else if (section === 'Code' && !t.startsWith('```')) {
      out.push('```python\n' + t + '\n```');
    } else {
      out.push(line);
    }
  }
  return collapseBlankLines(out.join('\n'));
}

function formatFromMetadata(type: string, raw: string, meta: Record<string, any>): string {
  if (!['coding', 'debugging', 'trace'].some((t) => type.includes(t))) return raw;

  const contract = meta.function_contract && typeof meta.function_contract === 'object'
    ? meta.function_contract
    : {};
  const inputs = Array.isArray(contract.inputs) ? contract.inputs.map(String) : [];
  const requirements = Array.isArray(meta.requirements) ? meta.requirements.map(String) : [];
  const examples = Array.isArray(meta.examples) ? meta.examples.map(String) : [];

  if (type.includes('coding') && (inputs.length || requirements.length)) {
    const parts = [`## Task\n${raw}`];
    if (inputs.length) parts.push(`## Inputs\n${inputs.map((i: string) => `- ${i}`).join('\n')}`);
    if (contract.output) parts.push(`## Output\n- ${contract.output}`);
    if (requirements.length) parts.push(`## Requirements\n${requirements.map((r) => `- ${r}`).join('\n')}`);
    if (examples.length) {
      parts.push(`## Example\n\`\`\`python\n${examples[0]}\n\`\`\``);
    }
    return parts.join('\n\n');
  }
  return raw;
}

function looksLikeCode(line: string): boolean {
  return /(\w+\([^)]*\)|->|=>|^\s*def |^\s*class )/.test(line);
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
