import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractPptx } from './pptx';
import { DocumentIntakeInput, DocumentIntakeIntent, DocumentIntakeResult } from './types';
import { getExtension } from './office-tools';
import { extractXlsx } from './xlsx';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'tsv',
  'xml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'cpp',
  'c',
  'h',
]);

function buildTextResult(input: DocumentIntakeInput, fileType: string): DocumentIntakeResult {
  const content = input.buffer.toString('utf-8');
  return {
    fileName: input.fileName,
    fileType,
    intent: input.intent || 'generic',
    strategy: `${fileType}.utf8-text`,
    content,
    pages: content ? [{ pageNumber: 1, text: content, textLen: content.length }] : [],
    warnings: [],
    metadata: { skillWorkflow: ['direct UTF-8 text read'] },
  };
}

export async function intakeDocument(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const fileType = getExtension(input.fileName);

  if (fileType === 'pdf') return extractPdf(input);
  if (fileType === 'docx') return extractDocx(input);
  if (fileType === 'pptx') return extractPptx(input);
  if (fileType === 'xlsx' || fileType === 'xls') return extractXlsx(input);
  if (TEXT_EXTENSIONS.has(fileType)) return buildTextResult(input, fileType);

  throw new Error(`Unsupported file type: ${fileType || 'unknown'}`);
}

export function inferIntakeIntent(moduleType?: string): DocumentIntakeIntent {
  if (moduleType === 'lecture_rehearsal') return 'read_for_script_generation';
  if (moduleType === 'exam_evaluation') return 'evaluate_student_answer';
  if (moduleType === 'drills' || moduleType === 'labs' || moduleType === 'homework' || moduleType === 'exams') {
    return 'read_for_question_generation';
  }
  return 'generic';
}

export type { DocumentIntakeInput, DocumentIntakeIntent, DocumentIntakeResult, DocumentPage } from './types';

