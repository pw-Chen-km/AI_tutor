'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Check, Loader2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './code-block';
import { MixedContent } from './mixed-content';
import { VariantSelector } from './variant-selector';
import { ensureMarkdownCodeFences } from '@/lib/llm/format';

// Helper function to check if a problem type is coding-related
function isCodingType(format: string | undefined): boolean {
    const normalized = String(format || '').toLowerCase();
    return normalized.includes('coding') || 
           normalized.includes('debugging') || 
           normalized.includes('trace') ||
           normalized === 'code';
}

// Format type display with title case
function formatTypeDisplay(format: string | undefined): string {
    return String(format || '')
        .replace(/_/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export interface ProblemItem {
    number?: number;
    title?: string;
    concept_name?: string;
    description?: string;
    question?: string;
    solution?: string;
    solution_explanation?: string;
    explanation?: string;
    format?: string;
    type?: string;
    points?: number;
    hints?: string[];
    requirements?: string[];
    options?: string[];
    sources?: Array<{ file: string; pages: string }>;
    // Secondary language fields
    title_secondary?: string;
    description_secondary?: string;
    question_secondary?: string;
    solution_secondary?: string;
    solution_explanation_secondary?: string;
    explanation_secondary?: string;
    hints_secondary?: string[];
    requirements_secondary?: string[];
    options_secondary?: string[];
}

export interface Variant {
    variantId: string;
    [key: string]: any;
}

export interface ProblemDisplayProps {
    item: ProblemItem;
    index: number;
    moduleId: string;
    primaryLanguage: string;
    secondaryLanguage: string;
    // Selection
    isSelected: boolean;
    onToggleSelect: (selected: boolean) => void;
    // Copy
    onCopyPrimary: () => void;
    onCopySecondary?: () => void;
    copiedIndex: number | null;
    // Regenerate
    onRegenerate: () => void;
    isRegenerating: boolean;
    isLoading: boolean;
    // Variants
    variants?: Variant[];
    selectedVariantIds?: string[];
    displayedVariantId?: string;
    onToggleVariant?: (variantId: string) => void;
    onDisplayVariant?: (variantId: string) => void;
    onGenerateSimilar?: () => Promise<void>;
    onRemoveVariant?: (variantId: string) => void;
    onReorderVariants?: (variantIds: string[]) => void;
    isGeneratingSimilar?: boolean;
    // Display options
    showEstimatedTime?: number;
    showVariantSelector?: boolean;
}

export function ProblemDisplay({
    item,
    index,
    moduleId,
    primaryLanguage,
    secondaryLanguage,
    isSelected,
    onToggleSelect,
    onCopyPrimary,
    onCopySecondary,
    copiedIndex,
    onRegenerate,
    isRegenerating,
    isLoading,
    variants = [],
    selectedVariantIds = ['original'],
    displayedVariantId = 'original',
    onToggleVariant,
    onDisplayVariant,
    onGenerateSimilar,
    onRemoveVariant,
    onReorderVariants,
    isGeneratingSimilar = false,
    showEstimatedTime,
    showVariantSelector = false,
}: ProblemDisplayProps) {
    const [showSolution, setShowSolution] = useState(false);
    const [showSecondarySolution, setShowSecondarySolution] = useState(false);

    const problemNumber = item.number ?? index + 1;
    const problemTitle = item.concept_name || item.title || '';
    const problemFormat = item.format || item.type || '';
    const problemQuestion = item.question || item.description || '';
    const problemSolution = item.solution || '';
    const problemExplanation = item.solution_explanation || item.explanation || '';
    const problemQuestionSecondary = item.question_secondary || item.description_secondary || '';
    const problemSolutionSecondary = item.solution_secondary || '';
    const problemExplanationSecondary = item.solution_explanation_secondary || item.explanation_secondary || '';

    return (
        <Card className={`transition-all duration-200 ${isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}`}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300"
                                checked={isSelected}
                                onChange={(e) => onToggleSelect(e.target.checked)}
                            />
                            <CardTitle className="text-lg">
                                Problem {problemNumber}{problemTitle ? `: ${problemTitle}` : ''}
                            </CardTitle>
                            {problemFormat && (
                                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                                    {formatTypeDisplay(problemFormat)}
                                </span>
                            )}
                        </div>
                        <CardDescription className="mt-1">
                            Worth {item.points ?? 5} points
                        </CardDescription>
                        {showEstimatedTime && (
                            <p className="text-xs text-slate-500 mt-1">
                                Estimated time: ~{showEstimatedTime} min
                            </p>
                        )}
                        {(item.sources ?? []).length > 0 && (
                            <p className="mt-2 text-xs text-slate-500">
                                <strong>Sources:</strong>{' '}
                                {(item.sources ?? [])
                                    .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                    .join(', ')}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={onCopyPrimary}
                            title={`Copy (${primaryLanguage})`}
                        >
                            {copiedIndex === index ? (
                                <Check className="w-4 h-4 text-green-600" />
                            ) : (
                                <Copy className="w-4 h-4" />
                            )}
                        </Button>
                        {secondaryLanguage !== 'none' && onCopySecondary && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={onCopySecondary}
                                title={`Copy (${secondaryLanguage})`}
                            >
                                <Copy className="w-4 h-4 text-blue-600" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            disabled={isLoading || isRegenerating}
                            onClick={onRegenerate}
                            title="Regenerate"
                        >
                            {isRegenerating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <RotateCcw className="w-4 h-4" />
                            )}
                        </Button>
                    </div>
                </div>

                {/* Variant Selector */}
                {showVariantSelector && onToggleVariant && onDisplayVariant && onGenerateSimilar && onRemoveVariant && onReorderVariants && (
                    <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
                        <VariantSelector
                            itemId={`${moduleId}-${problemNumber}`}
                            originalItem={item}
                            variants={variants}
                            selectedVariantIds={selectedVariantIds}
                            displayedVariantId={displayedVariantId}
                            onToggleVariant={onToggleVariant}
                            onDisplayVariant={onDisplayVariant}
                            onGenerateSimilar={onGenerateSimilar}
                            onRemoveVariant={onRemoveVariant}
                            onReorderVariants={onReorderVariants}
                            isGenerating={isGeneratingSimilar}
                            getDisplayText={(v) => v.question || v.description || ''}
                            primaryLanguage={primaryLanguage}
                        />
                    </div>
                )}
            </CardHeader>

            <CardContent className="pt-6 space-y-4">
                {/* Primary language block */}
                <div className="space-y-4">
                    <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                        {primaryLanguage} Block
                    </h4>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                        <MixedContent content={problemQuestion} />
                    </div>

                    {/* Multiple Choice Options */}
                    {problemFormat === 'multiple_choice' && item.options && item.options.length > 0 && (
                        <div className="mt-3 space-y-2">
                            {item.options.map((opt, optIdx) => (
                                <div key={optIdx} className="flex items-start gap-2 p-2 rounded bg-slate-100 dark:bg-slate-700/50">
                                    <span className="font-bold text-blue-600 dark:text-blue-400 min-w-[24px]">
                                        {String.fromCharCode(65 + optIdx)}.
                                    </span>
                                    <span className="text-slate-700 dark:text-slate-300">{opt}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Requirements */}
                    {item.requirements && item.requirements.length > 0 && (
                        <div className="mt-3">
                            <h5 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2">Requirements:</h5>
                            <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                {item.requirements.map((req, reqIdx) => (
                                    <li key={reqIdx}>{req}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Hints */}
                    {item.hints && item.hints.length > 0 && (
                        <div className="mt-3">
                            <h5 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2">Hints:</h5>
                            <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                {item.hints.map((hint, hintIdx) => (
                                    <li key={hintIdx}>{hint}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowSolution(!showSolution)}
                    >
                        {showSolution ? 'Hide' : 'Show'} Solution
                    </Button>

                    {showSolution && (
                        <div className="mt-2 space-y-3">
                            <div className="max-w-none">
                                {isCodingType(problemFormat) ? (
                                    <CodeBlock code={problemSolution} />
                                ) : (
                                    <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                            {ensureMarkdownCodeFences(problemSolution)}
                                        </ReactMarkdown>
                                    </div>
                                )}
                            </div>
                            {problemExplanation.trim().length > 0 && (
                                <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                        {ensureMarkdownCodeFences(problemExplanation)}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Secondary language block */}
                {secondaryLanguage !== 'none' && (
                    <div className="space-y-4 pt-4 border-t border-slate-200/60 dark:border-slate-700/60">
                        <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                            {secondaryLanguage} Block
                        </h4>
                        {problemQuestionSecondary.trim().length > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                <MixedContent content={problemQuestionSecondary} />
                            </div>
                        )}

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowSecondarySolution(!showSecondarySolution)}
                        >
                            {showSecondarySolution ? 'Hide' : 'Show'} Solution ({secondaryLanguage})
                        </Button>

                        {showSecondarySolution && (
                            <div className="mt-2 space-y-3">
                                <div className="max-w-none">
                                    {isCodingType(problemFormat) ? (
                                        <CodeBlock code={problemSolutionSecondary} />
                                    ) : (
                                        <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                {ensureMarkdownCodeFences(problemSolutionSecondary)}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                                {problemExplanationSecondary.trim().length > 0 && (
                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                            {ensureMarkdownCodeFences(problemExplanationSecondary)}
                                        </ReactMarkdown>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}



