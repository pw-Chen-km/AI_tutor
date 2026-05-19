import JSZip from 'jszip';
import { extractSlidesFromPptx } from '@/lib/parsers/pptx';
import { DocumentIntakeInput, DocumentIntakeResult } from './types';
import { extractTextFromXml, normalizePageTextToContent, runCommand, withTempFile } from './office-tools';

async function extractWithMarkitdown(buffer: Buffer) {
  return withTempFile('pptx', buffer, async (filePath) => {
    const result = await runCommand('python', ['-m', 'markitdown', filePath], 45000);
    return result.ok && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
  });
}

async function extractNotes(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const noteFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const an = Number(a.match(/notesSlide(\d+)\.xml/i)?.[1] || 0);
      const bn = Number(b.match(/notesSlide(\d+)\.xml/i)?.[1] || 0);
      return an - bn;
    });

  const notes = new Map<number, string>();
  for (const fileName of noteFiles) {
    const slideNumber = Number(fileName.match(/notesSlide(\d+)\.xml/i)?.[1] || 0);
    const xml = await zip.file(fileName)!.async('string');
    const text = extractTextFromXml(xml).trim();
    if (text) notes.set(slideNumber, text);
  }
  return notes;
}

export async function extractPptx(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const warnings: string[] = [];
  let markitdownContent = '';

  try {
    markitdownContent = (await extractWithMarkitdown(input.buffer)) || '';
  } catch (error: any) {
    warnings.push(`markitdown unavailable or failed: ${error?.message || error}`);
  }

  const slides = await extractSlidesFromPptx(input.buffer);
  const notes = await extractNotes(input.buffer).catch((error: any) => {
    warnings.push(`speaker notes extraction failed: ${error?.message || error}`);
    return new Map<number, string>();
  });

  const pages = slides.map((slide) => {
    const slideNumber = Number(slide.slideNum) || 0;
    const notesText = notes.get(slideNumber) || '';
    const text = [slide.text || '', notesText ? `[SPEAKER NOTES]\n${notesText}` : ''].filter(Boolean).join('\n\n');
    return {
      pageNumber: slideNumber,
      text,
      textLen: text.trim().length,
      notes: notesText || undefined,
      features: slide.features || {},
    };
  });

  const slideContent = normalizePageTextToContent(pages);
  const content = markitdownContent.trim()
    ? `${markitdownContent.trim()}\n\n[PPTX STRUCTURED SLIDES]\n${slideContent}`.trim()
    : slideContent || `PowerPoint file: ${input.fileName}\n(No extractable text found in slides)`;

  return {
    fileName: input.fileName,
    fileType: 'pptx',
    intent: input.intent || 'generic',
    strategy: markitdownContent.trim() ? 'pptx.markitdown-plus-ooxml' : 'pptx.ooxml-slide-parser',
    content,
    pages,
    warnings,
    metadata: {
      slideCount: pages.length,
      notesCount: notes.size,
      skillWorkflow: ['markitdown markdown extraction', 'OOXML slide text', 'OOXML speaker notes', 'layout/media feature hints'],
    },
  };
}

