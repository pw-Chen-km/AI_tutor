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
- Use scope_kind "two_chapter_bridge".
- Prefer exactly 2 chapter_ids when enough chapters exist.
- Earlier items may stay local, but the overall set must include chapter-to-chapter transfer, comparison, or dependency.
- When two chapters are in different files, use the sources array with one source per file.`
        : moduleType === 'exams'
        ? `EXAM-SPECIFIC RULES:
- Use scope_kind "three_plus_chapter_fusion".
- Prefer 3 or more chapter_ids when enough chapters exist.
- Each item should fuse concepts across chapters, not merely sample isolated pages.
- Keep each item anchored to a primary skill under time pressure, but require cross-chapter reasoning.
- When chapters are in different files, use the sources array with one source per file.`
        : moduleType === 'labs'
        ? `LAB-SPECIFIC RULES:
- Use scope_kind "same_chapter_multi_section".
- Use 2-4 related section_ids within exactly one chapter_id.
- Choose scopes that can support actionable requirements, testing, debugging, implementation, or design steps.`
        : `DRILL-SPECIFIC RULES:
- Use scope_kind "single_section".
- Use exactly one section_id.
- Favor one local concept that supports a quick in-class check.`;

      const messages = [
        {
          role: 'system',
          content: `You are an expert curriculum planner for university teaching materials.

Your job is to plan source scopes for downstream question generation.
You do NOT write the questions. You only decide which file/pages each item should use.

PLANNING RULES:
- Read only the provided page metadata and outline.
- Prefer conceptually coherent scopes over broad coverage.
- Avoid repeating the same pages unless absolutely necessary.
- Match the planned scope to the requested question type.
- Use ONLY filenames and page ranges that actually exist in the metadata.
- Never invent files, pages, or concepts.
- Skip cover, agenda, transition, administrative, and empty pages unless they contain examinable concepts.
- Treat scope_kind, chapter_ids, section_ids, and integration_goal as a binding contract for the question generator.
- chapter_ids and section_ids are GLOBAL course IDs when a global course outline is present; use them for cross-chapter planning.
- Every chapter_id and section_id you list MUST be represented by at least one selected page in sources.
- For homework/exams, if the target chapters are in different files, sources MUST include those different files.

${moduleRules}

Return ONLY valid JSON:
{
  "scopes": [
    {
      "item_number": 1,
      "question_type": "coding",
      "scope_kind": "single_section",
      "file": "lecture3.pdf",
      "pages": "12-13",
      "sources": [{ "file": "lecture3.pdf", "pages": "12-13" }],
      "chapter_ids": ["ch1"],
      "section_ids": ["ch1-s2"],
      "topic_focus": ["list slicing", "mutation"],
      "integration_goal": "What relationship or transfer the question should test",
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
