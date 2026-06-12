import type { DocumentIntakeInput, DocumentIntakeResult } from './types';
import { getExtension } from './office-tools';

const IMAGE_OCR_PROMPT = [
  'You are a document OCR engine for student exam answers.',
  'Transcribe every readable answer, label, formula, table, code snippet, and handwritten note from the attached image.',
  'Preserve the original language and line breaks as much as possible.',
  'Do not grade, summarize, or add explanations.',
  'If the image is unreadable, say: [UNREADABLE IMAGE].',
].join('\n');

function getMimeType(fileName: string) {
  const ext = getExtension(fileName);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  return 'application/octet-stream';
}

async function runOpenAiImageOcr(input: DocumentIntakeInput): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const config = input.llmConfig!;
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || 'https://api.openai.com/v1',
  });

  const response = await client.chat.completions.create({
    model: config.model || 'gpt-5.5',
    messages: [
      { role: 'system', content: IMAGE_OCR_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'OCR this image. Return only the transcription.' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${getMimeType(input.fileName)};base64,${input.buffer.toString('base64')}`,
            },
          },
        ],
      } as any,
    ],
    temperature: 0,
    max_completion_tokens: 4000,
  });

  return String(response.choices[0]?.message?.content || '').trim();
}

async function runGeminiImageOcr(input: DocumentIntakeInput): Promise<string> {
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
  let model = (config.model || '').trim() || 'gemini-1.5-flash';
  if (model.startsWith('models/')) model = model.replace(/^models\//, '');

  const response = await fetch(
    `${geminiBase}/${apiVersion}/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey || '')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${IMAGE_OCR_PROMPT}\n\nOCR this image. Return only the transcription.` },
              {
                inlineData: {
                  mimeType: getMimeType(input.fileName),
                  data: input.buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini image OCR failed: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
  }

  const data = await response.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

export async function extractImage(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const warnings: string[] = [];
  let content = '';
  let strategy = 'image.unread';

  if (!input.llmConfig?.apiKey) {
    warnings.push('Image OCR skipped: no active LLM API key was provided.');
  } else {
    try {
      const provider = String(input.llmConfig.provider || 'openai').toLowerCase();
      if (provider === 'gemini') {
        content = await runGeminiImageOcr(input);
      } else {
        content = await runOpenAiImageOcr(input);
      }
      strategy = 'image.llm-ocr';
    } catch (error: any) {
      warnings.push(`Image OCR failed: ${error?.message || error}`);
    }
  }

  const finalContent = content.trim()
    ? `[IMAGE OCR: ${input.fileName}]\n${content.trim()}`
    : `[IMAGE: ${input.fileName}]\n[WARNING: Image content could not be read. Teacher review is required.]`;

  return {
    fileName: input.fileName,
    fileType: getExtension(input.fileName),
    intent: input.intent || 'generic',
    strategy,
    content: finalContent,
    pages: [{ pageNumber: 1, text: finalContent, textLen: finalContent.length }],
    warnings,
    metadata: {
      mimeType: getMimeType(input.fileName),
      ocr: strategy === 'image.llm-ocr',
      needsReview: strategy !== 'image.llm-ocr' || /\[UNREADABLE IMAGE\]/i.test(content),
      skillWorkflow: ['LLM image OCR', 'teacher review fallback'],
    },
  };
}
