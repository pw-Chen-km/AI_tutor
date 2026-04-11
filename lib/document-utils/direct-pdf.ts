import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
}

export function parseSelectedPages(selectedPages?: string): number[] {
  if (!selectedPages || !selectedPages.trim()) return [];

  const pages: number[] = [];
  for (const part of selectedPages.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [startText, endText] = part.split('-').map((item) => item.trim());
      const start = Number.parseInt(startText, 10);
      const end = Number.parseInt(endText, 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        for (let page = start; page <= end; page++) {
          pages.push(page);
        }
      }
      continue;
    }

    const page = Number.parseInt(part, 10);
    if (Number.isFinite(page) && page > 0) {
      pages.push(page);
    }
  }

  return uniqueNumbers(pages);
}

export async function extractPdfSelectedPagesBase64(params: {
  pdfBase64: string;
  filename: string;
  selectedPages?: string;
}): Promise<{ pdfBase64: string; filename: string } | null> {
  const { pdfBase64, filename, selectedPages } = params;
  const pageNumbers = parseSelectedPages(selectedPages);
  if (!pdfBase64 || pageNumbers.length === 0) return null;

  const sourceDoc = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
  const pageCount = sourceDoc.getPageCount();
  const pageIndexes = uniqueNumbers(pageNumbers)
    .filter((page) => page <= pageCount)
    .map((page) => page - 1);

  if (pageIndexes.length === 0) return null;

  const outputDoc = await PDFDocument.create();
  const copiedPages = await outputDoc.copyPages(sourceDoc, pageIndexes);
  copiedPages.forEach((page) => outputDoc.addPage(page));

  const outputBytes = await outputDoc.save();
  const firstPage = pageIndexes[0] + 1;
  const lastPage = pageIndexes[pageIndexes.length - 1] + 1;
  const baseName = filename.replace(/\.pdf$/i, '');
  const outputName = firstPage === lastPage
    ? `${baseName}-p${firstPage}.pdf`
    : `${baseName}-p${firstPage}-${lastPage}.pdf`;

  return {
    pdfBase64: Buffer.from(outputBytes).toString('base64'),
    filename: outputName,
  };
}

function escapePowerShellString(value: string) {
  return value.replace(/'/g, "''");
}

export async function convertPptxBase64ToPdfBase64(params: {
  pptxBase64: string;
  filename: string;
}): Promise<{ pdfBase64: string; filename: string } | null> {
  const { pptxBase64, filename } = params;
  if (!pptxBase64) return null;
  if (process.platform !== 'win32') return null;

  const baseName = filename.replace(/\.pptx$/i, '');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-pptx-pdf-'));
  const inputPath = path.join(tempDir, `${baseName || 'slides'}.pptx`);
  const outputPath = path.join(tempDir, `${baseName || 'slides'}.pdf`);

  try {
    await fs.writeFile(inputPath, Buffer.from(pptxBase64, 'base64'));

    const escapedInput = escapePowerShellString(inputPath);
    const escapedOutput = escapePowerShellString(outputPath);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$ppt = $null',
      '$presentation = $null',
      'try {',
      '  $ppt = New-Object -ComObject PowerPoint.Application',
      '  $ppt.Visible = 1',
      `  $presentation = $ppt.Presentations.Open('${escapedInput}', $false, $false, $false)`,
      `  $presentation.SaveAs('${escapedOutput}', 32)`,
      '  $presentation.Close()',
      '  $presentation = $null',
      '  $ppt.Quit()',
      '  $ppt = $null',
      '} catch {',
      '  if ($presentation -ne $null) { $presentation.Close() }',
      '  if ($ppt -ne $null) { $ppt.Quit() }',
      '  throw',
      '}',
    ].join('; ');

    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const pdfBuffer = await fs.readFile(outputPath);
    return {
      pdfBase64: pdfBuffer.toString('base64'),
      filename: `${baseName || 'slides'}.pdf`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
