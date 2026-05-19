import { DocumentIntakeInput, DocumentIntakeResult } from './types';
import { normalizePageTextToContent, splitTextIntoPages, withTempFile, runCommand } from './office-tools';

async function extractWithPdfToText(buffer: Buffer) {
  return withTempFile('pdf', buffer, async (filePath) => {
    const result = await runCommand('pdftotext', ['-layout', filePath, '-'], 45000);
    if (!result.ok || !result.stdout.trim()) {
      return null;
    }

    const pages = splitTextIntoPages(result.stdout);
    const actualTextLen = pages.reduce((sum, page) => sum + page.textLen, 0);
    return actualTextLen > 100 ? pages : null;
  });
}

async function extractWithPdfJs(buffer: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
    useSystemFonts: true,
  } as any);
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str || '')
      .join(' ')
      .trim();
    pages.push({ pageNumber: i, text, textLen: text.length });
  }

  const actualTextLen = pages.reduce((sum, page) => sum + page.textLen, 0);
  return actualTextLen > 100 ? pages : null;
}

async function extractWithPdfParse(buffer: Buffer) {
  // @ts-ignore - pdf-parse types may not fully describe pagerender.
  const pdfParse = (await import('pdf-parse')).default;
  const renderPage = async (pageData: any) => {
    const textContent = await pageData.getTextContent();
    const pageText = (textContent.items || [])
      .map((item: any) => item.str || '')
      .join(' ')
      .trim();
    return `${pageText}\f`;
  };
  const data = await pdfParse(buffer, { pagerender: renderPage as any });
  const pages = splitTextIntoPages(data.text || '');
  const actualTextLen = pages.reduce((sum, page) => sum + page.textLen, 0);
  return actualTextLen > 100 ? pages : null;
}

async function buildPageFallback(buffer: Buffer) {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(buffer);
  return Array.from({ length: pdfDoc.getPageCount() }, (_, index) => ({
    pageNumber: index + 1,
    text: '',
    textLen: 0,
  }));
}

export async function extractPdf(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const warnings: string[] = [];
  let pages = null as Awaited<ReturnType<typeof extractWithPdfToText>>;
  let strategy = '';

  try {
    pages = await extractWithPdfToText(input.buffer);
    if (pages) strategy = 'pdf.pdftotext.layout';
  } catch (error: any) {
    warnings.push(`pdftotext unavailable or failed: ${error?.message || error}`);
  }

  if (!pages) {
    try {
      pages = await extractWithPdfJs(input.buffer);
      if (pages) strategy = 'pdf.pdfjs-dist';
    } catch (error: any) {
      warnings.push(`pdfjs-dist failed: ${error?.message || error}`);
    }
  }

  if (!pages) {
    try {
      pages = await extractWithPdfParse(input.buffer);
      if (pages) strategy = 'pdf.pdf-parse';
    } catch (error: any) {
      warnings.push(`pdf-parse failed: ${error?.message || error}`);
    }
  }

  if (!pages) {
    pages = await buildPageFallback(input.buffer);
    strategy = 'pdf.page-count-fallback';
    warnings.push('PDF text extraction failed. OCR fallback is not wired into runtime yet.');
  }

  const content =
    strategy === 'pdf.page-count-fallback'
      ? `[WARNING: PDF text extraction failed. The PDF may be image-based or protected.]\n\n${normalizePageTextToContent(pages)}`
      : normalizePageTextToContent(pages);

  return {
    fileName: input.fileName,
    fileType: 'pdf',
    intent: input.intent || 'generic',
    strategy,
    content,
    pages,
    warnings,
    metadata: {
      pageCount: pages.length,
      skillWorkflow: ['pdftotext layout', 'pdfjs-dist', 'pdf-parse', 'page-count fallback', 'future OCR fallback'],
    },
  };
}

