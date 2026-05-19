import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export function decodeXmlEntities(input: string) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanXmlText(input: string) {
  return input
    // Some Office generators escape OOXML fragments into text nodes.
    .replace(/<\/?[a-zA-Z][\w.-]*(?::[\w.-]+)?\b[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTextFromXml(xml: string) {
  const parts: string[] = [];
  const re = /<[^:>]+:t[^>]*>([\s\S]*?)<\/[^:>]+:t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const text = cleanXmlText(decodeXmlEntities(match[1] || ''));
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

export function normalizePageTextToContent(pages: Array<{ pageNumber: number; text: string }>) {
  return pages
    .map((page) => `[PAGE: ${page.pageNumber}]\n${page.text || ''}`.trimEnd())
    .join('\n\n')
    .trim();
}

export function splitTextIntoPages(text: string) {
  const chunks = text
    .split(/\f/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return text.trim()
      ? [{ pageNumber: 1, text: text.trim(), textLen: text.trim().length }]
      : [];
  }

  return chunks.map((chunk, index) => ({
    pageNumber: index + 1,
    text: chunk,
    textLen: chunk.length,
  }));
}

export async function runCommand(command: string, args: string[], timeoutMs = 30000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, stdout, stderr: stderr || `${command} timed out`, exitCode: null });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message, exitCode: null });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

export async function withTempFile<T>(
  extension: string,
  buffer: Buffer,
  fn: (filePath: string, dirPath: string) => Promise<T>
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-tutor-intake-'));
  const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const filePath = path.join(dir, `input${safeExtension}`);

  try {
    await writeFile(filePath, buffer);
    return await fn(filePath, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

