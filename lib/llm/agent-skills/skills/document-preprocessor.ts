/**
 * Document Preprocessor Skill
 *
 * Deterministic document ingestion / parsing skill for PDF and PPTX files.
 * This skill is meant to be shared by downstream features before any LLM-heavy
 * generation step begins.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';
import { extractSlidesFromPptx } from '@/lib/parsers/pptx';

type SupportedDocumentType = 'pdf' | 'pptx';

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

export class DocumentPreprocessorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'document_preprocessor',
    description: 'Parse PDF/PPTX files into page-level text, heuristic hints, and reusable windows',
    category: 'specialized',
    version: '1.0.0',
    estimatedTokens: 0,
    requiredInputs: ['fileName', 'fileBase64'],
    optionalInputs: ['fileType', 'audienceLevel', 'targetMinutes', 'windowSize', 'overlap', 'preferPdfPipeline'],
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

    if (!fileType) {
      return this.error(`Unsupported document type for file: ${fileName}`);
    }

    this.log('info', `Preprocessing ${fileType.toUpperCase()} document: ${fileName}`);

    try {
      const routeHelpers = await import('@/app/api/lecture-rehearsal/route');
      const buildSlidePlan = (routeHelpers as any).buildSlidePlan;

      if (typeof buildSlidePlan !== 'function') {
        throw new Error('buildSlidePlan helper is unavailable');
      }

      let rawPages: Array<any> = [];
      let parserStrategy = '';
      let warnings: string[] = [];
      let normalizedType: SupportedDocumentType = fileType;

      if (fileType === 'pdf') {
        const extractPdfPagesFromBase64 = (routeHelpers as any).extractPdfPagesFromBase64;
        if (typeof extractPdfPagesFromBase64 !== 'function') {
          throw new Error('extractPdfPagesFromBase64 helper is unavailable');
        }
        rawPages = await extractPdfPagesFromBase64(fileBase64);
        parserStrategy = 'pdfjs-dist/pdf-parse';
      } else {
        const buffer = Buffer.from(fileBase64, 'base64');
        const slides = await extractSlidesFromPptx(buffer);
        rawPages = slides.map((slide) => ({
          page: Number(slide.slideNum) || 0,
          text: slide.text || '',
          textLen: slide.textLen || 0,
          features: slide.features || {},
        }));
        parserStrategy = 'pptx-xml';
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
        return {
          page_number: pageNumber,
          text: typeof page.text === 'string' ? page.text : '',
          text_len: Number(page.textLen) || 0,
          has_extractable_text: Boolean((page.text || '').trim()),
          slide_type_hint: plan?.slide_type || 'concept',
          target_words: Number(plan?.target_words) || 120,
          must_cover: Array.isArray(plan?.must_cover) ? plan.must_cover : [],
          topic_labels: Array.isArray(plan?.topic_labels) ? plan.topic_labels : [],
          features: page.features || undefined,
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
        pages,
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
