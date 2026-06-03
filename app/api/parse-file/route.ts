import { NextRequest, NextResponse } from 'next/server';
import { intakeDocument } from '@/lib/document-intake';
import { getActiveLLMConfig } from '@/lib/llm/config';
import type { DocumentIntakeIntent } from '@/lib/document-intake/types';

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

function parseJsonField(value: FormDataEntryValue | null): Record<string, any> | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

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
        const intent = parseIntent(formData.get('intent'));
        const rawLLMConfig = parseJsonField(formData.get('llmConfig'));
        const activeLLMConfig = getActiveLLMConfig(rawLLMConfig);
        const ocrLLMConfig = activeLLMConfig.apiKey
            ? {
                provider: activeLLMConfig.provider,
                apiKey: activeLLMConfig.apiKey,
                baseURL: activeLLMConfig.baseURL,
                model: activeLLMConfig.model,
            }
            : undefined;

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

        console.log(`Processing file: ${file.name} (${fileType})`);

        switch (fileType) {
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
                try {
                    const result = await intakeDocument({
                        fileName: file.name,
                        buffer,
                        intent,
                        llmConfig: ocrLLMConfig,
                    });
                    console.log(
                        `Successfully parsed ${file.name}, strategy: ${result.strategy}, length: ${result.content.length}`
                    );
                    return NextResponse.json({
                        fileName: result.fileName,
                        fileType: result.fileType,
                        intent: result.intent,
                        content: result.content,
                        pages: result.pages,
                        warnings: result.warnings,
                        metadata: result.metadata,
                        strategy: result.strategy,
                    });
                } catch (parseError: any) {
                    return NextResponse.json(
                        { error: parseError?.message || `Unsupported file type: ${fileType}` },
                        { status: 400 }
                    );
                }
        }
    } catch (error: any) {
        console.error('SERVER ERROR parsing file:', error);
        return NextResponse.json(
            { error: `Failed to parse file: ${error.message || 'Unknown error'}` },
            { status: 500 }
        );
    }
}
