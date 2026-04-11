import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { extractTextFromPptx } from '@/lib/parsers/pptx';
import JSZip from 'jszip';

export async function POST(req: NextRequest) {
    console.log('API: /api/parse-file POST request received');

    try {
        let formData;
        try {
            formData = await req.formData();
        } catch (formError: any) {
            console.error('Failed to parse form data:', formError);
            return NextResponse.json(
                { error: `Failed to parse form data: ${formError.message}` },
                { status: 400 }
            );
        }

        const file = formData.get('file') as File;

        if (!file) {
            console.error('No file in form data');
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        console.log(`API: Received file: ${file.name}, size: ${file.size} bytes`);

        let buffer;
        try {
            buffer = Buffer.from(await file.arrayBuffer());
        } catch (bufferError: any) {
            console.error('Failed to read file buffer:', bufferError);
            return NextResponse.json(
                { error: `Failed to read file: ${bufferError.message}` },
                { status: 400 }
            );
        }

        const fileType = file.name.split('.').pop()?.toLowerCase();

        let content = '';

        console.log(`Processing file: ${file.name} (${fileType})`);

        switch (fileType) {
            case 'pdf':
                try {
                    // Try multiple approaches for PDF parsing
                    let pdfParsed = false;
                    
                    // Approach 1: Try pdfjs-dist with legacy build
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
                        let fullText = '';
                        
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items
                                .map((item: any) => item.str || '')
                                .join(' ')
                                .trim();
                            
                            // Only add if we got actual content
                            if (pageText.length > 0) {
                                fullText += `[PAGE: ${i}]\n${pageText}\n\n`;
                            } else {
                                fullText += `[PAGE: ${i}]\n\n`;
                            }
                        }
                        
                        content = fullText.trim();
                        
                        // Check if we got meaningful content (not just page markers)
                        const textWithoutMarkers = content.replace(/\[PAGE:\s*\d+\]/g, '').trim();
                        if (textWithoutMarkers.length > 100) {
                            pdfParsed = true;
                            console.log(`PDF parsed successfully using pdfjs-dist, length: ${content.length}, actual text: ${textWithoutMarkers.length} chars, pages: ${pdf.numPages}`);
                        } else {
                            console.warn(`pdfjs-dist returned mostly empty content (${textWithoutMarkers.length} chars), trying alternative...`);
                        }
                    } catch (pdfjsError: any) {
                        console.warn('pdfjs-dist failed:', pdfjsError.message);
                    }
                    
                    // Approach 2: If pdfjs failed or returned empty, try pdf-parse with per-page rendering
                    if (!pdfParsed) {
                        try {
                            // Dynamic import pdf-parse
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
                            
                            if (data.text && data.text.trim().length > 100) {
                                // pdf-parse now provides per-page markers via pagerender
                                content = data.text.trim();
                                pdfParsed = true;
                                console.log(`PDF parsed successfully using pdf-parse, length: ${content.length}, pages: ${data.numpages}`);
                            } else {
                                console.warn('pdf-parse returned empty content');
                            }
                        } catch (pdfParseError: any) {
                            console.warn('pdf-parse failed:', pdfParseError.message);
                        }
                    }
                    
                    // Final fallback: At least get page count
                    if (!pdfParsed) {
                        try {
                            const { PDFDocument } = await import('pdf-lib');
                            const pdfDoc = await PDFDocument.load(buffer);
                            const pageCount = pdfDoc.getPageCount();
                            
                            // Generate markers with a warning message
                            let markers = `[WARNING: PDF text extraction failed. The PDF may be image-based or protected.]\n\n`;
                            for (let i = 1; i <= pageCount; i++) {
                                markers += `[PAGE: ${i}]\n\n`;
                            }
                            content = markers.trim();
                            console.warn(`PDF text extraction completely failed, generated ${pageCount} empty page markers`);
                        } catch (fallbackError: any) {
                            throw new Error(`PDF parsing failed completely: ${fallbackError.message}`);
                        }
                    }
                } catch (pdfError: any) {
                    console.error('PDF Parse Error:', pdfError);
                    throw new Error(`PDF parsing failed: ${pdfError.message}`);
                }
                break;

            case 'docx':
                try {
                    const docxResult = await mammoth.extractRawText({ buffer });
                    content = docxResult.value;
                } catch (docxError: any) {
                    console.error('DOCX Parse Error:', docxError);
                    throw new Error(`DOCX parsing failed: ${docxError.message}`);
                }
                break;

            case 'xlsx':
            case 'xls':
                try {
                    const workbook = XLSX.read(buffer);
                    const sheets = workbook.SheetNames.map(name => {
                        const sheet = workbook.Sheets[name];
                        return `Sheet: ${name}\n${XLSX.utils.sheet_to_txt(sheet)}`;
                    });
                    content = sheets.join('\n\n');
                } catch (xlsError: any) {
                    console.error('Excel Parse Error:', xlsError);
                    throw new Error(`Excel parsing failed: ${xlsError.message}`);
                }
                break;

            case 'txt':
            case 'md':
                content = buffer.toString('utf-8');
                break;

            case 'pptx':
                try {
                    const pptxText = await extractTextFromPptx(buffer);
                    content =
                        pptxText && pptxText.trim().length > 0
                            ? pptxText
                            : `PowerPoint file: ${file.name}\n(No extractable text found in slides)`;
                } catch (pptxError: any) {
                    console.error('PPTX Parse Error:', pptxError);
                    throw new Error(`PPTX parsing failed: ${pptxError.message}`);
                }
                break;

            case 'zip':
                // ZIP files need special handling - return extraction request
                return NextResponse.json({
                    isArchive: true,
                    archiveType: 'zip',
                    message: 'ZIP file detected. Please use /api/extract-archive endpoint to extract files.',
                });

            case 'rar':
                // RAR files need special handling - return extraction request
                return NextResponse.json({
                    isArchive: true,
                    archiveType: 'rar',
                    message: 'RAR file detected. Please use /api/extract-archive endpoint to extract files.',
                });

            default:
                return NextResponse.json(
                    { error: `Unsupported file type: ${fileType}` },
                    { status: 400 }
                );
        }

        console.log(`Successfully parsed ${file.name}, length: ${content.length}`);
        return NextResponse.json({ content });
    } catch (error: any) {
        console.error('SERVER ERROR parsing file:', error);
        return NextResponse.json(
            { error: `Failed to parse file: ${error.message || 'Unknown error'}` },
            { status: 500 }
        );
    }
}
