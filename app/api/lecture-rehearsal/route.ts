import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { recordUsage } from '@/lib/payments/usage-tracker';
import OpenAI, { toFile } from 'openai';
import { jsonrepair } from 'jsonrepair';
import promptTemplates from '@/lib/llm/prompt-templates.json';
import { extractSlidesFromPptx } from '@/lib/parsers/pptx';
import { gatherWebSources as gatherWebSourcesShared } from '@/lib/web-search/web-search';
import { PDFDocument } from 'pdf-lib';

export const runtime = 'nodejs';

const STAGE_CONTEXT_LIMIT = 20000;
const SLIDE_BATCH_CONTEXT_LIMIT = 8000;
const SLIDE_SINGLE_CONTEXT_LIMIT = 6000;
const WEB_SOURCES_STAGE_LIMIT = 6000;
const WEB_SOURCES_SLIDE_LIMIT = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMsFromError(error: any, attempt: number): number {
  const fallback = Math.min(30000, 1500 * Math.pow(2, attempt));
  const retryAfterHeader =
    error?.headers?.['retry-after'] ??
    error?.headers?.get?.('retry-after');

  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.round(retryAfterSeconds * 1000);
  }

  const message = typeof error?.message === 'string' ? error.message : '';
  const secondsMatch = message.match(/try again in\s+([\d.]+)s/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000) + 250;
    }
  }

  const msMatch = message.match(/try again in\s+(\d+)ms/i);
  if (msMatch) {
    const ms = Number(msMatch[1]);
    if (Number.isFinite(ms) && ms > 0) {
      return ms + 250;
    }
  }

  return fallback;
}

function extractOpenAIMessageContent(message: any): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  if (typeof message.refusal === 'string') return message.refusal.trim();
  return '';
}

type WebSource = { term: string; title: string; url: string; extract: string; provider?: string };

// LLM Provider configuration for parallel processing
type LLMProviderConfig = {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
};

// Default models and base URLs for each provider
const LLM_PROVIDER_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash' },
  anthropic: { baseURL: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

// Build a pool of available LLM configurations from apiKeys and per-provider models
export function buildLLMPool(
  apiKeys: Record<string, string> | undefined,
  primaryProvider: string,
  primaryBaseURL: string,
  primaryModel: string,
  providerModels?: Record<string, string>
): LLMProviderConfig[] {
  const pool: LLMProviderConfig[] = [];
  
  // Always add the primary provider first (the one selected by user)
  const primaryApiKey = apiKeys?.[primaryProvider] || '';
  if (primaryApiKey) {
    pool.push({
      provider: primaryProvider,
      apiKey: primaryApiKey,
      baseURL: primaryBaseURL || LLM_PROVIDER_DEFAULTS[primaryProvider]?.baseURL || '',
      model: primaryModel || LLM_PROVIDER_DEFAULTS[primaryProvider]?.model || '',
    });
  }
  
  // Add other providers with valid API keys; use stored providerModels when available
  if (apiKeys) {
    for (const [provider, apiKey] of Object.entries(apiKeys)) {
      if (!apiKey || provider === primaryProvider || provider === 'custom') continue;
      const defaults = LLM_PROVIDER_DEFAULTS[provider];
      if (defaults) {
        const model = (providerModels?.[provider] && providerModels[provider].trim())
          ? providerModels[provider].trim()
          : defaults.model;
        pool.push({
          provider,
          apiKey,
          baseURL: defaults.baseURL,
          model,
        });
      }
    }
  }
  
  return pool;
}

// Get the next LLM config from the pool in round-robin fashion
export function getLLMConfigFromPool(pool: LLMProviderConfig[], index: number): LLMProviderConfig {
  if (pool.length === 0) {
    throw new Error('No LLM providers available');
  }
  return pool[index % pool.length];
}

function safeParseLLMJson(raw: string) {
  const text = (raw || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try to extract JSON from markdown code fences
  const fenced =
    text.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ??
    text.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced ?? text).trim();

  // Check if the content looks like JSON at all (starts with { or [)
  const looksLikeJson = /^\s*[\[{]/.test(candidate);
  
  // Try to find JSON anywhere in the text
  if (!looksLikeJson) {
    // Try to find a JSON object anywhere in the text
    const jsonMatch = text.match(/\{[\s\S]*?"script_markdown"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const repaired = jsonrepair(jsonMatch[0]);
        const parsed = JSON.parse(repaired);
        console.log('[JSON Parse] Successfully extracted JSON from mixed content');
        return parsed;
      } catch {
        // Continue to fallback
      }
    }
    
    // Content is clearly not JSON (e.g., plain markdown text)
    // Return it as raw text for the caller to handle
    console.warn('[JSON Parse] Content is not JSON format, returning as raw text.');
    return { __raw_text: candidate };
  }

  try {
    const repaired = jsonrepair(candidate);
    return JSON.parse(repaired);
  } catch (e: any) {
    // Try to handle truncated JSON by attempting to close incomplete strings/objects
    try {
      // Check if JSON appears to be truncated (ends with incomplete string or object)
      const hasIncompleteString = candidate.match(/"[^"]*$/);
      const hasIncompleteObject = !candidate.match(/}\s*$/);
      
      if (hasIncompleteString || hasIncompleteObject) {
        // Try to fix truncated JSON by closing strings and objects
        let fixed = candidate;
        
        // Close incomplete string
        if (hasIncompleteString) {
          fixed = fixed.replace(/("[^"]*)$/, '$1"');
        }
        
        // Remove trailing comma before closing
        fixed = fixed.replace(/,\s*$/, '');
        
        // Close incomplete objects/arrays
        let openBraces = (fixed.match(/{/g) || []).length;
        let closeBraces = (fixed.match(/}/g) || []).length;
        let openBrackets = (fixed.match(/\[/g) || []).length;
        let closeBrackets = (fixed.match(/\]/g) || []).length;
        
        // Add missing closing brackets
        while (openBrackets > closeBrackets) {
          fixed += ']';
          closeBrackets++;
        }
        
        // Add missing closing braces
        while (openBraces > closeBraces) {
          fixed += '}';
          closeBraces++;
        }
        
        // Try parsing the fixed JSON
        try {
          const repaired = jsonrepair(fixed);
          const parsed = JSON.parse(repaired);
          console.warn('[JSON Parse] Successfully recovered truncated JSON');
          return parsed;
        } catch (recoveryError: any) {
          console.warn('[JSON Parse] Failed to recover truncated JSON:', recoveryError?.message || recoveryError);
        }
      }
    } catch (recoveryError) {
      // Ignore recovery errors
    }
    
    // Try one more time with aggressive cleanup
    try {
      // Remove any text before the first { or [
      const firstBrace = candidate.indexOf('{');
      const firstBracket = candidate.indexOf('[');
      const startIdx = Math.min(
        firstBrace >= 0 ? firstBrace : Infinity,
        firstBracket >= 0 ? firstBracket : Infinity
      );
      
      if (startIdx !== Infinity && startIdx > 0) {
        const cleanedCandidate = candidate.slice(startIdx);
        const repaired = jsonrepair(cleanedCandidate);
        const parsed = JSON.parse(repaired);
        console.warn('[JSON Parse] Successfully recovered JSON by removing prefix text');
        return parsed;
      }
    } catch {
      // Ignore
    }
    
    // If all recovery attempts fail, fall back to raw text
    const snippet = candidate.slice(Math.max(0, candidate.length - 2000), candidate.length);
    console.warn('[JSON Parse] Failed to parse LLM JSON after repair. Returning raw text fallback.', {
      error: e?.message || e,
      preview: snippet.slice(0, 400),
    });
    return { __raw_text: candidate };
  }
}

function normalizeBaseURL(input?: string) {
  const raw = (input || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

async function fetchGeminiModels(params: { apiKey: string; baseURL: string; apiVersion: 'v1beta' | 'v1' }) {
  const { apiKey, baseURL, apiVersion } = params;
  const url = `${baseURL}/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini listModels failed: ${res.status}${text ? ` - ${text}` : ''}`);
  }
  const data = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models as Array<{ name?: string; supportedGenerationMethods?: string[] }>;
}

function pickDefaultGeminiModel(models: Array<{ name?: string; supportedGenerationMethods?: string[] }>) {
  const candidates = models
    .filter((m) => typeof m?.name === 'string')
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name as string);

  const prefer = (needle: string) => candidates.find((n) => n.includes(needle));
  return prefer('gemini-1.5-flash') || prefer('gemini-1.5-pro') || prefer('gemini-2') || candidates[0] || '';
}

export async function callLLMJson(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: any[];
  maxCompletionTokens?: number;
}): Promise<{ data: any; tokensUsed?: number }> {
  const { apiKey, baseURL, model, messages, maxCompletionTokens } = params;
  const isGemini = baseURL?.includes('generativelanguage.googleapis.com') || model?.includes('gemini');

  if (isGemini) {
    const geminiBase = normalizeBaseURL(baseURL) || 'https://generativelanguage.googleapis.com';
    const apiVersion: 'v1beta' | 'v1' = 'v1beta';
    let geminiModel = (model || '').trim() || 'gemini-1.5-flash';
    let apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiMessages = messages.map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
      parts: [{ text: msg.content }],
    }));

    // Merge adjacent user messages (Gemini)
    const mergedMessages: any[] = [];
    for (let i = 0; i < geminiMessages.length; i++) {
      if (geminiMessages[i].role === 'user' && i > 0 && geminiMessages[i - 1].role === 'user') {
        mergedMessages[mergedMessages.length - 1].parts[0].text += '\n\n' + geminiMessages[i].parts[0].text;
      } else {
        mergedMessages.push(geminiMessages[i]);
      }
    }

    const doRequest = async (url: string) => {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: mergedMessages,
          generationConfig: { 
            temperature: 0.7, 
            // Gemini API maximum is 8192 tokens
            maxOutputTokens: 8192,
          },
        }),
      });
    };

    // Retry logic for transient errors (503, 429, 500)
    const maxRetries = 5;
    const retryableStatuses = [429, 500, 502, 503, 504];
    
    const doRequestWithRetry = async (url: string, retries = maxRetries): Promise<Response> => {
      const response = await doRequest(url);
      
      if (!response.ok && retryableStatuses.includes(response.status) && retries > 0) {
        // Longer exponential backoff for 503 (overloaded): 3s, 6s, 12s, 24s, 48s
        // Shorter for other errors: 2s, 4s, 8s, 16s, 32s
        const baseDelay = response.status === 503 ? 3000 : 2000;
        const delay = Math.pow(2, maxRetries - retries) * baseDelay;
        console.log(`[Gemini] Retrying in ${delay}ms due to ${response.status} (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return doRequestWithRetry(url, retries - 1);
      }
      
      return response;
    };

    let response = await doRequestWithRetry(apiUrl);

    if (!response.ok && response.status === 404) {
      try {
        const modelsList = await fetchGeminiModels({ apiKey, baseURL: geminiBase, apiVersion });
        const picked = pickDefaultGeminiModel(modelsList);
        if (picked) {
          geminiModel = picked.replace(/^models\//, '');
          apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
          response = await doRequestWithRetry(apiUrl);
        }
      } catch (e) {
        console.error('Gemini listModels fallback failed:', e);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini API Error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content received from Gemini');
    const parsed = safeParseLLMJson(content);
    
    // Extract token usage from Gemini response if available
    const usageMetadata = data.usageMetadata;
    const tokensUsed = usageMetadata?.totalTokenCount 
      ? usageMetadata.totalTokenCount 
      : Math.round((JSON.stringify(messages).length + JSON.stringify(parsed).length) / 4);
    
    return { data: parsed, tokensUsed };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || 'https://api.openai.com/v1',
  });

  const maxRetries = 4;
  let response: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await client.chat.completions.create({
        model: model || 'gpt-4',
        messages,
        response_format: { type: 'json_object' },
        // Keep completion budgets bounded so requests do not reserve unnecessary TPM.
        max_completion_tokens: maxCompletionTokens ?? 2500,
      });
      break;
    } catch (error: any) {
      const status = Number(error?.status) || 0;
      const isRetryable = [429, 500, 502, 503, 504].includes(status);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delayMs = getRetryDelayMsFromError(error, attempt);
      console.warn(`[OpenAI] Retrying after ${delayMs}ms due to status ${status} (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(delayMs);
    }
  }

  if (!response) {
    throw new Error('No response received from LLM');
  }
  const content = extractOpenAIMessageContent(response.choices?.[0]?.message);
  if (!content) {
    const finishReason = response.choices?.[0]?.finish_reason || 'unknown';
    throw new Error(`No content received from LLM (finish_reason: ${finishReason})`);
  }
  const parsed = safeParseLLMJson(content);
  
  // Extract token usage from OpenAI response if available
  const tokensUsed = response.usage?.total_tokens 
    ? response.usage.total_tokens 
    : Math.round((JSON.stringify(messages).length + JSON.stringify(parsed).length) / 4);
  
  return { data: parsed, tokensUsed };
}

function isTraditionalChinese(lang: string) {
  const s = (lang || '').toLowerCase();
  return s.includes('繁體') || s.includes('traditional');
}

type FileBlock = { fileName: string; content: string };
type PdfPage = { page: number; text: string; textLen: number };
const PDF_CONTEXT_SAMPLE_PAGES = 12;
const PDF_CONTEXT_PAGE_CHAR_LIMIT = 1200;
const PDF_WINDOW_SIZE = 5;
const PDF_WINDOW_OVERLAP = 1;

export type RollingLectureMemory = {
  document_title: string;
  main_theme: string;
  teaching_goal: string;
  section_progress: string[];
  key_terms: Array<{ term: string; meaning: string }>;
  open_loops: string[];
  covered_pages: number[];
  next_batch_focus: string[];
};

export type PdfWindowChunk = {
  filename: string;
  fileData: string;
  startPage: number;
  endPage: number;
};

export function splitContextByFile(context: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const parts = (context || '').split(/(?=FILE:\s*)/);
  for (const part of parts) {
    const match = part.match(/^FILE:\s*(.+?)\s*\n/);
    if (!match) continue;
    const fileName = match[1].trim();
    const content = part.slice(match[0].length).trim();
    if (!fileName) continue;
    blocks.push({ fileName, content });
  }
  return blocks;
}

export function extractPdfPagesFromContent(content: string): PdfPage[] {
  const pages: PdfPage[] = [];
  const regex = /\[PAGE:\s*(\d+)\]/gi;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastPage = 0;

  while ((match = regex.exec(content)) !== null) {
    if (lastPage > 0) {
      const chunk = content.slice(lastIndex, match.index).trim();
      pages.push({ page: lastPage, text: chunk, textLen: chunk.length });
    }
    lastPage = Number(match[1]) || 0;
    lastIndex = match.index + match[0].length;
  }

  if (lastPage > 0) {
    const chunk = content.slice(lastIndex).trim();
    pages.push({ page: lastPage, text: chunk, textLen: chunk.length });
  }

  return pages;
}

export async function extractPdfPagesFromBase64(pdfBase64: string): Promise<PdfPage[]> {
  const buffer = Buffer.from(pdfBase64, 'base64');
  let pages: PdfPage[] = [];

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      verbosity: 0,
      useSystemFonts: true,
    } as any);

    const pdf = await loadingTask.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim();
      pages.push({
        page: i,
        text: pageText,
        textLen: pageText.length,
      });
    }
  } catch (pdfjsError: any) {
    console.warn('[Lecture] extractPdfPagesFromBase64 pdfjs-dist failed:', pdfjsError?.message || pdfjsError);
  }

  const meaningfulText = pages.some((page) => page.textLen > 0);
  if (pages.length > 0 && meaningfulText) {
    return pages;
  }

  try {
    // @ts-ignore - pdf-parse types may not be available
    const pdfParse = (await import('pdf-parse')).default;
    const renderPage = async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const pageText = (textContent.items || [])
        .map((item: any) => item.str || '')
        .join(' ')
        .trim();
      const pageNum = (pageData.pageIndex ?? 0) + 1;
      return `[PAGE: ${pageNum}]\n${pageText}\n`;
    };
    const data = await pdfParse(buffer, { pagerender: renderPage });
    const parsedPages = extractPdfPagesFromContent((data?.text || '').trim());
    if (parsedPages.length > 0) {
      return parsedPages;
    }
  } catch (pdfParseError: any) {
    console.warn('[Lecture] extractPdfPagesFromBase64 pdf-parse failed:', pdfParseError?.message || pdfParseError);
  }

  const pageCount = await getPdfPageCountFromBase64(pdfBase64);
  return Array.from({ length: pageCount }, (_, idx) => ({
    page: idx + 1,
    text: '',
    textLen: 0,
  }));
}

function selectEvenlySpacedPages(pages: PdfPage[], maxPages: number): PdfPage[] {
  if (pages.length <= maxPages) return pages;

  const picked: PdfPage[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < maxPages; i++) {
    const idx = Math.round((i * (pages.length - 1)) / Math.max(maxPages - 1, 1));
    const page = pages[idx];
    if (!page || seen.has(page.page)) continue;
    seen.add(page.page);
    picked.push(page);
  }

  return picked.sort((a, b) => a.page - b.page);
}

export function buildCompactPdfContext(fileName: string, pages: PdfPage[]): string {
  if (!pages.length) {
    return `FILE: ${fileName}\n[WARNING: No extractable PDF pages found]`;
  }

  const sampledPages = selectEvenlySpacedPages(pages, PDF_CONTEXT_SAMPLE_PAGES);
  const sampledContent = sampledPages
    .map((page) => {
      const trimmed = (page.text || '').trim().slice(0, PDF_CONTEXT_PAGE_CHAR_LIMIT);
      return `[PAGE: ${page.page}]\n${trimmed}`;
    })
    .join('\n\n');

  return [
    `FILE: ${fileName}`,
    `[PDF SUMMARY] Total pages: ${pages.length}. Included ${sampledPages.length} evenly sampled pages for overview context.`,
    sampledContent,
  ].join('\n');
}

export async function splitPdfBase64IntoWindows(params: {
  pdfBase64: string;
  filename: string;
  windowSize?: number;
  overlap?: number;
}): Promise<PdfWindowChunk[]> {
  const { pdfBase64, filename, windowSize = PDF_WINDOW_SIZE, overlap = PDF_WINDOW_OVERLAP } = params;
  const buffer = Buffer.from(pdfBase64, 'base64');
  const sourceDoc = await PDFDocument.load(buffer);
  const totalPages = sourceDoc.getPageCount();
  const step = Math.max(1, windowSize - overlap);
  const baseName = filename.replace(/\.pdf$/i, '');
  const windows: PdfWindowChunk[] = [];

  for (let start = 0; start < totalPages; start += step) {
    const endExclusive = Math.min(totalPages, start + windowSize);
    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(
      sourceDoc,
      Array.from({ length: endExclusive - start }, (_, idx) => start + idx)
    );
    copiedPages.forEach((page) => outDoc.addPage(page));
    const bytes = await outDoc.save();
    windows.push({
      filename: `${baseName}-p${start + 1}-${endExclusive}.pdf`,
      fileData: Buffer.from(bytes).toString('base64'),
      startPage: start + 1,
      endPage: endExclusive,
    });

    if (endExclusive >= totalPages) break;
  }

  return windows;
}

export async function getPdfPageCountFromBase64(pdfBase64: string): Promise<number> {
  const buffer = Buffer.from(pdfBase64, 'base64');
  const sourceDoc = await PDFDocument.load(buffer);
  return sourceDoc.getPageCount();
}

export async function extractSinglePdfPageBase64(params: {
  pdfBase64: string;
  filename: string;
  pageNumber: number;
}): Promise<PdfWindowChunk> {
  const { pdfBase64, filename, pageNumber } = params;
  const buffer = Buffer.from(pdfBase64, 'base64');
  const sourceDoc = await PDFDocument.load(buffer);
  const totalPages = sourceDoc.getPageCount();

  if (pageNumber < 1 || pageNumber > totalPages) {
    throw new Error(`Requested PDF page ${pageNumber} is out of range 1-${totalPages}`);
  }

  const outDoc = await PDFDocument.create();
  const [copiedPage] = await outDoc.copyPages(sourceDoc, [pageNumber - 1]);
  outDoc.addPage(copiedPage);
  const bytes = await outDoc.save();
  const baseName = filename.replace(/\.pdf$/i, '');

  return {
    filename: `${baseName}-p${pageNumber}.pdf`,
    fileData: Buffer.from(bytes).toString('base64'),
    startPage: pageNumber,
    endPage: pageNumber,
  };
}

export function shouldAttemptOpenAIFullPdfPass(params: {
  pageCount: number;
  targetMinutes: number;
  audienceLevel: string;
}): boolean {
  const { pageCount, targetMinutes, audienceLevel } = params;
  if (pageCount > 25) return false;
  if (pageCount > 18 && audienceLevel === 'beginner') return false;
  if (pageCount > 20 && targetMinutes >= 90) return false;
  return true;
}

export async function callOpenAIResponsesJson(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  instructions: string;
  promptText: string;
  maxOutputTokens?: number;
  previousResponseId?: string;
  pdfFileData?: string;
  pdfFilename?: string;
}): Promise<{ data: any; text: string; responseId: string; tokensUsed: number; incompleteReason?: string | null }> {
  const {
    apiKey,
    baseURL,
    model,
    instructions,
    promptText,
    maxOutputTokens,
    previousResponseId,
    pdfFileData,
    pdfFilename,
  } = params;

  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || 'https://api.openai.com/v1',
  });

  const content: Array<any> = [];
  if (pdfFileData && pdfFilename) {
    const cleanBase64 = pdfFileData.replace(/^data:application\/pdf;base64,/, '');
    const uploadedFile = await client.files.create({
      file: await toFile(Buffer.from(cleanBase64, 'base64'), pdfFilename, {
        type: 'application/pdf',
      }),
      purpose: 'user_data',
    });
    content.push({
      type: 'input_file',
      file_id: uploadedFile.id,
    });
  }
  content.push({
    type: 'input_text',
    text: promptText,
  });

  const requestBody: any = {
    model: model || 'gpt-4.1',
    instructions,
    input: [
      {
        role: 'user',
        content,
      },
    ],
    max_output_tokens: maxOutputTokens ?? 1400,
  };

  if (previousResponseId && previousResponseId.trim()) {
    requestBody.previous_response_id = previousResponseId.trim();
  }

  const response: any = await client.responses.create(requestBody);

  if (response?.error) {
    throw new Error(response.error.message || 'OpenAI Responses API error');
  }

  const text = (response?.output_text || '').trim();
  const incompleteReason = response?.incomplete_details?.reason || null;
  if (!text) {
    throw new Error(`No content received from OpenAI Responses API${incompleteReason ? ` (${incompleteReason})` : ''}`);
  }

  const parsed = safeParseLLMJson(text);
  const usage = response?.usage;
  const tokensUsed =
    usage?.total_tokens ??
    ((usage?.input_tokens || 0) + (usage?.output_tokens || 0)) ??
    Math.round((instructions.length + promptText.length + text.length) / 4);

  return {
    data: parsed,
    text,
    responseId: response?.id || '',
    tokensUsed,
    incompleteReason,
  };
}

type SlidePlanType = 'cover' | 'transition' | 'concept' | 'example' | 'summary';
type SlidePlanImportance = 'low' | 'medium' | 'high';
type SlidePlanItem = {
  slide_number: number;
  slide_type: SlidePlanType;
  importance: SlidePlanImportance;
  target_words: number;
  must_cover: string[];
  topic_labels: string[];
};

function extractMustCover(text: string): string[] {
  return (text || '')
    .split(/\r?\n|•|·|-/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .slice(0, 8)
    .map((line) => line.slice(0, 120));
}

function extractTopicLabels(text: string): string[] {
  return Array.from(
    new Set(
      (text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 4 && line.length <= 48)
        .filter((line) => /[A-Za-z&]/.test(line))
        .filter((line) => !/[.!?]$/.test(line))
        .filter((line) => !/^(output|note|page|\d+|\(.*\))$/i.test(line))
    )
  ).slice(0, 5);
}

function classifySlideType(slide: { text: string; isCover?: boolean }): SlidePlanType {
  if (slide.isCover) return 'cover';
  const text = (slide.text || '').toLowerCase();
  if (!text.trim()) return 'transition';
  if (/(agenda|outline|roadmap|today|contents|section|part\s+\d+)/i.test(text)) return 'transition';
  if (/(summary|recap|takeaway|conclusion|q&a|questions)/i.test(text)) return 'summary';
  if (/(example|case study|demo|exercise|practice|quiz|problem)/i.test(text)) return 'example';
  if (/(function\s|\bclass\s|\bdef\s|\breturn\b|=>|console\.log|SELECT\s|INSERT\s|<div|public\s+static)/i.test(text)) return 'example';
  if ((slide.text || '').trim().length < 80) return 'transition';
  return 'concept';
}

function getTargetWords(params: {
  slideType: SlidePlanType;
  importance: SlidePlanImportance;
  audienceLevel: string;
  targetMinutes: number;
  totalSlides: number;
}): number {
  const { slideType, importance, audienceLevel, targetMinutes, totalSlides } = params;
  const avgMinutesPerSlide = targetMinutes / Math.max(totalSlides, 1);

  let base =
    slideType === 'cover' ? 25 :
    slideType === 'transition' ? 45 :
    slideType === 'summary' ? 80 :
    slideType === 'example' ? 150 :
    180;

  if (audienceLevel === 'beginner') base += 25;
  if (importance === 'high') base += 35;
  if (importance === 'low') base -= 20;
  if (avgMinutesPerSlide < 1.5) base -= 20;
  if (avgMinutesPerSlide > 3.5) base += 25;

  return Math.max(20, Math.min(base, 260));
}

export function buildSlidePlan(params: {
  slidesFromPpt: Array<{ slide_number: number; text: string; textLen?: number; isCover?: boolean }>;
  audienceLevel: string;
  targetMinutes: number;
}): SlidePlanItem[] {
  const { slidesFromPpt, audienceLevel, targetMinutes } = params;
  const totalSlides = slidesFromPpt.filter((slide) => !slide.isCover).length;

  return slidesFromPpt
    .filter((slide) => !slide.isCover)
    .map((slide) => {
      const slideType = classifySlideType(slide);
      const textLen = slide.textLen ?? (slide.text || '').length;
      const importance: SlidePlanImportance =
        slideType === 'concept' && textLen > 180 ? 'high' :
        slideType === 'example' && textLen > 120 ? 'high' :
        slideType === 'transition' || slideType === 'cover' ? 'low' :
        'medium';

      return {
        slide_number: slide.slide_number,
        slide_type: slideType,
        importance,
        target_words: getTargetWords({
          slideType,
          importance,
          audienceLevel,
          targetMinutes,
          totalSlides,
        }),
        must_cover: extractMustCover(slide.text),
        topic_labels: extractTopicLabels(slide.text),
      };
    });
}

export async function translateMarkdown(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  primaryLanguage: string;
  secondaryLanguage: string;
  markdown: string;
  label?: string;
}): Promise<{ text: string; tokensUsed: number }> {
  const { apiKey, baseURL, model, primaryLanguage, secondaryLanguage, markdown, label } = params;
  const clean = (markdown || '').trim();
  if (!clean || !secondaryLanguage || secondaryLanguage.toLowerCase() === 'none') {
    return { text: '', tokensUsed: 0 };
  }

  const result = await callLLMJson({
    apiKey,
    baseURL,
    model,
    maxCompletionTokens: 2600,
    messages: [
      {
        role: 'system',
        content:
          `You are a precise educational translator. Output VALID JSON only.\n\n` +
          `Return JSON with exactly:\n{\n  "translation": "string"\n}\n` +
          `Rules:\n- Translate from ${primaryLanguage} to ${secondaryLanguage}.\n- Preserve markdown structure.\n- Do not add or remove sections.\n- Keep terminology consistent.\n- Do not explain your work.`,
      },
      {
        role: 'user',
        content:
          `Label: ${label || 'markdown'}\n\n` +
          `Translate this markdown from ${primaryLanguage} to ${secondaryLanguage}:\n\n${clean.slice(0, 12000)}`,
      },
    ],
  });

  const text =
    typeof result.data?.translation === 'string'
      ? result.data.translation
      : typeof result.data?.__raw_text === 'string'
      ? result.data.__raw_text
      : '';

  return { text, tokensUsed: result.tokensUsed || 0 };
}

export async function translateSlidesSecondary(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  primaryLanguage: string;
  secondaryLanguage: string;
  slides: Array<{ slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }>;
}): Promise<{ slides: Array<{ slide_number: number; script_markdown_secondary: string }>; tokensUsed: number }> {
  const { apiKey, baseURL, model, primaryLanguage, secondaryLanguage, slides } = params;
  if (!secondaryLanguage || secondaryLanguage.toLowerCase() === 'none') {
    return { slides: [], tokensUsed: 0 };
  }

  const translated: Array<{ slide_number: number; script_markdown_secondary: string }> = [];
  let totalTokensUsed = 0;
  const batchSize = 2;

  for (let i = 0; i < slides.length; i += batchSize) {
    const batch = slides.slice(i, i + batchSize).map((slide) => ({
      slide_number: slide.slide_number,
      slide_title: slide.slide_title,
      script_markdown: slide.script_markdown.slice(0, 5000),
    }));

    const result = await callLLMJson({
      apiKey,
      baseURL,
      model,
      maxCompletionTokens: 3200,
      messages: [
        {
          role: 'system',
          content:
            `You are a precise educational translator. Output VALID JSON only.\n\n` +
            `Return JSON with exactly:\n{\n  "slides": [\n    {\n      "slide_number": number,\n      "script_markdown_secondary": "string"\n    }\n  ]\n}\n` +
            `Rules:\n- Translate from ${primaryLanguage} to ${secondaryLanguage}.\n- Preserve markdown formatting.\n- Keep the same number of slides.\n- Do not summarize.`,
        },
        {
          role: 'user',
          content:
            `Translate these slide notes from ${primaryLanguage} to ${secondaryLanguage}:\n\n${JSON.stringify(batch, null, 2)}`,
        },
      ],
    });

    totalTokensUsed += result.tokensUsed || 0;
    const items = Array.isArray(result.data?.slides) ? result.data.slides : [];
    for (const item of items) {
      const slide_number = Number(item?.slide_number) || 0;
      const script_markdown_secondary = typeof item?.script_markdown_secondary === 'string' ? item.script_markdown_secondary : '';
      if (slide_number && script_markdown_secondary.trim()) {
        translated.push({ slide_number, script_markdown_secondary });
      }
    }
  }

  return { slides: translated, tokensUsed: totalTokensUsed };
}

export async function buildSlideScriptsBatched(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  primaryLanguage: string;
  secondaryLanguage: string;
  audienceLevel: string;
  targetMinutes: number;
  addonSystem: string;
  addonUser: string;
  context: string;
  slidesFromPpt: Array<{ slide_number: number; original_slide_number: number; source_file: string; text: string; features?: any; isCover?: boolean }>;
  web_sources: WebSource[];
  onProgress?: (current: number, total: number) => void;
  /** When provided with length > 1, run batch LLM calls in parallel (one config per batch). */
  llmPool?: LLMProviderConfig[];
}): Promise<{ slides: Array<{ slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }>; tokensUsed: number }> {
  const {
    apiKey,
    baseURL,
    model,
    primaryLanguage,
    secondaryLanguage,
    audienceLevel,
    targetMinutes,
    addonSystem,
    addonUser,
    context,
    slidesFromPpt,
    web_sources,
    onProgress,
    llmPool,
  } = params;
  
  let totalTokensUsed = 0;

  const langHintPrimary = `PRIMARY language: ${primaryLanguage}`;
  const shouldTranslateSecondary = secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none';
  // Generate primary notes first, then translate as a cheaper secondary pass.
  const needSecondary = false;
  const batchSize = 4;
  const allSlides: Array<{ slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }> = [];
  const slidePlans = buildSlidePlan({ slidesFromPpt, audienceLevel, targetMinutes });
  const slidePlanByNumber = new Map<number, SlidePlanItem>(slidePlans.map((plan) => [plan.slide_number, plan]));

  const schema = needSecondary
    ? `Return JSON with exactly:
{
  "slides": [ 
    { 
      "slide_number": number, 
      "slide_title": "string", 
      "script_markdown": "string (FULL speaker notes in ${primaryLanguage})", 
      "script_markdown_secondary": "string (FULL speaker notes in ${secondaryLanguage})" 
    } 
  ]
}
CRITICAL RULES:
- Return one item per provided slide_number (no missing).
- script_markdown: MUST be complete speaker notes in ${primaryLanguage}. CANNOT be empty.
- script_markdown_secondary: MUST be complete speaker notes in ${secondaryLanguage}. CANNOT be empty.
- Both scripts should cover the same content in their respective languages.
- Each script should be at least 3-5 paragraphs with detailed explanations.`
    : `Return JSON with exactly:
{
  "slides": [ { "slide_number": number, "slide_title": "string", "script_markdown": "string", "script_markdown_secondary": "" } ]
}
Rules:
- Return one item per provided slide_number (no missing).
- Adjust depth by slide importance and slide type.
- Transition or cover-like slides can be cue notes.
- Core concept/example slides can be fuller speaker notes.`;
  
  const generateOneSlide = async (slide: any, retryCount = 0): Promise<any> => {
    const slidePlan = slide?.plan || slidePlanByNumber.get(Number(slide?.slide_number) || 0) || null;
    const oneSchema = needSecondary
      ? `Return JSON with exactly:
{
  "slide_number": number,
  "slide_title": "string",
  "script_markdown": "string (FULL speaker notes in ${primaryLanguage})",
  "script_markdown_secondary": "string (FULL speaker notes in ${secondaryLanguage})"
}
CRITICAL RULES:
- slide_number MUST match the requested slide_number.
- script_markdown: MUST be complete speaker notes in ${primaryLanguage}. This CANNOT be empty.
- script_markdown_secondary: MUST be complete speaker notes in ${secondaryLanguage}. This CANNOT be empty.
- Both scripts should cover the same content but in their respective languages.
- Each script should be at least 3-5 paragraphs with detailed explanations.`
      : `Return JSON with exactly:
{
  "slide_number": number,
  "slide_title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": ""
}
Rules:
- slide_number MUST match the requested slide_number.
- Use the slide execution plan to decide detail level.
- Transition-style slides can be cue notes instead of full speaker notes.`;

    const resultData = await callLLMJson({
      apiKey,
      baseURL,
      model,
      maxCompletionTokens: needSecondary ? 1800 : 900,
      messages: [
        {
          role: 'system',
          content:
            `You are an expert teaching assistant creating lecture scripts.

⚠️ OUTPUT FORMAT REQUIREMENT ⚠️
You MUST respond with ONLY a valid JSON object. No markdown, no explanations, no text before or after the JSON.
Your response must start with { and end with }

${oneSchema}` +
            (needSecondary 
              ? `\n\n⚠️ CRITICAL: You MUST provide COMPLETE speaker notes in BOTH languages (${primaryLanguage} AND ${secondaryLanguage}). The script_markdown_secondary field is MANDATORY and must contain substantial content (at least 150+ characters). Empty or very short secondary language content is NOT acceptable.` 
              : '') +
            (addonSystem ? `\n\n${addonSystem}` : ''),
        },
        {
          role: 'user',
          content:
            `Deck context (background only, lower priority than current slide):\n${context.substring(0, 2000)}\n\n---\n\n` +
            `Slide execution plan:\n${JSON.stringify(slidePlan, null, 2)}\n\n---\n\n` +
            `Current slide source text (PRIMARY evidence, highest priority):\n${(slide?.text || '').slice(0, 5000)}\n\n---\n\n` +
            `Current slide metadata:\n${JSON.stringify({
              slide_number: slide?.slide_number,
              original_slide_number: slide?.original_slide_number,
              source_file: slide?.source_file,
              features: slide?.features || {},
            }, null, 2)}\n\n---\n\n` +
            `web_sources (optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_SLIDE_LIMIT)}\n\n---\n\n` +
            `AUDIENCE LEVEL: ${audienceLevel.toUpperCase()}\n` +
            (audienceLevel === 'beginner'
              ? `BEGINNER REQUIREMENTS:\n- This is the FIRST time students see these concepts.\n- Define technical terms only when they actually appear on this slide.\n- Use simple wording and short explanations.\n- If the slide has multiple subtopics, briefly explain EACH one.\n- Do not choose only one concept and ignore the rest.\n`
              : `INTERMEDIATE REQUIREMENTS:\n- Be concise and focus on the visible slide content.\n- If the slide has multiple subtopics, briefly connect EACH one.\n- Do not choose only one concept and ignore the rest.\n`) +
            `TARGET DURATION: ~${targetMinutes} minutes total (${slidesFromPpt.length} slides = ~${Math.round(targetMinutes / Math.max(slidesFromPpt.length, 1))} min/slide average)\n` +
            (slidePlan
              ? `SLIDE PLAN:\n- type: ${slidePlan.slide_type}\n- importance: ${slidePlan.importance}\n- target_words: ${slidePlan.target_words}\n- topic_labels: ${(slidePlan.topic_labels || []).join(' | ') || 'none'}\n- must_cover: ${(slidePlan.must_cover || []).join(' | ') || 'none'}\n- Use target_words as a soft upper bound.\n- If this is a transition/cover-like slide, keep it brief and cue-oriented.\n`
              : '') +
            `GROUNDING RULES:\n- Base the notes on CURRENT slide source text first.\n- Do NOT invent concepts, code, formulas, or examples that are not clearly present on this slide.\n- If the slide has multiple columns/boxes, mention each major box briefly.\n- If information is missing from the slide, say it briefly and conservatively instead of filling in extra theory.\n- Prefer paraphrasing slide text over adding external explanation.\n` +
            `- Do NOT mention parser artifacts, metadata, alt text, shape text, XML artifacts, or extraction issues in the lecture notes.\n` +
            `- If topic_labels contains multiple items, cover ALL of them. Do not focus on only one label.\n` +
            `- If the slide shows side-by-side examples, summarize both sides before highlighting differences.\n` +
            (needSecondary 
              ? `\nIMPORTANT: You MUST provide COMPLETE speaker notes in BOTH languages:\n1. script_markdown: Full notes in ${primaryLanguage}\n2. script_markdown_secondary: Full notes in ${secondaryLanguage}\nBoth fields are REQUIRED and must contain substantial content (not just translations of titles).\n`
              : `\nOutput in ${primaryLanguage} only.\n`) +
            (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : '') +
            `\n\n⚠️ REMINDER: Respond with ONLY valid JSON. Start with { and end with }. No other text.`,
        },
      ],
    });
    const result = resultData.data;
    const tokensUsed = resultData.tokensUsed || 0;

    // Check if JSON parsing failed completely (only has __raw_text)
    const isRawTextOnly = result?.__raw_text && !result?.script_markdown && !result?.slide_number;
    
    // If JSON parsing failed and we haven't retried too many times, retry
    if (isRawTextOnly && retryCount < 3) {
      const rawPreview = typeof result?.__raw_text === 'string' ? result.__raw_text.substring(0, 200) : 'N/A';
      console.warn(`[Lecture] Slide ${slide?.slide_number}: JSON parsing failed, retrying (attempt ${retryCount + 1}/3)...`);
      console.warn(`[Lecture] Raw response preview: ${rawPreview}`);
      await new Promise(resolve => setTimeout(resolve, 3000 * (retryCount + 1)));
      return generateOneSlide(slide, retryCount + 1);
    }
    
    // If still failed after max retries, try to extract content from raw text
    if (isRawTextOnly && retryCount >= 3) {
      console.warn(`[Lecture] Slide ${slide?.slide_number}: All JSON parse attempts failed. Using raw text as fallback.`);
      // Use the raw text as the script content
      const rawText = result?.__raw_text || '';
      if (rawText.length > 50) {
        return {
          slide_number: Number(slide?.slide_number) || 0,
          slide_title: slide?.slide_title || `Slide ${slide?.slide_number}`,
          script_markdown: rawText,
          script_markdown_secondary: '',
          tokensUsed,
        };
      }
    }

    const slide_number = Number(result?.slide_number) || Number(slide?.slide_number) || 0;
    if (!slide_number) return null;
    
    // If we only have raw text after retries, try to use it as the script
    // Accept any raw text that has meaningful content (at least 20 chars)
    const script_markdown =
      typeof result?.script_markdown === 'string' && result.script_markdown.length > 0
        ? result.script_markdown
        : typeof result?.__raw_text === 'string' && result.__raw_text.length > 20
        ? result.__raw_text
        : '';
    
    // Log warning if we ended up with empty script after all attempts
    if (!script_markdown && retryCount >= 3) {
      console.warn(`[Lecture] Slide ${slide_number}: Empty script_markdown after ${retryCount} retries. Result:`, {
        hasScriptMarkdown: !!result?.script_markdown,
        hasRawText: !!result?.__raw_text,
        rawTextLength: result?.__raw_text?.length || 0,
      });
    }
    const script_markdown_secondary = needSecondary && typeof result?.script_markdown_secondary === 'string'
      ? result.script_markdown_secondary
      : '';
    
    // Validate: if secondary language is needed but missing/too short, retry up to 3 times
    const minSecondaryLength = 150; // Minimum characters for secondary language
    if (needSecondary && script_markdown_secondary.length < minSecondaryLength && retryCount < 3) {
      console.log(`[Lecture] Slide ${slide_number}: Secondary language too short (${script_markdown_secondary.length} chars, need ${minSecondaryLength}+), retrying (attempt ${retryCount + 1}/3)...`);
      // Add a small delay before retry to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)));
      return generateOneSlide(slide, retryCount + 1);
    }
    
    // If still missing after retries, log warning
    if (needSecondary && script_markdown_secondary.length < minSecondaryLength) {
      console.warn(`[Lecture] Slide ${slide_number}: Secondary language still incomplete after ${retryCount} retries (${script_markdown_secondary.length} chars)`);
    }
    
    return {
      slide_number,
      slide_title: typeof result?.slide_title === 'string' ? result.slide_title : '',
      script_markdown,
      script_markdown_secondary,
      tokensUsed,
    };
  };

  // Skip cover slides if marked as cover (usually first slide with very little text).
  const slidesToGenerate = slidesFromPpt.filter((s) => !s.isCover);
  const totalSlides = slidesToGenerate.length;

  // Build batch list for parallel or sequential processing
  type BatchItem = { batchRaw: typeof slidesToGenerate; batch: Array<{ slide_number: number; original_slide_number: number; source_file: string; text: string; features?: any; plan?: SlidePlanItem | null }> };
  const batchList: BatchItem[] = [];
  for (let i = 0; i < slidesToGenerate.length; i += batchSize) {
    const batchRaw = slidesToGenerate.slice(i, i + batchSize);
    const batch = batchRaw.map((s) => ({
      slide_number: s.slide_number,
      original_slide_number: s.original_slide_number,
      source_file: s.source_file,
      text: (s.text || '').slice(0, 5000),
      features: s.features || {},
      plan: slidePlanByNumber.get(s.slide_number) || null,
    }));
    batchList.push({ batchRaw, batch });
  }

  const useParallelBatches = !!(llmPool && llmPool.length > 1 && batchList.length > 1);

  const processBatchOutput = async (
    batchRaw: BatchItem['batchRaw'],
    batch: BatchItem['batch'],
    result: any,
    batchTokensUsed: number
  ) => {
    totalTokensUsed += batchTokensUsed;
    const slides = Array.isArray(result?.slides) ? result.slides : [];
    const slidesNeedingRetry: number[] = [];

    for (const s of slides) {
      const slide_number = Number(s?.slide_number) || 0;
      if (!slide_number) continue;
      const existing = allSlides.find((x) => x.slide_number === slide_number);
      if (existing) continue;

      const script_markdown = typeof s?.script_markdown === 'string' ? s.script_markdown : '';
      const script_markdown_secondary = needSecondary && typeof s?.script_markdown_secondary === 'string'
        ? s.script_markdown_secondary
        : '';

      const minSecondaryLength = 150;
      if (needSecondary && (script_markdown_secondary.length < minSecondaryLength || !script_markdown_secondary.trim())) {
        console.log(`[Lecture] Batch: Slide ${slide_number} has incomplete secondary language (${script_markdown_secondary.length} chars, need ${minSecondaryLength}+)`);
        slidesNeedingRetry.push(slide_number);
      }

      allSlides.push({
        slide_number,
        slide_title: typeof s?.slide_title === 'string' ? s.slide_title : '',
        script_markdown,
        script_markdown_secondary,
      });
    }

    if (onProgress) {
      onProgress(Math.min(allSlides.length, totalSlides), totalSlides);
    }

    for (const n of slidesNeedingRetry) {
      const slideData = batchRaw.find((s) => s.slide_number === n);
      if (slideData) {
        const slideObj = {
          slide_number: n,
          original_slide_number: slideData.original_slide_number,
          source_file: slideData.source_file,
          text: (slideData.text || '').slice(0, 5000),
          features: slideData.features || {},
          plan: slidePlanByNumber.get(n) || null,
          prev_text: (slidesFromPpt.find((x: any) => x.slide_number === n - 1)?.text || '').slice(0, 1500),
          next_text: (slidesFromPpt.find((x: any) => x.slide_number === n + 1)?.text || '').slice(0, 1500),
        };
        try {
          await new Promise(resolve => setTimeout(resolve, 1500));
          const one = await generateOneSlide(slideObj);
          if (one && one.slide_number === n && one.script_markdown) {
            const idx = allSlides.findIndex((x) => x.slide_number === n);
            const minSecondaryLength = 150;
            if (idx >= 0) {
              const currentSecondary = allSlides[idx].script_markdown_secondary.length;
              const newSecondary = one.script_markdown_secondary.length;
              if (newSecondary >= minSecondaryLength || newSecondary > currentSecondary + 50) {
                allSlides[idx] = {
                  slide_number: one.slide_number,
                  slide_title: one.slide_title,
                  script_markdown: one.script_markdown,
                  script_markdown_secondary: one.script_markdown_secondary,
                };
                totalTokensUsed += one.tokensUsed || 0;
                console.log(`[Lecture] Slide ${n} secondary language retry successful (${currentSecondary} -> ${newSecondary} chars)`);
              }
            }
          }
        } catch (e) {
          console.error(`[Lecture] Slide ${n} secondary language retry failed:`, e);
        }
      }
    }

    const expectedNums = batch.map((b) => Number(b.slide_number) || 0).filter(Boolean);
    const missingNums = expectedNums.filter((n) => !allSlides.some((s) => s.slide_number === n));
    for (const n of missingNums) {
      const src = batchRaw.find((x: any) => x.slide_number === n);
      if (!src) continue;
      const slideObj = {
        slide_number: n,
        original_slide_number: src.original_slide_number,
        source_file: src.source_file,
        text: (src.text || '').slice(0, 6000),
        features: src.features || {},
        plan: slidePlanByNumber.get(n) || null,
        prev_text: (slidesFromPpt.find((x: any) => x.slide_number === n - 1)?.text || '').slice(0, 1500),
        next_text: (slidesFromPpt.find((x: any) => x.slide_number === n + 1)?.text || '').slice(0, 1500),
      };
      try {
        const one = await generateOneSlide(slideObj);
        if (one && one.slide_number === n && one.script_markdown) {
          const existing = allSlides.find((x) => x.slide_number === n);
          if (!existing) {
            allSlides.push({
              slide_number: one.slide_number,
              slide_title: one.slide_title,
              script_markdown: one.script_markdown,
              script_markdown_secondary: one.script_markdown_secondary,
            });
            totalTokensUsed += one.tokensUsed || 0;
          }
        }
      } catch (e) {
        console.error('single-slide retry failed:', n, e);
      }
    }
  };

  // Report initial progress
  if (onProgress) {
    onProgress(0, totalSlides);
  }

  const buildBatchMessages = (batch: BatchItem['batch']) => [
    {
      role: 'system' as const,
      content:
        `You are an expert teaching assistant creating lecture rehearsal notes. You must output VALID JSON only (no markdown fences).` +
        (needSecondary
          ? `\n\n⚠️ CRITICAL: For EVERY slide, you MUST provide COMPLETE speaker notes in BOTH languages (${primaryLanguage} AND ${secondaryLanguage}). The script_markdown_secondary field is MANDATORY for each slide and must contain substantial content (at least 150+ characters per slide). Empty or very short secondary language content is NOT acceptable.`
          : '') +
        (addonSystem ? `\n\n${addonSystem}` : '') +
        `\n\n${schema}`,
    },
    {
      role: 'user' as const,
      content:
        `Deck context (background only, lower priority than slide text):\n${context.substring(0, 1500)}\n\n---\n\n` +
        `Slides batch with execution plans and source text:\n${JSON.stringify(batch, null, 2).substring(0, 9000)}\n\n---\n\n` +
        `web_sources (optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_SLIDE_LIMIT)}\n\n---\n\n` +
        `Audience: ${audienceLevel}. Target duration overall ~${targetMinutes} minutes.\n` +
        (needSecondary
          ? `CRITICAL: You MUST provide COMPLETE speaker notes in BOTH languages for EVERY slide:\n1. script_markdown: Full detailed notes in ${primaryLanguage}\n2. script_markdown_secondary: Full detailed notes in ${secondaryLanguage}\nBoth fields are REQUIRED and must contain substantial content.\n`
          : `Output in ${primaryLanguage} only.\n- Use each slide's plan to decide depth.\n- Transition or cover-like slides can be cue notes.\n- Concept/example slides can be fuller speaker notes.\n- Ground every slide in that slide's own source text.\n- Do not invent concepts or examples that are not present on that slide.\n`) +
        (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
    },
  ];

  const fallbackBatchToSingleSlides = async (batchRaw: BatchItem['batchRaw']) => {
    for (const src of batchRaw) {
      if (allSlides.some((slide) => slide.slide_number === src.slide_number)) continue;
      const slideObj = {
        slide_number: src.slide_number,
        original_slide_number: src.original_slide_number,
        source_file: src.source_file,
        text: (src.text || '').slice(0, 6000),
        features: src.features || {},
        plan: slidePlanByNumber.get(src.slide_number) || null,
        prev_text: (slidesFromPpt.find((x: any) => x.slide_number === src.slide_number - 1)?.text || '').slice(0, 1500),
        next_text: (slidesFromPpt.find((x: any) => x.slide_number === src.slide_number + 1)?.text || '').slice(0, 1500),
      };
      try {
        const one = await generateOneSlide(slideObj);
        if (one?.script_markdown) {
          allSlides.push({
            slide_number: one.slide_number,
            slide_title: one.slide_title,
            script_markdown: one.script_markdown,
            script_markdown_secondary: one.script_markdown_secondary,
          });
          totalTokensUsed += one.tokensUsed || 0;
        }
      } catch (error) {
        console.error('[Lecture] Single-slide fallback failed:', src.slide_number, error);
      }
      if (onProgress) {
        onProgress(Math.min(allSlides.length, totalSlides), totalSlides);
      }
    }
  };

  if (useParallelBatches) {
    console.log(`[Lecture] Processing ${batchList.length} slide batches in parallel using ${llmPool!.length} LLM provider(s)`);
    const completedBatches = { n: 0 };
    const batchResults: Array<{ data: any; tokensUsed: number; batchRaw: BatchItem['batchRaw']; batch: BatchItem['batch'] }> = [];
    const workerCount = Math.min(llmPool!.length, batchList.length);
    let nextBatchIndex = 0;

    const runWorker = async (workerIndex: number) => {
      while (nextBatchIndex < batchList.length) {
        const batchIndex = nextBatchIndex++;
        const b = batchList[batchIndex];
        const config = getLLMConfigFromPool(llmPool!, workerIndex);
        try {
          const batchResult = await callLLMJson({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            model: config.model,
            maxCompletionTokens: needSecondary ? 3200 : 1800,
            messages: buildBatchMessages(b.batch),
          });
          completedBatches.n += 1;
          if (onProgress) {
            const approxSlides = Math.min(completedBatches.n * batchSize, totalSlides);
            onProgress(approxSlides, totalSlides);
          }
          batchResults.push({
            data: batchResult.data,
            tokensUsed: batchResult.tokensUsed || 0,
            batchRaw: b.batchRaw,
            batch: b.batch,
          });
        } catch (error: any) {
          if (String(error?.message || '').includes('finish_reason: length')) {
            console.warn('[Lecture] Batch generation hit length limit, falling back to single-slide generation.');
            await fallbackBatchToSingleSlides(b.batchRaw);
          } else {
            throw error;
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, (_, idx) => runWorker(idx)));
    for (const br of batchResults) {
      await processBatchOutput(br.batchRaw, br.batch, br.data, br.tokensUsed);
    }
  } else {
    for (let i = 0; i < batchList.length; i++) {
      const { batchRaw, batch } = batchList[i];
      try {
        const batchResult = await callLLMJson({
          apiKey,
          baseURL,
          model,
          maxCompletionTokens: needSecondary ? 3200 : 1800,
          messages: buildBatchMessages(batch),
        });
        await processBatchOutput(batchRaw, batch, batchResult.data, batchResult.tokensUsed || 0);
      } catch (error: any) {
        if (String(error?.message || '').includes('finish_reason: length')) {
          console.warn('[Lecture] Sequential batch generation hit length limit, falling back to single-slide generation.');
          await fallbackBatchToSingleSlides(batchRaw);
        } else {
          throw error;
        }
      }
    }
  }

  // Final check: ensure all slides have complete secondary language if needed
  if (needSecondary) {
    const minSecondaryLength = 150;
    const incompleteSlides = allSlides.filter(
      (s) => s.slide_number > 1 && (s.script_markdown_secondary.length < minSecondaryLength || !s.script_markdown_secondary.trim())
    );
    
    if (incompleteSlides.length > 0) {
      console.log(`[Lecture] Final check: ${incompleteSlides.length} slides still have incomplete secondary language, attempting final retry...`);
      
      for (const slide of incompleteSlides) {
        const slideData = slidesFromPpt.find((s) => s.slide_number === slide.slide_number);
        if (slideData) {
          const slideObj = {
            slide_number: slide.slide_number,
            text: (slideData.text || '').slice(0, 5000),
            features: slideData.features || {},
            prev_text: (slidesFromPpt.find((x: any) => x.slide_number === slide.slide_number - 1)?.text || '').slice(0, 1500),
            next_text: (slidesFromPpt.find((x: any) => x.slide_number === slide.slide_number + 1)?.text || '').slice(0, 1500),
          };
          try {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Delay to avoid rate limiting
            const retryResult = await generateOneSlide(slideObj);
            if (retryResult && retryResult.slide_number === slide.slide_number && retryResult.script_markdown_secondary.length >= minSecondaryLength) {
              const idx = allSlides.findIndex((x) => x.slide_number === slide.slide_number);
              if (idx >= 0) {
                allSlides[idx] = {
                  slide_number: retryResult.slide_number,
                  slide_title: retryResult.slide_title,
                  script_markdown: retryResult.script_markdown,
                  script_markdown_secondary: retryResult.script_markdown_secondary,
                };
                totalTokensUsed += retryResult.tokensUsed || 0;
                console.log(`[Lecture] Final retry successful for slide ${slide.slide_number}`);
              }
            }
          } catch (e) {
            console.error(`[Lecture] Final retry failed for slide ${slide.slide_number}:`, e);
          }
        }
      }
    }
  }

  // Ensure we return all slide numbers (fill missing with a stub rather than dropping)
  const expected = slidesToGenerate.map((s) => s.slide_number);
  for (const n of expected) {
    if (!allSlides.some((s) => s.slide_number === n)) {
      allSlides.push({
        slide_number: n,
        slide_title: '',
        script_markdown: `Speaker notes could not be generated for slide ${n}.`,
        script_markdown_secondary:
          secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none'
            ? `（未能產生第 ${n} 頁的講稿）`
            : '',
      });
    }
  }

  // Add cover slides (marked) as plain extracted text (no AI script)
  const covers = slidesFromPpt.filter((s) => s.isCover);
  for (const cover of covers) {
    const coverText = (cover.text || '').trim();
    allSlides.push({
      slide_number: cover.slide_number,
      slide_title: `Cover (${cover.source_file} - slide ${cover.original_slide_number})`,
      script_markdown: coverText || 'Cover slide (no script generated).',
      script_markdown_secondary: coverText || '',
    });
  }

  if (shouldTranslateSecondary) {
    try {
      const translationResult = await translateSlidesSecondary({
        apiKey,
        baseURL,
        model,
        primaryLanguage,
        secondaryLanguage,
        slides: allSlides.sort((a, b) => a.slide_number - b.slide_number),
      });
      totalTokensUsed += translationResult.tokensUsed;
      const translationBySlide = new Map(
        translationResult.slides.map((slide) => [slide.slide_number, slide.script_markdown_secondary])
      );
      for (const slide of allSlides) {
        slide.script_markdown_secondary = translationBySlide.get(slide.slide_number) || slide.script_markdown_secondary || '';
      }
    } catch (error) {
      console.error('[Lecture] Secondary translation failed:', error);
    }
  }

  return {
    slides: allSlides.sort((a, b) => a.slide_number - b.slide_number),
    tokensUsed: totalTokensUsed,
  };
}

function pickWikiLang(primaryLanguage: string) {
  // Prefer zh (Traditional/Simplified both) when Chinese; otherwise use en.
  const s = (primaryLanguage || '').toLowerCase();
  if (s.includes('中文') || s.includes('chinese') || s.includes('繁體') || s.includes('简体')) return 'zh';
  return 'en';
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'AI-Teaching-Assistant/1.0',
        'Accept': 'text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1',
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function wikiLookup(term: string, lang: string) {
  const host = `${lang}.wikipedia.org`;
  // Allowlist: only wikipedia.
  const q = (term || '').trim();
  if (!q) return null;

  // Search for best matching title
  const searchUrl = `https://${host}/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=1`;
  const searchRes = await fetchWithTimeout(searchUrl, 6000);
  if (!searchRes.ok) return null;
  const searchJson: any = await searchRes.json().catch(() => ({}));
  const page = Array.isArray(searchJson?.pages) ? searchJson.pages[0] : null;
  const title = page?.title;
  if (!title || typeof title !== 'string') return null;

  const summaryUrl = `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryRes = await fetchWithTimeout(summaryUrl, 6000);
  if (!summaryRes.ok) return null;
  const summaryJson: any = await summaryRes.json().catch(() => ({}));
  const extract = summaryJson?.extract;
  if (!extract || typeof extract !== 'string') return null;

  const wikiUrl = `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return { term: q, title, url: wikiUrl, extract, provider: 'wikipedia' } satisfies WebSource;
}

const ALLOWED_HOSTS = new Set<string>([
  // Mozilla / web
  'developer.mozilla.org',
  'developer.chrome.com',
  // Microsoft
  'learn.microsoft.com',
  // JS/TS
  'nodejs.org',
  'typescriptlang.org',
  'react.dev',
  'nextjs.org',
  // Python
  'docs.python.org',
  // Java
  'docs.oracle.com',
  // Go/Rust
  'pkg.go.dev',
  'doc.rust-lang.org',
  // General reference
  'en.wikipedia.org',
  'zh.wikipedia.org',
]);

function isAllowedUrl(u: string) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

function stripHtmlToText(html: string) {
  let s = html || '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<\/(p|div|br|li|h\d|pre|code)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

async function fetchPageExtract(url: string): Promise<{ title: string; extract: string } | null> {
  if (!isAllowedUrl(url)) return null;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!(ct.includes('text/html') || ct.includes('text/plain'))) return null;
  const html = (await res.text().catch(() => '')).slice(0, 220_000);
  if (!html) return null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 120) : url;
  // Prefer meta description (less likely to be navigation chrome like "Skip to main content")
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    '';
  let extract = metaDesc ? stripHtmlToText(metaDesc) : '';
  if (!extract) {
    extract = stripHtmlToText(html);
  }
  // Filter common boilerplate that shows up first on some sites
  extract = extract
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^skip to /i.test(l) && !/^skip to main content/i.test(l) && !/^skip to search/i.test(l))
    .join('\n');
  extract = extract.slice(0, 900);
  if (!extract) return null;
  return { title, extract };
}

async function mdnLookup(query: string): Promise<WebSource | null> {
  const q = (query || '').trim();
  if (!q) return null;
  const apiUrl = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(apiUrl, 7000);
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => ({}));
  const docs = Array.isArray(json?.documents) ? json.documents : [];
  const doc = docs[0];
  const mdnUrlRaw = typeof doc?.mdn_url === 'string' ? doc.mdn_url : typeof doc?.url === 'string' ? doc.url : '';
  const url = mdnUrlRaw
    ? mdnUrlRaw.startsWith('http')
      ? mdnUrlRaw
      : `https://developer.mozilla.org${mdnUrlRaw.startsWith('/') ? '' : '/'}${mdnUrlRaw}`
    : '';
  if (!url || !isAllowedUrl(url)) return null;

  // Prefer API-provided excerpt if present; otherwise fetch page.
  const excerptRaw = typeof doc?.excerpt === 'string' ? doc.excerpt : '';
  const excerpt = excerptRaw ? stripHtmlToText(excerptRaw) : '';
  if (excerpt) {
    return {
      term: q,
      title: typeof doc?.title === 'string' ? doc.title : 'MDN',
      url,
      extract: excerpt.slice(0, 900),
      provider: 'mdn',
    };
  }
  const page = await fetchPageExtract(url);
  if (!page) return null;
  return { term: q, title: page.title, url, extract: page.extract, provider: 'mdn' };
}

function decodeDuckDuckGoRedirect(href: string) {
  try {
    const u = new URL(href);
    if (u.hostname !== 'duckduckgo.com' && u.hostname !== 'www.duckduckgo.com') return href;
    const uddg = u.searchParams.get('uddg');
    if (!uddg) return href;
    return decodeURIComponent(uddg);
  } catch {
    return href;
  }
}

async function duckDuckGoSearch(query: string): Promise<Array<{ title: string; url: string }>> {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return [];
  const html = (await res.text().catch(() => '')).slice(0, 250_000);
  if (!html) return [];

  const out: Array<{ title: string; url: string }> = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 8) {
    const href = decodeDuckDuckGoRedirect(m[1]);
    const title = stripHtmlToText(m[2]).slice(0, 140);
    if (!href || !title) continue;
    out.push({ title, url: href });
  }
  return out;
}

async function googleCseSearch(query: string): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  const q = (query || '').trim();
  if (!key || !cx || !q) return [];
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, 7000);
  if (!res.ok) return [];
  const json: any = await res.json().catch(() => ({}));
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .map((it: any) => ({
      title: typeof it?.title === 'string' ? it.title : '',
      url: typeof it?.link === 'string' ? it.link : '',
      snippet: typeof it?.snippet === 'string' ? it.snippet : '',
    }))
    .filter((x: any) => x.title && x.url);
}

async function searchWeb(query: string): Promise<Array<{ title: string; url: string }>> {
  // Use DuckDuckGo as primary search engine (no API key required)
  return await duckDuckGoSearch(query);
}

async function gatherWebSources(params: { queries: string[]; primaryLanguage: string }): Promise<WebSource[]> {
  const { queries, primaryLanguage } = params;
  const wikiLang = pickWikiLang(primaryLanguage);
  const sources: WebSource[] = [];

  const unique = Array.from(new Set((queries || []).map((q) => q.trim()).filter(Boolean))).slice(0, 6);
  for (const term of unique) {
    if (sources.length >= 8) break;

    // 1) MDN first (for web/dev terms)
    const mdn = await mdnLookup(term).catch(() => null);
    if (mdn) sources.push(mdn);

    if (sources.length >= 8) break;

    // 2) Google/DDG search -> allowlisted pages -> extract
    const results = await searchWeb(term).catch(() => []);
    const candidates = results
      .map((r) => ({ ...r, url: decodeDuckDuckGoRedirect(r.url) }))
      .filter((r) => r.url && isAllowedUrl(r.url))
      .slice(0, 2);

    for (const c of candidates) {
      if (sources.length >= 8) break;
      // Avoid duplicates
      if (sources.some((s) => s.url === c.url)) continue;
      const page = await fetchPageExtract(c.url).catch(() => null);
      if (!page) continue;
      sources.push({ term, title: page.title || c.title, url: c.url, extract: page.extract, provider: 'web' });
    }

    if (sources.length >= 8) break;

    // 3) Wikipedia fallback
    const wiki = await wikiLookup(term, wikiLang).catch(() => null);
    if (wiki && !sources.some((s) => s.url === wiki.url)) sources.push(wiki);
  }

  return sources;
}

function getLectureAddon(): { system: string; user: string } {
  const raw: any = promptTemplates as any;
  const tpl = raw?.lecture_rehearsal || {};
  return {
    system: typeof tpl?.system === 'string' ? tpl.system : '',
    user: typeof tpl?.user === 'string' ? tpl.user : '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const apiKey = (body?.apiKey || '').toString();
    const baseURL = (body?.baseURL || '').toString();
    const model = (body?.model || '').toString();
    const provider = (body?.provider || 'openai').toString();
    const apiKeys = body?.apiKeys as Record<string, string> | undefined;
    const providerModels = body?.providerModels as Record<string, string> | undefined;
    const primaryLanguage = (body?.primaryLanguage || 'English').toString();
    const secondaryLanguage = (body?.secondaryLanguage || 'none').toString();
    const includeWebResources = Boolean(body?.includeWebResources);
    const audienceLevel = (body?.audienceLevel || 'beginner').toString();
    const targetMinutes = Number(body?.targetMinutes) || 45;
    const context = (body?.context || '').toString();
    const pptxBase64 = typeof body?.pptxBase64 === 'string' ? body.pptxBase64 : '';
    const pptxFiles = Array.isArray(body?.pptxFiles) ? body.pptxFiles : [];
    const pptxFileContexts = Array.isArray(body?.pptxFileContexts) ? body.pptxFileContexts : [];

    // Build LLM pool for parallel processing with multiple providers
    const llmPool = buildLLMPool(apiKeys, provider, baseURL, model, providerModels);
    const hasMultipleLLMs = llmPool.length > 1;
    
    // If we have a pool but apiKey is empty, use the first pool entry as default
    // This ensures sequential processing works even when apiKey comes from apiKeys object
    let effectiveApiKey = apiKey;
    let effectiveBaseURL = baseURL;
    let effectiveModel = model;
    
    if (!effectiveApiKey && llmPool.length > 0) {
      const defaultConfig = llmPool[0];
      effectiveApiKey = defaultConfig.apiKey;
      effectiveBaseURL = defaultConfig.baseURL;
      effectiveModel = defaultConfig.model;
      console.log(`[Lecture Rehearsal] Using ${defaultConfig.provider} as default LLM provider`);
    }
    
    // Log available LLM providers
    if (hasMultipleLLMs) {
      console.log(`[Lecture Rehearsal] Multiple LLM providers available: ${llmPool.map(p => p.provider).join(', ')}`);
    }

    if (!effectiveApiKey && llmPool.length === 0) return NextResponse.json({ error: 'API Key is missing' }, { status: 400 });
    if (!context.trim()) return NextResponse.json({ error: 'Context is empty' }, { status: 400 });
    
    let totalTokensUsed = 0;

    const addon = getLectureAddon();
    const addonSystem = addon.system.trim();
    const addonUser = addon.user.trim();

    const langHintPrimary = `PRIMARY language: ${primaryLanguage}`;
    const langHintSecondary = secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? `SECONDARY language: ${secondaryLanguage}` : 'No secondary language.';

    // Stage 1: decide outline + key terms to lookup
    const stage1Schema = `Return JSON with exactly:
{
  "title": "string",
  "outline": ["string"],
  "key_terms": ["string"],
  "web_queries": ["string"]
}
Rules:
- key_terms/web_queries: pick up to 8 items; prefer terms that a beginner may not know.
- web_queries should be short (2-8 words) and suitable for web search (Google/MDN/Wikipedia). Prefer official-doc-friendly queries (e.g., "Promise JavaScript", "fetch API", "Big-O notation").`;

    const stage1Result = await callLLMJson({
      apiKey: effectiveApiKey,
      baseURL: effectiveBaseURL,
      model: effectiveModel,
      maxCompletionTokens: 900,
      messages: [
        {
          role: 'system',
          content:
            `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
            (addonSystem ? `\n\n${addonSystem}` : '') +
            `\n\n${stage1Schema}`,
        },
        {
          role: 'user',
          content:
            `Context (may contain slides/notes/code):\n${context.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
            `Task: Build a lecture rehearsal plan for an ${audienceLevel} audience, target duration ~${targetMinutes} minutes.\n\n` +
            (audienceLevel === 'beginner'
              ? `AUDIENCE LEVEL: BEGINNER\n- Students have NO prior knowledge of this topic.\n- Explain EVERY term and concept from first principles (what it is, why it exists, how it works).\n- Use simple analogies and real-world examples that beginners can relate to.\n- Break down complex ideas into smaller, digestible pieces.\n- Avoid jargon without explanation. If you must use technical terms, define them immediately.\n- Assume students need step-by-step guidance.\n- Use "think of it like..." or "imagine that..." frequently.\n`
              : `AUDIENCE LEVEL: INTERMEDIATE\n- Students have BASIC knowledge of the topic but need deeper understanding.\n- You can reference fundamental concepts without full explanation (e.g., "as you know, variables store data...").\n- Focus on connections, patterns, and advanced applications rather than basic definitions.\n- Use technical terminology appropriately; only explain new or complex terms.\n- Assume students can follow logical reasoning and make connections.\n- Discuss trade-offs, best practices, and real-world applications.\n- Can introduce related concepts and show how they integrate.\n`) +
            `TARGET DURATION: ${targetMinutes} minutes\n- Plan content to fit within this timeframe.\n- Allocate time per section (e.g., "Section 1: Introduction (5 min)", "Section 2: Core Concepts (15 min)").\n- If target is ≤30 minutes: Keep explanations concise, focus on key points only.\n- If target is 45-60 minutes: Provide moderate detail with examples.\n- If target is ≥90 minutes: Include comprehensive explanations, multiple examples, and deeper discussions.\n- Adjust slide-by-slide script length accordingly (shorter time = shorter per-slide scripts, longer time = more detailed per-slide scripts).\n\n` +
            `${langHintPrimary}\n${langHintSecondary}\n` +
            (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
        },
      ],
    });
    const stage1 = stage1Result.data;
    totalTokensUsed += stage1Result.tokensUsed || 0;

    const title = typeof stage1?.title === 'string' && stage1.title.trim() ? stage1.title.trim() : 'Lecture Rehearsal';
    const webQueries: string[] = Array.isArray(stage1?.web_queries) ? stage1.web_queries.filter((x: any) => typeof x === 'string') : [];
    const fileBlocks = splitContextByFile(context);
    const pdfBlocks = fileBlocks.filter((b) => b.fileName.toLowerCase().endsWith('.pdf'));
    const web_sources: WebSource[] = includeWebResources && webQueries.length > 0
      ? await gatherWebSourcesShared({ queries: webQueries, primaryLanguage })
      : [];

    // If a PPTX is provided, parse slide-by-slide context for more faithful per-slide scripts.
    // Optional llmConfig allows using different LLM providers for parallel processing
    const processSinglePptx = async (file: { name: string; base64: string; context?: string }, llmConfig?: LLMProviderConfig) => {
      // Use provided LLM config or fall back to the effective values
      const useApiKey = llmConfig?.apiKey || effectiveApiKey;
      const useBaseURL = llmConfig?.baseURL || effectiveBaseURL;
      const useModel = llmConfig?.model || effectiveModel;
      const useProvider = llmConfig?.provider || provider;
      
      if (llmConfig) {
        console.log(`[Lecture Rehearsal] Processing ${file.name} with ${useProvider} (${useModel})`);
      }
      const slidesFromPpt: Array<{ slide_number: number; original_slide_number: number; source_file: string; text: string; textLen?: number; features?: any; isCover?: boolean }> = [];
      const buf = Buffer.from(file.base64, 'base64');
      const slides = await extractSlidesFromPptx(buf);
      for (const s of slides) {
        const isCover = Number(s.slideNum) === 1 && (s.textLen || 0) < 30;
        slidesFromPpt.push({
          slide_number: Number(s.slideNum) || 0,
          original_slide_number: Number(s.slideNum) || 0,
          source_file: file.name,
          text: s.text || '',
          textLen: s.textLen || 0,
          features: s.features || {},
          isCover,
        });
      }

      const contextForFile = file.context || context;

      // Stage 2 (script) for this file
      let stage2: any;
      let stage2Tokens = 0;
      try {
        const stage2Result = await callLLMJson({
          apiKey: useApiKey,
          baseURL: useBaseURL,
          model: useModel,
          maxCompletionTokens: secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? 3200 : 2200,
          messages: [
            {
              role: 'system',
              content:
                `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
                (addonSystem ? `\n\n${addonSystem}` : '') +
                `\n\nReturn JSON with exactly:\n{\n  \"title\": \"string\",\n  \"script_markdown\": \"string\",\n  \"script_markdown_secondary\": \"string\"\n}\nRules:\n- script_markdown must be Markdown text (NOT JSON inside).\n- script_markdown_secondary must be in the SECONDARY language when enabled, otherwise \"\".\n- Do NOT include a \"slides\" array here - slides will be generated separately.\n- Use clear headings, short paragraphs, and examples.\n- Include a final section: \"Recap\" and \"Self-check Questions\" (3-5 items).`,
            },
            {
              role: 'user',
              content:
                `Context:\n${contextForFile.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                `PPT slides detected (${slidesFromPpt.length} slides). You should write a general lecture script that covers this PPTX content only.\n\n---\n\n` +
                `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                (audienceLevel === 'beginner'
                  ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script length: ~200-350 words per slide (more detailed explanations).\n`
                  : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script length: ~150-250 words per slide (more focused, less repetition).\n`) +
                `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n- Calculate: ~${Math.round(targetMinutes / Math.max(slidesFromPpt.length, 1))} minutes per slide on average.\n- Shorter time (≤30 min): Concise explanations, key points only.\n- Medium time (45-60 min): Balanced detail with examples.\n- Longer time (≥90 min): Comprehensive coverage with multiple examples.\n\n` +
                `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
                (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
            },
          ],
        });
        stage2 = stage2Result.data;
        stage2Tokens = stage2Result.tokensUsed || 0;
        totalTokensUsed += stage2Tokens;
      } catch (stage2Error: any) {
        console.error('[Lecture Rehearsal] Stage 2 JSON parsing failed:', stage2Error);
        throw new Error(`Failed to generate lecture script. ${stage2Error?.message || 'Unknown error'}`);
      }

      const script_markdown =
        typeof stage2?.script_markdown === 'string'
          ? stage2.script_markdown
          : typeof stage2?.__raw_text === 'string'
          ? stage2.__raw_text
          : '';
      if (!script_markdown.trim()) {
        const rawHint = typeof stage2?.__raw_text === 'string' && stage2.__raw_text.length > 50
          ? ' Model returned non-JSON or unexpected format; try again or use a different model.'
          : '';
        throw new Error(`LLM returned empty script_markdown.${rawHint}`);
      }
      const script_markdown_secondary =
        secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none'
          ? (typeof stage2?.script_markdown_secondary === 'string' ? stage2.script_markdown_secondary : '')
          : '';

      // Generate per-slide scripts for this file (llmPool enables parallel batch processing)
      const batchResult = await buildSlideScriptsBatched({
        apiKey: useApiKey,
        baseURL: useBaseURL,
        model: useModel,
        primaryLanguage,
        secondaryLanguage,
        audienceLevel,
        targetMinutes,
        addonSystem,
        addonUser,
        context: contextForFile,
        slidesFromPpt,
        web_sources,
        llmPool,
      });
      totalTokensUsed += batchResult.tokensUsed;

      return {
        title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : file.name,
        script_markdown,
        script_markdown_secondary,
        slides: batchResult.slides,
        web_sources,
        source_file: file.name,
      };
    };

    // Optional llmConfig allows using different LLM providers for parallel processing
    const processSinglePdf = async (file: { name: string; content: string }, llmConfig?: LLMProviderConfig) => {
      // Use provided LLM config or fall back to the effective values
      const useApiKey = llmConfig?.apiKey || effectiveApiKey;
      const useBaseURL = llmConfig?.baseURL || effectiveBaseURL;
      const useModel = llmConfig?.model || effectiveModel;
      const useProvider = llmConfig?.provider || provider;
      
      if (llmConfig) {
        console.log(`[Lecture Rehearsal] Processing ${file.name} with ${useProvider} (${useModel})`);
      }
      
      const pages = extractPdfPagesFromContent(file.content);
      if (pages.length === 0) {
        throw new Error(`PDF "${file.name}" has no [PAGE: X] markers or extractable text.`);
      }
      const slidesFromPdf = pages.map((p) => ({
        slide_number: p.page,
        original_slide_number: p.page,
        source_file: file.name,
        text: p.text,
        textLen: p.textLen,
      }));

      const contextForFile = buildCompactPdfContext(file.name, pages);

      let stage2: any;
      let stage2Tokens = 0;
      try {
        const stage2Result = await callLLMJson({
          apiKey: useApiKey,
          baseURL: useBaseURL,
          model: useModel,
          maxCompletionTokens: secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? 3200 : 2200,
          messages: [
            {
              role: 'system',
              content:
                `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
                (addonSystem ? `\n\n${addonSystem}` : '') +
                `\n\nReturn JSON with exactly:\n{\n  \"title\": \"string\",\n  \"script_markdown\": \"string\",\n  \"script_markdown_secondary\": \"string\"\n}\nRules:\n- script_markdown must be Markdown text (NOT JSON inside).\n- script_markdown_secondary must be in the SECONDARY language when enabled, otherwise \"\".\n- Do NOT include a \"slides\" array here - slides will be generated separately.\n- Use clear headings, short paragraphs, and examples.\n- Include a final section: \"Recap\" and \"Self-check Questions\" (3-5 items).`,
            },
            {
              role: 'user',
              content:
                `Context:\n${contextForFile.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                `PDF pages detected (${slidesFromPdf.length} pages). You should write a general lecture script that covers this PDF content only.\n\n---\n\n` +
                `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                (audienceLevel === 'beginner'
                  ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script length: ~200-350 words per page (more detailed explanations).\n`
                  : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script length: ~150-250 words per page (more focused, less repetition).\n`) +
                `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n- Calculate: ~${Math.round(targetMinutes / Math.max(slidesFromPdf.length, 1))} minutes per page on average.\n- Shorter time (≤30 min): Concise explanations, key points only.\n- Medium time (45-60 min): Balanced detail with examples.\n- Longer time (≥90 min): Comprehensive coverage with multiple examples.\n\n` +
                `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
                (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
            },
          ],
        });
        stage2 = stage2Result.data;
        stage2Tokens = stage2Result.tokensUsed || 0;
        totalTokensUsed += stage2Tokens;
      } catch (stage2Error: any) {
        console.error('[Lecture Rehearsal] PDF Stage 2 JSON parsing failed:', stage2Error);
        throw new Error(`Failed to generate lecture script. ${stage2Error?.message || 'Unknown error'}`);
      }

      const script_markdown =
        typeof stage2?.script_markdown === 'string'
          ? stage2.script_markdown
          : typeof stage2?.__raw_text === 'string'
          ? stage2.__raw_text
          : '';
      if (!script_markdown.trim()) {
        const rawHint = typeof stage2?.__raw_text === 'string' && stage2.__raw_text.length > 50
          ? ' Model returned non-JSON or unexpected format; try again or use a different model.'
          : '';
        throw new Error(`LLM returned empty script_markdown.${rawHint}`);
      }
      const script_markdown_secondary =
        secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none'
          ? (typeof stage2?.script_markdown_secondary === 'string' ? stage2.script_markdown_secondary : '')
          : '';

      const pageTextByNumber = new Map<number, string>();
      for (const p of pages) pageTextByNumber.set(p.page, p.text);

      const batchResult = await buildSlideScriptsBatched({
        apiKey: useApiKey,
        baseURL: useBaseURL,
        model: useModel,
        primaryLanguage,
        secondaryLanguage,
        audienceLevel,
        targetMinutes,
        addonSystem,
        addonUser,
        context: contextForFile,
        slidesFromPpt: slidesFromPdf,
        web_sources,
        llmPool,
      });
      totalTokensUsed += batchResult.tokensUsed;

      return {
        title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : file.name,
        script_markdown,
        script_markdown_secondary,
        slides: batchResult.slides.map((s) => ({
            ...s,
            slide_text: pageTextByNumber.get(s.slide_number) || '',
          })),
        web_sources,
        source_file: file.name,
      };
    };

    if (pptxFiles.length > 0 || pdfBlocks.length > 0) {
      const results: any[] = [];
      
      // Collect all files to process
      const allTasks: Array<{ type: 'pptx' | 'pdf'; file: any; index: number }> = [];
      pptxFiles.forEach((f: any, i: number) => {
        const name = typeof f?.name === 'string' ? f.name : 'pptx';
        const base64 = typeof f?.base64 === 'string' ? f.base64 : '';
        const ctx = pptxFileContexts.find((c: any) => c?.name === name)?.context || context;
        allTasks.push({ type: 'pptx', file: { name, base64, context: ctx }, index: i });
      });
      pdfBlocks.forEach((b: any, i: number) => {
        allTasks.push({ type: 'pdf', file: { name: b.fileName, content: b.content }, index: pptxFiles.length + i });
      });
      
      // If multiple LLMs available and multiple files, process in parallel
      if (hasMultipleLLMs && allTasks.length > 1) {
        console.log(`[Lecture Rehearsal] Processing ${allTasks.length} files in parallel using ${llmPool.length} LLM providers`);
        
        const taskPromises = allTasks.map((task, idx) => {
          // Assign LLM from pool in round-robin fashion
          const llmConfig = getLLMConfigFromPool(llmPool, idx);
          
          if (task.type === 'pptx') {
            return processSinglePptx(task.file, llmConfig);
          } else {
            return processSinglePdf(task.file, llmConfig);
          }
        });
        
        const parallelResults = await Promise.all(taskPromises);
        results.push(...parallelResults);
      } else {
        // Sequential processing (single LLM or single file)
        console.log(`[Lecture Rehearsal] Processing ${allTasks.length} files sequentially`);
        
        for (const task of allTasks) {
          if (task.type === 'pptx') {
            const result = await processSinglePptx(task.file);
            results.push(result);
          } else {
            const result = await processSinglePdf(task.file);
            results.push(result);
          }
          // Add delay between files to avoid rate limiting
          if (task.index < allTasks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      if (results.length > 1) {
        if (session?.user?.id && totalTokensUsed > 0) {
          try {
            const inputTokens = Math.round(totalTokensUsed * 0.6);
            const outputTokens = Math.round(totalTokensUsed * 0.4);
            await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
            console.log(`[lecture-rehearsal] Recorded ${totalTokensUsed} tokens (multi-file, input: ${inputTokens}, output: ${outputTokens})`);
          } catch (usageError: any) {
            console.error('[lecture-rehearsal] Failed to record token usage:', usageError);
          }
        }
        return NextResponse.json({ results });
      }
      if (results.length === 1) {
        if (session?.user?.id && totalTokensUsed > 0) {
          try {
            const inputTokens = Math.round(totalTokensUsed * 0.6);
            const outputTokens = Math.round(totalTokensUsed * 0.4);
            await recordUsage(session.user.id, 'lecture_rehearsal', inputTokens, outputTokens, model || 'unknown');
            console.log(`[lecture-rehearsal] Recorded ${totalTokensUsed} tokens (multi-file single result, input: ${inputTokens}, output: ${outputTokens})`);
          } catch (usageError: any) {
            console.error('[lecture-rehearsal] Failed to record token usage:', usageError);
          }
        }
        return NextResponse.json(results[0]);
      }
    }

    let slidesFromPpt: Array<{ slide_number: number; original_slide_number: number; source_file: string; text: string; textLen?: number; features?: any; isCover?: boolean }> = [];
    let contextSingle = context;
    let pdfPageTextByNumber: Map<number, string> | null = null;
    if (pptxFiles.length === 1) {
      const name = typeof pptxFiles[0]?.name === 'string' ? pptxFiles[0].name : 'pptx';
      const base64 = typeof pptxFiles[0]?.base64 === 'string' ? pptxFiles[0].base64 : '';
      const ctx = pptxFileContexts.find((c: any) => c?.name === name)?.context || context;
      contextSingle = ctx;
      if (base64) {
        try {
          const buf = Buffer.from(base64, 'base64');
          const slides = await extractSlidesFromPptx(buf);
          slidesFromPpt = slides.map((s: any) => ({
            slide_number: Number(s.slideNum) || 0,
            original_slide_number: Number(s.slideNum) || 0,
            source_file: name,
            text: s.text || '',
            textLen: s.textLen || 0,
            features: s.features || {},
            isCover: Number(s.slideNum) === 1 && (s.textLen || 0) < 30,
          }));
        } catch (e) {
          console.error('extractSlidesFromPptx (single) failed:', e);
        }
      }
    } else if (pptxBase64) {
      try {
        const buf = Buffer.from(pptxBase64, 'base64');
        const slides = await extractSlidesFromPptx(buf);
        slidesFromPpt = slides.map((s: any) => ({
          slide_number: Number(s.slideNum) || 0,
          original_slide_number: Number(s.slideNum) || 0,
          source_file: 'pptx',
          text: s.text || '',
          textLen: s.textLen || 0,
          features: s.features || {},
          isCover: Number(s.slideNum) === 1 && (s.textLen || 0) < 30,
        }));
      } catch (e) {
        console.error('extractSlidesFromPptx failed:', e);
      }
    } else if (pdfBlocks.length === 1) {
      const pdf = pdfBlocks[0];
      const pages = extractPdfPagesFromContent(pdf.content);
      if (pages.length > 0) {
        contextSingle = buildCompactPdfContext(pdf.fileName, pages);
        pdfPageTextByNumber = new Map<number, string>();
        pages.forEach((p) => pdfPageTextByNumber?.set(p.page, p.text));
        slidesFromPpt = pages.map((p) => ({
          slide_number: p.page,
          original_slide_number: p.page,
          source_file: pdf.fileName,
          text: p.text,
          textLen: p.textLen,
        }));
      }
    }

    // Stage 2: write the full lecture script
    // If PPT is provided, don't ask for slides in stage2 (they'll be generated separately)
    const stage2Schema = slidesFromPpt.length > 0
      ? `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string"
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- Do NOT include a "slides" array here - slides will be generated separately.
- Use clear headings, short paragraphs, and examples.
- Include a final section: "Recap" and "Self-check Questions" (3-5 items).
- If using web_sources, cite them inline like: [source: TERM]. TERM must match a term in web_sources.
- Include a final "Sources" section at the end listing TERM -> URL (one or more URLs per TERM if multiple were used).`
      : `Return JSON with exactly:
{
  "title": "string",
  "script_markdown": "string",
  "script_markdown_secondary": "string",
  "slides": [ { "slide_number": number, "slide_title": "string", "script_markdown": "string", "script_markdown_secondary": "string" } ]
}
Rules:
- script_markdown must be Markdown text (NOT JSON inside).
- script_markdown_secondary should be "" in this step. Secondary translation happens later.
- If slides are provided in the prompt, you MUST fill the "slides" array with one item per slide (same slide_number).
- Use clear headings, short paragraphs, and examples.
- Include a final section: "Recap" and "Self-check Questions" (3-5 items).
- If using web_sources, cite them inline like: [source: TERM]. TERM must match a term in web_sources.
- Include a final "Sources" section at the end listing TERM -> URL (one or more URLs per TERM if multiple were used).`;

        let stage2: any;
        let stage2Tokens = 0;
        try {
          const stage2Result = await callLLMJson({
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            model: effectiveModel,
            maxCompletionTokens: secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' ? 3200 : 2200,
            messages: [
              {
                role: 'system',
                content:
                  `You are an expert teaching assistant. You must output VALID JSON only (no markdown fences).` +
                  (addonSystem ? `\n\n${addonSystem}` : '') +
                  `\n\n${stage2Schema}`,
              },
              {
                role: 'user',
                content:
                  `Context:\n${contextSingle.substring(0, STAGE_CONTEXT_LIMIT)}\n\n---\n\n` +
                  (slidesFromPpt.length > 0
                    ? `PPT slides detected (${slidesFromPpt.length} slides). You should write a general lecture script that covers the overall content. Individual slide-by-slide scripts will be generated separately.\n\n---\n\n`
                    : '') +
                  `Lecture plan (from model):\n${JSON.stringify(
                    {
                      title,
                      outline: stage1?.outline,
                      key_terms: stage1?.key_terms,
                    },
                    null,
                    2
                  ).substring(0, 12000)}\n\n---\n\n` +
                  `web_sources (supplemental, optional):\n${JSON.stringify(web_sources, null, 2).substring(0, WEB_SOURCES_STAGE_LIMIT)}\n\n---\n\n` +
                  `Now write a lecture rehearsal skeleton for an ${audienceLevel} audience, target ~${targetMinutes} minutes.\n\n` +
                  (audienceLevel === 'beginner'
                    ? `AUDIENCE: BEGINNER\n- Explain every concept from scratch. Define all terms.\n- Use simple analogies and step-by-step explanations.\n- Assume zero prior knowledge.\n- Script should be comprehensive and detailed.\n`
                    : `AUDIENCE: INTERMEDIATE\n- Reference basic concepts without full re-explanation.\n- Focus on deeper understanding, connections, and applications.\n- Assume foundational knowledge exists.\n- Script should be focused and efficient.\n`) +
                  `TARGET TIME: ${targetMinutes} minutes\n- Adjust content density to fit this duration.\n` +
                  (targetMinutes <= 30
                    ? `- SHORT LECTURE: Keep explanations concise, focus on key points only.\n`
                    : targetMinutes <= 60
                    ? `- MEDIUM LECTURE: Provide balanced detail with examples.\n`
                    : `- LONG LECTURE: Provide comprehensive coverage with multiple examples and deeper discussions.\n`) +
                  `Output PRIMARY language only for now:\n- ${langHintPrimary}\n- Secondary translation will run in a separate pass.\n` +
                  (slidesFromPpt.length > 0 
                    ? `\n\nIMPORTANT: Do NOT include a "slides" array in your JSON response. Only return "title", "script_markdown", and "script_markdown_secondary".`
                    : '') +
                  (addonUser ? `\n\nMODULE PROMPT ADDON:\n${addonUser}\n` : ''),
              },
            ],
          });
          stage2 = stage2Result.data;
          stage2Tokens = stage2Result.tokensUsed || 0;
          totalTokensUsed += stage2Tokens;
        } catch (stage2Error: any) {
          // If stage2 fails due to JSON parsing, try to provide a fallback
          console.error('[Lecture Rehearsal] Stage 2 JSON parsing failed:', stage2Error);
          throw new Error(`Failed to generate lecture script. The response was too long or malformed. ${stage2Error?.message || 'Unknown error'}. Please try with fewer slides or shorter content.`);
        }

    const script_markdown =
      typeof stage2?.script_markdown === 'string'
        ? stage2.script_markdown
        : typeof stage2?.__raw_text === 'string'
        ? stage2.__raw_text
        : typeof stage2?.script === 'string'
        ? stage2.script
        : '';
    if (!script_markdown.trim()) {
      const rawHint = typeof stage2?.__raw_text === 'string' && stage2.__raw_text.length > 50
        ? ' Model returned non-JSON or unexpected format; try again or use a different model.'
        : '';
      throw new Error(`LLM returned empty script_markdown.${rawHint}`);
    }
    const script_markdown_secondary =
      secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none'
        ? (typeof stage2?.script_markdown_secondary === 'string' ? stage2.script_markdown_secondary : '')
        : '';
    
    // Only parse slides from stage2 if PPT was NOT provided (slides will be generated separately via buildSlideScriptsBatched)
    let slides: Array<{ slide_number: number; slide_title: string; script_markdown: string; script_markdown_secondary: string }> = [];
    if (slidesFromPpt.length === 0) {
      // No PPT provided, use slides from stage2 if available
      slides =
        Array.isArray(stage2?.slides)
          ? stage2.slides
              .map((s: any) => ({
                slide_number: Number(s?.slide_number) || 0,
                slide_title: typeof s?.slide_title === 'string' ? s.slide_title : '',
                script_markdown: typeof s?.script_markdown === 'string' ? s.script_markdown : '',
                script_markdown_secondary:
                  secondaryLanguage && secondaryLanguage.toLowerCase() !== 'none' && typeof s?.script_markdown_secondary === 'string'
                    ? s.script_markdown_secondary
                    : '',
              }))
              .filter((s: any) => s.slide_number > 0 && s.script_markdown)
          : [];
    }

    // If PPT was provided, ensure slide-by-slide scripts cover ALL slides via batching (avoid truncation).
    if (slidesFromPpt.length > 0) {
      const batchResult = await buildSlideScriptsBatched({
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseURL,
        model: effectiveModel,
        primaryLanguage,
        secondaryLanguage,
        audienceLevel,
        targetMinutes,
        addonSystem,
        addonUser,
        context: contextSingle,
        slidesFromPpt,
        web_sources,
        llmPool,
      });
      slides = pdfPageTextByNumber
        ? batchResult.slides.map((s) => ({
            ...s,
            slide_text: pdfPageTextByNumber?.get(s.slide_number) || '',
          }))
        : batchResult.slides;
      totalTokensUsed += batchResult.tokensUsed;
    }

    // Record token usage
    try {
      // Estimate input/output tokens (rough split: 60% input, 40% output)
      const inputTokens = Math.round(totalTokensUsed * 0.6);
      const outputTokens = Math.round(totalTokensUsed * 0.4);
      
      await recordUsage(
        session.user.id,
        'lecture_rehearsal',
        inputTokens,
        outputTokens,
        model || 'unknown'
      );
      
      console.log(`[lecture-rehearsal] Recorded ${totalTokensUsed} tokens (input: ${inputTokens}, output: ${outputTokens})`);
    } catch (usageError: any) {
      // Don't fail the request if usage recording fails
      console.error('[lecture-rehearsal] Failed to record token usage:', usageError);
    }

    return NextResponse.json({
      title: typeof stage2?.title === 'string' && stage2.title.trim() ? stage2.title.trim() : title,
      script_markdown,
      script_markdown_secondary,
      slides,
      web_sources,
    });
  } catch (e: any) {
    console.error('Lecture rehearsal API error:', e);
    return NextResponse.json({ error: e?.message || 'Lecture rehearsal failed' }, { status: 500 });
  }
}
