/**
 * Document Preprocessor Skill
 *
 * Deterministic document ingestion / parsing skill for PDF and PPTX files.
 * This skill is meant to be shared by downstream features before any LLM-heavy
 * generation step begins.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';
import { intakeDocument } from '@/lib/document-intake';
import { buildSlidePlan } from '@/lib/document-intake/slide-plan';

type SupportedDocumentType = 'pdf' | 'pptx';

type OutlineSection = {
  section_id: string;
  title: string;
  page_range: string;
  page_refs: number[];
  topic_labels: string[];
  section_role: string;
};

function inferDocumentType(fileName: string, explicitType?: string): SupportedDocumentType | null {
  const raw = (explicitType || '').trim().toLowerCase();
  if (raw === 'pdf' || raw === 'pptx') return raw;

  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerName.endsWith('.pptx')) return 'pptx';
  return null;
}

function buildWindows(pageCount: number, windowSize = 5, overlap = 1) {
  const safeWindowSize = Math.max(1, windowSize);
  const safeOverlap = Math.max(0, Math.min(overlap, safeWindowSize - 1));
  const step = Math.max(1, safeWindowSize - safeOverlap);
  const windows: Array<{ start_page: number; end_page: number }> = [];

  for (let start = 1; start <= pageCount; start += step) {
    const end = Math.min(pageCount, start + safeWindowSize - 1);
    windows.push({ start_page: start, end_page: end });
    if (end >= pageCount) break;
  }

  return windows;
}

function normalizeTitle(text: string, fallback: string) {
  const firstUsefulLine = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 3 && line.length <= 90 && !/^\d+$/.test(line));
  return firstUsefulLine || fallback;
}

function titleFromFileName(fileName: string) {
  const baseName = (fileName || 'document')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return baseName || 'document';
}

function pageRangeFromRefs(refs: number[]) {
  if (refs.length === 0) return '';
  const sorted = [...refs].sort((a, b) => a - b);
  return sorted[0] === sorted[sorted.length - 1]
    ? String(sorted[0])
    : `${sorted[0]}-${sorted[sorted.length - 1]}`;
}

function shouldStartNewSection(page: any, current: OutlineSection | null) {
  if (!current) return true;
  const role = String(page.slide_type_hint || 'concept');
  const currentRole = current.section_role;
  const labels = Array.isArray(page.topic_labels) ? page.topic_labels : [];
  const currentLabels = new Set(current.topic_labels || []);
  const sharedLabels = labels.filter((label: string) => currentLabels.has(label)).length;
  const textLen = Number(page.text_len) || 0;

  if (role === 'transition' || role === 'cover') return false;
  if (current.page_refs.length >= 5) return true;
  if (currentRole !== role && ['example', 'summary'].includes(role)) return true;
  if (labels.length > 0 && currentLabels.size > 0 && sharedLabels === 0 && current.page_refs.length >= 2) return true;
  return textLen > 500 && current.page_refs.length >= 3;
}

function buildOutline(fileName: string, pages: Array<any>) {
  const chapterId = 'ch1';
  const contentPages = pages.filter((page) => !['cover', 'transition'].includes(String(page.slide_type_hint || 'concept')));
  const sectionPages = contentPages.length > 0 ? contentPages : pages;
  const sections: OutlineSection[] = [];

  for (const page of sectionPages) {
    const pageNumber = Number(page.page_number) || 0;
    if (!pageNumber) continue;

    let current = sections[sections.length - 1] || null;
    if (shouldStartNewSection(page, current)) {
      const sectionId = `${chapterId}-s${sections.length + 1}`;
      current = {
        section_id: sectionId,
        title: normalizeTitle(page.text, `Section ${sections.length + 1}`),
        page_range: String(pageNumber),
        page_refs: [],
        topic_labels: [],
        section_role: String(page.slide_type_hint || 'concept'),
      };
      sections.push(current);
    }

    current.page_refs.push(pageNumber);
    current.page_range = pageRangeFromRefs(current.page_refs);
    current.topic_labels = [
      ...new Set([
        ...current.topic_labels,
        ...(Array.isArray(page.topic_labels) ? page.topic_labels : []),
      ]),
    ].slice(0, 8);
  }

  return {
    chapters: [
      {
        chapter_id: chapterId,
        title: titleFromFileName(fileName),
        file: fileName,
        page_range: pageRangeFromRefs(pages.map((page) => Number(page.page_number) || 0).filter(Boolean)),
        sections,
      },
    ],
  };
}

export class DocumentPreprocessorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'document_preprocessor',
    description: 'Parse PDF/PPTX files into page-level text, heuristic hints, and reusable windows',
    category: 'specialized',
    version: '1.0.0',
    estimatedTokens: 0,
    requiredInputs: ['fileName'],
    optionalInputs: ['fileType', 'fileBase64', 'intake', 'audienceLevel', 'targetMinutes', 'windowSize', 'overlap', 'preferPdfPipeline'],
  };

  async execute(input: SkillInput, _context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    const fileName = String(input.fileName || '').trim();
    const fileBase64 = String(input.fileBase64 || '').trim();
    const fileType = inferDocumentType(fileName, input.fileType);
    const audienceLevel = String(input.audienceLevel || 'beginner');
    const targetMinutes = Number(input.targetMinutes) || 45;
    const windowSize = Number(input.windowSize) || 5;
    const overlap = Number(input.overlap) || 1;
    const preferPdfPipeline = Boolean(input.preferPdfPipeline);
    const existingIntake = input?.intake && typeof input.intake === 'object' ? input.intake : null;

    if (!fileType) {
      return this.error(`Unsupported document type for file: ${fileName}`);
    }

    const hasReusableIntake = existingIntake && Array.isArray(existingIntake.pages) && existingIntake.pages.length > 0;
    if (!hasReusableIntake && !fileBase64) {
      return this.error(`Missing reusable intake or fileBase64 for file: ${fileName}`);
    }

    this.log('info', `Preprocessing ${fileType.toUpperCase()} document: ${fileName}`);

    try {
      const intake = hasReusableIntake
        ? {
            fileName,
            fileType,
            intent: 'read_for_question_generation',
            strategy: String(existingIntake.strategy || 'client-intake-reused'),
            content: String(existingIntake.content || ''),
            pages: existingIntake.pages,
            warnings: Array.isArray(existingIntake.warnings) ? existingIntake.warnings : [],
            metadata: existingIntake.metadata || {},
          }
        : await intakeDocument({
            fileName,
            buffer: Buffer.from(fileBase64, 'base64'),
            intent: 'read_for_question_generation',
          });

      let rawPages: Array<any> = intake.pages.map((page: any) => ({
        page: Number(page.pageNumber) || 0,
        text: page.text || '',
        textLen: Number(page.textLen) || 0,
        features: page.features || {},
      }));
      const parserStrategy = intake.strategy;
      let warnings: string[] = [...(intake.warnings || [])];
      let normalizedType: SupportedDocumentType = fileType;

      if (fileType === 'pptx') {
        normalizedType = preferPdfPipeline ? 'pdf' : 'pptx';
        if (preferPdfPipeline) {
          warnings.push('preferPdfPipeline is enabled, but PPTX-to-PDF normalization is not implemented in this skill yet.');
        }
      }

      const slidePlan = buildSlidePlan({
        slidesFromPpt: rawPages.map((page: any) => ({
          slide_number: Number(page.page) || 0,
          text: page.text || '',
          textLen: page.textLen || 0,
          isCover: Number(page.page) === 1 && Number(page.textLen) < 30,
        })),
        audienceLevel,
        targetMinutes,
      });

      const planByPage = new Map<number, any>(
        (Array.isArray(slidePlan) ? slidePlan : []).map((plan: any) => [Number(plan.slide_number) || 0, plan])
      );

      const pages = rawPages.map((page: any) => {
        const pageNumber = Number(page.page) || 0;
        const plan = planByPage.get(pageNumber);
        const slideTypeHint = plan?.slide_type || 'concept';
        return {
          page_number: pageNumber,
          text: typeof page.text === 'string' ? page.text : '',
          text_len: Number(page.textLen) || 0,
          has_extractable_text: Boolean((page.text || '').trim()),
          slide_type_hint: slideTypeHint,
          target_words: Number(plan?.target_words) || 120,
          must_cover: Array.isArray(plan?.must_cover) ? plan.must_cover : [],
          topic_labels: Array.isArray(plan?.topic_labels) ? plan.topic_labels : [],
          features: page.features || undefined,
        };
      });
      const outline = buildOutline(fileName, pages);
      const sectionByPage = new Map<number, OutlineSection>();
      for (const chapter of outline.chapters) {
        for (const section of chapter.sections) {
          for (const pageRef of section.page_refs) {
            sectionByPage.set(pageRef, section);
          }
        }
      }
      const pagesWithOutline = pages.map((page) => {
        const section = sectionByPage.get(Number(page.page_number) || 0);
        return {
          ...page,
          chapter_id: outline.chapters[0]?.chapter_id || 'ch1',
          section_id: section?.section_id,
          section_title: section?.title,
        };
      });

      const pageCount = pages.length;
      const textlessPages = pages
        .filter((page) => !page.has_extractable_text)
        .map((page) => page.page_number);

      if (textlessPages.length > 0) {
        warnings.push(`Some pages have no extractable text: ${textlessPages.join(', ')}`);
      }

      const windows = buildWindows(pageCount, windowSize, overlap);
      const result = {
        source_type: fileType,
        normalized_type: normalizedType,
        file_name: fileName,
        parser: {
          strategy: parserStrategy,
        },
        page_count: pageCount,
        pages: pagesWithOutline,
        rough_outline: outline,
        outline,
        outline_source: 'heuristic',
        windows,
        recommendations: {
          prefer_direct_pdf: fileType === 'pdf' || preferPdfPipeline,
          recommended_window_size: windowSize,
          recommended_overlap: overlap,
          single_page_rescue_candidates: textlessPages,
        },
        warnings,
      };

      return this.success(result, 0, {
        deterministic: true,
        parserStrategy,
      });
    } catch (error: any) {
      this.log('error', 'Failed to preprocess document', error);
      return this.error(error?.message || 'Failed to preprocess document');
    }
  }
}
