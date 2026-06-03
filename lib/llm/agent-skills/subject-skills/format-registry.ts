/**
 * Registry of deterministic format scripts per subject skill.
 * Scripts live under .skills/subject-{id}/scripts but are imported here
 * so Next.js can bundle them reliably.
 */

import { formatQuestion as formatDefault } from '../../../../.skills/subject-default/scripts/format-question';
import { formatQuestion as formatCS } from '../../../../.skills/subject-computer-science/scripts/format-question';
import { formatQuestion as formatLanguage } from '../../../../.skills/subject-language/scripts/format-question';
import { formatQuestion as formatFinance } from '../../../../.skills/subject-finance/scripts/format-question';
import { formatQuestion as formatMathematics } from '../../../../.skills/subject-mathematics/scripts/format-question';
import { formatQuestion as formatPhysics } from '../../../../.skills/subject-physics/scripts/format-question';
import { formatQuestion as formatChemistry } from '../../../../.skills/subject-chemistry/scripts/format-question';
import { formatQuestion as formatBiology } from '../../../../.skills/subject-biology/scripts/format-question';
import { formatQuestion as formatHistory } from '../../../../.skills/subject-history/scripts/format-question';
import { formatQuestion as formatGeography } from '../../../../.skills/subject-geography/scripts/format-question';
import { formatQuestion as formatCivics } from '../../../../.skills/subject-civics/scripts/format-question';

export interface FormatQuestionInput {
  questionText: string;
  questionType: string;
  metadata?: Record<string, any>;
}

export type FormatQuestionFn = (input: FormatQuestionInput) => string;

const REGISTRY: Record<string, FormatQuestionFn> = {
  default: formatDefault,
  'computer-science': formatCS,
  language: formatLanguage,
  finance: formatFinance,
  mathematics: formatMathematics,
  physics: formatPhysics,
  chemistry: formatChemistry,
  biology: formatBiology,
  history: formatHistory,
  geography: formatGeography,
  civics: formatCivics,
};

export function runFormatQuestionScript(
  subjectId: string,
  input: FormatQuestionInput
): string {
  const id = String(subjectId || 'default').trim().toLowerCase();
  const fn = REGISTRY[id] || REGISTRY.default;
  return fn(input);
}
