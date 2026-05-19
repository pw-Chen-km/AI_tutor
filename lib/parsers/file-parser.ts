// Client-side file reading utilities

import type { DocumentIntakeIntent } from '@/lib/document-intake/types';

// Vercel serverless requests are rejected before our API route runs when the
// multipart body is too large. Keep the client-side limit below that ceiling.
const SERVER_PARSE_FILE_LIMIT_BYTES = 4 * 1024 * 1024;

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function buildTooLargeMessage(file: File): string {
    return [
        `檔案「${file.name}」大小為 ${formatBytes(file.size)}，超過目前線上解析上限 ${formatBytes(SERVER_PARSE_FILE_LIMIT_BYTES)}。`,
        '請先壓縮檔案、拆成較小檔案，或只上傳需要出題/產生講稿的頁面後再試一次。',
    ].join('\n');
}

export async function readTextFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export async function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            // Remove data URL prefix to get pure base64
            const base64 = result.split(',')[1] || result;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export type ParsedFileResult = {
    fileName?: string;
    fileType?: string;
    intent?: DocumentIntakeIntent;
    content: string;
    pages?: Array<{
        pageNumber: number;
        text: string;
        textLen: number;
        features?: Record<string, any>;
        notes?: string;
    }>;
    strategy?: string;
    warnings?: string[];
    metadata?: Record<string, any>;
};

export async function parseFile(file: File): Promise<string> {
    const parsed = await parseFileDetailed(file);
    return parsed.content;
}

export async function parseFileDetailed(file: File, intent: DocumentIntakeIntent = 'generic'): Promise<ParsedFileResult> {
    const fileType = file.name.split('.').pop()?.toLowerCase();

    switch (fileType) {
        case 'txt':
        case 'md': {
            const content = await readTextFile(file);
            return {
                fileName: file.name,
                fileType: fileType || 'txt',
                intent,
                content,
                pages: [
                    {
                        pageNumber: 1,
                        text: content,
                        textLen: content.length,
                    },
                ],
                strategy: `${fileType}.client-text`,
                warnings: [],
                metadata: {},
            };
        }

        case 'pdf':
        case 'docx':
        case 'pptx':
        case 'xlsx':
            // These require server-side processing
            return await uploadAndParse(file, intent);

        default:
            throw new Error(`Unsupported file type: ${fileType}`);
    }
}

// Enhanced file parser for Exam Evaluation (supports images, ZIP, etc.)
export async function parseFileForEvaluation(file: File): Promise<string> {
    const fileType = file.name.split('.').pop()?.toLowerCase();

    switch (fileType) {
        case 'txt':
        case 'md':
            return await readTextFile(file);

        case 'pdf':
        case 'docx':
        case 'pptx':
        case 'xlsx':
            // These require server-side processing
            return (await uploadAndParse(file)).content;

        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
            // For images, we return a placeholder and store base64 separately
            // The actual image will be sent to LLM via vision API
            return `[IMAGE: ${file.name}]`;

        case 'zip':
        case 'rar':
            // ZIP/RAR files will be handled by extract-archive API
            // Return placeholder - actual extraction happens in handleStudentFileUpload
            return `[ARCHIVE: ${file.name}]`;

        default:
            // Try to read as text for unknown types
            try {
                return await readTextFile(file);
            } catch {
                return `[BINARY FILE: ${file.name}]`;
            }
    }
}

async function uploadAndParse(file: File, intent: DocumentIntakeIntent = 'generic'): Promise<ParsedFileResult> {
    if (file.size > SERVER_PARSE_FILE_LIMIT_BYTES) {
        throw new Error(buildTooLargeMessage(file));
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('intent', intent);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        const response = await fetch('/api/parse-file', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 413) {
                throw new Error(buildTooLargeMessage(file));
            }
            throw new Error(errorData.error || `Failed to parse file (status: ${response.status})`);
        }

        const data = await response.json();
        return {
            fileName: data.fileName || file.name,
            fileType: data.fileType || file.name.split('.').pop()?.toLowerCase(),
            intent: data.intent || intent,
            content: data.content || '',
            pages: Array.isArray(data.pages) ? data.pages : [],
            strategy: data.strategy,
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
            metadata: data.metadata || {},
        };
    } catch (error: any) {
        if (error.name === 'AbortError') {
            throw new Error('File upload timed out. Please try a smaller file.');
        }
        throw new Error(`Failed to upload file: ${error.message}`);
    }
}
