import { NextRequest, NextResponse } from 'next/server';
import { intakeDocument } from '@/lib/document-intake';
import type { DocumentIntakeIntent } from '@/lib/document-intake/types';
import { requireUserSession, logServerError, publicErrorMessage } from '@/lib/server/api';
import { getPlatformDocumentIntakeConfig } from '@/lib/llm/platform';
import { UPLOAD_LIMITS, getFileExtension, validateUploadFile } from '@/lib/server/upload-limits';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPPORTED_INTENTS = new Set<DocumentIntakeIntent>([
    'read_for_question_generation',
    'read_for_script_generation',
    'evaluate_student_answer',
    'visual_analysis',
    'edit_document',
    'generic',
]);

function parseIntent(value: FormDataEntryValue | null): DocumentIntakeIntent {
    const intent = typeof value === 'string' ? value : 'generic';
    return SUPPORTED_INTENTS.has(intent as DocumentIntakeIntent) ? (intent as DocumentIntakeIntent) : 'generic';
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireUserSession();
        if (auth.response) return auth.response;

        let formData;
        try {
            formData = await req.formData();
        } catch (formError: any) {
            logServerError('Failed to parse form data:', formError);
            return NextResponse.json(
                { error: 'Failed to parse uploaded file data' },
                { status: 400 }
            );
        }

        const file = formData.get('file') as File;
        const intent = parseIntent(formData.get('intent'));
        const ocrLLMConfig = getPlatformDocumentIntakeConfig();

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        const fileType = getFileExtension(file.name);
        const validationError = validateUploadFile(file.name, file.size, { archive: fileType === 'zip' });
        if (validationError) {
            return NextResponse.json(
                { error: validationError, limits: UPLOAD_LIMITS },
                { status: 400 }
            );
        }

        let buffer;
        try {
            buffer = Buffer.from(await file.arrayBuffer());
        } catch (bufferError: any) {
            logServerError('Failed to read file buffer:', bufferError);
            return NextResponse.json(
                { error: 'Failed to read uploaded file' },
                { status: 400 }
            );
        }

        switch (fileType) {
            case 'zip':
                // ZIP files need special handling - return extraction request
                return NextResponse.json({
                    isArchive: true,
                    archiveType: 'zip',
                    message: 'ZIP file detected. Please use /api/extract-archive endpoint to extract files.',
                    limits: UPLOAD_LIMITS,
                });

            case 'rar':
                // RAR files need special handling - return extraction request
                return NextResponse.json({
                    isArchive: true,
                    archiveType: 'rar',
                    message: 'RAR file detected. Please use /api/extract-archive endpoint to extract files.',
                    limits: UPLOAD_LIMITS,
                });

            default:
                try {
                    const result = await intakeDocument({
                        fileName: file.name,
                        buffer,
                        intent,
                        llmConfig: ocrLLMConfig,
                    });
                    return NextResponse.json({
                        fileName: result.fileName,
                        fileType: result.fileType,
                        intent: result.intent,
                        content: result.content,
                        pages: result.pages,
                        warnings: result.warnings,
                        metadata: result.metadata,
                        strategy: result.strategy,
                        limits: UPLOAD_LIMITS,
                    });
                } catch (parseError: any) {
                    logServerError('File parsing error:', parseError);
                    return NextResponse.json(
                        { error: publicErrorMessage(parseError, 'Failed to parse uploaded file') },
                        { status: 400 }
                    );
                }
        }
    } catch (error: any) {
        logServerError('SERVER ERROR parsing file:', error);
        return NextResponse.json(
            { error: publicErrorMessage(error, 'Failed to parse uploaded file') },
            { status: 500 }
        );
    }
}
