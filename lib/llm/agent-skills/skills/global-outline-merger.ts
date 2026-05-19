/**
 * Global Outline Merger Skill
 *
 * Normalizes per-file refined outlines into a course-level chapter map so
 * source planning can reason across multiple uploaded lecture files.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

function compactDocuments(documents: any[]) {
  return (Array.isArray(documents) ? documents : []).map((doc: any, index: number) => {
    const outline = doc?.outline || {};
    const chapters = Array.isArray(outline?.chapters) ? outline.chapters : [];
    return {
      file: String(doc?.fileName || doc?.file || `document-${index + 1}`),
      uploaded_index: Number(doc?.uploadedIndex) || index + 1,
      page_count: Array.isArray(doc?.pages) ? doc.pages.length : Number(doc?.pageCount) || 0,
      outline_source: doc?.outlineSource || doc?.outline_source || 'unknown',
      chapters: chapters.map((chapter: any) => ({
        local_chapter_id: String(chapter?.chapter_id || 'ch1'),
        title: String(chapter?.title || ''),
        page_range: String(chapter?.page_range || ''),
        sections: (Array.isArray(chapter?.sections) ? chapter.sections : []).map((section: any) => ({
          local_section_id: String(section?.section_id || ''),
          title: String(section?.title || ''),
          page_range: String(section?.page_range || ''),
          page_refs: Array.isArray(section?.page_refs) ? section.page_refs : [],
          topic_labels: Array.isArray(section?.topic_labels) ? section.topic_labels.slice(0, 8) : [],
          section_role: String(section?.section_role || ''),
          questionable: section?.questionable,
        })),
      })),
    };
  });
}

export class GlobalOutlineMergerSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'global_outline_merger',
    description: 'Merge per-file lecture outlines into global course chapter and section IDs for cross-chapter source planning',
    category: 'orchestration',
    version: '1.0.0',
    estimatedTokens: 1000,
    requiredInputs: ['documents'],
    optionalInputs: ['courseTitle'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    const documents = compactDocuments(input.documents);
    if (documents.length === 0) {
      return this.error('No document outlines provided');
    }

    const messages = [
      {
        role: 'system',
        content: `You are an expert curriculum organizer.

Merge multiple per-file lecture outlines into a single course-level outline.
Do NOT write questions.
Do NOT invent topics that are not supported by file titles, outline titles, or section labels.

Important:
- Filenames may be free style. Use filename chapter/week/lecture/unit numbers when present, but do not rely on filenames only.
- Prefer explicit chapter numbers in outline titles over filenames.
- If no explicit order exists, infer order from curriculum progression and uploaded_index.
- A single uploaded file may be one global chapter.
- If a file contains multiple major chapters, split them into multiple global chapters.
- If several files are parts of one chapter, merge them under one global chapter.
- Preserve exact source file names, local_chapter_id, local_section_id, and page ranges.
- Global chapter IDs must be stable: course-ch1, course-ch2, ...
- Global section IDs must be stable under their chapter: course-ch1-s1, course-ch1-s2, ...

Return ONLY valid JSON:
{
  "course_outline": {
    "chapters": [
      {
        "chapter_id": "course-ch1",
        "title": "Python Programming Basics",
        "order": 1,
        "source_files": ["intro slides.pptx"],
        "source_chapters": [{ "file": "intro slides.pptx", "local_chapter_id": "ch1" }],
        "order_confidence": "high",
        "order_basis": ["title says Introduction", "uploaded first"],
        "sections": [
          {
            "section_id": "course-ch1-s1",
            "title": "Variables",
            "source_file": "intro slides.pptx",
            "local_section_id": "ch1-s3",
            "page_range": "3-8",
            "page_refs": [3, 4, 5, 6, 7, 8],
            "topic_labels": ["variables"],
            "section_role": "concept",
            "questionable": true
          }
        ]
      }
    ]
  },
  "file_chapter_map": [
    {
      "file": "intro slides.pptx",
      "local_chapter_id": "ch1",
      "global_chapter_id": "course-ch1"
    }
  ],
  "section_map": [
    {
      "file": "intro slides.pptx",
      "local_section_id": "ch1-s3",
      "global_chapter_id": "course-ch1",
      "global_section_id": "course-ch1-s1"
    }
  ]
}`
      },
      {
        role: 'user',
        content: `COURSE TITLE: ${input.courseTitle || 'not specified'}

PER-FILE OUTLINES:
${JSON.stringify(documents, null, 2)}

Merge these into a global course outline now. Return ONLY valid JSON.`
      },
    ];

    try {
      const { content, tokensUsed } = await this.callLLM(messages, context, {
        temperature: 0.1,
        maxTokens: 5000,
      });

      const chapters = content?.course_outline?.chapters;
      if (!Array.isArray(chapters) || chapters.length === 0) {
        return this.error('Global outline merger returned no chapters');
      }

      const invalidChapterIds = chapters
        .map((chapter: any) => String(chapter?.chapter_id || ''))
        .filter((chapterId: string) => !/^course-ch\d+$/.test(chapterId));
      if (invalidChapterIds.length > 0) {
        return this.error(`Global outline merger returned invalid chapter IDs: ${invalidChapterIds.join(', ')}`);
      }

      const coveredFiles = new Set<string>();
      for (const chapter of chapters) {
        const chapterId = String(chapter?.chapter_id || '');
        if (Array.isArray(chapter?.source_files)) {
          chapter.source_files.forEach((file: any) => coveredFiles.add(String(file || '').toLowerCase()));
        }
        if (Array.isArray(chapter?.source_chapters)) {
          chapter.source_chapters.forEach((source: any) => coveredFiles.add(String(source?.file || '').toLowerCase()));
        }
        if (Array.isArray(chapter?.sections)) {
          for (const section of chapter.sections) {
            const sectionId = String(section?.section_id || '');
            if (!sectionId.startsWith(`${chapterId}-s`)) {
              return this.error(`Global outline merger returned invalid section ID: ${sectionId}`);
            }
            coveredFiles.add(String(section?.source_file || '').toLowerCase());
          }
        }
      }
      const missingFiles = documents
        .map((doc) => doc.file.toLowerCase())
        .filter((file) => !coveredFiles.has(file));
      if (missingFiles.length > 0) {
        return this.error(`Global outline merger omitted files: ${missingFiles.join(', ')}`);
      }

      return this.success(content, tokensUsed, {
        outline_source: 'global_llm_merged',
      });
    } catch (error: any) {
      this.log('warn', 'Global outline merge failed', error?.message || error);
      return this.error(error?.message || 'Global outline merge failed');
    }
  }
}
