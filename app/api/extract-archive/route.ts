import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { intakeDocument } from '@/lib/document-intake';

export const runtime = 'nodejs';
export const maxDuration = 120; // 120 seconds for large archives

interface ExtractedFile {
    name: string;
    content: string;
    size: number;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        const fileType = file.name.split('.').pop()?.toLowerCase();
        const buffer = Buffer.from(await file.arrayBuffer());

        const extractedFiles: ExtractedFile[] = [];

        if (fileType === 'zip') {
            try {
                const zip = await JSZip.loadAsync(buffer);
                const fileNames = Object.keys(zip.files);

                // Extract all files from ZIP
                for (const fileName of fileNames) {
                    const zipEntry = zip.files[fileName];
                    
                    // Skip directories
                    if (zipEntry.dir) {
                        continue;
                    }

                    try {
                        // Try to extract as text first
                        let content: string;
                        const fileContent = await zipEntry.async('nodebuffer');
                        const buffer = Buffer.from(fileContent);
                        const ext = fileName.split('.').pop()?.toLowerCase();
                        if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'webp' || ext === 'bmp') {
                            // Image files - mark as image (will be processed by LLM vision API)
                            content = `[IMAGE: ${fileName}]`;
                        } else if (ext === 'ppt' || ext === 'pptm') {
                            // Older PowerPoint formats - mark as needing special handling
                            content = `[POWERPOINT FILE: ${fileName} - Please convert to PPTX format for better compatibility]`;
                        } else if (ext === 'doc' || ext === 'docm' || ext === 'rtf') {
                            // Older Word formats - mark as needing special handling
                            content = `[WORD FILE: ${fileName} - Please convert to DOCX format for better compatibility]`;
                        } else {
                            try {
                                const result = await intakeDocument({
                                    fileName,
                                    buffer,
                                    intent: 'evaluate_student_answer',
                                });
                                content = result.content;
                            } catch (intakeError: any) {
                                console.error(`Intake failed for ${fileName}:`, intakeError);
                                content = `[UNKNOWN BINARY: ${fileName} - File type may not be supported]`;
                            }
                        }

                        extractedFiles.push({
                            name: fileName,
                            content,
                            size: fileContent.length,
                        });
                    } catch (extractError: any) {
                        console.error(`Error extracting ${fileName}:`, extractError);
                        // Continue with other files
                        extractedFiles.push({
                            name: fileName,
                            content: `[ERROR: Failed to extract ${fileName}]`,
                            size: 0,
                        });
                    }
                }

                if (extractedFiles.length === 0) {
                    return NextResponse.json(
                        { error: 'ZIP file is empty or contains no extractable files' },
                        { status: 400 }
                    );
                }

                return NextResponse.json({
                    success: true,
                    archiveType: 'zip',
                    files: extractedFiles,
                    totalFiles: extractedFiles.length,
                });
            } catch (zipError: any) {
                console.error('ZIP extraction error:', zipError);
                return NextResponse.json(
                    { error: `Failed to extract ZIP file: ${zipError.message}` },
                    { status: 500 }
                );
            }
        } else if (fileType === 'rar') {
            // RAR extraction requires unrar command-line tool or a Node.js library
            // For now, return a helpful error message
            return NextResponse.json(
                { 
                    error: 'RAR 格式目前不支援自動解壓縮',
                    suggestion: '請將 RAR 檔案轉換為 ZIP 格式，或手動解壓縮後上傳個別檔案。您可以使用線上工具（如 CloudConvert）或系統工具來轉換格式。',
                    alternatives: [
                        '將 RAR 轉換為 ZIP 格式後上傳',
                        '手動解壓縮後上傳個別檔案',
                        '使用線上轉換工具（如 CloudConvert、Zamzar）'
                    ]
                },
                { status: 400 }
            );
        } else {
            return NextResponse.json(
                { error: `Unsupported archive type: ${fileType}` },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Archive extraction error:', error);
        return NextResponse.json(
            { error: `Failed to extract archive: ${error.message || 'Unknown error'}` },
            { status: 500 }
        );
    }
}
