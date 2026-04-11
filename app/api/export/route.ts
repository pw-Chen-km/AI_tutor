import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { checkExportAvailable, recordExport } from '@/lib/payments/usage-tracker';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs/promises';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { uploadFile, getContentType } from '@/lib/storage/supabase-storage';
import { createGenerationHistory, hasGenerationHistoryFeature } from '@/lib/db/queries/generation-history';

export const runtime = 'nodejs';

type ExportFormat = 'docx' | 'pdf' | 'pptx';
type ExportLanguage = 'primary' | 'secondary';

type ExportSource = { file: string; pages: string };
type ExportItem = {
    number: number;
    title: string;
    type: string;
    points: number;
    sources: ExportSource[];
    primary: { question: string; solution?: string; explanation?: string };
    secondary?: { question?: string; solution?: string; explanation?: string };
};

function decodeBase64ToBuffer(b64: string): Buffer {
    return Buffer.from(b64, 'base64');
}

function safeString(x: any) {
    return typeof x === 'string' ? x : '';
}

function buildPlainText(payload: {
    title: string;
    languageLabel: string;
    includeSolutions: boolean;
    includeExplanations: boolean;
    exportKind?: 'qa' | 'lecture';
    items: Array<{
        number: number;
        title: string;
        type: string;
        points: number;
        sources: ExportSource[];
        question: string;
        solution?: string;
        explanation?: string;
    }>;
}) {
    const parts: string[] = [];
    parts.push(`# ${payload.title}`);
    parts.push(`Language: ${payload.languageLabel}`);
    parts.push('');
    const exportKind = payload.exportKind || 'qa';
    for (const it of payload.items) {
        if (exportKind === 'lecture') {
            parts.push(`## ${it.title || `Section ${it.number}`}`);
            parts.push('');
            parts.push(safeString(it.question));
            parts.push('');
            parts.push('---');
            parts.push('');
            continue;
        }
        parts.push(`## Problem ${it.number}: ${it.title}`);
        parts.push(`Points: ${it.points}`);
        parts.push(`Type: ${it.type}`);
        if (it.sources?.length) {
            parts.push(`Sources: ${it.sources.map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}`);
        }
        parts.push('');
        parts.push('### Question');
        parts.push(safeString(it.question));
        parts.push('');
        if (payload.includeSolutions) {
            parts.push('### Solution');
            parts.push(safeString(it.solution));
            parts.push('');
            if (payload.includeExplanations) {
                parts.push('### Explanation');
                parts.push(safeString(it.explanation));
                parts.push('');
            }
        }
        parts.push('---');
        parts.push('');
    }
    return parts.join('\n');
}

function splitMarkdownCodeFences(markdown: string) {
    const blocks: Array<{ kind: 'text' | 'code'; lang: string; content: string }> = [];
    const re = /```([A-Za-z0-9_-]+)?\n([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
        const before = markdown.slice(last, m.index);
        if (before.trim().length > 0) blocks.push({ kind: 'text', lang: '', content: before });
        blocks.push({ kind: 'code', lang: (m[1] || '').trim(), content: m[2] || '' });
        last = m.index + m[0].length;
    }
    const rest = markdown.slice(last);
    if (rest.trim().length > 0) blocks.push({ kind: 'text', lang: '', content: rest });
    if (blocks.length === 0) blocks.push({ kind: 'text', lang: '', content: markdown });
    return blocks;
}

async function generateDocx(payload: {
    title: string;
    languageLabel: string;
    includeSolutions: boolean;
    includeExplanations: boolean;
    exportKind?: 'qa' | 'lecture';
    items: Array<{
        number: number;
        title: string;
        type: string;
        points: number;
        sources: ExportSource[];
        question: string;
        solution?: string;
        explanation?: string;
    }>;
    templateDocxBase64?: string;
}) {
    if (payload.templateDocxBase64) {
        const tplBuf = decodeBase64ToBuffer(payload.templateDocxBase64);
        const zip = new PizZip(tplBuf);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.setData({
            TITLE: payload.title,
            CONTENT: buildPlainText(payload),
            title: payload.title,
            content: buildPlainText(payload),
        });
        doc.render();
        const out = doc.getZip().generate({ type: 'nodebuffer' });
        return out as Buffer;
    }

    const children: Paragraph[] = [];
    children.push(new Paragraph({ text: payload.title, heading: HeadingLevel.TITLE }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Language: ${payload.languageLabel}`, italics: true })] }));
    children.push(new Paragraph({ text: '' }));

    const addMarkdown = (md: string) => {
        const blocks = splitMarkdownCodeFences(md || '');
        for (const b of blocks) {
            if (b.kind === 'text') {
                const lines = (b.content || '').split('\n');
                for (const line of lines) {
                    const headerMatch = line.match(/^#{1,6}\s*(.+)$/);
                    if (headerMatch) {
                        children.push(new Paragraph({ children: [new TextRun({ text: headerMatch[1], bold: true })] }));
                    } else {
                        children.push(new Paragraph({ text: line }));
                    }
                }
                continue;
            }
            children.push(new Paragraph({ children: [new TextRun({ text: b.lang ? `Code (${b.lang})` : 'Code', italics: true, color: '666666' })] }));
            const codeLines = (b.content || '').replace(/\r\n/g, '\n').split('\n');
            for (const line of codeLines) {
                children.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas' })] }));
            }
        }
    };

    const exportKind = payload.exportKind || 'qa';
    for (const it of payload.items) {
        if (exportKind === 'lecture') {
            children.push(new Paragraph({ text: it.title || `Section ${it.number}`, heading: HeadingLevel.HEADING_2 }));
            children.push(new Paragraph({ text: '' }));
            addMarkdown(safeString(it.question));
            children.push(new Paragraph({ text: '' }));
            children.push(new Paragraph({ text: '------------------------' }));
            children.push(new Paragraph({ text: '' }));
            continue;
        }
        children.push(new Paragraph({ text: `Problem ${it.number}: ${it.title}`, heading: HeadingLevel.HEADING_2 }));
        children.push(new Paragraph({ text: `Points: ${it.points}` }));
        children.push(new Paragraph({ text: `Type: ${it.type}` }));
        if (it.sources?.length) {
            children.push(new Paragraph({ children: [new TextRun({ text: 'Sources: ', bold: true }), new TextRun({ text: it.sources.map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ') })] }));
        }
        children.push(new Paragraph({ text: '' }));
        children.push(new Paragraph({ text: 'Question', heading: HeadingLevel.HEADING_3 }));
        addMarkdown(safeString(it.question));
        children.push(new Paragraph({ text: '' }));
        if (payload.includeSolutions) {
            children.push(new Paragraph({ text: 'Solution', heading: HeadingLevel.HEADING_3 }));
            addMarkdown(safeString(it.solution));
            children.push(new Paragraph({ text: '' }));
            if (payload.includeExplanations) {
                children.push(new Paragraph({ text: 'Explanation', heading: HeadingLevel.HEADING_3 }));
                addMarkdown(safeString(it.explanation));
                children.push(new Paragraph({ text: '' }));
            }
        }
        children.push(new Paragraph({ text: '------------------------' }));
        children.push(new Paragraph({ text: '' }));
    }

    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    return Buffer.from(buf);
}

async function generatePdf(payload: {
    title: string;
    languageLabel: string;
    includeSolutions: boolean;
    includeExplanations: boolean;
    exportKind?: 'qa' | 'lecture';
    items: Array<{
        number: number;
        title: string;
        type: string;
        points: number;
        sources: ExportSource[];
        question: string;
        solution?: string;
        explanation?: string;
    }>;
}) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const getCjkFontBytes = async () => {
        // 1) Allow user override via env (useful in offline environments)
        const envPath = process.env.PDF_FONT_PATH;
        if (envPath) {
            console.log('[PDF Export] Using custom font from PDF_FONT_PATH:', envPath);
            const buf = await fs.readFile(envPath);
            return new Uint8Array(buf);
        }

        // Detect language variant based on languageLabel
        const label = (payload.languageLabel || '').toLowerCase();
        
        // Traditional Chinese detection
        const isTc = /繁體|traditional|taiwan|hong\s*kong|hk|tw|中文.*繁|chinese.*traditional/i.test(payload.languageLabel || '');
        // Simplified Chinese detection
        const isSc = /简体|simplified|prc|cn|中文.*简|chinese.*simplified|mainland/i.test(payload.languageLabel || '');
        // Japanese detection
        const isJa = /日本語|japanese|ja|jp|にほんご/i.test(payload.languageLabel || '');
        // Korean detection
        const isKo = /한국어|korean|ko|kr|hangul|조선어/i.test(payload.languageLabel || '');
        
        // Determine variant and font configuration
        let variant: 'tc' | 'sc' | 'jp' | 'kr';
        let filename: string;
        let folder: string;
        
        if (isJa) {
            variant = 'jp';
            filename = 'NotoSansCJKjp-Regular.otf';
            folder = 'Japanese';
        } else if (isKo) {
            variant = 'kr';
            filename = 'NotoSansCJKkr-Regular.otf';
            folder = 'Korean';
        } else if (isTc) {
            variant = 'tc';
            filename = 'NotoSansCJKtc-Regular.otf';
            folder = 'TraditionalChinese';
        } else if (isSc) {
            variant = 'sc';
            filename = 'NotoSansCJKsc-Regular.otf';
            folder = 'SimplifiedChinese';
        } else {
            // Default to SC which has good CJK coverage
            // SC font can display most CJK characters even for mixed content
            variant = 'sc';
            filename = 'NotoSansCJKsc-Regular.otf';
            folder = 'SimplifiedChinese';
        }
        
        console.log(`[PDF Export] Language detected: ${payload.languageLabel} -> variant: ${variant}, font: ${filename}`);

        // 2) Cache downloaded font locally
        const cacheDir = path.join(process.cwd(), '.cache', 'fonts');
        const cachePath = path.join(cacheDir, filename);
        try {
            const buf = await fs.readFile(cachePath);
            console.log(`[PDF Export] Using cached font: ${cachePath}`);
            return new Uint8Array(buf);
        } catch {
            console.log(`[PDF Export] Font not cached, will download: ${filename}`);
        }

        await fs.mkdir(cacheDir, { recursive: true });

        // 3) Download an OTF that supports CJK
        // Note: Google Fonts web endpoints are woff2; we need OTF/TTF for pdf-lib.
        const urls = [
            `https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/${folder}/${filename}`,
            // Fallback URLs
            `https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/${folder}/${filename}`,
        ];

        let lastStatus: number | undefined;
        let lastError: string | undefined;
        let ab: ArrayBuffer | null = null;
        
        for (const url of urls) {
            try {
                console.log(`[PDF Export] Attempting to download font from: ${url}`);
                const res = await fetch(url, { 
                    headers: { 'User-Agent': 'AI-Teaching-Assistant/1.0' },
                    // Add timeout
                    signal: AbortSignal.timeout(30000)
                });
                lastStatus = res.status;
                if (res.ok) {
                    ab = await res.arrayBuffer();
                    console.log(`[PDF Export] Font downloaded successfully (${ab.byteLength} bytes)`);
                    break;
                } else {
                    lastError = `HTTP ${res.status} ${res.statusText}`;
                    console.warn(`[PDF Export] Font download failed: ${lastError}`);
                }
            } catch (e: any) {
                lastError = e?.message || 'Unknown error';
                console.warn(`[PDF Export] Font download error: ${lastError}`);
            }
        }
        
        if (!ab) {
            const errorMsg = `Failed to download CJK font "${filename}" for PDF export. ` +
                `Last status: ${lastStatus ?? 'N/A'}, Error: ${lastError ?? 'N/A'}. ` +
                `Set PDF_FONT_PATH environment variable to a local .ttf/.otf file that supports CJK characters to fix this.`;
            console.error(`[PDF Export] ${errorMsg}`);
            throw new Error(errorMsg);
        }
        
        const u8 = new Uint8Array(ab);
        await fs.writeFile(cachePath, Buffer.from(u8));
        console.log(`[PDF Export] Font cached to: ${cachePath}`);
        return u8;
    };

    // Check if content contains CJK characters for debugging
    const allContent = payload.items.map(it => `${it.question || ''} ${it.solution || ''} ${it.explanation || ''}`).join(' ');
    const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(allContent);
    console.log(`[PDF Export] Content length: ${allContent.length}, contains CJK: ${hasCjk}`);
    console.log(`[PDF Export] Content preview: ${allContent.substring(0, 200)}...`);

    // Use a Unicode font for ALL text to avoid WinAnsi encoding errors (e.g., 简)
    console.log(`[PDF Export] Loading CJK font for language: ${payload.languageLabel}`);
    const cjkBytes = await getCjkFontBytes();
    console.log(`[PDF Export] CJK font loaded, size: ${cjkBytes.length} bytes`);
    
    const font = await pdfDoc.embedFont(cjkBytes, { subset: true });
    console.log(`[PDF Export] Font embedded successfully`);
    
    // For simplicity and safety (code may contain unicode too), reuse the same font for monospace blocks.
    // If you want a true monospace CJK font later, we can embed NotoSansMono + fallback.
    const mono = font;
    const pageMargin = 48;
    const fontSize = 11;
    const lineHeight = 14;

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let x = pageMargin;
    let y = height - pageMargin;

    const drawLine = (text: string, opts?: { mono?: boolean; bold?: boolean; size?: number }) => {
        const size = opts?.size ?? fontSize;
        const f = opts?.mono ? mono : font;
        const color = rgb(0.1, 0.1, 0.1);
        const maxWidth = width - pageMargin * 2;
        const raw = (text || '').toString();

        const flush = (line: string) => {
            if (y < pageMargin + lineHeight) {
                page = pdfDoc.addPage();
                ({ width, height } = page.getSize());
                y = height - pageMargin;
            }
            page.drawText(line, { x, y, size, font: f, color });
            y -= lineHeight;
        };

        // Handle explicit newlines inside a "line"
        const parts = raw.split('\n');
        for (let pi = 0; pi < parts.length; pi++) {
            const part = parts[pi];
            if (!part) {
                flush(' ');
                continue;
            }

            // Prefer wrapping by spaces, but fall back to char wrapping for CJK/no-space strings.
            const tokens = part.includes(' ') ? part.split(' ') : [part];
            let line = '';

            const pushToken = (token: string, withSpace: boolean) => {
                const test = line ? (withSpace ? `${line} ${token}` : `${line}${token}`) : token;
                const wWidth = f.widthOfTextAtSize(test, size);
                if (wWidth > maxWidth && line) {
                    flush(line);
                    line = token;
                } else {
                    line = test;
                }
            };

            if (tokens.length === 1 && f.widthOfTextAtSize(tokens[0], size) > maxWidth) {
                // Character wrapping
                for (const ch of Array.from(tokens[0])) {
                    pushToken(ch, false);
                }
            } else {
                for (const t of tokens) {
                    pushToken(t, true);
                }
            }

            if (line) flush(line);
            if (pi < parts.length - 1) flush(' ');
        }
    };

    drawLine(payload.title, { size: 18 });
    drawLine(`Language: ${payload.languageLabel}`, { size: 10 });
    drawLine('');

    const normalizeTextLineForPdf = (line: string) => {
        let s = (line || '').replace(/\r/g, '');
        // Remove markdown inline syntax
        s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
        s = s.replace(/\*([^*]+)\*/g, '$1');
        s = s.replace(/`([^`]+)`/g, '$1');
        // Convert bullets
        s = s.replace(/^[-*]\s+/g, '• ');
        return s;
    };

    const addMarkdown = (md: string) => {
        const blocks = splitMarkdownCodeFences(md || '');
        for (const b of blocks) {
            if (b.kind === 'text') {
                const lines = (b.content || '').split('\n');
                for (const rawLine of lines) {
                    const line = (rawLine || '').trimEnd();
                    const header = line.match(/^#{1,6}\s*(.+?)\s*$/);
                    if (header) {
                        // Render markdown headings without "##"
                        drawLine(header[1], { size: 12 });
                        continue;
                    }
                    drawLine(normalizeTextLineForPdf(line));
                }
                continue;
            }
            drawLine(b.lang ? `Code (${b.lang})` : 'Code', { size: 10 });
            const codeLines = (b.content || '').replace(/\r\n/g, '\n').split('\n');
            for (const line of codeLines) drawLine(line || ' ', { mono: true });
        }
    };

    const exportKind = payload.exportKind || 'qa';
    for (const it of payload.items) {
        if (exportKind === 'lecture') {
            drawLine(it.title || `Section ${it.number}`, { size: 14 });
            drawLine('');
            addMarkdown(safeString(it.question));
            drawLine('');
            drawLine('------------------------');
            drawLine('');
            continue;
        }
        drawLine(`Problem ${it.number}: ${it.title}`, { size: 14 });
        drawLine(`Points: ${it.points}`);
        drawLine(`Type: ${it.type}`);
        if (it.sources?.length) {
            drawLine(`Sources: ${it.sources.map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}`);
        }
        drawLine('');
        drawLine('Question', { size: 12 });
        addMarkdown(safeString(it.question));
        drawLine('');
        if (payload.includeSolutions) {
            drawLine('Solution', { size: 12 });
            addMarkdown(safeString(it.solution));
            drawLine('');
            if (payload.includeExplanations) {
                drawLine('Explanation', { size: 12 });
                addMarkdown(safeString(it.explanation));
                drawLine('');
            }
        }
        drawLine('------------------------');
        drawLine('');
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}

async function generatePptx(payload: {
    title: string;
    languageLabel: string;
    includeSolutions: boolean;
    includeExplanations: boolean;
    exportKind?: 'qa' | 'lecture';
    items: Array<{
        number: number;
        title: string;
        type: string;
        points: number;
        sources: ExportSource[];
        question: string;
        solution?: string;
        explanation?: string;
    }>;
    templatePptxBase64?: string;
}) {
    const escapeXml = (s: string) =>
        (s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

    if (payload.templatePptxBase64) {
        try {
            const tplBuf = decodeBase64ToBuffer(payload.templatePptxBase64);
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

            const newSlideEntries: Array<{ num: number; xml: string; rels: string | null }> = [];
            let currentMaxSlideNum = Math.max(...slidePaths.map(p => Number(p.match(/slide(\d+)\.xml/i)?.[1] || 0)));

            // Helper functions for template mode
            const cleanMarkdownForTemplate = (text: string) => {
                let cleaned = (text || '').replace(/```[\s\S]*?```/g, (m) => {
                    const codeContent = m.replace(/```[A-Za-z0-9_-]*\n?/g, '').replace(/```/g, '').trim();
                    return codeContent;
                });
                cleaned = cleaned
                    .replace(/^#{1,6}\s*/gm, '')           // Remove ## headers
                    .replace(/\*\*([^*]+)\*\*/g, '$1')     // Remove **bold**
                    .replace(/\*([^*]+)\*/g, '$1')         // Remove *italic*
                    .replace(/`([^`]+)`/g, '$1')           // Remove inline `code`
                    .replace(/^[-*]\s+/gm, '• ')           // Convert bullets
                    .trim();
                return cleaned;
            };

            const isCodeLikeForTemplate = (block: string, strict: boolean = false): boolean => {
                const lines = block.split('\n').map((l) => l.trimEnd());
                const nonEmpty = lines.filter((l) => l.trim().length > 0);
                if (nonEmpty.length === 0) return false;
                
                // Strict mode: only for solutions, require stronger evidence
                if (strict) {
                    // Must have at least 2 lines of code-like content
                    if (nonEmpty.length < 2) return false;
                    // Must start with code keywords or have significant indentation
                    const codeStart = /^(def |class |import |from |const |let |var |async |function |public |private |#|@|\s{4,})/;
                    if (!codeStart.test(nonEmpty[0])) return false;
                    // Must have code keywords in multiple lines
                    const codeKeywords = /(def |class |import |from |for |while |if |else:|elif |return |try:|except |with |:=|lambda|function |const |let |var |=)/;
                    const keywordHits = nonEmpty.filter((l) => codeKeywords.test(l)).length;
                    if (keywordHits < 2) return false;
                    // Must have significant indentation (at least 40% of lines)
                    const indentRatio = nonEmpty.filter((l) => /^\s{2,}/.test(l) || l.startsWith('\t')).length / nonEmpty.length;
                    if (indentRatio < 0.4) return false;
                    return true;
                }
                
                // Normal mode: for questions, be more lenient but still require evidence
                const codeKeywords = /(def |class |import |from |for |while |if |else:|elif |return |try:|except |with |:=|lambda|\{|\}|\(|\)|=)/;
                const keywordHits = nonEmpty.filter((l) => codeKeywords.test(l)).length;
                const indentRatio = nonEmpty.filter((l) => /^\s{2,}/.test(l) || l.startsWith('\t')).length / nonEmpty.length;
                const hasSymbols = nonEmpty.some((l) => /[:\(\)=]/.test(l));
                const colonRatio = nonEmpty.filter((l) => /[:\)]\s*$/.test(l)).length / nonEmpty.length;
                const isCodeHead = /^(def |class |import |from |const |let |var |async |#|@)/.test(nonEmpty[0].trim());
                
                // For single line, require very strong evidence
                if (nonEmpty.length === 1) {
                    return isCodeHead || /^("""|'''|#|\/\/)/.test(nonEmpty[0].trim());
                }
                
                // For multiple lines, require strong evidence (at least 2 keywords AND significant indentation)
                return (isCodeHead && keywordHits >= 1) || (keywordHits >= 2 && indentRatio >= 0.3) || (indentRatio >= 0.5);
            };

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

            // Helper to highlight code and convert to XML text runs
            const highlightCodeToXml = (code: string): string => {
                const codeColors = {
                    keyword: '569cd6',    // Blue - keywords
                    string: 'ce9178',     // Orange - strings
                    comment: '6a9955',    // Green - comments
                    function: 'dcdcaa',   // Yellow - function names
                    number: 'b5cea8',     // Light green - numbers
                    default: 'd4d4d4',    // Light gray - default text
                };

                const lines = code.split('\n');
                const result: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const runs: string[] = [];
                    
                    // Handle empty lines
                    if (!line.trim()) {
                        result.push(`<a:p><a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="d4d4d4"/></a:solidFill></a:rPr><a:t> </a:t></a:r></a:p>`);
                        continue;
                    }
                    
                    let remaining = line;

                    while (remaining.length > 0) {
                        // Check for comments (# or //)
                        const commentMatch = remaining.match(/^(#.*|\/\/.*)$/);
                        if (commentMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.comment}"/></a:solidFill></a:rPr><a:t>${escapeXml(commentMatch[0])}</a:t></a:r>`);
                            remaining = '';
                            continue;
                        }

                        // Check for strings
                        const stringMatch = remaining.match(/^(["'])(?:(?!\1|\\).|\\.)*\1/);
                        if (stringMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.string}"/></a:solidFill></a:rPr><a:t>${escapeXml(stringMatch[0])}</a:t></a:r>`);
                            remaining = remaining.slice(stringMatch[0].length);
                            continue;
                        }

                        // Check for keywords
                        const keywordMatch = remaining.match(/^(def|class|function|async|await|return|if|else|elif|for|while|in|import|from|const|let|var|try|except|catch|finally|throw|new|this|self|True|False|None|true|false|null|undefined|and|or|not)\b/);
                        if (keywordMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.keyword}"/></a:solidFill></a:rPr><a:t>${escapeXml(keywordMatch[0])}</a:t></a:r>`);
                            remaining = remaining.slice(keywordMatch[0].length);
                            continue;
                        }

                        // Check for numbers
                        const numberMatch = remaining.match(/^-?\d+\.?\d*/);
                        if (numberMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.number}"/></a:solidFill></a:rPr><a:t>${escapeXml(numberMatch[0])}</a:t></a:r>`);
                            remaining = remaining.slice(numberMatch[0].length);
                            continue;
                        }

                        // Check for function calls (word followed by parenthesis)
                        const funcMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/);
                        if (funcMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.function}"/></a:solidFill></a:rPr><a:t>${escapeXml(funcMatch[1])}</a:t></a:r>`);
                            remaining = remaining.slice(funcMatch[1].length);
                            continue;
                        }

                        // Default: take next character or word
                        const defaultMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*|\s+|.)/);
                        if (defaultMatch) {
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.default}"/></a:solidFill></a:rPr><a:t>${escapeXml(defaultMatch[0])}</a:t></a:r>`);
                            remaining = remaining.slice(defaultMatch[0].length);
                        } else {
                            // Fallback
                            runs.push(`<a:r><a:rPr lang="en-US" sz="1800" fontFace="Consolas"><a:solidFill><a:srgbClr val="${codeColors.default}"/></a:solidFill></a:rPr><a:t>${escapeXml(remaining[0])}</a:t></a:r>`);
                            remaining = remaining.slice(1);
                        }
                    }

                    result.push(`<a:p>${runs.join('')}</a:p>`);
                }

                return result.join('');
            };

            const createCodeBoxXml = (id: number, name: string, code: string, x: number, y: number, w: number, h: number) => {
                const lines = code.split('\n');
                const codeLines = lines.length;
                // Calculate height: top padding (0.15") + lines * line height (0.32" per line for Consolas 18pt) + bottom padding (0.25")
                // Use more generous line height (0.32") and larger buffer (1.8x) to ensure all code fits
                const lineHeight = 0.32; // More generous line height
                const topPadding = 0.15;
                const bottomPadding = 0.25;
                const calculatedHeight = (topPadding + codeLines * lineHeight + bottomPadding) * 1.8; // 80% buffer
                // Use the larger of: calculated height or provided height, but cap at reasonable max (7.0")
                const boxHeight = Math.max(h, Math.max(1.8 * EMU, Math.min(7.0 * EMU, calculatedHeight * EMU)));
                
                // Background rectangle (black)
                const bgRect = `
                <p:sp>
                    <p:nvSpPr>
                        <p:cNvPr id="${id}" name="${name}_bg"/>
                        <p:cNvSpPr/>
                        <p:nvPr/>
                    </p:nvSpPr>
                    <p:spPr>
                        <a:xfrm>
                            <a:off x="${Math.round(x)}" y="${Math.round(y)}"/>
                            <a:ext cx="${Math.round(w)}" cy="${Math.round(boxHeight)}"/>
                        </a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                        <a:solidFill><a:srgbClr val="1e1e1e"/></a:solidFill>
                        <a:ln w="12700"><a:solidFill><a:srgbClr val="3c3c3c"/></a:solidFill></a:ln>
                    </p:spPr>
                </p:sp>`;

                // Code text with syntax highlighting
                const codeText = highlightCodeToXml(code);

                const textBox = `
                <p:sp>
                    <p:nvSpPr>
                        <p:cNvPr id="${id + 1}" name="${name}_text"/>
                        <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
                        <p:nvPr/>
                    </p:nvSpPr>
                    <p:spPr>
                        <a:xfrm>
                            <a:off x="${Math.round(x + 0.1 * EMU)}" y="${Math.round(y + 0.08 * EMU)}"/>
                            <a:ext cx="${Math.round(w - 0.2 * EMU)}" cy="${Math.round(boxHeight - 0.16 * EMU)}"/>
                        </a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                        <a:noFill/>
                    </p:spPr>
                    <p:txBody>
                        <a:bodyPr rtlCol="0" anchor="t" wrap="square" numCol="1" spcCol="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" bIns="45720" tIns="45720" lIns="91440" rIns="91440"/>
                        <a:lstStyle/>
                        ${codeText}
                    </p:txBody>
                </p:sp>`;

                return bgRect + textBox;
            };

            const EMU = 914400; 
            for (const it of payload.items) {
                currentMaxSlideNum++;
                let slideXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
                const shapes: string[] = [];
                let nextId = 1000 + (it.number * 20);
                shapes.push(createShapeXml(nextId++, 'Title', `Problem ${it.number}: ${it.title}`, 0.5 * EMU, 0.4 * EMU, 12 * EMU, 0.8 * EMU, { fontSize: 36, bold: true }));
                const metaText = [`${it.points} pts`, it.type, it.sources?.length ? it.sources.map(s => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ') : ''].filter(Boolean).join('  •  ');
                shapes.push(createShapeXml(nextId++, 'Meta', metaText, 0.5 * EMU, 1.2 * EMU, 12 * EMU, 0.4 * EMU, { fontSize: 14, color: '666666' }));
                shapes.push(createShapeXml(nextId++, 'QuestionHeader', 'Question:', 0.5 * EMU, 1.8 * EMU, 3 * EMU, 0.5 * EMU, { fontSize: 20, bold: true, color: '2563EB' }));
                let questionY = 2.4 * EMU;
                const questionText = it.question || '';
                
                // Extract code blocks first
                const codeBlockRegex = /```([a-zA-Z0-9_-]*)?\s*\n?([\s\S]*?)```/g;
                let lastIndex = 0;
                let match;
                let hasCodeBlocks = false;
                
                while ((match = codeBlockRegex.exec(questionText)) !== null) {
                    hasCodeBlocks = true;
                    // Add text before code block
                    if (match.index > lastIndex) {
                        const textBefore = cleanMarkdownForTemplate(questionText.slice(lastIndex, match.index));
                        if (textBefore.trim()) {
                            shapes.push(createShapeXml(nextId++, 'QuestionText', textBefore, 0.5 * EMU, questionY, 12 * EMU, 1.0 * EMU, { fontSize: 18 }));
                            questionY += 1.2 * EMU;
                        }
                    }
                    // Add code block
                    let codeContent = (match[2] || '').trim();
                    const firstLine = codeContent.split('\n')[0].trim();
                    if (firstLine && /^[a-zA-Z0-9_-]+$/.test(firstLine) && !match[1]) {
                        codeContent = codeContent.slice(firstLine.length).trim();
                    }
                    if (codeContent) {
                        // Calculate proper height based on code lines (using same formula as createCodeBoxXml)
                        const codeLines = codeContent.split('\n').length;
                        const estimatedHeight = (0.15 + codeLines * 0.32 + 0.25) * 1.8 * EMU;
                        const codeHeight = Math.max(2.0 * EMU, Math.min(7.0 * EMU, estimatedHeight));
                        shapes.push(createCodeBoxXml(nextId++, 'QuestionCode', codeContent, 0.5 * EMU, questionY, 12 * EMU, codeHeight));
                        nextId += 2;
                        questionY += (codeHeight / EMU) + 0.15 * EMU;
                    }
                    lastIndex = match.index + match[0].length;
                }
                
                // Add remaining text or full content if no code blocks
                // For questions, only use code box if there are explicit code fences (```)
                // Don't use heuristic detection for questions to avoid false positives
                if (!hasCodeBlocks) {
                    const questionCleaned = cleanMarkdownForTemplate(questionText);
                    // Always use regular text box for questions (no heuristic code detection)
                    shapes.push(createShapeXml(nextId++, 'QuestionContent', questionCleaned, 0.5 * EMU, questionY, 12 * EMU, 4.5 * EMU, { fontSize: 18 }));
                } else if (lastIndex < questionText.length) {
                    const textAfter = cleanMarkdownForTemplate(questionText.slice(lastIndex));
                    if (textAfter.trim()) {
                        shapes.push(createShapeXml(nextId++, 'QuestionTextAfter', textAfter, 0.5 * EMU, questionY, 12 * EMU, 1.0 * EMU, { fontSize: 18 }));
                    }
                }
                const spTreeEnd = slideXml.lastIndexOf('</p:spTree>');
                if (spTreeEnd !== -1) slideXml = slideXml.substring(0, spTreeEnd) + shapes.join('') + slideXml.substring(spTreeEnd);
                newSlideEntries.push({ num: currentMaxSlideNum, xml: slideXml, rels: masterRelsXml });

                if (payload.includeSolutions && it.solution) {
                    currentMaxSlideNum++;
                    let ansXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
                    const ansShapes: string[] = [];
                    let aId = 2000 + (it.number * 20);
                    ansShapes.push(createShapeXml(aId++, 'Title', `Problem ${it.number}: ${it.title}`, 0.5 * EMU, 0.4 * EMU, 12 * EMU, 0.8 * EMU, { fontSize: 36, bold: true }));
                    ansShapes.push(createShapeXml(aId++, 'SolutionHeader', 'Solution:', 0.5 * EMU, 1.6 * EMU, 3 * EMU, 0.5 * EMU, { fontSize: 20, bold: true, color: '16A34A' }));
                    
                    let solutionY = 2.2 * EMU;
                    const solutionText = it.solution || '';
                    
                    // Extract code blocks first
                    const codeBlockRegex = /```([a-zA-Z0-9_-]*)?\s*\n?([\s\S]*?)```/g;
                    let lastIndex = 0;
                    let match;
                    let hasCodeBlocks = false;

                    // If this is a coding-like problem, render the entire solution as ONE code box
                    // (avoid fragmented multiple code boxes which looks messy in PPT)
                    const tplProblemType = String(it.type || '').toLowerCase();
                    const tplIsCodingType =
                        tplProblemType.includes('coding') ||
                        tplProblemType.includes('debugging') ||
                        tplProblemType.includes('trace') ||
                        tplProblemType === 'code';

                    if (tplIsCodingType) {
                        const blocks: string[] = [];
                        codeBlockRegex.lastIndex = 0;
                        while ((match = codeBlockRegex.exec(solutionText)) !== null) {
                            const c = (match[2] || '').trim();
                            if (c) blocks.push(c);
                        }
                        // For coding problems, if no explicit code blocks, extract the entire solution
                        // but remove markdown formatting and ``` markers
                        let combined: string;
                        if (blocks.length > 0) {
                            combined = blocks.join('\n\n');
                        } else {
                            // Remove all ``` markers and clean up
                            combined = solutionText
                                .replace(/```[a-zA-Z0-9_-]*\s*\n?/g, '')
                                .replace(/```/g, '')
                                .replace(/^#{1,6}\s*/gm, '')
                                .replace(/\*\*([^*]+)\*\*/g, '$1')
                                .replace(/\*([^*]+)\*/g, '$1')
                                .replace(/`([^`]+)`/g, '$1')
                                .trim();
                        }
                        const codeLines = combined.split('\n').length;
                        const estimatedHeight = (0.15 + codeLines * 0.32 + 0.25) * 1.8 * EMU;
                        const codeHeight = Math.max(2.0 * EMU, Math.min(7.0 * EMU, estimatedHeight));
                        ansShapes.push(createCodeBoxXml(aId++, 'SolutionContent', combined, 0.5 * EMU, solutionY, 12 * EMU, codeHeight));
                        aId += 2;
                        hasCodeBlocks = true;
                        lastIndex = solutionText.length;
                    }
                    
                    while (!tplIsCodingType && (match = codeBlockRegex.exec(solutionText)) !== null) {
                        hasCodeBlocks = true;
                        // Add text before code block
                        if (match.index > lastIndex) {
                            const textBefore = cleanMarkdownForTemplate(solutionText.slice(lastIndex, match.index));
                            if (textBefore.trim()) {
                                ansShapes.push(createShapeXml(aId++, 'SolutionText', textBefore, 0.5 * EMU, solutionY, 12 * EMU, 0.8 * EMU, { fontSize: 18 }));
                                solutionY += 1.0 * EMU;
                            }
                        }
                        // Add code block
                        let codeContent = (match[2] || '').trim();
                        const firstLine = codeContent.split('\n')[0].trim();
                        if (firstLine && /^[a-zA-Z0-9_-]+$/.test(firstLine) && !match[1]) {
                            codeContent = codeContent.slice(firstLine.length).trim();
                        }
                        if (codeContent) {
                            // Calculate proper height based on code lines (createCodeBoxXml will recalculate, but we need it for positioning)
                            const codeLines = codeContent.split('\n').length;
                            const estimatedHeight = (0.15 + codeLines * 0.32 + 0.25) * 1.8 * EMU;
                            const codeHeight = Math.max(2.0 * EMU, Math.min(7.0 * EMU, estimatedHeight));
                            ansShapes.push(createCodeBoxXml(aId++, 'SolutionCode', codeContent, 0.5 * EMU, solutionY, 12 * EMU, codeHeight));
                            aId += 2;
                            solutionY += (codeHeight / EMU) + 0.15 * EMU;
                        }
                        lastIndex = match.index + match[0].length;
                    }
                    
                    // Add remaining text or full content if no code blocks
                    // Check if problem type is coding - if so, wrap entire solution as code
                    if (!hasCodeBlocks) {
                        const solutionCleaned = cleanMarkdownForTemplate(solutionText);
                        // Check problem type: if coding/debugging/trace, always use code box
                        const problemType = String(it.type || '').toLowerCase();
                        const isCodingType = problemType.includes('coding') || 
                                           problemType.includes('debugging') || 
                                           problemType.includes('trace') ||
                                           problemType === 'code';
                        
                        if (isCodingType) {
                            // For coding problems, always wrap entire solution as code
                            const codeLines = solutionCleaned.split('\n').length;
                            const estimatedHeight = (0.15 + codeLines * 0.32 + 0.25) * 1.8 * EMU;
                            const codeHeight = Math.max(2.0 * EMU, Math.min(7.0 * EMU, estimatedHeight));
                            ansShapes.push(createCodeBoxXml(aId++, 'SolutionContent', solutionCleaned, 0.5 * EMU, solutionY, 12 * EMU, codeHeight));
                            aId += 2;
                        } else if (isCodeLikeForTemplate(solutionCleaned, true)) {
                            // Use strict mode: only treat as code if there's strong evidence
                            const codeLines = solutionCleaned.split('\n').length;
                            const estimatedHeight = (0.15 + codeLines * 0.32 + 0.25) * 1.8 * EMU;
                            const codeHeight = Math.max(2.0 * EMU, Math.min(7.0 * EMU, estimatedHeight));
                            ansShapes.push(createCodeBoxXml(aId++, 'SolutionContent', solutionCleaned, 0.5 * EMU, solutionY, 12 * EMU, codeHeight));
                            aId += 2;
                        } else {
                            ansShapes.push(createShapeXml(aId++, 'SolutionContent', solutionCleaned, 0.5 * EMU, solutionY, 12 * EMU, 2.5 * EMU, { fontSize: 18 }));
                        }
                    } else if (lastIndex < solutionText.length) {
                        const textAfter = cleanMarkdownForTemplate(solutionText.slice(lastIndex));
                        if (textAfter.trim()) {
                            ansShapes.push(createShapeXml(aId++, 'SolutionTextAfter', textAfter, 0.5 * EMU, solutionY, 12 * EMU, 0.8 * EMU, { fontSize: 18 }));
                        }
                    }
                    
                    // For coding-type problems with code solutions, put explanation on a separate slide
                    // Otherwise, include explanation on the same slide
                    const solutionHasCode = tplIsCodingType || hasCodeBlocks;
                    
                    if (payload.includeExplanations && it.explanation && !solutionHasCode) {
                        // Non-coding: put explanation on same slide
                        ansShapes.push(createShapeXml(aId++, 'ExplanationHeader', 'Explanation:', 0.5 * EMU, 4.8 * EMU, 3 * EMU, 0.5 * EMU, { fontSize: 20, bold: true, color: 'D97706' }));
                        const explanationCleaned = cleanMarkdownForTemplate(it.explanation);
                        ansShapes.push(createShapeXml(aId++, 'ExplanationContent', explanationCleaned, 0.5 * EMU, 5.4 * EMU, 12 * EMU, 1.8 * EMU, { fontSize: 16 }));
                    }
                    
                    const aTreeEnd = ansXml.lastIndexOf('</p:spTree>');
                    if (aTreeEnd !== -1) ansXml = ansXml.substring(0, aTreeEnd) + ansShapes.join('') + ansXml.substring(aTreeEnd);
                    newSlideEntries.push({ num: currentMaxSlideNum, xml: ansXml, rels: masterRelsXml });
                    
                    // For coding-type problems: create a separate slide for explanation
                    if (payload.includeExplanations && it.explanation && solutionHasCode) {
                        currentMaxSlideNum++;
                        let expXml = masterXml.replace(/<p:sp>[\s\S]*?\{\{.*?\}\}[\s\S]*?<\/p:sp>/gi, '');
                        const expShapes: string[] = [];
                        let eId = 3000 + (it.number * 20);
                        
                        expShapes.push(createShapeXml(eId++, 'Title', `Problem ${it.number}: ${it.title}`, 0.5 * EMU, 0.4 * EMU, 12 * EMU, 0.8 * EMU, { fontSize: 36, bold: true }));
                        expShapes.push(createShapeXml(eId++, 'ExplanationHeader', 'Explanation:', 0.5 * EMU, 1.4 * EMU, 3 * EMU, 0.5 * EMU, { fontSize: 20, bold: true, color: 'D97706' }));
                        
                        const explanationCleaned = cleanMarkdownForTemplate(it.explanation);
                        // Use larger area for explanation on its own slide
                        expShapes.push(createShapeXml(eId++, 'ExplanationContent', explanationCleaned, 0.5 * EMU, 2.0 * EMU, 12 * EMU, 5.0 * EMU, { fontSize: 16 }));
                        
                        const eTreeEnd = expXml.lastIndexOf('</p:spTree>');
                        if (eTreeEnd !== -1) expXml = expXml.substring(0, eTreeEnd) + expShapes.join('') + expXml.substring(eTreeEnd);
                        newSlideEntries.push({ num: currentMaxSlideNum, xml: expXml, rels: masterRelsXml });
                    }
                }
            }

            slidePaths.forEach(p => { zip.remove(p); const rPath = `ppt/slides/_rels/${p.split('/').pop()}.rels`; if (zip.file(rPath)) zip.remove(rPath); });
            newSlideEntries.forEach(e => { zip.file(`ppt/slides/slide${e.num}.xml`, e.xml); if (e.rels) zip.file(`ppt/slides/_rels/slide${e.num}.xml.rels`, e.rels); });

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

            const ctPath = '[Content_Types].xml';
            let ctXml = await zip.file(ctPath)!.async('string');
            ctXml = ctXml.replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '');
            const ctEntries = newSlideEntries.map(e => `<Override PartName="/ppt/slides/slide${e.num}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
            ctXml = ctXml.replace('</Types>', `${ctEntries}</Types>`);
            zip.file(ctPath, ctXml);

            const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
            return Buffer.from(outBuf);
        } catch (err) {
            console.error('PPTX Template Error:', err);
        }
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'AI Teaching Assistant';
    pptx.title = payload.title;
    const colors = { background: 'FFFFFF', textPrimary: '1f2937', textSecondary: '4b5563', textMuted: '6b7280', accent: '2563eb', success: '16a34a', warning: 'd97706', codeBg: '1e1e1e' };

    const isCodeLike = (block: string): boolean => {
        const lines = block.split('\n').map((l) => l.trimEnd());
        const nonEmpty = lines.filter((l) => l.trim().length > 0);
        if (nonEmpty.length === 0) return false;
        const codeKeywords = /(def |class |import |from |for |while |if |else:|elif |return |try:|except |with |:=|lambda|\{|\}|\(|\)|=)/;
        const keywordHits = nonEmpty.filter((l) => codeKeywords.test(l)).length;
        const indentRatio = nonEmpty.filter((l) => /^\s{2,}/.test(l) || l.startsWith('\t')).length / nonEmpty.length;
        const hasSymbols = nonEmpty.some((l) => /[:\(\)=]/.test(l));
        const colonRatio = nonEmpty.filter((l) => /[:\)]\s*$/.test(l)).length / nonEmpty.length;
        const isCodeHead = /^(def |class |import |from |const |let |var |async |#|@)/.test(nonEmpty[0].trim());
        if (nonEmpty.length === 1) return isCodeHead || (keywordHits >= 1 && hasSymbols) || /^("""|'''|#|\/\/)/.test(nonEmpty[0].trim());
        return (isCodeHead || (keywordHits >= 1 && (indentRatio >= 0.2 || colonRatio >= 0.2)) || (keywordHits >= 2) || (indentRatio >= 0.4) || (colonRatio >= 0.4));
    };

    const parseMixedContent = (text: string) => {
        const segments: Array<{ type: 'text' | 'code'; content: string }> = [];
        const input = text || '';
        const pushSeg = (seg: { type: 'text' | 'code'; content: string }) => {
            const content = (seg.content || '').trim();
            if (!content) return;
            const last = segments[segments.length - 1];
            // Merge adjacent code segments to avoid fragmented layout in PPT
            if (last && last.type === 'code' && seg.type === 'code') {
                last.content = `${last.content}\n\n${content}`;
                return;
            }
            // Merge adjacent text segments too (keeps layout cleaner)
            if (last && last.type === 'text' && seg.type === 'text') {
                last.content = `${last.content}\n\n${content}`;
                return;
            }
            segments.push({ type: seg.type, content });
        };
        const processTextSegment = (txt: string) => {
            if (!txt.trim()) return;
            const paragraphs = txt.split(/\n{2,}/);
            for (const para of paragraphs) {
                if (!para.trim()) continue;
                if (isCodeLike(para)) pushSeg({ type: 'code', content: para.trim() });
                else pushSeg({ type: 'text', content: para.trim() });
            }
        };
        const fenceRegex = /```([a-zA-Z0-9_-]*)?\s*\n?([\s\S]*?)```|``([a-zA-Z0-9_-]*)?\s*\n?([\s\S]*?)``/g;
        let lastIndex = 0;
        let match;
        while ((match = fenceRegex.exec(input)) !== null) {
            if (match.index > lastIndex) processTextSegment(input.slice(lastIndex, match.index));
            let code = (match[2] || match[4] || '').trim();
            const firstLine = code.split('\n')[0].trim();
            if (firstLine && /^[a-zA-Z0-9_-]+$/.test(firstLine)) code = code.slice(firstLine.length).trim();
            if (code) pushSeg({ type: 'code', content: code });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < input.length) processTextSegment(input.slice(lastIndex));
        if (segments.length === 0 && input.trim()) pushSeg({ type: 'text', content: input.trim() });
        return segments;
    };

    const cleanMarkdown = (text: string) => {
        let cleaned = (text || '').replace(/```[\s\S]*?```/g, (m) => m.replace(/```[A-Za-z0-9_-]*\n?/g, '').replace(/```/g, '').trim());
        return cleaned.replace(/^#{1,6}\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^[-*]\s+/gm, '• ').trim();
    };

    const highlightCode = (code: string) => {
        const result: any[] = [];
        const baseOptions = { fontFace: 'Consolas', fontSize: 18 };
        const codeColors = { keyword: '569cd6', string: 'ce9178', comment: '6a9955', function: 'dcdcaa', number: 'b5cea8', default: 'd4d4d4' };
        code.split('\n').forEach((line, i) => {
            if (i > 0) result.push({ text: '\n', options: { ...baseOptions, color: codeColors.default } });
            let remaining = line;
            while (remaining.length > 0) {
                const commentMatch = remaining.match(/^(#.*|\/\/.*)$/);
                if (commentMatch) { result.push({ text: commentMatch[0], options: { ...baseOptions, color: codeColors.comment } }); remaining = ''; continue; }
                const stringMatch = remaining.match(/^(["'])(?:(?!\1|\\).|\\.)*\1/);
                if (stringMatch) { result.push({ text: stringMatch[0], options: { ...baseOptions, color: codeColors.string } }); remaining = remaining.slice(stringMatch[0].length); continue; }
                const keywordMatch = remaining.match(/^(def|class|function|async|await|return|if|else|elif|for|while|in|import|from|const|let|var|try|except|catch|finally|throw|new|this|self|True|False|None|true|false|null|undefined|and|or|not)\b/);
                if (keywordMatch) { result.push({ text: keywordMatch[0], options: { ...baseOptions, color: codeColors.keyword } }); remaining = remaining.slice(keywordMatch[0].length); continue; }
                const numberMatch = remaining.match(/^-?\d+\.?\d*/);
                if (numberMatch) { result.push({ text: numberMatch[0], options: { ...baseOptions, color: codeColors.number } }); remaining = remaining.slice(numberMatch[0].length); continue; }
                const funcMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/);
                if (funcMatch) { result.push({ text: funcMatch[1], options: { ...baseOptions, color: codeColors.function } }); remaining = remaining.slice(funcMatch[1].length); continue; }
                const defaultMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*|\s+|.)/);
                if (defaultMatch) { result.push({ text: defaultMatch[0], options: { ...baseOptions, color: codeColors.default } }); remaining = remaining.slice(defaultMatch[0].length); }
                else { result.push({ text: remaining[0], options: { ...baseOptions, color: codeColors.default } }); remaining = remaining.slice(1); }
            }
        });
        return result;
    };

    const renderMixedContent = (slide: any, segments: any[], startY: number, maxY: number, fs: number = 18) => {
        let currentY = startY;
        for (const segment of segments) {
            if (currentY >= maxY) break;
            if (segment.type === 'code') {
                const code = segment.content;
                const h = Math.min(maxY - currentY - 0.2, Math.max(1.5, (0.3 + code.split('\n').length * 0.26 + 0.4) * 1.4));
                if (h < 1.0) break;
                slide.addShape('rect', { x: 0.4, y: currentY, w: 12.6, h, fill: { color: '1e1e1e' }, line: { color: '3c3c3c', pt: 1 } });
                slide.addText(highlightCode(code), { x: 0.5, y: currentY + 0.05, w: 12.4, h: h - 0.1, valign: 'top', autoFit: false, shrinkText: false, lineSpacing: 1.15 });
                currentY += h + 0.2;
            } else {
                const txt = cleanMarkdown(segment.content);
                if (!txt.trim()) continue;
                const h = Math.min(maxY - currentY - 0.2, Math.max(0.3, (txt.split('\n').length * 0.22 + 0.1)));
                if (h < 0.2) break;
                slide.addText(txt, { x: 0.4, y: currentY, w: 12.6, h, fontSize: fs, color: colors.textPrimary, fontFace: 'Arial', valign: 'top' });
                currentY += h + 0.15;
            }
        }
        return currentY;
    };

    const exportKind = payload.exportKind || 'qa';

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: colors.background };
    titleSlide.addText(payload.title, { x: 0.6, y: 2.8, w: 12.2, h: 1.2, fontSize: 32, bold: true, color: colors.textPrimary, fontFace: 'Arial', align: 'center' });
    titleSlide.addText(`Language: ${payload.languageLabel}`, { x: 0.6, y: 4.0, w: 12.2, h: 0.5, fontSize: 16, color: colors.textSecondary, align: 'center' });
    titleSlide.addText(`Generated by AI Teaching Assistant`, { x: 0.6, y: 6.8, w: 12.2, h: 0.3, fontSize: 11, color: colors.textMuted, align: 'center' });

    for (const it of payload.items) {
        if (exportKind === 'lecture') {
            const slide = pptx.addSlide();
            slide.background = { color: colors.background };
            slide.addText(it.title || `Section ${it.number}`, { x: 0.4, y: 0.3, w: 12.6, h: 0.8, fontSize: 40, bold: true, color: colors.textPrimary, fontFace: 'Arial' });
            slide.addText('Content:', { x: 0.4, y: 1.3, w: 3, h: 0.5, fontSize: 20, bold: true, color: colors.accent, fontFace: 'Arial' });
            renderMixedContent(slide, parseMixedContent(safeString(it.question)), 1.9, 6.9, 18);
            continue;
        }

        const qSlide = pptx.addSlide();
        qSlide.background = { color: colors.background };
        qSlide.addText(`Problem ${it.number}: ${it.title}`, { x: 0.4, y: 0.3, w: 12.6, h: 0.8, fontSize: 40, bold: true, color: colors.textPrimary, fontFace: 'Arial' });
        const metaText = [`${it.points} pts`, it.type, it.sources?.length ? it.sources.map((s: any) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ') : ''].filter(Boolean).join('  •  ');
        qSlide.addText(metaText, { x: 0.4, y: 1.15, w: 12.6, h: 0.4, fontSize: 14, color: colors.textMuted, fontFace: 'Arial' });
        qSlide.addText('Question:', { x: 0.4, y: 1.6, w: 3, h: 0.5, fontSize: 20, bold: true, color: colors.accent, fontFace: 'Arial' });
        renderMixedContent(qSlide, parseMixedContent(safeString(it.question)), 2.2, 6.8, 18);

        if (payload.includeSolutions && it.solution) {
            const aSlide = pptx.addSlide();
            aSlide.background = { color: colors.background };
            aSlide.addText(`Problem ${it.number}: ${it.title}`, { x: 0.4, y: 0.3, w: 12.6, h: 0.8, fontSize: 40, bold: true, color: colors.textPrimary, fontFace: 'Arial' });
            aSlide.addText(metaText, { x: 0.4, y: 1.15, w: 12.6, h: 0.4, fontSize: 14, color: colors.textMuted, fontFace: 'Arial' });
            let yPos = 1.6;
            aSlide.addText('Solution:', { x: 0.4, y: yPos, w: 3, h: 0.5, fontSize: 20, bold: true, color: colors.success, fontFace: 'Arial' });
            yPos += 0.55;
            const solMaxY = payload.includeExplanations ? 5.5 : 7.3;
            // Check if problem type is coding - if so, wrap entire solution as code
            const problemType = String(it.type || '').toLowerCase();
            const isCodingType = problemType.includes('coding') || 
                               problemType.includes('debugging') || 
                               problemType.includes('trace') ||
                               problemType === 'code';
            if (isCodingType) {
                // For coding problems, treat entire solution as code
                // Use full slide height since explanation goes on separate slide
                const codeMaxY = payload.includeExplanations ? 7.0 : solMaxY;
                const solutionText = safeString(it.solution);
                const code = cleanMarkdown(solutionText).replace(/```[\s\S]*?```/g, (m) => m.replace(/```[A-Za-z0-9_-]*\n?/g, '').replace(/```/g, '').trim());
                const h = Math.min(codeMaxY - yPos - 0.2, Math.max(1.5, (0.3 + code.split('\n').length * 0.26 + 0.4) * 1.4));
                if (h >= 1.0) {
                    aSlide.addShape('rect', { x: 0.4, y: yPos, w: 12.6, h, fill: { color: '1e1e1e' }, line: { color: '3c3c3c', pt: 1 } });
                    aSlide.addText(highlightCode(code), { x: 0.5, y: yPos + 0.05, w: 12.4, h: h - 0.1, valign: 'top', autoFit: false, shrinkText: false, lineSpacing: 1.15 });
                    yPos += h + 0.2;
                }
                
                // For coding problems: put explanation on a SEPARATE slide
                if (payload.includeExplanations && it.explanation) {
                    const expSlide = pptx.addSlide();
                    expSlide.background = { color: colors.background };
                    expSlide.addText(`Problem ${it.number}: ${it.title}`, { x: 0.4, y: 0.3, w: 12.6, h: 0.8, fontSize: 40, bold: true, color: colors.textPrimary, fontFace: 'Arial' });
                    expSlide.addText(metaText, { x: 0.4, y: 1.15, w: 12.6, h: 0.4, fontSize: 14, color: colors.textMuted, fontFace: 'Arial' });
                    expSlide.addText('Explanation:', { x: 0.4, y: 1.6, w: 3, h: 0.5, fontSize: 20, bold: true, color: colors.warning, fontFace: 'Arial' });
                    expSlide.addText(cleanMarkdown(safeString(it.explanation)), { x: 0.4, y: 2.2, w: 12.6, h: 5.0, fontSize: 16, color: colors.textSecondary, fontFace: 'Arial', valign: 'top' });
                }
            } else {
                yPos = renderMixedContent(aSlide, parseMixedContent(safeString(it.solution)), yPos, solMaxY, 18);
                
                // For non-coding problems: put explanation on same slide
                if (payload.includeExplanations && it.explanation) {
                    aSlide.addText('Explanation:', { x: 0.4, y: yPos, w: 3, h: 0.5, fontSize: 20, bold: true, color: colors.warning, fontFace: 'Arial' });
                    yPos += 0.55;
                    aSlide.addText(cleanMarkdown(safeString(it.explanation)), { x: 0.4, y: yPos, w: 12.6, h: 2.5, fontSize: 18, color: colors.textSecondary, fontFace: 'Arial', valign: 'top' });
                }
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
        const body = await req.json();
        const exportKind = (body?.exportKind || 'qa') as 'qa' | 'lecture';
        const format = body?.format as ExportFormat;
        const filename = (body?.filename || 'export').toString();
        const language = (body?.language || 'primary') as ExportLanguage;
        const title = (body?.title || 'Export').toString();
        const includeSolutions = exportKind === 'lecture' ? false : Boolean(body?.includeSolutions);
        const includeExplanations = exportKind === 'lecture' ? false : Boolean(body?.includeExplanations);
        const items = Array.isArray(body?.items) ? (body.items as ExportItem[]) : [];
        const primaryLanguage = (body?.primaryLanguage || 'English').toString();
        const secondaryLanguage = (body?.secondaryLanguage || 'none').toString();
        const languageLabel = language === 'primary' ? primaryLanguage : secondaryLanguage;
        const moduleId = (body?.moduleId || (exportKind === 'lecture' ? 'lecture_rehearsal' : 'exams')) as string;

        const normalizedItems = items.map((it) => {
            const q = language === 'primary' ? safeString(it?.primary?.question) : safeString(it?.secondary?.question);
            const sol = language === 'primary' ? safeString(it?.primary?.solution) : safeString(it?.secondary?.solution);
            const exp = language === 'primary' ? safeString(it?.primary?.explanation) : safeString(it?.secondary?.explanation);
            return {
                number: Number(it?.number) || 1,
                title: safeString(it?.title),
                type: safeString(it?.type),
                points: Number(it?.points) || 0,
                sources: Array.isArray(it?.sources) ? it.sources.map((s) => ({ file: safeString(s?.file), pages: safeString(s?.pages) })) : [],
                question: q,
                solution: sol,
                explanation: exp,
            };
        });

        // Debug logging for export
        console.log(`[Export API] format=${format}, language=${language}, languageLabel=${languageLabel}`);
        console.log(`[Export API] filename=${filename}, format from body=${body?.format}`);
        console.log(`[Export API] items count=${normalizedItems.length}`);
        if (normalizedItems.length > 0) {
            const firstItem = normalizedItems[0];
            console.log(`[Export API] First item question length=${firstItem.question?.length || 0}`);
            console.log(`[Export API] First item question preview: ${(firstItem.question || '').substring(0, 100)}...`);
        }

        let buf: Buffer;
        if (format === 'docx') {
            console.log('[Export API] Generating DOCX format');
            buf = await generateDocx({ title, languageLabel, includeSolutions, includeExplanations, exportKind, items: normalizedItems, templateDocxBase64: typeof body?.templateDocxBase64 === 'string' ? body.templateDocxBase64 : undefined });
        } else if (format === 'pdf') {
            console.log(`[Export API] Generating PDF with languageLabel=${languageLabel}`);
            buf = await generatePdf({ title, languageLabel, includeSolutions, includeExplanations, exportKind, items: normalizedItems });
        } else if (format === 'pptx') {
            console.log('[Export API] Generating PPTX format');
            buf = await generatePptx({ title, languageLabel, includeSolutions, includeExplanations, exportKind, items: normalizedItems, templatePptxBase64: typeof body?.templatePptxBase64 === 'string' ? body.templatePptxBase64 : undefined });
        } else {
            console.error(`[Export API] Unsupported format: ${format}`);
            return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
        }

        console.log(`[Export API] Generated buffer size: ${buf.length} bytes for format: ${format}`);

        // Record export usage
        await recordExport(session.user.id);
        
        const contentType = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : format === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf';

        // If user is Premium, save to generation history
        try {
            const hasPremium = await hasGenerationHistoryFeature(session.user.id);
            console.log('[Export] Premium check:', { userId: session.user.id, hasPremium });
            
            if (hasPremium) {
                console.log('[Export] Starting upload to Supabase Storage:', { 
                    filename, 
                    size: buf.length, 
                    format, 
                    module: moduleId 
                });
                
                // Upload to Supabase Storage
                const uploadResult = await uploadFile(
                    session.user.id,
                    filename,
                    buf,
                    getContentType(format)
                );
                
                console.log('[Export] Upload result:', uploadResult);
                
                if (uploadResult.success && uploadResult.fileUrl) {
                    // Save to generation history
                    const historyData = {
                        userId: session.user.id,
                        module: moduleId,
                        title: title,
                        format: format, // Ensure format is correctly saved
                        fileUrl: uploadResult.fileUrl,
                        fileSize: buf.length,
                        metadata: {
                            language: languageLabel,
                            includeSolutions,
                            itemsCount: normalizedItems.length,
                        },
                    };
                    
                    console.log('[Export] Saving to generation history:', {
                        ...historyData,
                        format: format, // Log format explicitly
                        formatType: typeof format,
                    });
                    const historyResult = await createGenerationHistory(historyData);
                    console.log('[Export] ✓ Successfully saved to generation history:', {
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

        return new NextResponse(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"` } });
    } catch (e: any) {
        console.error('Export API error:', e);
        return NextResponse.json({ error: e?.message || 'Export failed' }, { status: 500 });
    }
}
