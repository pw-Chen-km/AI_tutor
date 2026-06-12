import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { intakeDocument } from '@/lib/document-intake';
import type { DocumentIntakeLLMConfig } from '@/lib/document-intake/types';
import { getPlatformDocumentIntakeConfig } from '@/lib/llm/platform';
import { requireUserSession, logServerError, publicErrorMessage } from '@/lib/server/api';
import { UPLOAD_LIMITS, SUPPORTED_UPLOAD_EXTENSIONS, formatBytes, validateUploadFile } from '@/lib/server/upload-limits';

export const runtime = 'nodejs';
export const maxDuration = 120;

type ArchiveRole = 'teacher' | 'student';

interface ExtractedFile {
    name: string;
    path: string;
    fileType: string;
    content: string;
    size: number;
    strategy: string;
    warnings: string[];
    metadata?: Record<string, any>;
    studentId?: string;
    studentName?: string;
}

interface StudentGroup {
    studentId: string;
    studentName: string;
    files: ExtractedFile[];
    content: string;
    warnings: string[];
}

const GENERIC_WRAPPER_FOLDERS = new Set([
    'submission',
    'submissions',
    'student-submissions',
    'student_submissions',
    'students',
    'answers',
    'answer',
    'exam',
    'exams',
    '作答',
    '學生作答',
]);

function parseArchiveRole(value: FormDataEntryValue | null): ArchiveRole {
    return value === 'teacher' ? 'teacher' : 'student';
}

function normalizeArchivePath(fileName: string) {
    return fileName.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function getArchiveBaseName(fileName: string) {
    return fileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
}

function getFileType(fileName: string) {
    return fileName.split('.').pop()?.toLowerCase() || 'unknown';
}

function getLastPathPart(filePath: string) {
    const parts = filePath.split('/').filter(Boolean);
    return parts[parts.length - 1] || filePath;
}

function getBaseNameWithoutExtension(filePath: string) {
    return getLastPathPart(filePath).replace(/\.[^/.]+$/, '').trim();
}

function cleanStudentName(value: string) {
    return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown Student';
}

function isSkippableArchivePath(filePath: string) {
    const normalized = normalizeArchivePath(filePath);
    if (!normalized) return true;
    const parts = normalized.split('/');
    if (parts.some((part) => part === '__MACOSX' || part.startsWith('.'))) return true;
    const last = getLastPathPart(normalized).toLowerCase();
    return last === '.ds_store' || last === 'thumbs.db';
}

function findWrapperFolder(paths: string[], archiveName: string) {
    const usablePaths = paths.map(normalizeArchivePath).filter(Boolean);
    if (usablePaths.length === 0) return null;

    const firstParts = usablePaths.map((p) => p.split('/')[0]).filter(Boolean);
    const uniqueFirstParts = Array.from(new Set(firstParts));
    if (uniqueFirstParts.length !== 1) return null;

    const root = uniqueFirstParts[0];
    const rootLower = root.toLowerCase();
    const archiveBase = getArchiveBaseName(archiveName);
    if (rootLower === archiveBase || GENERIC_WRAPPER_FOLDERS.has(rootLower)) {
        return root;
    }

    return null;
}

function stripWrapper(filePath: string, wrapperFolder: string | null) {
    const parts = normalizeArchivePath(filePath).split('/').filter(Boolean);
    if (wrapperFolder && parts[0] === wrapperFolder) return parts.slice(1);
    return parts;
}

function deriveStudentName(filePath: string, wrapperFolder: string | null) {
    const parts = stripWrapper(filePath, wrapperFolder);
    if (parts.length > 1) return cleanStudentName(parts[0]);
    return cleanStudentName(getBaseNameWithoutExtension(parts[0] || filePath));
}

function buildFileSection(file: ExtractedFile) {
    const warnings = file.warnings.length > 0
        ? `\n[READING WARNINGS]\n${file.warnings.join('\n')}`
        : '';
    return `[SOURCE FILE: ${file.path}]\n${file.content || '[NO READABLE CONTENT]'}${warnings}`;
}

function buildStudentGroup(studentName: string, files: ExtractedFile[]): StudentGroup {
    const warnings = files.flatMap((file) => file.warnings.map((warning) => `${file.path}: ${warning}`));
    const content = [
        `STUDENT: ${studentName}`,
        '',
        files.map(buildFileSection).join('\n\n---\n\n'),
    ].join('\n').trim();

    return {
        studentId: studentName,
        studentName,
        files,
        content,
        warnings,
    };
}

function groupFilesByStudent(files: ExtractedFile[], archiveName: string) {
    const wrapperFolder = findWrapperFolder(files.map((file) => file.path), archiveName);
    const groups = new Map<string, ExtractedFile[]>();

    for (const file of files) {
        const studentName = deriveStudentName(file.path, wrapperFolder);
        file.studentId = studentName;
        file.studentName = studentName;
        groups.set(studentName, [...(groups.get(studentName) || []), file]);
    }

    return Array.from(groups.entries()).map(([studentName, groupFiles]) =>
        buildStudentGroup(studentName, groupFiles)
    );
}

async function parseZipFile(
    fileName: string,
    buffer: Buffer,
    llmConfig?: DocumentIntakeLLMConfig
): Promise<ExtractedFile> {
    const fileType = getFileType(fileName);

    if (!SUPPORTED_UPLOAD_EXTENSIONS.has(fileType)) {
        return {
            name: getLastPathPart(fileName),
            path: fileName,
            fileType,
            content: `[UNSUPPORTED FILE: ${fileName}]`,
            size: buffer.length,
            strategy: 'archive.unsupported-file-type',
            warnings: [`Unsupported file type in ZIP: ${fileType}`],
        };
    }

    if (fileType === 'ppt' || fileType === 'pptm') {
        return {
            name: getLastPathPart(fileName),
            path: fileName,
            fileType,
            content: `[POWERPOINT FILE: ${fileName} - Please convert to PPTX format for better compatibility]`,
            size: buffer.length,
            strategy: 'archive.unsupported-legacy-powerpoint',
            warnings: ['Older PowerPoint formats are not supported. Convert to PPTX for better extraction.'],
        };
    }

    if (fileType === 'doc' || fileType === 'docm' || fileType === 'rtf') {
        return {
            name: getLastPathPart(fileName),
            path: fileName,
            fileType,
            content: `[WORD FILE: ${fileName} - Please convert to DOCX format for better compatibility]`,
            size: buffer.length,
            strategy: 'archive.unsupported-legacy-word',
            warnings: ['Older Word/RTF formats are not supported. Convert to DOCX for better extraction.'],
        };
    }

    try {
        const result = await intakeDocument({
            fileName,
            buffer,
            intent: 'evaluate_student_answer',
            llmConfig,
        });

        return {
            name: getLastPathPart(fileName),
            path: fileName,
            fileType: result.fileType || fileType,
            content: result.content,
            size: buffer.length,
            strategy: result.strategy,
            warnings: result.warnings || [],
            metadata: result.metadata || {},
        };
    } catch (intakeError: any) {
        return {
            name: getLastPathPart(fileName),
            path: fileName,
            fileType,
            content: `[UNKNOWN BINARY: ${fileName} - File type may not be supported]`,
            size: buffer.length,
            strategy: 'archive.unsupported',
            warnings: [`Failed to read file: ${intakeError?.message || intakeError}`],
        };
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireUserSession();
        if (auth.response) return auth.response;

        const formData = await req.formData();
        const file = formData.get('file') as File;
        const role = parseArchiveRole(formData.get('role'));
        const ocrLLMConfig = getPlatformDocumentIntakeConfig();

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileType = getFileType(file.name);
        if (fileType === 'rar') {
            return NextResponse.json(
                {
                    error: 'RAR 格式目前不支援自動解壓縮',
                    suggestion: '請將 RAR 檔案轉換為 ZIP 格式，或手動解壓縮後上傳個別檔案。',
                    alternatives: [
                        '將 RAR 轉換為 ZIP 格式後上傳',
                        '手動解壓縮後上傳個別檔案',
                        '使用線上轉換工具（如 CloudConvert、Zamzar）',
                    ],
                },
                { status: 400 }
            );
        }

        const validationError = validateUploadFile(file.name, file.size, { archive: true });
        if (validationError) {
            return NextResponse.json(
                { error: validationError, limits: UPLOAD_LIMITS },
                { status: 400 }
            );
        }

        if (fileType !== 'zip') {
            return NextResponse.json(
                { error: `Unsupported archive type: ${fileType}`, limits: UPLOAD_LIMITS },
                { status: 400 }
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const extractedFiles: ExtractedFile[] = [];
        const archiveWarnings: string[] = [];

        const zip = await JSZip.loadAsync(buffer);
        const fileNames = Object.keys(zip.files);
        const extractableNames = fileNames.filter((rawFileName) => {
            const zipEntry = zip.files[rawFileName];
            return !zipEntry.dir && !isSkippableArchivePath(normalizeArchivePath(rawFileName));
        });

        if (extractableNames.length > UPLOAD_LIMITS.maxZipEntries) {
            return NextResponse.json(
                {
                    error: `ZIP contains too many files (${extractableNames.length}). Maximum allowed is ${UPLOAD_LIMITS.maxZipEntries}.`,
                    limits: UPLOAD_LIMITS,
                },
                { status: 400 }
            );
        }

        let totalExtractedBytes = 0;
        for (const rawFileName of fileNames) {
            const zipEntry = zip.files[rawFileName];
            const normalizedPath = normalizeArchivePath(rawFileName);
            if (zipEntry.dir || isSkippableArchivePath(normalizedPath)) continue;

            try {
                const fileContent = Buffer.from(await zipEntry.async('nodebuffer'));
                if (fileContent.length > UPLOAD_LIMITS.maxExtractedFileBytes) {
                    archiveWarnings.push(`${normalizedPath}: skipped because file is too large (${formatBytes(fileContent.length)})`);
                    extractedFiles.push({
                        name: getLastPathPart(normalizedPath),
                        path: normalizedPath,
                        fileType: getFileType(normalizedPath),
                        content: `[SKIPPED FILE: ${normalizedPath} - too large to read]`,
                        size: fileContent.length,
                        strategy: 'archive.file-too-large',
                        warnings: [`File exceeds per-file ZIP limit of ${formatBytes(UPLOAD_LIMITS.maxExtractedFileBytes)}.`],
                    });
                    continue;
                }
                if (totalExtractedBytes + fileContent.length > UPLOAD_LIMITS.maxExtractedTotalBytes) {
                    archiveWarnings.push(`${normalizedPath}: skipped because ZIP extracted content limit was reached`);
                    continue;
                }
                totalExtractedBytes += fileContent.length;
                const parsed = await parseZipFile(normalizedPath, fileContent, ocrLLMConfig);
                extractedFiles.push(parsed);
            } catch (extractError: any) {
                archiveWarnings.push(`${normalizedPath}: ${extractError?.message || extractError}`);
                extractedFiles.push({
                    name: getLastPathPart(normalizedPath),
                    path: normalizedPath,
                    fileType: getFileType(normalizedPath),
                    content: `[ERROR: Failed to extract ${normalizedPath}]`,
                    size: 0,
                    strategy: 'archive.extract-error',
                    warnings: [`Failed to extract file: ${extractError?.message || extractError}`],
                });
            }
        }

        if (extractedFiles.length === 0) {
            return NextResponse.json(
                { error: 'ZIP file is empty or contains no extractable files' },
                { status: 400 }
            );
        }

        const studentGroups = role === 'student' ? groupFilesByStudent(extractedFiles, file.name) : [];

        return NextResponse.json({
            success: true,
            archiveType: 'zip',
            role,
            files: extractedFiles,
            totalFiles: extractedFiles.length,
            studentGroups,
            totalStudents: studentGroups.length,
            warnings: archiveWarnings,
            limits: UPLOAD_LIMITS,
        });
    } catch (error: any) {
        logServerError('Archive extraction error:', error);
        return NextResponse.json(
            { error: publicErrorMessage(error, 'Failed to extract archive') },
            { status: 500 }
        );
    }
}
