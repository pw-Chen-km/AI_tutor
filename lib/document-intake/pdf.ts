import type { DocumentIntakeInput, DocumentIntakeResult, DocumentPage } from './types';
import { normalizePageTextToContent, splitTextIntoPages, withTempFile, runCommand } from './office-tools';

const OCR_SYSTEM_PROMPT = [
  'You are a document OCR engine for teaching materials.',
  'Transcribe every readable page from the attached PDF, including handwriting, scanned text, tables, formulas, labels, and marginal notes.',
  'Preserve the original language and page order. Do not summarize or add explanations.',
  'If a page has no readable text, return an empty string for that page.',
  'Return strict JSON only: {"pages":[{"pageNumber":1,"text":"..."},{"pageNumber":2,"text":"..."}]}.',
].join('\n');

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(buffer);
  return pdfDoc.getPageCount();
}

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
  const pageCount = await getPdfPageCount(buffer);
  return Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    text: '',
    textLen: 0,
  }));
}

async function parseJsonObject(raw: string) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const { jsonrepair } = await import('jsonrepair');
    const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)?.[1]
      ?? trimmed.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
    const candidate = (fenced ?? trimmed).trim();
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      const jsonMatch = candidate.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonrepair(jsonMatch[0]));
      }
      throw new Error('LLM OCR response was not valid JSON');
    }
  }
}

function normalizeOcrPages(payload: any, expectedPageCount: number): DocumentPage[] | null {
  const rawPages = Array.isArray(payload?.pages) ? payload.pages : [];
  if (rawPages.length === 0) return null;

  const byPage = new Map<number, DocumentPage>();
  for (let index = 0; index < rawPages.length; index++) {
    const rawPage = rawPages[index] || {};
    const pageNumber = Number(rawPage.pageNumber ?? rawPage.page_number ?? rawPage.page ?? index + 1);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;

    const text = String(rawPage.text ?? rawPage.ocrText ?? rawPage.transcription ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    byPage.set(pageNumber, {
      pageNumber,
      text,
      textLen: text.length,
      features: {
        ...(rawPage.features && typeof rawPage.features === 'object' ? rawPage.features : {}),
        ocr: true,
      },
    });
  }

  const maxOcrPage = Math.max(0, ...Array.from(byPage.keys()));
  const pageCount = Math.max(expectedPageCount || 0, maxOcrPage);
  if (pageCount === 0) return null;

  const pages = Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    return byPage.get(pageNumber) || {
      pageNumber,
      text: '',
      textLen: 0,
      features: { ocr: true },
    };
  });

  const actualTextLen = pages.reduce((sum, page) => sum + page.textLen, 0);
  return actualTextLen > 0 ? pages : null;
}

async function runOpenAiPdfOcr(input: DocumentIntakeInput): Promise<string> {
  const { default: OpenAI, toFile } = await import('openai');
  const config = input.llmConfig!;
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || 'https://api.openai.com/v1',
  });
  let uploadedFile: any = null;

  try {
    uploadedFile = await client.files.create({
      file: await toFile(input.buffer, input.fileName || 'document.pdf', {
        type: 'application/pdf',
      }),
      purpose: 'user_data',
    });
    const response: any = await client.responses.create({
      model: config.model || 'gpt-5.5',
      instructions: OCR_SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: uploadedFile.id },
            {
              type: 'input_text',
              text: 'OCR this PDF page by page. Return only the required JSON object.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_object',
        },
      },
      max_output_tokens: 20000,
    });
    return String(response?.output_text || '').trim();
  } finally {
    if (uploadedFile?.id) {
      await client.files.delete(uploadedFile.id).catch(() => undefined);
    }
  }
}

async function runGeminiPdfOcr(input: DocumentIntakeInput): Promise<string> {
  const config = input.llmConfig!;
  const configuredBase = config.baseURL && !config.baseURL.includes('api.openai.com')
    ? config.baseURL
    : 'https://generativelanguage.googleapis.com';
  let geminiBase = configuredBase.replace(/\/$/, '');
  let apiVersion = 'v1beta';
  if (geminiBase.endsWith('/v1beta') || geminiBase.endsWith('/v1')) {
    const parts = geminiBase.split('/');
    apiVersion = parts.pop() || 'v1beta';
    geminiBase = parts.join('/');
  }
  const model = (config.model || '').trim() || 'gemini-1.5-flash';
  const apiUrl = `${geminiBase}/${apiVersion}/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey || '')}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${OCR_SYSTEM_PROMPT}\n\nOCR the attached PDF page by page. Return only the required JSON object.`,
            },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: input.buffer.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 20000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini OCR failed: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
  }

  const data = await response.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

async function extractWithLlmOcr(input: DocumentIntakeInput): Promise<DocumentPage[] | null> {
  const config = input.llmConfig;
  if (!config?.apiKey) return null;

  const provider = String(config.provider || 'openai').toLowerCase();
  const expectedPageCount = await getPdfPageCount(input.buffer).catch(() => 0);
  let raw = '';

  if (provider === 'openai') {
    raw = await runOpenAiPdfOcr(input);
  } else if (provider === 'gemini') {
    raw = await runGeminiPdfOcr(input);
  } else {
    throw new Error(`LLM OCR supports PDF input for OpenAI and Gemini only; current provider is ${provider || 'unknown'}`);
  }

  if (!raw) return null;
  const parsed = await parseJsonObject(raw);
  return normalizeOcrPages(parsed, expectedPageCount);
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
    if (input.llmConfig?.apiKey) {
      try {
        pages = await extractWithLlmOcr(input);
        if (pages) strategy = 'pdf.llm-ocr';
      } catch (error: any) {
        warnings.push(`LLM OCR failed: ${error?.message || error}`);
      }
    } else {
      warnings.push('LLM OCR fallback skipped: no active LLM API key was provided.');
    }
  }

  if (!pages) {
    pages = await buildPageFallback(input.buffer);
    strategy = 'pdf.page-count-fallback';
    warnings.push('PDF text extraction failed. LLM OCR fallback was unavailable or failed.');
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
      ocr: strategy === 'pdf.llm-ocr',
      skillWorkflow: ['pdftotext layout', 'pdfjs-dist', 'pdf-parse', 'LLM OCR fallback', 'page-count fallback'],
    },
  };
}
