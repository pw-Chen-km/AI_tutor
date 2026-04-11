'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FileText, RotateCcw, Loader2, X } from 'lucide-react';

interface SourceFile {
    name: string;
    content: string;
}

// Helper function to extract page count from file content
function getPageCountFromContent(content: string): number {
    // Look for [PAGE: X] markers in the content
    const pageMatches = content.match(/\[PAGE:\s*(\d+)\]/g) || [];
    if (pageMatches.length === 0) return 1;
    
    // Extract the highest page number
    const pageNumbers = pageMatches.map(m => {
        const num = m.match(/\d+/);
        return num ? parseInt(num[0], 10) : 0;
    }).filter(p => p > 0);
    
    return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
}

interface SourceSelectorProps {
    availableFiles: SourceFile[];
    currentSources?: Array<{ file: string; pages: string }>;
    onRegenerate: (selectedFile: string, selectedPages: string, selectedQuestionType?: string) => Promise<void>;
    isLoading?: boolean;
    buttonVariant?: 'ghost' | 'outline' | 'default';
    buttonSize?: 'sm' | 'default' | 'lg';
    questionTypes?: string[];
    currentQuestionType?: string;
}

export function SourceSelector({
    availableFiles,
    currentSources,
    onRegenerate,
    isLoading = false,
    buttonVariant = 'ghost',
    buttonSize = 'sm',
    questionTypes = [],
    currentQuestionType,
}: SourceSelectorProps) {
    const [open, setOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string>('');
    const [startPage, setStartPage] = useState<string>('1');
    const [endPage, setEndPage] = useState<string>('1');
    const [regenerating, setRegenerating] = useState(false);
    const [selectedQuestionType, setSelectedQuestionType] = useState<string>(currentQuestionType || '');
    
    useEffect(() => {
        if (currentQuestionType) {
            setSelectedQuestionType(currentQuestionType);
        }
    }, [currentQuestionType]);
    
    // Calculate page counts for all files
    const filePageCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const file of availableFiles) {
            counts[file.name] = getPageCountFromContent(file.content);
        }
        return counts;
    }, [availableFiles]);
    
    // Get the max page for currently selected file
    const maxPage = selectedFile ? (filePageCounts[selectedFile] || 1) : 1;
    
    // Update end page when file selection changes
    useEffect(() => {
        if (selectedFile && filePageCounts[selectedFile]) {
            const maxP = filePageCounts[selectedFile];
            setStartPage('1');
            setEndPage(String(Math.min(5, maxP))); // Default to first 5 pages or max
        }
    }, [selectedFile, filePageCounts]);

    const handleRegenerate = async () => {
        if (!selectedFile) return;
        
        setRegenerating(true);
        try {
            const pages = startPage === endPage 
                ? startPage 
                : `${startPage}-${endPage}`;
            await onRegenerate(selectedFile, pages, selectedQuestionType || undefined);
            setOpen(false);
        } catch (error) {
            console.error('Error regenerating with custom source:', error);
        } finally {
            setRegenerating(false);
        }
    };

    const isGenerating = isLoading || regenerating;

    if (!open) {
        return (
            <Button
                variant={buttonVariant}
                size={buttonSize}
                disabled={isGenerating || availableFiles.length === 0}
                onClick={() => setOpen(true)}
                title="Regenerate from custom source"
            >
                {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <FileText className="w-4 h-4" />
                )}
            </Button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
            <Card className="w-full max-w-md mx-4 bg-white dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                <CardHeader className="relative">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-2 top-2 h-8 w-8 p-0"
                        onClick={() => setOpen(false)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                    <CardTitle>Regenerate from Custom Source</CardTitle>
                    <CardDescription>
                        Select a specific file and page range to generate this question from.
                    </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                    {/* Current Sources Display */}
                    {currentSources && currentSources.length > 0 && (
                        <div className="text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-3 rounded-md">
                            <strong>Current Sources:</strong>{' '}
                            {currentSources.map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}
                        </div>
                    )}
                    
                    {/* File Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="source-file">Select File</Label>
                        <select
                            id="source-file"
                            value={selectedFile}
                            onChange={(e) => setSelectedFile(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Choose a file...</option>
                            {availableFiles.map((file) => (
                                <option key={file.name} value={file.name}>
                                    {file.name} ({filePageCounts[file.name] || 1} pages)
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Question Type Selection */}
                    {questionTypes.length > 0 && (
                        <div className="space-y-2">
                            <Label htmlFor="question-type">Question Type</Label>
                            <select
                                id="question-type"
                                value={selectedQuestionType}
                                onChange={(e) => setSelectedQuestionType(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Use current type</option>
                                {questionTypes.map((type) => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    {/* Page Range */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="start-page">Start Page (1-{maxPage})</Label>
                            <Input
                                id="start-page"
                                type="number"
                                min={1}
                                max={maxPage}
                                value={startPage}
                                onChange={(e) => {
                                    const val = Math.min(Math.max(1, parseInt(e.target.value) || 1), maxPage);
                                    setStartPage(String(val));
                                    // Ensure end page is >= start page
                                    if (parseInt(endPage) < val) {
                                        setEndPage(String(val));
                                    }
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="end-page">End Page (1-{maxPage})</Label>
                            <Input
                                id="end-page"
                                type="number"
                                min={1}
                                max={maxPage}
                                value={endPage}
                                onChange={(e) => {
                                    const val = Math.min(Math.max(parseInt(startPage) || 1, parseInt(e.target.value) || 1), maxPage);
                                    setEndPage(String(val));
                                }}
                            />
                        </div>
                    </div>
                    
                    {/* Page info */}
                    {selectedFile && (
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                            Selected: {selectedFile} has {maxPage} page(s). Range: {startPage}-{endPage}
                        </p>
                    )}
                    
                    {/* Note */}
                    <p className="text-xs text-slate-500">
                        The question will be regenerated using content from the selected file and pages.
                        Distribution charts will be updated automatically.
                    </p>
                    
                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRegenerate}
                            disabled={!selectedFile || isGenerating}
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Regenerating...
                                </>
                            ) : (
                                <>
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    Regenerate
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
