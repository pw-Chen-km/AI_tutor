/**
 * Exam Export Module - Main Exporter
 * 考試卷輸出模組 - 主導出函數
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, PageBreak, BorderStyle, PageOrientation,
  HeightRule, ITableCellBorders, ImageRun,
} from 'docx';
import {
  ExamExportConfig, HeaderLayout, HeaderItem, ExamContent,
  Question, ExamSection, MCQQuestion, ShortQuestion, ProgrammingQuestion,
  TrueFalseQuestion, DebuggingQuestion, StudentInfo, LegacyExportItem, ConvertToExamOptions,
} from './types';
import { EXAM_STYLES, PAGE_SIZES, DEFAULT_MARGINS, FONTS, FONT_SIZES, SPACING, BORDERS, ptToHalfPt, cmToTwip } from './styles';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================
// Utility Functions
// ============================================

/**
 * Clean markdown formatting from text for Word export
 * IMPORTANT: Order matters! Code blocks must be handled before inline code
 */
function cleanMarkdownText(text: string): string {
  if (!text) return '';

  return text
    // FIRST: Remove code blocks (must be before inline code to avoid partial matches)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove markdown bold **text**
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // Remove markdown italic *text*
    .replace(/\*([^*]+)\*/g, '$1')
    // Remove inline code `text` (after code blocks are handled)
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown bullets completely (don't convert to • or ■)
    .replace(/^[-*■•▪]\s+/gm, '')
    // Remove extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract code content from markdown, preserving formatting
 * Use this for solutions that contain code blocks
 */
function extractCodeFromMarkdown(text: string): string {
  if (!text) return '';

  // Check if text contains code blocks
  const codeBlockMatch = text.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    // Return the code content, preserving newlines
    return codeBlockMatch[1].trim();
  }

  // No code block found, return cleaned text
  return cleanMarkdownText(text);
}

/**
 * Format question text with proper structure
 * Extracts description and requirements from markdown-formatted text
 */
function formatQuestionText(text: string): { description: string; requirements: string[] } {
  const cleaned = cleanMarkdownText(text);
  
  // Try to extract requirements section
  const requirementsMatch = cleaned.match(/(?:Requirements?|Constraints?)[:\s]*\n?([\s\S]*?)(?:\n\n|$)/i);
  let requirements: string[] = [];
  let description = cleaned;
  
  if (requirementsMatch) {
    const reqSection = requirementsMatch[1];
    requirements = reqSection
      .split(/\n/)
      .map(line => line.replace(/^[•\-*]\s*/, '').trim())
      .filter(line => line.length > 0);
    description = cleaned.replace(requirementsMatch[0], '').trim();
  }
  
  // Remove "Description" label if present
  description = description.replace(/^Description[:\s]*/i, '').trim();
  
  return { description, requirements };
}

// ============================================
// Main Export Function
// ============================================

export async function exportExamDocx(config: ExamExportConfig): Promise<Buffer> {
  const { headerLayout, examContent, studentInfo, includeSolutions, institutionLogoBase64 } = config;
  
  const children: (Paragraph | Table)[] = [];
  
  // 1. Render Header (pass logo if available)
  children.push(...renderHeader(headerLayout, examContent.metadata, studentInfo, institutionLogoBase64));
  
  // 2. Render Instructions Box
  if (examContent.instructions && examContent.instructions.length > 0) {
    children.push(...renderInstructionsBox(examContent.instructions));
  }
  
  // 3. Render Sections (pass includeSolutions flag)
  for (const section of examContent.sections) {
    children.push(...renderSection(section, includeSolutions));
  }
  
  // Get page size
  const pageSize = headerLayout.page.size === 'Letter' ? PAGE_SIZES.Letter : PAGE_SIZES.A4;
  const marginCm = headerLayout.page.marginCm || 2.5;
  const margins = {
    top: cmToTwip(marginCm),
    bottom: cmToTwip(marginCm),
    left: cmToTwip(marginCm),
    right: cmToTwip(marginCm),
  };
  
  // Create Document
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: pageSize.width,
            height: pageSize.height,
            orientation: PageOrientation.PORTRAIT,
          },
          margin: margins,
        },
      },
      children,
    }],
  });
  
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

// ============================================
// Header Rendering
// ============================================

function renderHeader(
  layout: HeaderLayout,
  metadata: ExamContent['metadata'],
  studentInfo?: StudentInfo,
  institutionLogoBase64?: string
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  const items = layout.header.items;
  
  if (items.length === 0) {
    // If no custom header items, create default header from metadata
    return renderDefaultHeader(metadata, studentInfo, institutionLogoBase64);
  }
  
  // If logo is provided, insert it first (before custom header items)
  console.log('[renderHeader] Checking logo:', {
    hasLogo: !!institutionLogoBase64,
    logoLength: institutionLogoBase64?.length || 0
  });
  
  if (institutionLogoBase64 && institutionLogoBase64.length > 50) {
    try {
      let cleanBase64 = institutionLogoBase64.trim();
      if (cleanBase64.startsWith('data:')) {
        const commaIndex = cleanBase64.indexOf(',');
        if (commaIndex !== -1) {
          cleanBase64 = cleanBase64.substring(commaIndex + 1);
        }
      }
      cleanBase64 = cleanBase64.replace(/\s+/g, '');
      
      const imageBuffer = Buffer.from(cleanBase64, 'base64');
      console.log('[renderHeader] Logo buffer created:', imageBuffer.length, 'bytes');
      
      if (imageBuffer.length > 100) {
        // A4 width: 21cm, margins: 2.5cm each side = 16cm content width
        // 16cm = ~604 pixels at 96 DPI
        // Use proper ImageRun constructor with all required properties
        try {
          const imageRun = new ImageRun({
            data: imageBuffer,
            transformation: {
              width: 604,  // Full content width (對齊兩邊)
              height: 70,  // Maintain reasonable height
            },
            type: 'png', // Try to detect or default to png
          });
          
          result.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [imageRun],
            spacing: { after: 200 },
          }));
          console.log('[renderHeader] ✓ Logo inserted successfully (full width: 604px)');
        } catch (imgError: any) {
          console.error('[renderHeader] ImageRun creation failed:', imgError.message);
          // Fallback: try without type specification
          try {
            const imageRun = new ImageRun({
              data: imageBuffer,
              transformation: {
                width: 604,
                height: 70,
              },
            } as any);
            
            result.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [imageRun],
              spacing: { after: 200 },
            }));
            console.log('[renderHeader] ✓ Logo inserted (fallback method)');
          } catch (fallbackError: any) {
            console.error('[renderHeader] Fallback also failed:', fallbackError.message);
            throw fallbackError;
          }
        }
      }
    } catch (e: any) {
      console.error('[renderHeader] ✗ Failed to insert logo:', e.message);
    }
  } else {
    console.log('[renderHeader] No logo to insert');
  }
  
  // Filter out institution item if logo is provided
  const filteredItems = institutionLogoBase64 && institutionLogoBase64.length > 50
    ? items.filter(item => !(item.type === 'text' && item.value?.includes('{{institution}}')))
    : items;
  
  console.log('[renderHeader] Filtered items:', {
    original: items.length,
    filtered: filteredItems.length,
    removed: items.length - filteredItems.length
  });
  
  const maxRow = Math.max(...filteredItems.map(i => i.row));
  
  // Group items by row
  const rowMap = new Map<number, HeaderItem[]>();
  for (const item of filteredItems) {
    if (!rowMap.has(item.row)) rowMap.set(item.row, []);
    rowMap.get(item.row)!.push(item);
  }
  
  // Calculate column width (12-column grid)
  const pageWidth = layout.page.size === 'Letter' ? PAGE_SIZES.Letter.width : PAGE_SIZES.A4.width;
  const marginCm = layout.page.marginCm || 2.5;
  const contentWidth = pageWidth - cmToTwip(marginCm * 2);
  const colWidth = Math.floor(contentWidth / 12);
  
  const tableRows: TableRow[] = [];
  
  for (let row = 1; row <= maxRow; row++) {
    const rowItems = rowMap.get(row) || [];
    if (rowItems.length === 0) continue;
    
    // Sort by column position
    rowItems.sort((a, b) => a.col - b.col);
    
    const cells: TableCell[] = [];
    let currentCol = 1;
    
    for (const item of rowItems) {
      // Add empty cells before this item
      while (currentCol < item.col) {
        cells.push(createEmptyCell(colWidth));
        currentCol++;
      }
      
      // Render item
      const cellContent = renderHeaderItem(item, metadata, studentInfo);
      const cellBorders: ITableCellBorders = item.type === 'divider' 
        ? BORDERS.bottomOnly as ITableCellBorders
        : BORDERS.none as ITableCellBorders;
      
      cells.push(new TableCell({
        children: cellContent,
        width: { size: colWidth * item.colSpan, type: WidthType.DXA },
        columnSpan: item.colSpan,
        borders: cellBorders,
      }));
      currentCol = item.col + item.colSpan;
    }
    
    // Fill remaining columns
    while (currentCol <= 12) {
      cells.push(createEmptyCell(colWidth));
      currentCol++;
    }
    
    tableRows.push(new TableRow({ children: cells }));
  }
  
  if (tableRows.length > 0) {
    result.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }
  
  // Add spacing after header
  result.push(new Paragraph({ children: [], spacing: { after: SPACING.afterSection } }));
  
  return result;
}

function createEmptyCell(width: number): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })] })],
    width: { size: width, type: WidthType.DXA },
    borders: BORDERS.none as ITableCellBorders,
  });
}

function renderDefaultHeader(
  metadata: ExamContent['metadata'],
  studentInfo?: StudentInfo,
  institutionLogoBase64?: string
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Institution - Logo or Text
  console.log('[Logo] renderDefaultHeader called with logo:', {
    hasLogo: !!institutionLogoBase64,
    logoLength: institutionLogoBase64?.length || 0,
    metadata: metadata.institution
  });
  
  if (institutionLogoBase64 && institutionLogoBase64.length > 50) {
    // Use logo image
    try {
      // Clean base64 data
      let cleanBase64 = institutionLogoBase64.trim();
      
      // Remove data URL prefix if present
      if (cleanBase64.startsWith('data:')) {
        const commaIndex = cleanBase64.indexOf(',');
        if (commaIndex !== -1) {
          cleanBase64 = cleanBase64.substring(commaIndex + 1);
        }
      }
      
      // Remove any whitespace
      cleanBase64 = cleanBase64.replace(/\s+/g, '');
      
      console.log('[Logo] Step 1 - Cleaned base64:', {
        originalLength: institutionLogoBase64.length,
        cleanedLength: cleanBase64.length,
        first50: cleanBase64.substring(0, 50)
      });
      
      const imageBuffer = Buffer.from(cleanBase64, 'base64');
      console.log('[Logo] Step 2 - Buffer created:', imageBuffer.length, 'bytes');
      
      if (imageBuffer.length < 100) {
        throw new Error(`Image buffer too small: ${imageBuffer.length} bytes`);
      }
      
      // Direct approach - use buffer directly (no temp file)
      console.log('[Logo] Step 3 - Creating ImageRun directly from buffer');
      
      try {
        const imageRun = new ImageRun({
          data: imageBuffer,
          transformation: {
            width: 604,  // Full content width (對齊兩邊)
            height: 70,
          },
          type: 'png', // Default to png, docx will handle other formats
        });
        
        result.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [imageRun],
          spacing: { after: 200 },
        }));
        
        console.log('[Logo] ✓✓✓ SUCCESS - ImageRun inserted successfully (full width: 604px)');
      } catch (imgError: any) {
        console.error('[Logo] ImageRun creation failed:', imgError.message);
        // Fallback: try without type
        try {
          const imageRun = new ImageRun({
            data: imageBuffer,
            transformation: {
              width: 604,
              height: 70,
            },
          } as any);
          
          result.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [imageRun],
            spacing: { after: 200 },
          }));
          console.log('[Logo] ✓✓✓ SUCCESS (fallback method)');
        } catch (fallbackError: any) {
          throw fallbackError;
        }
      }
    } catch (e: any) {
      console.error('[Logo] ✗✗✗ FAILED to insert logo');
      console.error('[Logo] Error message:', e.message);
      console.error('[Logo] Error stack:', e.stack);
      
      // Fallback to text
      console.log('[Logo] Falling back to text display');
      result.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: metadata.institution || 'University',
          font: FONTS.default,
          size: 36,
          bold: true,
        })],
        spacing: { after: 80 },
      }));
    }
  } else {
    // No logo provided
    console.log('[Logo] ⚠️ No logo - using text. Reason:', 
      !institutionLogoBase64 ? 'institutionLogoBase64 is null/undefined' : 
      `institutionLogoBase64 length (${institutionLogoBase64.length}) <= 50`
    );
    result.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: metadata.institution || 'University',
        font: FONTS.default,
        size: 36, // 18pt
        bold: true,
      })],
      spacing: { after: 80 },
    }));
  }
  
  // Course - Medium, Bold, Centered
  result.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: metadata.course || 'Course Name',
      font: FONTS.default,
      size: 32, // 16pt
      bold: true,
    })],
    spacing: { after: 60 },
  }));
  
  // Exam type - Normal, Centered
  result.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: metadata.examType || 'Examination',
      font: FONTS.default,
      size: 26, // 13pt
    })],
    spacing: { after: 40 },
  }));
  
  // Duration and Total Marks - Smaller, Italic
  result.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `Duration: ${metadata.durationMinutes || 120} minutes  |  Total Marks: ${metadata.totalMarks || 100}`,
      font: FONTS.default,
      size: 22, // 11pt
      italics: true,
    })],
    spacing: { after: 200 },
  }));
  
  // Horizontal line using a bordered table
  result.push(new Table({
    rows: [new TableRow({
      children: [new TableCell({
        children: [new Paragraph({ children: [] })],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
          bottom: { style: BorderStyle.NIL },
          left: { style: BorderStyle.NIL },
          right: { style: BorderStyle.NIL },
        },
      })],
    })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));
  
  result.push(new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })], spacing: { after: 150 } }));
  
  // Student info in a single line - 8pt font (size: 16 = 8pt in half-points)
  // Note: docx uses half-point units, so size:16 = 8pt, size:20 = 10pt
  const fontSize = 12; // 8pt (您手動改成8會變成4pt，太小了)
  
  result.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [
      new TextRun({ text: 'Student ID:', font: FONTS.default, size: fontSize }),
      new TextRun({ text: '________________', font: FONTS.default, size: fontSize }),
      new TextRun({ text: '        Name:', font: FONTS.default, size: fontSize }),
      new TextRun({ text: '________________________', font: FONTS.default, size: fontSize }),
      new TextRun({ text: '        Class:', font: FONTS.default, size: fontSize }),
      new TextRun({ text: '________________', font: FONTS.default, size: fontSize }),
    ],
    spacing: { before: 0, after: 200 },
  }));
  
  return result;
}

function renderHeaderItem(
  item: HeaderItem,
  metadata: ExamContent['metadata'],
  studentInfo?: StudentInfo
): Paragraph[] {
  const style = item.style || { fontSize: 12, bold: false, underline: false };
  const alignment = item.align === 'center' ? AlignmentType.CENTER 
    : item.align === 'right' ? AlignmentType.RIGHT 
    : AlignmentType.LEFT;
  
  if (item.type === 'divider') {
    return [new Paragraph({ children: [], spacing: { before: 100, after: 100 } })];
  }
  
  if (item.type === 'text') {
    // Replace placeholders with metadata
    let text = item.value || '';
    text = text.replace(/\{\{course\}\}/g, metadata.course || '');
    text = text.replace(/\{\{institution\}\}/g, metadata.institution || '');
    text = text.replace(/\{\{examType\}\}/g, metadata.examType || '');
    text = text.replace(/\{\{duration\}\}/g, String(metadata.durationMinutes || 120));
    text = text.replace(/\{\{totalMarks\}\}/g, String(metadata.totalMarks || 100));
    
    return [new Paragraph({
      alignment,
      children: [new TextRun({
        text,
        font: FONTS.default,
        size: ptToHalfPt(style.fontSize),
        bold: style.bold,
        underline: style.underline ? {} : undefined,
        italics: style.italic,
      })],
    })];
  }
  
  if (item.type === 'field') {
    const value = studentInfo?.[item.bindKey || ''] || item.placeholder || '______________';
    return [new Paragraph({
      alignment,
      children: [
        new TextRun({
          text: item.label || '',
          font: FONTS.default,
          size: ptToHalfPt(style.fontSize),
          bold: style.bold,
        }),
        new TextRun({
          text: value,
          font: FONTS.default,
          size: ptToHalfPt(style.fontSize),
          underline: {},
        }),
      ],
    })];
  }
  
  return [];
}

// ============================================
// Instructions Box Rendering
// ============================================

function renderInstructionsBox(_instructions: string[]): (Paragraph | Table)[] {
  // Fixed instructions as per user requirement
  const fixedInstructions = [
    'All questions must be answered.',
    'All responses must be written clearly and legibly.',
    'All necessary steps, calculations, and reasoning must be shown in order to be eligible for partial credit.',
    'The possession or use of any electronic devices is strictly prohibited for the duration of the examination.',
  ];
  
  // Build instruction paragraphs with numbering
  const instructionParagraphs = fixedInstructions.map((inst, idx) => {
    return new Paragraph({
      indent: { left: 360 },
      children: [new TextRun({
        text: `${idx + 1}. ${inst}`,
        font: FONTS.default,
        size: 22, // 11pt
      })],
      spacing: { after: 100 },
    });
  });
  
  // Create a single cell with all instructions
  const contentCell = new TableCell({
    children: [
      // Header
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: 'INSTRUCTIONS',
          font: FONTS.default,
          size: 24, // 12pt
          bold: true,
        })],
        spacing: { after: 150 },
      }),
      // Instructions
      ...instructionParagraphs,
    ],
    borders: {
      top: { style: BorderStyle.DOUBLE, size: 6, color: '000000' },
      bottom: { style: BorderStyle.DOUBLE, size: 6, color: '000000' },
      left: { style: BorderStyle.DOUBLE, size: 6, color: '000000' },
      right: { style: BorderStyle.DOUBLE, size: 6, color: '000000' },
    },
    margins: {
      top: 150,
      bottom: 150,
      left: 200,
      right: 200,
    },
  });
  
  return [
    new Table({
      rows: [new TableRow({ children: [contentCell] })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
    new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })], spacing: { after: 400 } }),
  ];
}

// ============================================
// Section Rendering
// ============================================

function renderSection(section: ExamSection, includeSolutions?: boolean): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Page break if needed (but no section title - per user request)
  if (section.pageBreakBefore) {
    result.push(new Paragraph({ children: [new PageBreak()] }));
  }
  
  // No section title - questions start directly
  
  // Render questions (pass includeSolutions flag)
  for (const q of section.questions) {
    result.push(...renderQuestion(q, includeSolutions));
  }
  
  return result;
}

// ============================================
// Question Rendering
// ============================================

function buildMetadataLine(q: Question): Paragraph | null {
  const parts: TextRun[] = [];
  const addSep = () => {
    if (parts.length > 0) {
      parts.push(new TextRun({ text: '  |  ', font: FONTS.default, size: FONT_SIZES.small, color: '999999' }));
    }
  };

  if (q.originalType) {
    addSep();
    parts.push(new TextRun({ text: `Type: ${q.originalType}`, font: FONTS.default, size: FONT_SIZES.small, color: '555555', italics: true }));
  }

  addSep();
  parts.push(new TextRun({ text: `Worth: ${q.marks} pts`, font: FONTS.default, size: FONT_SIZES.small, color: '555555', italics: true }));

  if (q.sources && q.sources.length > 0) {
    const srcText = q.sources.map(s => s.pages ? `${s.file} (p. ${s.pages})` : s.file).join('; ');
    addSep();
    parts.push(new TextRun({ text: `Source: ${srcText}`, font: FONTS.default, size: FONT_SIZES.small, color: '555555', italics: true }));
  }

  if (parts.length === 0) return null;

  return new Paragraph({
    indent: { left: 360 },
    children: parts,
    spacing: { after: 120 },
  });
}

function renderQuestion(q: Question, includeSolutions?: boolean): (Paragraph | Table)[] {
  // Get the solution from extended question if available
  const solution = (q as any).solution as string | undefined;
  const hasSolution = includeSolutions && solution;
  
  let result: (Paragraph | Table)[];
  
  switch (q.type) {
    case 'mcq':
      result = renderMCQ(q as MCQQuestion, hasSolution ? solution : undefined);
      break;
    case 'short':
      result = renderShortAnswer(q as ShortQuestion, hasSolution ? solution : undefined);
      break;
    case 'programming':
    case 'coding':
      result = renderProgramming(q as ProgrammingQuestion, hasSolution ? solution : undefined);
      break;
    case 'truefalse':
      result = renderTrueFalse(q as TrueFalseQuestion, hasSolution ? solution : undefined);
      break;
    case 'debugging':
      result = renderDebugging(q as DebuggingQuestion, hasSolution ? solution : undefined);
      break;
    default:
      // Fallback to short answer style
      result = renderShortAnswer(Object.assign({}, q, { 
        type: 'short', 
        prompt: (q as any)?.prompt || (q as any)?.stem || '', 
        answerLines: 4 
      }) as ShortQuestion, hasSolution ? solution : undefined);
  }

  const meta = buildMetadataLine(q);
  if (meta && result.length > 0) {
    result.splice(1, 0, meta);
  }
  
  return result;
}

function renderMCQ(q: MCQQuestion, solution?: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Clean the question stem
  const cleanedStem = cleanMarkdownText(q.stem);
  
  // Question number and stem - entire question in bold
  result.push(new Paragraph({
    children: [
      new TextRun({
        text: `${q.number}. ${cleanedStem}`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      }),
      new TextRun({
        text: ` (${q.marks} marks)`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        italics: true,
      }),
    ],
    spacing: { after: 150 },
    keepNext: true, // Keep with choices
    keepLines: true,
  }));
  
  // Choices with proper formatting
  for (let i = 0; i < q.choices.length; i++) {
    const choice = q.choices[i];
    const isLast = i === q.choices.length - 1;
    result.push(new Paragraph({
      indent: { left: 720 },  // 0.5 inch indent
      children: [
        new TextRun({
          text: `${choice.key}. `,
          font: FONTS.default,
          size: FONT_SIZES.normal,
          bold: true,
        }),
        new TextRun({
          text: cleanMarkdownText(choice.text),
          font: FONTS.default,
          size: FONT_SIZES.normal,
        }),
      ],
      spacing: { after: 100 },
      keepNext: !isLast || !!solution, // Keep all choices together
      keepLines: true,
    }));
  }
  
  // If solution is provided, show answer
  if (solution) {
    result.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Answer: ',
          font: FONTS.default,
          size: FONT_SIZES.normal,
          bold: true,
          color: '006400',
        }),
        new TextRun({
          text: cleanMarkdownText(solution),
          font: FONTS.default,
          size: FONT_SIZES.normal,
          color: '006400',
        }),
      ],
      spacing: { before: 100, after: 100 },
    }));
  }
  
  result.push(new Paragraph({ children: [], spacing: { after: SPACING.afterQuestion } }));
  
  return result;
}

function renderShortAnswer(q: ShortQuestion, solution?: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Parse and clean the question text
  const { description, requirements } = formatQuestionText(q.prompt);
  
  // Question number and description - entire question in bold
  // Use keepNext to keep with answer lines
  result.push(new Paragraph({
    children: [
      new TextRun({
        text: `${q.number}. ${description}`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      }),
      new TextRun({
        text: ` (${q.marks} marks)`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        italics: true,
      }),
    ],
    spacing: { after: 120 },
    keepNext: true, // Keep with next paragraph (answer lines)
    keepLines: true, // Don't break this paragraph across pages
  }));
  
  // Requirements list if present - no indent for "Requirements:", items also no indent
  if (requirements.length > 0) {
    result.push(new Paragraph({
      indent: { left: 0 }, // Explicitly no indent
      children: [new TextRun({
        text: 'Requirements:',
        font: FONTS.default,
        size: FONT_SIZES.small,
        italics: true, // Only italic, not bold
      })],
      spacing: { after: 40 },
      keepNext: true,
      keepLines: true,
    }));
    
    for (let i = 0; i < requirements.length; i++) {
      result.push(new Paragraph({
        indent: { left: 0 }, // Explicitly set to 0 - no indent at all
        children: [new TextRun({
          text: `- ${requirements[i]}`,
          font: FONTS.default,
          size: FONT_SIZES.small,
        })],
        spacing: { after: 30 },
        keepNext: true,
        keepLines: true,
      }));
    }
  }
  
  // If solution is provided, render it instead of blank lines
  if (solution) {
    // Check if solution contains code block
    const hasCodeBlock = /```[\w]*\n?[\s\S]*?```/.test(solution);

    // Solution label
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Answer:',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
        color: '006400', // Dark green
      })],
      spacing: { before: 100, after: 80 },
      keepNext: true,
    }));

    if (hasCodeBlock) {
      // Extract and render code with syntax highlighting
      const cleanCode = extractCodeFromMarkdown(solution);
      const codeLines = cleanCode.split('\n');
      const codeParagraphs: Paragraph[] = codeLines.map(line => {
        const textRuns = highlightCodeLine(line);
        return new Paragraph({
          children: textRuns,
          spacing: { after: 0 },
        });
      });

      result.push(new Table({
        rows: [new TableRow({
          children: [new TableCell({
            children: codeParagraphs.length > 0 ? codeParagraphs : [new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.code, size: FONT_SIZES.code })] })],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERS.box as ITableCellBorders,
            shading: { fill: '1E1E1E' }, // Dark background like VS Code
            margins: { top: cmToTwip(0.3), bottom: cmToTwip(0.3), left: cmToTwip(0.4), right: cmToTwip(0.4) },
          })],
        })],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
    } else {
      // Solution content - in a box with green text (no code)
      result.push(new Table({
        rows: [new TableRow({
          children: [new TableCell({
            children: [new Paragraph({
              children: [new TextRun({
                text: cleanMarkdownText(solution),
                font: FONTS.default,
                size: FONT_SIZES.normal,
                color: '006400', // Dark green
              })],
            })],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERS.box as ITableCellBorders,
            shading: { fill: 'F0FFF0' }, // Light green background
            margins: { top: cmToTwip(0.2), bottom: cmToTwip(0.2), left: cmToTwip(0.3), right: cmToTwip(0.3) },
          })],
        })],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
    }
  } else {
    // Answer lines - 10 lines for answer
    const lineCount = 10; // Fixed 10 lines as per user request
    const answerLineTable = new Table({
      rows: Array.from({ length: lineCount }, () => new TableRow({
        children: [new TableCell({
          children: [new Paragraph({ 
            children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })],
            spacing: { after: 0 } 
          })],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NIL },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
            left: { style: BorderStyle.NIL },
            right: { style: BorderStyle.NIL },
          },
        })],
        height: { value: 360, rule: HeightRule.EXACT },
      })),
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
    
    result.push(answerLineTable);
  }
  
  result.push(new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })], spacing: { after: SPACING.afterQuestion } }));
  
  return result;
}

function renderProgramming(q: ProgrammingQuestion, solution?: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Parse and clean the question text
  const { description, requirements } = formatQuestionText(q.prompt);
  
  // Question number and description - entire question in bold
  result.push(new Paragraph({
    children: [
      new TextRun({
        text: `${q.number}. ${description}`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      }),
      new TextRun({
        text: ` (${q.marks} marks)`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        italics: true,
      }),
    ],
    spacing: { after: 120 },
    keepNext: true, // Keep with code area
    keepLines: true,
  }));
  
  // Requirements from parsed text or from constraints - no indent for label, items indented
  const allConstraints = [...requirements, ...(q.constraints || [])];
  if (allConstraints.length > 0) {
    result.push(new Paragraph({
      indent: { left: 0 }, // Explicitly no indent
      children: [new TextRun({
        text: 'Requirements:',
        font: FONTS.default,
        size: FONT_SIZES.small,
        italics: true, // Only italic, not bold
      })],
      spacing: { after: 40 },
      keepNext: true,
      keepLines: true,
    }));
    
    for (let i = 0; i < allConstraints.length; i++) {
      result.push(new Paragraph({
        indent: { left: 0 }, // Explicitly set to 0 - no indent at all
        children: [new TextRun({
          text: `- ${cleanMarkdownText(allConstraints[i])}`,
          font: FONTS.default,
          size: FONT_SIZES.small,
          italics: true,
        })],
        spacing: { after: 30 },
        keepNext: true,
        keepLines: true,
      }));
    }
  }
  
  // If solution is provided, render it as a code block
  if (solution) {
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Solution:',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
        color: '006400', // Dark green
      })],
      spacing: { before: 200, after: 80 },
      keepNext: true,
    }));
    
    // Extract clean code from solution (remove markdown fences)
    let cleanCode = solution
      .replace(/```[\w]*\n?/g, '') // Remove opening fences with optional language
      .replace(/```/g, '')          // Remove closing fences
      .trim();
    
    // Render code with syntax highlighting colors in a dark code box
    const codeLines = cleanCode.split('\n');
    const codeParagraphs: Paragraph[] = codeLines.map(line => {
      // Apply simple syntax highlighting
      const textRuns = highlightCodeLine(line);
      return new Paragraph({
        children: textRuns,
        spacing: { after: 0 },
      });
    });
    
    result.push(new Table({
      rows: [new TableRow({
        children: [new TableCell({
          children: codeParagraphs.length > 0 ? codeParagraphs : [new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.code, size: FONT_SIZES.code })] })],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: BORDERS.box as ITableCellBorders,
          shading: { fill: '1E1E1E' }, // Dark background like VS Code
          margins: { top: cmToTwip(0.3), bottom: cmToTwip(0.3), left: cmToTwip(0.4), right: cmToTwip(0.4) },
        })],
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  } else {
    // "Write your code below" label
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Write your code below:',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      })],
      spacing: { before: 200, after: 120 },
      keepNext: true,
      keepLines: true,
    }));
    
    // Empty code box - table with border
    const lineCount = q.codeAreaLines || 15;
    const boxHeight = lineCount * SPACING.codeLineHeight;
    
    result.push(new Table({
      rows: [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: '', font: FONTS.code, size: FONT_SIZES.code })],
          })],
          borders: BORDERS.box as ITableCellBorders,
          width: { size: 100, type: WidthType.PERCENTAGE },
        })],
        height: { value: boxHeight, rule: HeightRule.EXACT },
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }
  
  result.push(new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })], spacing: { after: 300 } }));
  
  return result;
}

/**
 * Highlight a single line of code with simple syntax highlighting
 * Returns TextRun array with appropriate colors
 */
function highlightCodeLine(line: string): TextRun[] {
  const runs: TextRun[] = [];
  
  // Python/JavaScript keyword colors
  const keywords = ['def', 'return', 'if', 'else', 'elif', 'for', 'while', 'in', 'not', 'and', 'or', 'True', 'False', 'None', 'import', 'from', 'class', 'try', 'except', 'finally', 'with', 'as', 'pass', 'break', 'continue', 'lambda', 'function', 'const', 'let', 'var', 'async', 'await'];
  const builtins = ['print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'input', 'open', 'console'];
  
  // Simple tokenization
  let remaining = line;
  
  while (remaining.length > 0) {
    // Check for string (single or double quotes)
    const stringMatch = remaining.match(/^(["'])((?:\\.|[^\\])*?)\1/);
    if (stringMatch) {
      runs.push(new TextRun({
        text: stringMatch[0],
        font: FONTS.code,
        size: 18, // 9pt
        color: 'CE9178', // Orange for strings
      }));
      remaining = remaining.slice(stringMatch[0].length);
      continue;
    }
    
    // Check for comment
    if (remaining.startsWith('#') || remaining.startsWith('//')) {
      runs.push(new TextRun({
        text: remaining,
        font: FONTS.code,
        size: 18,
        color: '6A9955', // Green for comments
      }));
      break;
    }
    
    // Check for number
    const numberMatch = remaining.match(/^\d+(\.\d+)?/);
    if (numberMatch) {
      runs.push(new TextRun({
        text: numberMatch[0],
        font: FONTS.code,
        size: 18,
        color: 'B5CEA8', // Light green for numbers
      }));
      remaining = remaining.slice(numberMatch[0].length);
      continue;
    }
    
    // Check for keyword or builtin
    const wordMatch = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      let color = 'D4D4D4'; // Default light gray
      
      if (keywords.includes(word)) {
        color = 'C586C0'; // Purple for keywords
      } else if (builtins.includes(word)) {
        color = 'DCDCAA'; // Yellow for builtins
      } else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        color = '4EC9B0'; // Teal for classes
      }
      
      runs.push(new TextRun({
        text: word,
        font: FONTS.code,
        size: 18,
        color: color,
      }));
      remaining = remaining.slice(word.length);
      continue;
    }
    
    // Check for operators and punctuation
    const opMatch = remaining.match(/^[+\-*/%=<>!&|^~()[\]{}:;,.\s]+/);
    if (opMatch) {
      runs.push(new TextRun({
        text: opMatch[0],
        font: FONTS.code,
        size: 18,
        color: 'D4D4D4', // Light gray
      }));
      remaining = remaining.slice(opMatch[0].length);
      continue;
    }
    
    // Fallback: single character
    runs.push(new TextRun({
      text: remaining[0],
      font: FONTS.code,
      size: 18,
      color: 'D4D4D4',
    }));
    remaining = remaining.slice(1);
  }
  
  return runs.length > 0 ? runs : [new TextRun({ text: '', font: FONTS.code, size: 18 })];
}

function renderTrueFalse(q: TrueFalseQuestion, solution?: string): Paragraph[] {
  const result: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: `${q.number}. `, font: FONTS.default, size: FONT_SIZES.normal, bold: true }),
        new TextRun({ text: `[  True  ]  [  False  ]  `, font: FONTS.default, size: FONT_SIZES.normal, bold: true }),
        new TextRun({ text: cleanMarkdownText(q.statement), font: FONTS.default, size: FONT_SIZES.normal, bold: true }),
        new TextRun({ text: ` (${q.marks} marks)`, font: FONTS.default, size: FONT_SIZES.normal, italics: true }),
      ],
      spacing: { after: solution ? 100 : SPACING.afterQuestion },
    }),
  ];
  
  if (solution) {
    result.push(new Paragraph({
      children: [
        new TextRun({ text: 'Answer: ', font: FONTS.default, size: FONT_SIZES.normal, bold: true, color: '006400' }),
        new TextRun({ text: cleanMarkdownText(solution), font: FONTS.default, size: FONT_SIZES.normal, color: '006400' }),
      ],
      spacing: { after: SPACING.afterQuestion },
    }));
  }
  
  return result;
}

function renderDebugging(q: DebuggingQuestion, solution?: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  
  // Prompt with marks - bold
  result.push(new Paragraph({
    children: [
      new TextRun({
        text: `${q.number}. ${cleanMarkdownText(q.prompt)}`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      }),
      new TextRun({
        text: ` (${q.marks} marks)`,
        font: FONTS.default,
        size: FONT_SIZES.normal,
        italics: true,
      }),
    ],
    spacing: { after: 120 },
    keepNext: true,
    keepLines: true,
  }));
  
  // Buggy code box
  if (q.buggyCode) {
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Given code (contains bug):',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      })],
      spacing: { after: 80 },
      keepNext: true,
    }));
    
    const codeLines = q.buggyCode.split('\n');
    const codeContent = codeLines.map(line => 
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: FONTS.code, size: FONT_SIZES.code })],
      })
    );
    
    result.push(new Table({
      rows: [new TableRow({
        children: [new TableCell({
          children: codeContent,
          borders: BORDERS.box as ITableCellBorders,
          shading: { fill: 'F5F5F5' },
        })],
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }
  
  // If solution provided, render it instead of empty box
  if (solution) {
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Corrected Code:',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
        color: '006400',
      })],
      spacing: { before: 200, after: 80 },
      keepNext: true,
    }));
    
    // Extract clean code from solution
    let cleanCode = solution
      .replace(/```[\w]*\n?/g, '')
      .replace(/```/g, '')
      .trim();
    
    const codeLines = cleanCode.split('\n');
    const codeParagraphs: Paragraph[] = codeLines.map(line => {
      const textRuns = highlightCodeLine(line);
      return new Paragraph({
        children: textRuns,
        spacing: { after: 0 },
      });
    });
    
    result.push(new Table({
      rows: [new TableRow({
        children: [new TableCell({
          children: codeParagraphs.length > 0 ? codeParagraphs : [new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.code, size: FONT_SIZES.code })] })],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: BORDERS.box as ITableCellBorders,
          shading: { fill: '1E1E1E' }, // Dark background
          margins: { top: cmToTwip(0.3), bottom: cmToTwip(0.3), left: cmToTwip(0.4), right: cmToTwip(0.4) },
        })],
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  } else {
    // Answer area
    result.push(new Paragraph({
      children: [new TextRun({
        text: 'Write the corrected code below:',
        font: FONTS.default,
        size: FONT_SIZES.normal,
        bold: true,
      })],
      spacing: { before: 200, after: 120 },
      keepNext: true,
    }));
    
    const lineCount = q.codeAreaLines || 12;
    const boxHeight = lineCount * SPACING.codeLineHeight;
    
    result.push(new Table({
      rows: [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: '', font: FONTS.code, size: FONT_SIZES.code })],
          })],
          borders: BORDERS.box as ITableCellBorders,
        })],
        height: { value: boxHeight, rule: HeightRule.EXACT },
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }
  
  result.push(new Paragraph({ children: [new TextRun({ text: ' ', font: FONTS.default, size: FONT_SIZES.normal })], spacing: { after: 300 } }));
  
  return result;
}

// ============================================
// Conversion Utilities
// ============================================

/**
 * Convert legacy export items to formal exam format
 * Total marks will be normalized to 100
 */
export function convertToExamContent(
  items: LegacyExportItem[],
  options: ConvertToExamOptions
): ExamContent {
  const TARGET_TOTAL = 100; // Always normalize to 100 points
  const rawTotal = items.reduce((sum, it) => sum + (it.points || 0), 0);
  const scaleFactor = rawTotal > 0 ? TARGET_TOTAL / rawTotal : 1;
  
  // Function to scale and round marks
  const scaleMarks = (points: number | undefined, defaultVal: number): number => {
    const raw = points || defaultVal;
    return Math.round(raw * scaleFactor);
  };
  
  // Group questions by type for sections
  const mcqItems = items.filter(it => it.type?.toLowerCase() === 'mcq' || it.choices);
  const codingItems = items.filter(it => 
    it.type?.toLowerCase().includes('coding') || 
    it.type?.toLowerCase().includes('programming') ||
    it.type?.toLowerCase().includes('debugging')
  );
  const otherItems = items.filter(it => 
    !mcqItems.includes(it) && !codingItems.includes(it)
  );
  
  const sections: ExamSection[] = [];
  let questionNum = 1;
  let runningTotal = 0;
  const allQuestions: { marks: number }[] = [];
  
  // MCQ Section
  if (mcqItems.length > 0) {
    const mcqQuestions = mcqItems.map(it => {
      const marks = scaleMarks(it.points, 3);
      runningTotal += marks;
      return {
        number: questionNum++,
        marks,
        type: 'mcq' as const,
        stem: it.question,
        choices: it.choices || [
          { key: 'A', text: 'Option A' },
          { key: 'B', text: 'Option B' },
          { key: 'C', text: 'Option C' },
          { key: 'D', text: 'Option D' },
        ],
        solution: it.solution,
        title: it.title,
        originalType: it.type,
        sources: it.sources,
      };
    });
    allQuestions.push(...mcqQuestions);
    sections.push({
      id: 'A',
      title: 'Section A: Multiple Choice Questions',
      marks: mcqQuestions.reduce((sum, q) => sum + q.marks, 0),
      pageBreakBefore: false,
      questions: mcqQuestions,
    });
  }
  
  // Short Answer Section
  if (otherItems.length > 0) {
    const shortQuestions = otherItems.map(it => {
      const marks = scaleMarks(it.points, 6);
      runningTotal += marks;
      return {
        number: questionNum++,
        marks,
        type: 'short' as const,
        prompt: it.question,
        answerLines: 10,
        solution: it.solution,
        title: it.title,
        originalType: it.type,
        sources: it.sources,
      };
    });
    allQuestions.push(...shortQuestions);
    sections.push({
      id: 'B',
      title: 'Section B: Short Answer Questions',
      marks: shortQuestions.reduce((sum, q) => sum + q.marks, 0),
      pageBreakBefore: sections.length > 0,
      questions: shortQuestions,
    });
  }
  
  // Programming Section
  if (codingItems.length > 0) {
    const progQuestions = codingItems.map(it => {
      const marks = scaleMarks(it.points, 15);
      runningTotal += marks;
      return {
        number: questionNum++,
        marks,
        type: 'programming' as const,
        prompt: it.question,
        constraints: [],
        codeAreaLines: Math.max(12, Math.min(25, Math.ceil(marks * 0.8))),
        solution: it.solution,
        title: it.title,
        originalType: it.type,
        sources: it.sources,
      };
    });
    allQuestions.push(...progQuestions);
    sections.push({
      id: 'C',
      title: 'Section C: Programming Questions',
      marks: progQuestions.reduce((sum, q) => sum + q.marks, 0),
      pageBreakBefore: sections.length > 0,
      questions: progQuestions,
    });
  }
  
  // Adjust last question to ensure total is exactly 100
  if (allQuestions.length > 0 && runningTotal !== TARGET_TOTAL) {
    const diff = TARGET_TOTAL - runningTotal;
    const lastQ = allQuestions[allQuestions.length - 1];
    lastQ.marks += diff;
    // Update section marks
    if (sections.length > 0) {
      sections[sections.length - 1].marks += diff;
    }
  }
  
  return {
    metadata: {
      course: options.course,
      institution: options.institution,
      examType: options.examType,
      durationMinutes: options.durationMinutes,
      totalMarks: TARGET_TOTAL, // Always 100
    },
    instructions: options.instructions || [
      'Answer ALL questions.',
      'Write clearly and legibly.',
      'Show all your work for partial credit.',
      'No electronic devices are permitted.',
    ],
    sections,
  };
}

