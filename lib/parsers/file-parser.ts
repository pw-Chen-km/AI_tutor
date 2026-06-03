// Client-side file reading utilities

import type { DocumentIntakeIntent } from '@/lib/document-intake/types';
import type { LLMConfig } from '@/lib/store';

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

export type ParseFileOptions = {
    llmConfig?: Partial<LLMConfig>;
};

export async function parseFile(file: File): Promise<string> {
    const parsed = await parseFileDetailed(file);
    return parsed.content;
}

export async function parseFileDetailed(
    file: File,
    intent: DocumentIntakeIntent = 'generic',
    options: ParseFileOptions = {}
): Promise<ParsedFileResult> {
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
            return await uploadAndParse(file, intent, options);

        default:
            throw new Error(`Unsupported file type: ${fileType}`);
    }
}

// Enhanced file parser for Exam Evaluation (supports images, ZIP, etc.)
export async function parseFileForEvaluation(file: File, options: ParseFileOptions = {}): Promise<string> {
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
            return (await uploadAndParse(file, 'evaluate_student_answer', options)).content;

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

async function uploadAndParse(
    file: File,
    intent: DocumentIntakeIntent = 'generic',
    options: ParseFileOptions = {}
): Promise<ParsedFileResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('intent', intent);
    if (options.llmConfig) {
        formData.append('llmConfig', JSON.stringify(options.llmConfig));
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.llmConfig ? 120000 : 60000);

        const response = await fetch('/api/parse-file', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
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
            throw new Error('File upload timed out. Please try again.');
        }
        throw new Error(`Failed to upload file: ${error.message}`);
    }
}
