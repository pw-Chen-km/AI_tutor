'use client';

import { useStore, ContextFile } from '@/lib/store';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, File, X, FileText, FileSpreadsheet, FolderOpen, Globe, GraduationCap, Users, Image, Archive } from 'lucide-react';
import { useCallback, useState, useEffect } from 'react';
import { parseFile, parseFileForEvaluation } from '@/lib/parsers/file-parser';

// File upload zone component
function FileUploadZone({
    id,
    files,
    onFileUpload,
    onRemoveFile,
    onClearFiles,
    title,
    description,
    icon: Icon,
    accentColor,
    acceptedTypes,
    compact = false,
}: {
    id: string;
    files: ContextFile[];
    onFileUpload: (files: FileList | null) => void;
    onRemoveFile: (id: string) => void;
    onClearFiles: () => void;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    acceptedTypes: string;
    compact?: boolean;
}) {
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        onFileUpload(e.dataTransfer.files);
    }, [onFileUpload]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
    }, []);

    const getFileIcon = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') return File;
        if (['xlsx', 'xls', 'csv'].includes(ext || '')) return FileSpreadsheet;
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return Image;
        if (ext === 'zip') return Archive;
        return FileText;
    };

    const getFileColor = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') return 'text-red-500';
        if (['xlsx', 'xls', 'csv'].includes(ext || '')) return 'text-emerald-500';
        if (['docx', 'doc'].includes(ext || '')) return 'text-blue-500';
        if (['pptx', 'ppt'].includes(ext || '')) return 'text-orange-500';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return 'text-purple-500';
        if (ext === 'zip') return 'text-yellow-500';
        return 'text-primary';
    };

    return (
        <div className="flex flex-col h-full">
            {/* Section Header */}
            <div className={`p-3 border-b border-border ${accentColor}`}>
                <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                        <p className="text-[10px] text-muted-foreground">{description}</p>
                    </div>
                </div>
            </div>

            {/* Upload Area */}
            <div className="p-3">
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`relative border-2 border-dashed rounded-lg ${compact ? 'p-3' : 'p-4'} text-center transition-all duration-200 cursor-pointer group ${
                        dragActive
                            ? 'border-primary bg-primary/5 scale-[1.01]'
                            : uploading
                            ? 'border-accent bg-accent/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                >
                    <input
                        type="file"
                        id={`file-upload-${id}`}
                        multiple
                        accept={acceptedTypes}
                        onChange={(e) => onFileUpload(e.target.files)}
                        className="hidden"
                    />
                    <label htmlFor={`file-upload-${id}`} className="cursor-pointer block">
                        <div className={`mx-auto ${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg flex items-center justify-center mb-2 transition-colors ${
                            dragActive ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'
                        }`}>
                            <Upload className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} transition-colors ${
                                dragActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'
                            }`} />
                        </div>
                        <p className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-foreground mb-1`}>
                            {uploading ? 'Uploading...' : 'Drop files here'}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            or click to browse
                        </p>
                    </label>
                </div>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Files ({files.length})
                    </h4>
                    {files.length > 0 && (
                        <button
                            onClick={onClearFiles}
                            className="text-[10px] font-medium text-destructive hover:text-destructive/80 transition-colors duration-200 cursor-pointer"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {files.length === 0 ? (
                    <div className="text-center py-4">
                        <p className="text-xs text-muted-foreground">No files</p>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {files.map((file) => {
                            const FileIcon = getFileIcon(file.name);
                            const colorClass = getFileColor(file.name);
                            return (
                                <div
                                    key={file.id}
                                    className="group flex items-center bg-background p-2 rounded-lg border border-border shadow-sm hover:shadow-md transition-all"
                                >
                                    <div className={`p-1.5 rounded-md bg-muted/50 mr-2 ${colorClass}`}>
                                        <FileIcon className="w-3 h-3" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">
                                            {file.name}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onRemoveFile(file.id)}
                                        className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export function ContextPanel() {
    const { 
        activeModule,
        contextFiles, addContextFile, removeContextFile, clearContextFiles, 
        teacherFiles, addTeacherFile, removeTeacherFile, clearTeacherFiles,
        studentFiles, addStudentFile, removeStudentFile, clearStudentFiles,
        includeWebResources, setIncludeWebResources 
    } = useStore();
    
    const { data: session } = useSession();
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [hasWebSearchAccess, setHasWebSearchAccess] = useState(false);
    const [subscriptionLoading, setSubscriptionLoading] = useState(true);
    const [webUrlInput, setWebUrlInput] = useState('');
    const [webFetchLoading, setWebFetchLoading] = useState(false);

    // Check subscription plan for web search access
    useEffect(() => {
        const checkWebSearchAccess = async () => {
            if (!session?.user?.id) {
                setHasWebSearchAccess(false);
                setSubscriptionLoading(false);
                return;
            }

            try {
                const response = await fetch('/api/subscription');
                if (response.ok) {
                    const data = await response.json();
                    const plan = data.plan || 'free';
                    // Pro and Premium plans have web search
                    setHasWebSearchAccess(plan === 'pro' || plan === 'premium');
                }
            } catch (error) {
                console.error('Failed to check subscription:', error);
                setHasWebSearchAccess(false);
            } finally {
                setSubscriptionLoading(false);
            }
        };

        checkWebSearchAccess();
    }, [session?.user?.id]);

    const isExamEvaluation = activeModule === 'exam_evaluation';
    const isLectureRehearsal = activeModule === 'lecture_rehearsal';
    const lectureRehearsalExts = ['pdf', 'docx', 'pptx'];
    const acceptedExtensions = isLectureRehearsal ? ['PDF', 'DOCX', 'PPTX'] : ['PDF', 'DOCX', 'PPTX', 'XLSX', 'TXT'];
    const acceptAttr = isLectureRehearsal ? '.pdf,.docx,.pptx' : '.pdf,.docx,.pptx,.xlsx,.txt,.md';

    const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    };

    // Standard file upload handler (for other modules)
    const handleFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const rejected: string[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const ext = file.name.split('.').pop()?.toLowerCase() || '';
                if (isLectureRehearsal && !lectureRehearsalExts.includes(ext)) {
                    rejected.push(file.name);
                    continue;
                }
                const rawBase64 = (ext === 'pptx' || ext === 'pdf') ? arrayBufferToBase64(await file.arrayBuffer()) : undefined;
                const content =
                    isLectureRehearsal && ext === 'pdf'
                        ? `[PDF DIRECT MODE: ${file.name}]`
                        : await parseFile(file);

                addContextFile({
                    id: Math.random().toString(36).substring(7),
                    name: file.name,
                    type: file.type || file.name.split('.').pop() || 'unknown',
                    content,
                    rawBase64,
                    uploadedAt: new Date(),
                });
            }
            if (rejected.length > 0) {
                alert(`Unsupported file type for Lecture Rehearsal: ${rejected.join(', ')}`);
            }
        } catch (error: any) {
            console.error('Error uploading files:', error);
            const message = error?.message || 'Unknown error occurred';
            alert(`Error uploading file: ${message}`);
        } finally {
            setUploading(false);
        }
    }, [addContextFile, isLectureRehearsal]);

    const handleAddWebUrl = useCallback(async () => {
        const url = webUrlInput.trim();
        if (!url) return;
        setWebFetchLoading(true);
        try {
            const res = await fetch('/api/fetch-webpage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(text || `Fetch failed (${res.status})`);
            }
            const data = await res.json();
            const title = data?.title || url;
            const extract = data?.extract || '';
            const content = `URL: ${url}\nTITLE: ${title}\n\n${extract}`.trim();

            addContextFile({
                id: Math.random().toString(36).substring(7),
                name: `WEB: ${title}`,
                type: 'web',
                content,
                uploadedAt: new Date(),
            });
            setWebUrlInput('');
        } catch (error: any) {
            alert(`Fetch webpage error: ${error?.message || 'Unknown error'}`);
        } finally {
            setWebFetchLoading(false);
        }
    }, [webUrlInput, addContextFile]);

    // Teacher file upload handler (for Exam Evaluation)
    const handleTeacherFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const content = await parseFileForEvaluation(file);
                const rawBase64 = arrayBufferToBase64(await file.arrayBuffer());

                addTeacherFile({
                    id: Math.random().toString(36).substring(7),
                    name: file.name,
                    type: file.type || file.name.split('.').pop() || 'unknown',
                    content,
                    rawBase64,
                    uploadedAt: new Date(),
                });
            }
        } catch (error: any) {
            console.error('Error uploading teacher files:', error);
            alert(`Error uploading file: ${error?.message || 'Unknown error'}`);
        }
    }, [addTeacherFile]);

    // Student file upload handler (for Exam Evaluation)
    const handleStudentFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileType = file.name.split('.').pop()?.toLowerCase();

                // Check if it's a ZIP or RAR archive
                if (fileType === 'zip' || fileType === 'rar') {
                    // Extract archive and add each file as a separate student
                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                        const response = await fetch('/api/extract-archive', {
                            method: 'POST',
                            body: formData,
                        });

                        if (!response.ok) {
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(errorData.error || `Failed to extract archive (status: ${response.status})`);
                        }

                        const data = await response.json();
                        
                        if (data.success && data.files && data.files.length > 0) {
                            let addedCount = 0;
                            const skippedFiles: string[] = [];
                            
                            // Add each extracted file as a separate student file
                            for (const extractedFile of data.files) {
                                // Don't skip any files - add all of them
                                // Images, errors, and other files should all be added
                                // The evaluation API will handle different file types appropriately
                                
                                addStudentFile({
                                    id: Math.random().toString(36).substring(7),
                                    name: extractedFile.name,
                                    type: extractedFile.name.split('.').pop() || 'unknown',
                                    content: extractedFile.content,
                                    rawBase64: undefined, // Extracted files don't have rawBase64
                                    uploadedAt: new Date(),
                                });
                                addedCount++;
                            }
                            
                            // Show success message with details
                            let message = `Successfully extracted ${addedCount} file(s) from ${file.name}`;
                            if (skippedFiles.length > 0) {
                                message += `\n\nSkipped ${skippedFiles.length} binary/error file(s):\n${skippedFiles.slice(0, 5).join(', ')}${skippedFiles.length > 5 ? '...' : ''}`;
                            }
                            alert(message);
                            
                            // Don't add the ZIP file itself - only the extracted files
                            continue; // Skip adding the ZIP file
                        } else {
                            throw new Error(data.error || 'Failed to extract archive');
                        }
                    } catch (extractError: any) {
                        console.error('Error extracting archive:', extractError);
                        const errorData = extractError.response?.data || {};
                        let errorMessage = extractError.message || 'Unknown error';
                        
                        // Improve RAR error message
                        if (errorMessage.includes('RAR extraction is not yet supported')) {
                            errorMessage = `RAR 格式目前不支援自動解壓縮。\n\n建議解決方案：\n1. 將 RAR 檔案轉換為 ZIP 格式\n2. 或手動解壓縮後上傳個別檔案\n\n您可以使用線上工具（如 CloudConvert）或系統工具來轉換格式。`;
                        }
                        
                        alert(`無法解壓縮 ${file.name}:\n${errorMessage}${errorData.suggestion ? '\n\n' + errorData.suggestion : ''}`);
                        
                        // Don't add the archive file if extraction failed
                        continue; // Skip adding the failed archive
                    }
                } else {
                    // Regular file - process normally
                    const content = await parseFileForEvaluation(file);
                    const rawBase64 = arrayBufferToBase64(await file.arrayBuffer());

                    addStudentFile({
                        id: Math.random().toString(36).substring(7),
                        name: file.name,
                        type: file.type || file.name.split('.').pop() || 'unknown',
                        content,
                        rawBase64,
                        uploadedAt: new Date(),
                    });
                }
            }
        } catch (error: any) {
            console.error('Error uploading student files:', error);
            alert(`Error uploading file: ${error?.message || 'Unknown error'}`);
        } finally {
            setUploading(false);
        }
    }, [addStudentFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        handleFileUpload(e.dataTransfer.files);
    }, [handleFileUpload]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
    }, []);

    const getFileIcon = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') return File;
        if (['xlsx', 'xls', 'csv'].includes(ext || '')) return FileSpreadsheet;
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return Image;
        if (ext === 'zip') return Archive;
        return FileText;
    };

    const getFileColor = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') return 'text-red-500';
        if (['xlsx', 'xls', 'csv'].includes(ext || '')) return 'text-emerald-500';
        if (['docx', 'doc'].includes(ext || '')) return 'text-blue-500';
        if (['pptx', 'ppt'].includes(ext || '')) return 'text-orange-500';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return 'text-purple-500';
        if (ext === 'zip') return 'text-yellow-500';
        return 'text-primary';
    };

    // Exam Evaluation mode - dual zone layout
    if (isExamEvaluation) {
        return (
            <div className="w-80 bg-card/50 backdrop-blur-sm border-r border-border flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <FolderOpen className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-base font-display font-semibold text-foreground">Exam Evaluation</h2>
                            <p className="text-xs text-muted-foreground">
                                Upload exam files
                            </p>
                        </div>
                    </div>
                </div>

                {/* Teacher Section (Upper Half) */}
                <div className="flex-1 border-b border-border overflow-hidden">
                    <FileUploadZone
                        id="teacher"
                        files={teacherFiles}
                        onFileUpload={handleTeacherFileUpload}
                        onRemoveFile={removeTeacherFile}
                        onClearFiles={clearTeacherFiles}
                        title="Teacher Files"
                        description="Questions & correct answers"
                        icon={GraduationCap}
                        accentColor="bg-emerald-50 dark:bg-emerald-950/30"
                        acceptedTypes=".pdf,.docx,.xlsx,.txt,.md,.png,.jpg,.jpeg,.zip"
                        compact={true}
                    />
                </div>

                {/* Student Section (Lower Half) */}
                <div className="flex-1 overflow-hidden">
                    <FileUploadZone
                        id="student"
                        files={studentFiles}
                        onFileUpload={handleStudentFileUpload}
                        onRemoveFile={removeStudentFile}
                        onClearFiles={clearStudentFiles}
                        title="Student Files"
                        description="Student submissions"
                        icon={Users}
                        accentColor="bg-blue-50 dark:bg-blue-950/30"
                        acceptedTypes=".pdf,.docx,.xlsx,.txt,.md,.png,.jpg,.jpeg,.zip"
                        compact={true}
                    />
                </div>
            </div>
        );
    }

    // Standard mode - single zone layout
    return (
        <div className="w-80 bg-card/50 backdrop-blur-sm border-r border-border flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent/10 rounded-lg">
                        <FolderOpen className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                        <h2 className="text-base font-display font-semibold text-foreground">Context Manager</h2>
                        <p className="text-xs text-muted-foreground">
                            Upload course materials
                        </p>
                    </div>
                </div>
            </div>

            {/* Upload Area */}
            <div className="p-4">
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer group ${
                        dragActive
                            ? 'border-primary bg-primary/5 scale-[1.02]'
                            : uploading
                            ? 'border-accent bg-accent/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                >
                    <input
                        type="file"
                        id="file-upload"
                        multiple
                        accept={acceptAttr}
                        onChange={(e) => handleFileUpload(e.target.files)}
                        className="hidden"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer block">
                        <div className={`mx-auto w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors ${
                            dragActive ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'
                        }`}>
                            <Upload className={`w-5 h-5 transition-colors ${
                                dragActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'
                            }`} />
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">
                            {uploading ? 'Uploading...' : 'Drop files here'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            or click to browse
                        </p>
                        <div className="flex flex-wrap justify-center gap-1 mt-3">
                            {acceptedExtensions.map((ext) => (
                                <span key={ext} className="px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded-full">
                                    {ext}
                                </span>
                            ))}
                        </div>
                    </label>
                </div>

                {/* Web Resources Toggle */}
                <div className="mt-4 flex items-center justify-between p-3 bg-muted/30 border border-border rounded-xl">
                    <div className="flex items-center gap-2.5">
                        <Globe className="w-4 h-4 text-muted-foreground" />
                        <div>
                            <span className="text-sm font-medium text-foreground">
                                Web Search
                            </span>
                            {!hasWebSearchAccess && !subscriptionLoading && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Pro/Premium only
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            if (!hasWebSearchAccess) {
                                alert('Web Search is only available for Pro and Premium plans. Please upgrade your subscription.');
                                return;
                            }
                            setIncludeWebResources(!includeWebResources);
                        }}
                        disabled={!hasWebSearchAccess || subscriptionLoading}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                            !hasWebSearchAccess || subscriptionLoading
                                ? 'bg-muted opacity-50 cursor-not-allowed'
                                : includeWebResources 
                                ? 'bg-primary cursor-pointer' 
                                : 'bg-muted cursor-pointer'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                includeWebResources ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                {hasWebSearchAccess && includeWebResources && (
                    <div className="mt-3 p-3 bg-muted/20 border border-border rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                            <Globe className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">Add Webpage URL</span>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={webUrlInput}
                                onChange={(e) => setWebUrlInput(e.target.value)}
                                placeholder="https://example.com/article"
                                className="flex-1"
                            />
                            <Button
                                onClick={handleAddWebUrl}
                                disabled={webFetchLoading || !webUrlInput.trim()}
                            >
                                {webFetchLoading ? 'Fetching...' : 'Add'}
                            </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">
                            Fetches webpage text
                        </p>
                    </div>
                )}
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Files ({contextFiles.length})
                    </h3>
                    {contextFiles.length > 0 && (
                        <button
                            onClick={clearContextFiles}
                            className="text-xs font-medium text-destructive hover:text-destructive/80 transition-colors duration-200 cursor-pointer"
                        >
                            Clear All
                        </button>
                    )}
                </div>

                {contextFiles.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="w-12 h-12 rounded-xl bg-muted mx-auto flex items-center justify-center mb-3">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">No files uploaded</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Upload materials to get started</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {contextFiles.map((file, index) => {
                            const Icon = getFileIcon(file.name);
                            const colorClass = getFileColor(file.name);
                            return (
                                <div
                                    key={file.id}
                                    className="group flex items-center bg-background p-3 rounded-xl border border-border shadow-soft hover:shadow-medium transition-all animate-slide-up"
                                    style={{ animationDelay: `${index * 0.05}s` }}
                                >
                                    <div className={`p-2 rounded-lg bg-muted/50 mr-3 ${colorClass}`}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {file.name}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {new Date(file.uploadedAt).toLocaleTimeString()}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => removeContextFile(file.id)}
                                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
