'use client';

import { ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, RefreshCw } from 'lucide-react';

export interface ProblemSource {
    file: string;
    pages?: string;
}

export interface ProblemCardProps {
    // Core info
    number: number;
    title: string;
    type?: string;
    points: number;
    sources?: ProblemSource[];
    estimatedTime?: number;
    reference?: string;
    chapter?: string;

    // Selection
    selected?: boolean;
    onSelectChange?: (selected: boolean) => void;

    // Actions
    onCopyPrimary?: () => void;
    onCopySecondary?: () => void;
    onRegenerate?: () => void;
    primaryLanguage?: string;
    secondaryLanguage?: string;
    showSecondaryActions?: boolean;
    copiedIndex?: number;
    currentIndex?: number;
    isRegenerating?: boolean;

    // Content
    children?: ReactNode;

    // Styling
    headerGradient?: string;
}

export function ProblemCard({
    number,
    title,
    type,
    points,
    sources = [],
    estimatedTime,
    reference,
    chapter,
    selected = false,
    onSelectChange,
    onCopyPrimary,
    onCopySecondary,
    onRegenerate,
    primaryLanguage = 'English',
    secondaryLanguage,
    showSecondaryActions = false,
    copiedIndex,
    currentIndex,
    isRegenerating = false,
    children,
    headerGradient = 'from-blue-500/10 to-purple-500/10 dark:from-blue-500/20 dark:to-purple-500/20',
}: ProblemCardProps) {
    const isCopied = copiedIndex === currentIndex;

    return (
        <Card className="hover:shadow-lg transition-shadow bg-white dark:bg-slate-900">
            <CardHeader className={`bg-gradient-to-r ${headerGradient}`}>
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        {/* Title row with checkbox, title, and type badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {onSelectChange && (
                                <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={(e) => onSelectChange(e.target.checked)}
                                    className="rounded border-slate-300"
                                />
                            )}
                            <CardTitle className="text-lg">
                                Problem {number}: {title}
                            </CardTitle>
                            {type && (
                                <span className="px-2 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                                    {type.replace(/_/g, ' ').toUpperCase()}
                                </span>
                            )}
                            {chapter && (
                                <span className="px-2 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                    {chapter}
                                </span>
                            )}
                        </div>

                        {/* Points and estimated time */}
                        <CardDescription className="mt-1">
                            Worth {points} points
                            {estimatedTime && estimatedTime > 0 && (
                                <> • ⏱️ Estimated Time: {estimatedTime} minutes</>
                            )}
                        </CardDescription>

                        {/* Reference (optional) */}
                        {reference && reference.trim().length > 0 && (
                            <p className="mt-2 text-xs text-slate-500">
                                <strong>Reference:</strong> {reference}
                            </p>
                        )}

                        {/* Sources */}
                        {sources.length > 0 && (
                            <p className="mt-2 text-xs text-slate-500">
                                <strong>Sources:</strong>{' '}
                                {sources
                                    .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                    .join(', ')}
                            </p>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {onCopyPrimary && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onCopyPrimary}
                                title={`Copy (${primaryLanguage})`}
                            >
                                {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                <span className="ml-1 text-xs hidden sm:inline">Copy</span>
                            </Button>
                        )}
                        {showSecondaryActions && secondaryLanguage && secondaryLanguage !== 'none' && onCopySecondary && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onCopySecondary}
                                title={`Copy (${secondaryLanguage})`}
                            >
                                <Copy className="w-4 h-4" />
                                <span className="ml-1 text-xs hidden sm:inline">Copy</span>
                            </Button>
                        )}
                        {onRegenerate && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onRegenerate}
                                disabled={isRegenerating}
                                title="Regenerate this problem"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                                <span className="ml-1 text-xs hidden sm:inline">Regenerate</span>
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            {children && (
                <CardContent className="pt-4">
                    {children}
                </CardContent>
            )}
        </Card>
    );
}

// Helper component for showing primary/secondary language content blocks
export interface LanguageBlockProps {
    label: string;
    language: string;
    content: ReactNode;
    showSolution?: boolean;
    onToggleSolution?: () => void;
    solutionLabel?: string;
    solutionContent?: ReactNode;
    explanationContent?: ReactNode;
    accentColor?: 'blue' | 'green' | 'purple' | 'orange';
}

export function LanguageBlock({
    label,
    language,
    content,
    showSolution = false,
    onToggleSolution,
    solutionLabel = 'Solution',
    solutionContent,
    explanationContent,
    accentColor = 'blue',
}: LanguageBlockProps) {
    const colorMap = {
        blue: 'border-blue-500 bg-blue-50 dark:bg-blue-900/10',
        green: 'border-green-500 bg-green-50 dark:bg-green-900/10',
        purple: 'border-purple-500 bg-purple-50 dark:bg-purple-900/10',
        orange: 'border-orange-500 bg-orange-50 dark:bg-orange-900/10',
    };
    const headerColor = {
        blue: 'text-blue-700 dark:text-blue-300',
        green: 'text-green-700 dark:text-green-300',
        purple: 'text-purple-700 dark:text-purple-300',
        orange: 'text-orange-700 dark:text-orange-300',
    };

    return (
        <div className={`border-l-4 ${colorMap[accentColor]} rounded-r-lg p-4 mb-4`}>
            <h4 className={`font-semibold text-sm mb-2 ${headerColor[accentColor]}`}>
                {label} ({language})
            </h4>
            <div className="prose prose-sm dark:prose-invert max-w-none">
                {content}
            </div>

            {onToggleSolution && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onToggleSolution}
                    className="mt-3"
                >
                    {showSolution ? `Hide ${solutionLabel}` : `Show ${solutionLabel}`}
                </Button>
            )}

            {showSolution && solutionContent && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <h5 className="font-semibold text-sm text-green-700 dark:text-green-300 mb-2">
                        {solutionLabel}
                    </h5>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        {solutionContent}
                    </div>
                </div>
            )}

            {showSolution && explanationContent && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <h5 className="font-semibold text-sm text-blue-700 dark:text-blue-300 mb-2">
                        Explanation
                    </h5>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        {explanationContent}
                    </div>
                </div>
            )}
        </div>
    );
}




