import JSZip from 'jszip';
import mammoth from 'mammoth';
import { DocumentIntakeInput, DocumentIntakeResult } from './types';
import { extractTextFromXml, runCommand, withTempFile } from './office-tools';

async function extractWithPandoc(buffer: Buffer) {
  return withTempFile('docx', buffer, async (filePath) => {
    const result = await runCommand('pandoc', ['--track-changes=all', filePath, '-t', 'markdown', '-o', '-'], 45000);
    return result.ok && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
  });
}

async function inspectDocxXml(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  const relFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/_rels/'));
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);

  const trackedInsertions = documentXml ? (documentXml.match(/<w:ins\b/g) || []).length : 0;
  const trackedDeletions = documentXml ? (documentXml.match(/<w:del\b/g) || []).length : 0;
  const comments = commentsXml ? (commentsXml.match(/<w:comment\b/g) || []).length : 0;
  const headings = documentXml
    ? Array.from(documentXml.matchAll(/<w:pStyle[^>]+w:val="([^"]+)"/g)).map((match) => match[1])
    : [];

  return {
    documentText: documentXml ? extractTextFromXml(documentXml) : '',
    commentsText: commentsXml ? extractTextFromXml(commentsXml) : '',
    comments,
    trackedInsertions,
    trackedDeletions,
    mediaFiles,
    relFiles,
    headings,
  };
}

export async function extractDocx(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const warnings: string[] = [];
  const xmlInfo = await inspectDocxXml(input.buffer).catch((error: any) => {
    warnings.push(`OOXML inspection failed: ${error?.message || error}`);
    return null;
  });

  let content = '';
  let strategy = '';

  try {
    const pandocText = await extractWithPandoc(input.buffer);
    if (pandocText) {
      content = pandocText;
      strategy = 'docx.pandoc.markdown.track-changes';
    }
  } catch (error: any) {
    warnings.push(`pandoc unavailable or failed: ${error?.message || error}`);
  }

  if (!content.trim()) {
    try {
      const docxResult = await mammoth.extractRawText({ buffer: input.buffer });
      content = docxResult.value || '';
      strategy = 'docx.mammoth.raw-text';
      if (docxResult.messages?.length) {
        warnings.push(...docxResult.messages.map((message: any) => String(message?.message || message)));
      }
    } catch (error: any) {
      warnings.push(`mammoth failed: ${error?.message || error}`);
    }
  }

  if (!content.trim() && xmlInfo?.documentText) {
    content = xmlInfo.documentText;
    strategy = 'docx.ooxml.text-fallback';
  }

  const contextAddons: string[] = [];
  if (xmlInfo?.commentsText) {
    contextAddons.push(`\n\n[DOCX COMMENTS]\n${xmlInfo.commentsText}`);
  }
  if ((xmlInfo?.mediaFiles?.length || 0) > 0) {
    contextAddons.push(`\n\n[DOCX MEDIA]\n${xmlInfo!.mediaFiles.join('\n')}`);
  }
  if ((xmlInfo?.trackedInsertions || 0) > 0 || (xmlInfo?.trackedDeletions || 0) > 0) {
    contextAddons.push(
      `\n\n[DOCX TRACKED CHANGES]\nInsertions: ${xmlInfo?.trackedInsertions || 0}\nDeletions: ${xmlInfo?.trackedDeletions || 0}`
    );
  }

  const finalContent = `${content.trim()}${contextAddons.join('')}`.trim();

  return {
    fileName: input.fileName,
    fileType: 'docx',
    intent: input.intent || 'generic',
    strategy: strategy || 'docx.empty',
    content: finalContent,
    pages: finalContent ? [{ pageNumber: 1, text: finalContent, textLen: finalContent.length }] : [],
    warnings,
    metadata: {
      comments: xmlInfo?.comments || 0,
      trackedInsertions: xmlInfo?.trackedInsertions || 0,
      trackedDeletions: xmlInfo?.trackedDeletions || 0,
      mediaFiles: xmlInfo?.mediaFiles || [],
      headings: xmlInfo?.headings || [],
      skillWorkflow: ['pandoc markdown with tracked changes', 'OOXML inspection', 'mammoth fallback'],
    },
  };
}

