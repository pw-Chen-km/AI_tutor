/**
 * Outline Refiner Skill
 *
 * Uses compact page metadata to turn a deterministic rough outline into a
 * cleaner chapter/section outline for source planning.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

function compactPages(pages: any[]) {
  return (Array.isArray(pages) ? pages : []).map((page: any) => {
    const text = typeof page?.text === 'string' ? page.text : '';
    const firstLines = text
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean)
      .slice(0, 8);

    return {
      page_number: Number(page?.page_number) || Number(page?.pageNumber) || 0,
      title_guess: firstLines[0] || '',
      preview: firstLines.join(' | ').slice(0, 500),
      text_len: Number(page?.text_len) || Number(page?.textLen) || text.length,
      slide_type_hint: page?.slide_type_hint || undefined,
      topic_labels: Array.isArray(page?.topic_labels) ? page.topic_labels.slice(0, 8) : [],
      must_cover: Array.isArray(page?.must_cover) ? page.must_cover.slice(0, 6) : [],
      features: page?.features || undefined,
    };
  }).filter((page: any) => page.page_number > 0);
}

export class OutlineRefinerSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'outline_refiner',
    description: 'Refine rough PDF/PPTX page outlines into cleaner chapter and section structures for question source planning',
    category: 'orchestration',
    version: '1.0.0',
    estimatedTokens: 1200,
    requiredInputs: ['fileName', 'pages', 'roughOutline'],
    optionalInputs: ['fileType'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    const fileName = String(input.fileName || '').trim();
    const fileType = String(input.fileType || '').trim();
    const pages = compactPages(input.pages);
    const roughOutline = input.roughOutline || {};

    if (pages.length === 0) {
      return this.error(`No pages available to refine outline for ${fileName}`);
    }

    const messages = [
      {
        role: 'system',
        content: `You are an expert curriculum outline editor.

Refine a rough machine-generated outline for teaching materials.
Do NOT write questions.
Do NOT invent topics not visible in page metadata.

Rules:
- Use only page numbers that exist in the provided pages.
- Prefer meaningful course-topic section titles over raw fragments like "Chapter", "Weekly", "Input:", or footer text.
- Mark cover, agenda, transition, administrative, and overview-only pages as non-questionable sections when appropriate.
- Mark substantive concept, example, coding, debugging, type, operation, and error sections as questionable: true.
- Use questionable: false only for pure logistics, cover/title, agenda, transition, or wrap-up sections.
- If a section could support a drill, lab, homework, or exam question, questionable MUST be true.
- Keep page ranges contiguous inside each section.
- Use one chapter for a single CH file unless page metadata clearly contains multiple major chapters.
- Section IDs must be stable and ordered: ch1-s1, ch1-s2, ...
- Chapter IDs must be stable and ordered: ch1, ch2, ...
- If the rough outline is poor, replace it with a cleaner outline.

Return ONLY valid JSON:
{
  "chapters": [
    {
      "chapter_id": "ch1",
      "title": "Introduction to Python",
      "file": "CH1-final.pptx",
      "page_range": "1-34",
      "sections": [
        {
          "section_id": "ch1-s1",
          "title": "Course Overview",
          "page_range": "1-4",
          "page_refs": [1, 2, 3, 4],
          "topic_labels": ["course logistics"],
          "section_role": "overview",
          "questionable": false
        }
      ]
    }
  ]
}`
      },
      {
        role: 'user',
        content: `FILE: ${fileName}
FILE TYPE: ${fileType || 'unknown'}

ROUGH OUTLINE:
${JSON.stringify(roughOutline, null, 2)}

COMPACT PAGE METADATA:
${JSON.stringify(pages, null, 2)}

Refine the outline now. Return ONLY valid JSON.`
      }
    ];

    try {
      const { content, tokensUsed } = await this.callLLM(messages, context, {
        temperature: 0.1,
        maxTokens: 3500,
      });
      const chapters = Array.isArray(content?.chapters) ? content.chapters : [];
      if (chapters.length === 0) {
        return this.error('Outline refiner returned no chapters');
      }

      return this.success({ chapters }, tokensUsed, {
        fileName,
        outline_source: 'llm_refined',
      });
    } catch (error: any) {
      this.log('warn', 'Outline refinement failed', error?.message || error);
      return this.error(error?.message || 'Outline refinement failed');
    }
  }
}
