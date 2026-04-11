/**
 * Source Planner Skill
 *
 * Uses compact page-level metadata to plan local source scopes for downstream
 * question generation. This keeps the planning phase cheap while still letting
 * an LLM reason about coverage and instructional intent.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class SourcePlannerSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'source_planner',
    description: 'Plan item-level source scopes from compact page metadata only',
    category: 'orchestration',
    version: '1.0.0',
    estimatedTokens: 900,
    requiredInputs: ['moduleType', 'numberOfItems', 'questionPlan', 'documents'],
    optionalInputs: ['targetMinutes', 'planningGoals', 'selectedChapters'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    try {
      const {
        moduleType,
        numberOfItems,
        questionPlan,
        documents,
        targetMinutes,
        planningGoals,
        selectedChapters,
      } = input;
      const moduleRules = moduleType === 'homework'
        ? `HOMEWORK-SPECIFIC RULES:
- Build an assignment-like progression: earlier items can be narrower, later items can integrate a small number of related ideas.
- Balance chapter/file coverage across the whole set rather than clustering too many items on one source.
- Allow modest multi-concept integration, but keep each source scope local and teachable.`
        : moduleType === 'exams'
        ? `EXAM-SPECIFIC RULES:
- Each item should map to one primary skill or misconception target.
- Keep scopes especially focused so exam questions stay discriminative and time-bounded.
- Prefer 1-2 page scopes unless a slightly broader local scope is clearly necessary.
- Avoid giving multiple exam items the exact same page range unless there is no better option.`
        : moduleType === 'labs'
        ? `LAB-SPECIFIC RULES:
- Prefer 2-4 page scopes around one coherent mini-topic.
- Choose scopes that can support actionable requirements, testing, and debugging steps.`
        : `DRILL-SPECIFIC RULES:
- Keep scopes very tight: usually 1 page, occasionally 2 if strongly justified.
- Favor one local concept that supports a quick in-class check.`;

      const messages = [
        {
          role: 'system',
          content: `You are an expert curriculum planner for university teaching materials.

Your job is to plan LOCAL source scopes for downstream question generation.
You do NOT write the questions. You only decide which file/pages each item should use.

PLANNING RULES:
- Read only the provided page metadata.
- Choose page scopes that are local and focused.
- Prefer conceptually coherent scopes over broad coverage.
- Avoid repeating the same pages unless absolutely necessary.
- Match the planned scope to the requested question type.
- Use ONLY filenames and page ranges that actually exist in the metadata.
- Never invent files, pages, or concepts.

${moduleRules}

Return ONLY valid JSON:
{
  "scopes": [
    {
      "item_number": 1,
      "question_type": "coding",
      "file": "lecture3.pdf",
      "pages": "12-13",
      "topic_focus": ["list slicing", "mutation"],
      "rationale": "Short reason why these pages best fit the item"
    }
  ],
  "coverage_summary": "One short sentence"
}`
        },
        {
          role: 'user',
          content: `MODULE TYPE: ${moduleType}
NUMBER OF ITEMS: ${numberOfItems}
TARGET MINUTES PER ITEM: ${targetMinutes || 'not specified'}
PLANNING GOALS: ${planningGoals || 'Choose the best local source scope for each item.'}
SELECTED CHAPTERS / FILES: ${Array.isArray(selectedChapters) && selectedChapters.length > 0 ? selectedChapters.join(', ') : 'All available files'}

QUESTION PLAN:
${JSON.stringify(questionPlan, null, 2)}

DOCUMENT METADATA:
${JSON.stringify(documents, null, 2)}

Plan the best local source scope for each item now. Return ONLY valid JSON.`
        }
      ];

      const { content, tokensUsed } = await this.callLLM(messages, context, {
        temperature: 0.2,
        maxTokens: 2200,
      });

      return this.success(content, tokensUsed, {
        moduleType,
        numberOfItems,
      });
    } catch (error: any) {
      this.log('error', 'Failed to plan sources', error);
      return this.error(error.message || 'Failed to plan sources');
    }
  }
}
