import * as XLSX from 'xlsx';
import { DocumentIntakeInput, DocumentIntakeResult } from './types';

export async function extractXlsx(input: DocumentIntakeInput): Promise<DocumentIntakeResult> {
  const workbook = XLSX.read(input.buffer);
  const pages = workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const text = XLSX.utils.sheet_to_txt(sheet);
    return {
      pageNumber: index + 1,
      text: `Sheet: ${name}\n${text}`,
      textLen: text.length,
      features: {
        sheetName: name,
        range: sheet['!ref'] || '',
      },
    };
  });

  return {
    fileName: input.fileName,
    fileType: 'xlsx',
    intent: input.intent || 'generic',
    strategy: 'xlsx.sheet_to_txt',
    content: pages.map((page) => page.text).join('\n\n').trim(),
    pages,
    warnings: [],
    metadata: {
      sheetNames: workbook.SheetNames,
      skillWorkflow: ['sheet text extraction', 'future pandas/openpyxl profiling for formulas and formatting'],
    },
  };
}

