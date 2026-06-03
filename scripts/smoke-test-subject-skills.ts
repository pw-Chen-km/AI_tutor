/**
 * Smoke test: subject skill catalog + progressive pack (no LLM).
 */
import {
  scanSubjectSkillCatalog,
  formatMetadataCatalogForPrompt,
  loadReferenceFiles,
  buildReferencesText,
} from '../lib/llm/agent-skills/subject-skills/catalog';
import { runFormatQuestionScript } from '../lib/llm/agent-skills/subject-skills/format-registry';

function assert(cond: any, msg: string) {
  if (!cond) {
    console.error('[FAIL]', msg);
    process.exit(1);
  }
  console.log('[OK]', msg);
}

function main() {
  const catalog = scanSubjectSkillCatalog();
  assert(catalog.length >= 11, `catalog has 11+ subjects (got ${catalog.length})`);

  for (const id of [
    'computer-science',
    'language',
    'finance',
    'mathematics',
    'physics',
    'chemistry',
    'biology',
    'history',
    'geography',
    'civics',
    'default',
  ]) {
    const meta = catalog.find((s) => s.id === id);
    assert(meta && meta.references.length > 0, `${id} has references`);
    assert(meta && meta.scripts.some((s) => s.fileName.includes('format-question')), `${id} has format-question script`);
  }

  const block = formatMetadataCatalogForPrompt(catalog);
  assert(block.includes('subject-computer-science') || block.includes('### computer-science'), 'catalog block lists CS');

  const refs = loadReferenceFiles('computer-science', ['coding.md']);
  assert(refs.length === 1 && refs[0].content.includes('## Task'), 'coding.md loads');

  const formatted = runFormatQuestionScript('computer-science', {
    questionText: 'Task\nImplement foo\nInputs\n- x: int',
    questionType: 'coding',
  });
  assert(formatted.includes('## Task'), 'format script adds headings');

  const langFormatted = runFormatQuestionScript('language', {
    questionText: 'Passage\n> Hello world',
    questionType: 'cloze',
  });
  assert(langFormatted.includes('## Passage'), 'language format works');

  const mathFormatted = runFormatQuestionScript('mathematics', {
    questionText: 'Problem\nSolve for x\nGiven\n- x + 2 = 5',
    questionType: 'calculation',
  });
  assert(mathFormatted.includes('## Problem'), 'mathematics format works');

  console.log('\nAll smoke tests passed.');
}

main();
