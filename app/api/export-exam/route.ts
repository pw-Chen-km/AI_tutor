/**
 * Exam Export API Route
 * 考試卷導出 API 路由
 *
 * Generates formal exam papers in Word (.docx), PDF, and PowerPoint (.pptx) format
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { checkExportAvailable, recordExport } from '@/lib/payments/usage-tracker';
import { exportExamDocx, convertToExamContent, getHeaderLayout } from '@/lib/exam-export';
import { ExamExportConfig, ExamContent, HeaderLayout, LegacyExportItem, ConvertToExamOptions } from '@/lib/exam-export/types';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { uploadFile, getContentType } from '@/lib/storage/supabase-storage';
import { createGenerationHistory, hasGenerationHistoryFeature } from '@/lib/db/queries/generation-history';

export const runtime = 'nodejs';

interface ExportExamRequest {
  // Mode: 'direct' uses provided examContent, 'convert' converts legacy items
  mode: 'direct' | 'convert';

  // Output format: 'docx' (default), 'pdf', or 'pptx'
  format?: 'docx' | 'pdf' | 'pptx';

  // For direct mode
  examContent?: ExamContent;
  headerLayout?: HeaderLayout;

  // For convert mode
  items?: LegacyExportItem[];
  convertOptions?: ConvertToExamOptions;

  // Common options
  headerLayoutName?: 'default' | 'minimal';
  studentInfo?: {
    student_id?: string;
    name?: string;
    class?: string;
  };

  // Metadata override (for convert mode)
  course?: string;
  institution?: string;
  examType?: string;
  durationMinutes?: number;
  instructions?: string[];

  // Include solutions in the output
  includeSolutions?: boolean;

  // Institution logo (base64 encoded image)
  institutionLogoBase64?: string;

  // User-uploaded PPTX template (base64 encoded)
  templatePptxBase64?: string;
  // User-uploaded DOCX template (base64 encoded)
  templateDocxBase64?: string;
}

// ============================================
// PDF Generator for Formal Exam Papers
// (Matches Word export structure and content)
// ============================================

async function generateExamPdf(config: ExamExportConfig): Promise<Buffer> {
  const { examContent, includeSolutions, institutionLogoBase64 } = config;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Try to load CJK font for Chinese support
  const getCjkFontBytes = async () => {
    const envPath = process.env.PDF_FONT_PATH;
    if (envPath) {
      const buf = await fs.readFile(envPath);
      return new Uint8Array(buf);
    }

    const filename = 'NotoSansCJKsc-Regular.otf';
    const folder = 'SimplifiedChinese';
    const cacheDir = path.join(process.cwd(), '.cache', 'fonts');
    const cachePath = path.join(cacheDir, filename);

    try {
      const buf = await fs.readFile(cachePath);
      return new Uint8Array(buf);
    } catch {
      // continue to download
    }

    await fs.mkdir(cacheDir, { recursive: true });
    const urls = [
      `https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/${folder}/${filename}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const u8 = new Uint8Array(ab);
          await fs.writeFile(cachePath, Buffer.from(u8));
          return u8;
        }
      } catch {
        continue;
      }
    }
    return null;
  };

  let font: any;
  let boldFont: any;
  try {
    const cjkBytes = await getCjkFontBytes();
    if (cjkBytes) {
      font = await pdfDoc.embedFont(cjkBytes, { subset: true });
      boldFont = font; // CJK fonts typically don't have separate bold
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);
  const pageMargin = 50;
  const fontSize = 11;
  const lineHeight = 16;

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  let x = pageMargin;
  let y = height - pageMargin;

  const checkPageBreak = (neededSpace: number = lineHeight * 3) => {
    if (y < pageMargin + neededSpace) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - pageMargin;
    }
  };

  const drawLine = (text: string, opts?: { size?: number; bold?: boolean; mono?: boolean; indent?: number; color?: { r: number; g: number; b: number } }) => {
    const size = opts?.size ?? fontSize;
    const f = opts?.mono ? monoFont : (opts?.bold ? boldFont : font);
    const maxWidth = width - pageMargin * 2 - (opts?.indent || 0);
    const raw = (text || '').toString();
    const color = opts?.color ? rgb(opts.color.r, opts.color.g, opts.color.b) : rgb(0.1, 0.1, 0.1);

    const flush = (line: string) => {
      checkPageBreak();
      page.drawText(line, { x: x + (opts?.indent || 0), y, size, font: f, color });
      y -= lineHeight;
    };

    // Simple word wrapping
    const words = raw.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      try {
        if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
          flush(line);
          line = word;
        } else {
          line = test;
        }
      } catch {
        line = test;
      }
    }
    if (line) flush(line);
  };

  const drawCenteredLine = (text: string, opts?: { size?: number; bold?: boolean }) => {
    const size = opts?.size ?? fontSize;
    const f = opts?.bold ? boldFont : font;
    checkPageBreak();
    try {
      const textWidth = f.widthOfTextAtSize(text, size);
      const centeredX = (width - textWidth) / 2;
      page.drawText(text, { x: centeredX, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    } catch {
      page.drawText(text, { x: pageMargin, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= lineHeight;
  };

  const drawSeparator = () => {
    checkPageBreak();
    page.drawLine({
      start: { x: pageMargin, y },
      end: { x: width - pageMargin, y },
      thickness: 1.5,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  };

  const drawBox = (content: string[], opts?: { bgColor?: { r: number; g: number; b: number }; borderColor?: { r: number; g: number; b: number }; padding?: number }) => {
    const padding = opts?.padding || 10;
    const boxWidth = width - pageMargin * 2;
    const contentHeight = content.length * lineHeight + padding * 2;

    checkPageBreak(contentHeight + 20);

    const boxY = y - contentHeight;

    // Draw background
    if (opts?.bgColor) {
      page.drawRectangle({
        x: pageMargin,
        y: boxY,
        width: boxWidth,
        height: contentHeight,
        color: rgb(opts.bgColor.r, opts.bgColor.g, opts.bgColor.b),
      });
    }

    // Draw border
    const borderColor = opts?.borderColor ? rgb(opts.borderColor.r, opts.borderColor.g, opts.borderColor.b) : rgb(0, 0, 0);
    page.drawRectangle({
      x: pageMargin,
      y: boxY,
      width: boxWidth,
      height: contentHeight,
      borderColor,
      borderWidth: 1.5,
    });

    // Draw content
    y -= padding;
    content.forEach(line => {
      drawLine(line, { indent: padding, size: 10 });
    });
    y -= padding;
  };

  // Clean markdown text
  const cleanText = (text: string) => {
    return (text || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[A-Za-z0-9_-]*\n?/g, '').replace(/```/g, '').trim())
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*■•▪]\s+/gm, '')
      .trim();
  };

  // ===== HEADER =====
  // Insert logo if provided
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

      const imageBytes = Buffer.from(cleanBase64, 'base64');
      let image;

      // Try PNG first, then JPEG
      try {
        image = await pdfDoc.embedPng(imageBytes);
      } catch {
        try {
          image = await pdfDoc.embedJpg(imageBytes);
        } catch {
          console.log('[PDF] Could not embed logo image');
        }
      }

      if (image) {
        const maxWidth = width - pageMargin * 2;
        const maxHeight = 50;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;

        page.drawImage(image, {
          x: (width - scaledWidth) / 2,
          y: y - scaledHeight,
          width: scaledWidth,
          height: scaledHeight,
        });
        y -= scaledHeight + 15;
      }
    } catch (e) {
      console.error('[PDF] Logo insertion failed:', e);
    }
  } else {
    // Institution name as text
    drawCenteredLine(examContent.metadata.institution || 'University', { size: 18, bold: true });
  }

  // Course name
  y -= 5;
  drawCenteredLine(examContent.metadata.course || 'Course', { size: 16, bold: true });

  // Exam type
  y -= 3;
  drawCenteredLine(examContent.metadata.examType || 'Examination', { size: 13 });

  // Duration and marks
  y -= 3;
  drawCenteredLine(`Duration: ${examContent.metadata.durationMinutes || 120} minutes  |  Total Marks: ${examContent.metadata.totalMarks || 100}`, { size: 10 });

  y -= 10;
  drawSeparator();
  y -= 5;

  // Student info
  drawLine('Student ID: ________________    Name: ________________________    Class: ________________', { size: 10 });
  y -= 15;

  // ===== INSTRUCTIONS BOX =====
  const fixedInstructions = [
    '1. All questions must be answered.',
    '2. All responses must be written clearly and legibly.',
    '3. All necessary steps, calculations, and reasoning must be shown in order to be eligible for partial credit.',
    '4. The possession or use of any electronic devices is strictly prohibited for the duration of the examination.',
  ];

  // Draw instructions box title
  checkPageBreak(100);
  const instrBoxY = y;
  const instrBoxHeight = (fixedInstructions.length + 1) * lineHeight + 30;

  // Box border
  page.drawRectangle({
    x: pageMargin,
    y: instrBoxY - instrBoxHeight,
    width: width - pageMargin * 2,
    height: instrBoxHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
  });

  y -= 15;
  drawCenteredLine('INSTRUCTIONS', { size: 12, bold: true });
  y -= 5;

  fixedInstructions.forEach(inst => {
    drawLine(inst, { size: 10, indent: 15 });
  });

  y -= 20;

  // ===== QUESTIONS =====
  for (const section of examContent.sections) {
    // Page break between sections if needed
    if (section.pageBreakBefore) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - pageMargin;
    }

    for (const q of section.questions) {
      const qText = cleanText((q as any).stem || (q as any).prompt || (q as any).statement || '');

      // Question header with number and marks
      checkPageBreak(lineHeight * 5);
      drawLine(`${q.number}. ${qText} (${q.marks} marks)`, { size: 11, bold: true });

      // Metadata line: type | points | sources
      const metaParts: string[] = [];
      if (q.originalType) metaParts.push(`Type: ${q.originalType}`);
      metaParts.push(`Worth: ${q.marks} pts`);
      if (q.sources && q.sources.length > 0) {
        const srcText = q.sources.map(s => s.pages ? `${s.file} (p. ${s.pages})` : s.file).join('; ');
        metaParts.push(`Source: ${srcText}`);
      }
      drawLine(metaParts.join('  |  '), { size: 9, indent: 15, color: { r: 0.5, g: 0.5, b: 0.5 } });

      // MCQ choices
      if (q.type === 'mcq' && (q as any).choices) {
        const choices = (q as any).choices as { key: string; text: string }[];
        choices.forEach((c) => {
          drawLine(`${c.key}. ${cleanText(c.text)}`, { indent: 30, size: 11 });
        });
      }

      // Programming/Coding questions - show requirements if any
      if ((q.type === 'programming' || q.type === 'coding') && (q as any).constraints?.length > 0) {
        y -= 5;
        drawLine('Requirements:', { size: 10, bold: true, indent: 20 });
        ((q as any).constraints as string[]).forEach(constraint => {
          drawLine(`- ${cleanText(constraint)}`, { size: 10, indent: 30 });
        });
      }

      // Solution if included
      if (includeSolutions && (q as any).solution) {
        y -= 10;
        drawLine('Answer:', { size: 11, bold: true, color: { r: 0, g: 0.4, b: 0 } });

        const solution = cleanText((q as any).solution);
        const solutionLines = solution.split('\n');

        // Check if it's code (programming/coding/debugging questions)
        if (q.type === 'programming' || q.type === 'coding' || q.type === 'debugging') {
          // Draw code in monospace with background
          const codeBoxHeight = solutionLines.length * (lineHeight - 2) + 20;
          checkPageBreak(codeBoxHeight + 20);

          page.drawRectangle({
            x: pageMargin + 10,
            y: y - codeBoxHeight,
            width: width - pageMargin * 2 - 20,
            height: codeBoxHeight,
            color: rgb(0.12, 0.12, 0.12),
          });

          y -= 10;
          solutionLines.forEach(line => {
            drawLine(line || ' ', { mono: true, size: 9, indent: 20, color: { r: 0.85, g: 0.85, b: 0.85 } });
          });
          y -= 10;
        } else {
          // Regular solution text
          solutionLines.forEach(line => {
            drawLine(line, { size: 10, indent: 20, color: { r: 0, g: 0.4, b: 0 } });
          });
        }
      } else if (!includeSolutions) {
        // Draw answer lines for non-solution exports
        if (q.type === 'programming' || q.type === 'coding' || q.type === 'debugging') {
          y -= 10;
          drawLine('Write your code below:', { size: 10, bold: true });
          y -= 5;

          // Draw empty code box
          const boxHeight = 150;
          checkPageBreak(boxHeight + 20);

          page.drawRectangle({
            x: pageMargin,
            y: y - boxHeight,
            width: width - pageMargin * 2,
            height: boxHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
          });
          y -= boxHeight + 10;
        } else if (q.type !== 'mcq' && q.type !== 'truefalse') {
          // Draw answer lines for short answer questions
          y -= 10;
          const lineCount = 8;
          for (let i = 0; i < lineCount; i++) {
            checkPageBreak();
            page.drawLine({
              start: { x: pageMargin, y },
              end: { x: width - pageMargin, y },
              thickness: 0.5,
              color: rgb(0, 0, 0),
            });
            y -= lineHeight + 5;
          }
        }
      }

      y -= 20;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// ============================================
// PPTX Generator for Formal Exam Papers
// ============================================

async function generateExamPptx(config: ExamExportConfig): Promise<Buffer> {
  const { examContent, includeSolutions, templatePptxBase64 } = config;

  const cleanText = (text: string) => {
    return (text || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[A-Za-z0-9_-]*\n?/g, '').replace(/```/g, '').trim())
      .replace(/^#{1,6}\s+/gm, '')
      .trim();
  };

  // ======== Template-based generation (JSZip) ========
  if (templatePptxBase64) {
    try {
      console.log('[ExamPPTX] Using uploaded PPTX template');
      const tplBuf = Buffer.from(templatePptxBase64, 'base64');
      const zip = await JSZip.loadAsync(tplBuf);

      const slidePaths = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
        .sort((a, b) => {
          const an = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
          const bn = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
          return an - bn;
        });

      if (slidePaths.length === 0) throw new Error('Template has no slides');

      const masterPath = slidePaths[0];
      const masterXml = await zip.file(masterPath)!.async('string');
      const masterNum = Number(masterPath.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const masterRelsPath = `ppt/slides/_rels/slide${masterNum}.xml.rels`;
      const masterRelsXml = zip.file(masterRelsPath) ? await zip.file(masterRelsPath)!.async('string') : null;

      const escapeXml = (s: string) =>
        (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

      const EMU = 914400;

      const createShapeXml = (id: number, name: string, text: string, x: number, y: number, w: number, h: number, opts: { fontSize?: number; bold?: boolean; color?: string; align?: string; fontFace?: string } = {}) => {
        const lines = (text || '').split('\n');
        const pXml = lines.map(line => `
          <a:p>
            <a:pPr algn="${opts.align || 'l'}"/>
            <a:r>
              <a:rPr lang="en-US" sz="${(opts.fontSize || 18) * 100}" b="${opts.bold ? '1' : '0'}">
                <a:solidFill><a:srgbClr val="${opts.color || '000000'}"/></a:solidFill>
                <a:latin typeface="${opts.fontFace || 'Arial'}"/>
              </a:rPr>
              <a:t>${escapeXml(line)}</a:t>
            </a:r>
          </a:p>`).join('');

        return `
          <p:sp>
            <p:nvSpPr>
              <p:cNvPr id="${id}" name="${name}"/>
              <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
              <p:nvPr/>
            </p:nvSpPr>
            <p:spPr>
              <a:xfrm>
                <a:off x="${Math.round(x)}" y="${Math.round(y)}"/>
                <a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/>
              </a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr rtlCol="0" anchor="t" wrap="square"/>
              <a:lstStyle/>
              ${pXml}
            </p:txBody>
          </p:sp>`;
      };

      const newSlideEntries: Array<{ num: number; xml: string; rels: string | null }> = [];
      let currentMaxSlideNum = Math.max(...slidePaths.map(p => Number(p.match(/slide(\d+)\.xml/i)?.[1] || 0)));

      // Title slide
      currentMaxSlideNum++;
      {
        let slideXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
        const shapes: string[] = [];
        let nid = 100;
        shapes.push(createShapeXml(nid++, 'Institution', examContent.metadata.institution || 'University', 0.5 * EMU, 1.5 * EMU, 12.4 * EMU, 0.8 * EMU, { fontSize: 28, bold: true, align: 'ctr' }));
        shapes.push(createShapeXml(nid++, 'Course', examContent.metadata.course || 'Course', 0.5 * EMU, 2.5 * EMU, 12.4 * EMU, 0.8 * EMU, { fontSize: 36, bold: true, color: '2563eb', align: 'ctr' }));
        shapes.push(createShapeXml(nid++, 'ExamType', examContent.metadata.examType || 'Examination', 0.5 * EMU, 3.5 * EMU, 12.4 * EMU, 0.5 * EMU, { fontSize: 24, color: '4b5563', align: 'ctr' }));
        shapes.push(createShapeXml(nid++, 'Duration', `Duration: ${examContent.metadata.durationMinutes || 120} minutes  |  Total: ${examContent.metadata.totalMarks || 100} marks`, 0.5 * EMU, 4.2 * EMU, 12.4 * EMU, 0.4 * EMU, { fontSize: 16, color: '6b7280', align: 'ctr' }));
        const spTreeEnd = slideXml.lastIndexOf('</p:spTree>');
        if (spTreeEnd !== -1) slideXml = slideXml.substring(0, spTreeEnd) + shapes.join('') + slideXml.substring(spTreeEnd);
        newSlideEntries.push({ num: currentMaxSlideNum, xml: slideXml, rels: masterRelsXml });
      }

      // Question slides
      for (const section of examContent.sections) {
        for (const q of section.questions) {
          currentMaxSlideNum++;
          let slideXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
          const shapes: string[] = [];
          let nid = 1000 + (q.number * 20);

          shapes.push(createShapeXml(nid++, 'QNum', `Question ${q.number}`, 0.5 * EMU, 0.3 * EMU, 10 * EMU, 0.8 * EMU, { fontSize: 32, bold: true }));
          shapes.push(createShapeXml(nid++, 'QMarks', `${q.marks} marks`, 10.5 * EMU, 0.3 * EMU, 2.4 * EMU, 0.8 * EMU, { fontSize: 20, color: '6b7280', align: 'r' }));

          // Metadata line: type | points | sources
          const metaParts: string[] = [];
          if (q.originalType) metaParts.push(`Type: ${q.originalType}`);
          metaParts.push(`Worth: ${q.marks} pts`);
          if (q.sources && q.sources.length > 0) {
            const srcText = q.sources.map(s => s.pages ? `${s.file} (p. ${s.pages})` : s.file).join('; ');
            metaParts.push(`Source: ${srcText}`);
          }
          shapes.push(createShapeXml(nid++, 'QMeta', metaParts.join('  |  '), 0.5 * EMU, 1.1 * EMU, 12.4 * EMU, 0.35 * EMU, { fontSize: 12, color: '9ca3af' }));

          const qText = cleanText((q as any).stem || (q as any).prompt || (q as any).statement || '');
          shapes.push(createShapeXml(nid++, 'QText', qText, 0.5 * EMU, 1.5 * EMU, 12.4 * EMU, 2.5 * EMU, { fontSize: 20 }));

          if (q.type === 'mcq' && (q as any).choices) {
            let yPos = 4.2;
            for (const c of (q as any).choices as { key: string; text: string }[]) {
              shapes.push(createShapeXml(nid++, `Choice${c.key}`, `${c.key}. ${cleanText(c.text)}`, 0.8 * EMU, yPos * EMU, 11.8 * EMU, 0.5 * EMU, { fontSize: 18, color: '4b5563' }));
              yPos += 0.6;
            }
          }

          const spTreeEnd = slideXml.lastIndexOf('</p:spTree>');
          if (spTreeEnd !== -1) slideXml = slideXml.substring(0, spTreeEnd) + shapes.join('') + slideXml.substring(spTreeEnd);
          newSlideEntries.push({ num: currentMaxSlideNum, xml: slideXml, rels: masterRelsXml });

          if (includeSolutions && (q as any).solution) {
            currentMaxSlideNum++;
            let ansXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
            const ansShapes: string[] = [];
            let aid = 2000 + (q.number * 20);
            ansShapes.push(createShapeXml(aid++, 'ATitle', `Question ${q.number} - Answer`, 0.5 * EMU, 0.3 * EMU, 12.4 * EMU, 0.8 * EMU, { fontSize: 32, bold: true, color: '16a34a' }));
            const solText = cleanText((q as any).solution);
            ansShapes.push(createShapeXml(aid++, 'ASolution', solText, 0.5 * EMU, 1.3 * EMU, 12.4 * EMU, 5.5 * EMU, { fontSize: 18 }));
            const aTreeEnd = ansXml.lastIndexOf('</p:spTree>');
            if (aTreeEnd !== -1) ansXml = ansXml.substring(0, aTreeEnd) + ansShapes.join('') + ansXml.substring(aTreeEnd);
            newSlideEntries.push({ num: currentMaxSlideNum, xml: ansXml, rels: masterRelsXml });
          }
        }
      }

      // Remove original slides, add new ones
      slidePaths.forEach(p => {
        zip.remove(p);
        const rPath = `ppt/slides/_rels/${p.split('/').pop()}.rels`;
        if (zip.file(rPath)) zip.remove(rPath);
      });
      newSlideEntries.forEach(e => {
        zip.file(`ppt/slides/slide${e.num}.xml`, e.xml);
        if (e.rels) zip.file(`ppt/slides/_rels/slide${e.num}.xml.rels`, e.rels);
      });

      // Update presentation.xml
      const presPath = 'ppt/presentation.xml';
      let presXml = await zip.file(presPath)!.async('string');
      let nextSldId = 256;
      let newSldEntries = '';
      const presRelsPath = 'ppt/_rels/presentation.xml.rels';
      let presRelsXml = await zip.file(presRelsPath)!.async('string');
      let nextRId = 1;
      (presRelsXml.match(/Id="rId(\d+)"/g) || []).forEach(m => {
        const id = parseInt(m.match(/\d+/)?.[0] || '0');
        if (id >= nextRId) nextRId = id + 1;
      });
      let updatedPresRels = presRelsXml.replace('</Relationships>', '');
      newSlideEntries.forEach(e => {
        const rId = `rId${nextRId++}`;
        newSldEntries += `<p:sldId id="${nextSldId++}" r:id="${rId}"/>`;
        updatedPresRels += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${e.num}.xml"/>`;
      });
      updatedPresRels += '</Relationships>';
      presXml = presXml.replace(/<p:sldIdLst[^>]*>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${newSldEntries}</p:sldIdLst>`);
      zip.file(presPath, presXml);
      zip.file(presRelsPath, updatedPresRels);

      // Update [Content_Types].xml
      const ctPath = '[Content_Types].xml';
      let ctXml = await zip.file(ctPath)!.async('string');
      ctXml = ctXml.replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '');
      const ctEntries = newSlideEntries.map(e => `<Override PartName="/ppt/slides/slide${e.num}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
      ctXml = ctXml.replace('</Types>', `${ctEntries}</Types>`);
      zip.file(ctPath, ctXml);

      const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
      console.log('[ExamPPTX] Template-based PPTX generated successfully');
      return Buffer.from(outBuf);
    } catch (err) {
      console.error('[ExamPPTX] Template processing failed, falling back to PptxGenJS:', err);
    }
  }

  // ======== Default generation (PptxGenJS) ========
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AI Teaching Assistant';
  pptx.title = `${examContent.metadata.course} - ${examContent.metadata.examType}`;

  const colors = {
    background: 'FFFFFF',
    textPrimary: '1f2937',
    textSecondary: '4b5563',
    textMuted: '6b7280',
    accent: '2563eb',
    success: '16a34a',
    codeBg: '1e1e1e',
  };

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: colors.background };
  titleSlide.addText(examContent.metadata.institution || 'University', {
    x: 0.5, y: 1.5, w: 12.4, h: 0.8,
    fontSize: 28, bold: true, color: colors.textPrimary, fontFace: 'Arial', align: 'center',
  });
  titleSlide.addText(examContent.metadata.course || 'Course', {
    x: 0.5, y: 2.5, w: 12.4, h: 0.8,
    fontSize: 36, bold: true, color: colors.accent, fontFace: 'Arial', align: 'center',
  });
  titleSlide.addText(examContent.metadata.examType || 'Examination', {
    x: 0.5, y: 3.5, w: 12.4, h: 0.5,
    fontSize: 24, color: colors.textSecondary, fontFace: 'Arial', align: 'center',
  });
  titleSlide.addText(`Duration: ${examContent.metadata.durationMinutes || 120} minutes  |  Total: ${examContent.metadata.totalMarks || 100} marks`, {
    x: 0.5, y: 4.2, w: 12.4, h: 0.4,
    fontSize: 16, color: colors.textMuted, fontFace: 'Arial', align: 'center',
  });

  // Question slides
  for (const section of examContent.sections) {
    for (const q of section.questions) {
      const qSlide = pptx.addSlide();
      qSlide.background = { color: colors.background };

      qSlide.addText(`Question ${q.number}`, {
        x: 0.5, y: 0.3, w: 10, h: 0.8,
        fontSize: 32, bold: true, color: colors.textPrimary, fontFace: 'Arial',
      });
      qSlide.addText(`${q.marks} marks`, {
        x: 10.5, y: 0.3, w: 2.4, h: 0.8,
        fontSize: 20, color: colors.textMuted, fontFace: 'Arial', align: 'right',
      });

      // Metadata line: type | points | sources
      const metaParts: string[] = [];
      if (q.originalType) metaParts.push(`Type: ${q.originalType}`);
      metaParts.push(`Worth: ${q.marks} pts`);
      if (q.sources && q.sources.length > 0) {
        const srcText = q.sources.map(s => s.pages ? `${s.file} (p. ${s.pages})` : s.file).join('; ');
        metaParts.push(`Source: ${srcText}`);
      }
      qSlide.addText(metaParts.join('  |  '), {
        x: 0.5, y: 1.1, w: 12.4, h: 0.35,
        fontSize: 12, italic: true, color: '9ca3af', fontFace: 'Arial',
      });

      const qText = cleanText((q as any).stem || (q as any).prompt || (q as any).statement || '');
      qSlide.addText(qText, {
        x: 0.5, y: 1.5, w: 12.4, h: 2.5,
        fontSize: 20, color: colors.textPrimary, fontFace: 'Arial', valign: 'top',
      });

      if (q.type === 'mcq' && (q as any).choices) {
        const choices = (q as any).choices as { key: string; text: string }[];
        let yPos = 4.2;
        choices.forEach((c) => {
          qSlide.addText(`${c.key}. ${cleanText(c.text)}`, {
            x: 0.8, y: yPos, w: 11.8, h: 0.5,
            fontSize: 18, color: colors.textSecondary, fontFace: 'Arial',
          });
          yPos += 0.6;
        });
      }

      if (includeSolutions && (q as any).solution) {
        const sSlide = pptx.addSlide();
        sSlide.background = { color: colors.background };

        sSlide.addText(`Question ${q.number} - Answer`, {
          x: 0.5, y: 0.3, w: 12.4, h: 0.8,
          fontSize: 32, bold: true, color: colors.success, fontFace: 'Arial',
        });

        const solText = cleanText((q as any).solution);
        sSlide.addText(solText, {
          x: 0.5, y: 1.3, w: 12.4, h: 5.5,
          fontSize: 18, color: colors.textPrimary, fontFace: 'Arial', valign: 'top',
        });
      }
    }
  }

  const buf = await pptx.write({ outputType: 'nodebuffer' } as any);
  return Buffer.from(buf as any);
}

export async function POST(req: NextRequest) {
  // Check export availability
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const exportCheck = await checkExportAvailable(session.user.id);
  if (!exportCheck.available) {
    return NextResponse.json(
      { 
        error: 'Export limit reached',
        remaining: exportCheck.remaining,
        limit: exportCheck.limit,
      },
      { status: 403 }
    );
  }
  
  try {
    const body: ExportExamRequest = await req.json();
    
    console.log('[API] Logo received:', {
      hasLogo: !!body.institutionLogoBase64,
      logoLength: body.institutionLogoBase64?.length || 0,
      logoPrefix: body.institutionLogoBase64?.substring(0, 30)
    });
    
    let examContent: ExamContent;
    let headerLayout: HeaderLayout;
    
    // Get header layout
    if (body.headerLayout) {
      headerLayout = body.headerLayout;
    } else {
      headerLayout = getHeaderLayout(body.headerLayoutName || 'default');
    }
    
    // Get or convert exam content
    if (body.mode === 'direct' && body.examContent) {
      examContent = body.examContent;
    } else if (body.mode === 'convert' && body.items) {
      // Convert legacy items to exam format
      const options: ConvertToExamOptions = body.convertOptions || {
        course: body.course || 'Course Name',
        institution: body.institution || 'University',
        examType: body.examType || 'Examination',
        durationMinutes: body.durationMinutes || 120,
        instructions: body.instructions,
      };
      
      examContent = convertToExamContent(body.items, options);
    } else {
      return NextResponse.json(
        { error: 'Either examContent (with mode=direct) or items (with mode=convert) must be provided' },
        { status: 400 }
      );
    }
    
    // Determine output format
    const outputFormat = body.format || 'docx';

    // Build export config
    const config: ExamExportConfig = {
      headerLayout,
      examContent,
      studentInfo: body.studentInfo,
      format: outputFormat,
      includeSolutions: body.includeSolutions ?? false,
      institutionLogoBase64: body.institutionLogoBase64,
      templatePptxBase64: typeof body.templatePptxBase64 === 'string' ? body.templatePptxBase64 : undefined,
    };

    let buffer: Buffer;
    let contentType: string;
    let fileExtension: string;

    if (outputFormat === 'pdf') {
      buffer = await generateExamPdf(config);
      contentType = 'application/pdf';
      fileExtension = 'pdf';
    } else if (outputFormat === 'pptx') {
      buffer = await generateExamPptx(config);
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      fileExtension = 'pptx';
    } else {
      // Default to DOCX
      buffer = await exportExamDocx(config);
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      fileExtension = 'docx';
    }

    // Record export usage
    await recordExport(session.user.id);
    
    // Return as downloadable file
    const filename = `${examContent.metadata.course.replace(/[^a-zA-Z0-9]/g, '_')}_${examContent.metadata.examType.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExtension}`;

    // If user is Premium, save to generation history
    try {
      const hasPremium = await hasGenerationHistoryFeature(session.user.id);
      console.log('[Export] Premium check:', { userId: session.user.id, hasPremium });
      
      if (hasPremium) {
        console.log('[Export] Starting upload to Supabase Storage:', { filename, size: buffer.length, format: fileExtension });
        
        // Upload to Supabase Storage
        const uploadResult = await uploadFile(
          session.user.id,
          filename,
          buffer,
          getContentType(fileExtension)
        );
        
        console.log('[Export] Upload result:', uploadResult);
        
        if (uploadResult.success && uploadResult.fileUrl) {
          // Save to generation history
          const historyData = {
            userId: session.user.id,
            module: 'exams',
            title: `${examContent.metadata.course} - ${examContent.metadata.examType}`,
            format: fileExtension, // Use fileExtension which is correctly set based on outputFormat
            fileUrl: uploadResult.fileUrl,
            fileSize: buffer.length,
            metadata: {
              course: examContent.metadata.course,
              examType: examContent.metadata.examType,
              includeSolutions: body.includeSolutions,
            },
          };
          
          console.log('[Export Exam] Saving to generation history:', {
            ...historyData,
            format: fileExtension,
            outputFormat: outputFormat, // Log original format
            formatType: typeof fileExtension,
          });
          const historyResult = await createGenerationHistory(historyData);
          console.log('[Export Exam] ✓ Successfully saved to generation history:', {
            historyId: historyResult.created.id,
            filename,
            format: historyResult.created.format, // Log saved format
            module: historyResult.created.module,
          });
        } else {
          console.error('[Export] Upload failed:', uploadResult.error);
        }
      } else {
        console.log('[Export] User does not have Premium plan, skipping generation history');
      }
    } catch (historyError: any) {
      // Don't fail the export if history saving fails
      console.error('[Export] Failed to save to generation history:', {
        error: historyError.message,
        stack: historyError.stack,
        userId: session.user.id,
      });
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('Export exam error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to export exam' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for testing/preview
 */
export async function GET(req: NextRequest) {
  // Return available layout options and schema info
  return NextResponse.json({
    availableLayouts: ['default', 'minimal'],
    availableFormats: ['docx', 'pdf', 'pptx'],
    modes: ['direct', 'convert'],
    endpoints: {
      POST: {
        description: 'Generate exam paper in DOCX, PDF, or PPTX format',
        body: {
          mode: 'direct | convert',
          format: 'docx | pdf | pptx (default: docx)',
          examContent: 'ExamContent object (for direct mode)',
          items: 'LegacyExportItem[] (for convert mode)',
          headerLayoutName: 'default | minimal',
          course: 'string',
          institution: 'string',
          examType: 'string',
          durationMinutes: 'number',
          instructions: 'string[]',
          studentInfo: { student_id: 'string', name: 'string', class: 'string' },
        },
      },
    },
    questionTypes: ['mcq', 'short', 'programming', 'coding', 'debugging', 'truefalse'],
    sampleConvertRequest: {
      mode: 'convert',
      format: 'docx',
      items: [
        {
          number: 1,
          title: 'Variables',
          type: 'mcq',
          points: 3,
          question: 'Which of the following is a valid Python variable name?',
          choices: [
            { key: 'A', text: '123var' },
            { key: 'B', text: 'my_var' },
            { key: 'C', text: 'my-var' },
            { key: 'D', text: 'my var' },
          ],
        },
        {
          number: 2,
          title: 'Functions',
          type: 'coding',
          points: 15,
          question: 'Write a Python function that calculates the factorial of a number.',
        },
      ],
      course: 'Introduction to Python',
      institution: 'International University',
      examType: 'Final Examination',
      durationMinutes: 120,
    },
  });
}

