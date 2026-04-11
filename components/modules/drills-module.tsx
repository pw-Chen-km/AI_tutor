'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Copy, Check, Loader2, RotateCcw } from 'lucide-react';
import { createLLMClient, buildPrompt, buildRegeneratePrompt, buildSecondaryFixPrompt, generateContent } from '@/lib/llm/client';
import { defaultWeights, getDrillsTypes, getSubjectConfig, weightsToCounts } from '@/lib/subjects';
import { ensureMarkdownCodeFences, wrapSolutionAsCodeIfCoding } from '@/lib/llm/format';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { QuestionTypeMix } from '@/components/shared/question-type-mix';
import { ExportPanel, type ExportItem } from '@/components/shared/export-panel';
import { VariantSelector } from '@/components/shared/variant-selector';
import { CodeBlock } from '@/components/shared/code-block';
import { MixedContent } from '@/components/shared/mixed-content';
import { SourceSelector } from '@/components/shared/source-selector';

interface Drill {
    number?: number;
    concept_name: string;
    suggested_page_ref: string;
    question: string;
    solution: string;
    solution_explanation?: string;
    question_secondary?: string;
    solution_secondary?: string;
    solution_explanation_secondary?: string;
    format: string;
    points?: number;
    sources?: Array<{ file: string; pages: string }>;
    options?: string[];
    options_secondary?: string[];
}

// Helper function to check if a problem type is coding-related
function isCodingType(format: string | undefined): boolean {
    const normalized = String(format || '').toLowerCase();
    return normalized.includes('coding') || 
           normalized.includes('debugging') || 
           normalized.includes('trace') ||
           normalized === 'code';
}

function sanitizeMultipleChoiceOption(option: any): string {
    return String(option ?? '')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^[A-Da-d][\)\.\:\-]\s*/g, '')
        .replace(/^Option\s+[A-Da-d][\)\.\:\-]\s*/i, '')
        .trim();
}

export function DrillsModule() {
    const { contextFiles, llmConfig, languageConfig, subject, generatedContent, setGeneratedContent, variants, addVariant, removeVariant, reorderVariants, customQuestionTypes } = useStore();
    const [loading, setLoading] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});
    const [showSecondarySolution, setShowSecondarySolution] = useState<Record<number, boolean>>({});
    const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
    const [generatingSimilar, setGeneratingSimilar] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [numberOfQuestions, setNumberOfQuestions] = useState<number>(5);
    const [minutesPerProblem, setMinutesPerProblem] = useState<number>(8);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
    const [displayedVariant, setDisplayedVariant] = useState<Record<string, string>>({});
    const primaryLanguage = languageConfig.primaryLanguage || 'English';
    const secondaryLanguage = languageConfig.secondaryLanguage || 'none';

    // Get variants for drills
    const drillVariants = variants?.drills || {};

    const subjectConfig = useMemo(() => getSubjectConfig(subject), [subject]);
    const drillsTypes = useMemo(() => getDrillsTypes(subject, customQuestionTypes?.drills), [subject, customQuestionTypes?.drills]);
    const [typeWeights, setTypeWeights] = useState<Record<string, number>>(() => defaultWeights(drillsTypes));
    useEffect(() => {
        setTypeWeights(defaultWeights(drillsTypes));
    }, [drillsTypes]);
    const typeCounts = useMemo(() => weightsToCounts(numberOfQuestions, typeWeights), [numberOfQuestions, typeWeights]);

    const drills = generatedContent.drills as Drill[];
    const safeDrills = Array.isArray(drills) ? drills : [];
    const sourceDocuments = useMemo(
        () =>
            contextFiles
                .filter((f: any) => typeof f?.rawBase64 === 'string' && f.rawBase64.trim().length > 0)
                .map((f: any) => ({
                    name: f.name,
                    type: String(f.name || '').split('.').pop()?.toLowerCase() || '',
                    rawBase64: f.rawBase64,
                })),
        [contextFiles]
    );

    const exportItems: ExportItem[] = useMemo(() => {
        return safeDrills.map((d: any, i: number) => {
            const num = Number.isFinite(Number(d?.number)) ? Number(d.number) : i + 1;
            return {
                number: num,
                title: String(d?.concept_name || ''),
                type: String(d?.format || ''),
                points: Number.isFinite(Number(d?.points)) ? Number(d.points) : 5,
                sources: Array.isArray(d?.sources) ? d.sources : [],
                primary: {
                    question: ensureMarkdownCodeFences(d?.question),
                    solution: ensureMarkdownCodeFences(d?.solution),
                    explanation: ensureMarkdownCodeFences((d as any)?.solution_explanation),
                },
                secondary: {
                    question: ensureMarkdownCodeFences(d?.question_secondary),
                    solution: ensureMarkdownCodeFences(d?.solution_secondary),
                    explanation: ensureMarkdownCodeFences((d as any)?.solution_explanation_secondary),
                },
            };
        });
    }, [safeDrills]);

    const handleGenerate = async () => {
        if (contextFiles.length === 0) {
            alert('Please upload at least one file to generate drills.');
            return;
        }

        if (!llmConfig.apiKey) {
            alert('Please configure your API key in the settings.');
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: numberOfQuestions, message: 'Starting...' });
        try {
            const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

            const response = await fetch('/api/generate-with-agents-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    moduleType: 'drills',
                    numberOfItems: numberOfQuestions,
                    context,
                    taskParams: {
                        minutesPerProblem,
                        subject,
                        typeCounts,
                        availableFiles: contextFiles.map((f) => f.name),
                        sourceDocuments,
                    },
                    llmConfig,
                    languageConfig: { primaryLanguage, secondaryLanguage },
                    subject,
                    includeWebResources: false,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || `HTTP ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) throw new Error('No response stream');

            let buffer = '';
            let data: { results?: any[]; type?: string; message?: string; current?: number; total?: number } = {};

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const parsed = JSON.parse(line.slice(6));
                        if (parsed.type === 'progress') {
                            setProgress({
                                current: parsed.current ?? 0,
                                total: parsed.total ?? numberOfQuestions,
                                message: parsed.message ?? 'Processing...',
                            });
                        } else if (parsed.type === 'complete') {
                            data = parsed;
                        } else if (parsed.type === 'error') {
                            throw new Error(parsed.message || 'Generation failed');
                        }
                    } catch (e) {
                        if (e instanceof SyntaxError) continue;
                        throw e;
                    }
                }
            }

            const results = data.results;
            if (!Array.isArray(results)) {
                console.error('[drills-module] Invalid stream response:', data);
                throw new Error('Invalid response from server');
            }

            const normalized = results.map((d: any, i: number) => {
                const format = String(d?.format || '').toLowerCase();
                let options = d?.options;
                
                if (format === 'multiple_choice') {
                    if (!Array.isArray(options) || options.length === 0) {
                        console.warn(`Multiple choice question ${i + 1} is missing options, creating defaults`);
                        options = ['Option A', 'Option B', 'Option C', 'Option D'];
                    } else if (options.length !== 4) {
                        console.warn(`Multiple choice question ${i + 1} has ${options.length} options, padding to 4`);
                        while (options.length < 4) {
                            options.push(`Option ${String.fromCharCode(65 + options.length)}`);
                        }
                        options = options.slice(0, 4);
                    }
                    options = options.map((opt: any) => sanitizeMultipleChoiceOption(opt));
                }
                
                return {
                    ...d,
                    number: Number.isFinite(Number(d?.number)) ? Number(d.number) : i + 1,
                    points: Number.isFinite(Number(d?.points)) ? Number(d.points) : 5,
                    format: format,
                    options: options || d?.options,
                    options_secondary: d?.options_secondary || options || d?.options,
                    solution: ensureMarkdownCodeFences(d?.solution || ''),
                    solution_secondary: ensureMarkdownCodeFences(d?.solution_secondary || ''),
                    solution_explanation: ensureMarkdownCodeFences(d?.solution_explanation || ''),
                    solution_explanation_secondary: ensureMarkdownCodeFences(d?.solution_explanation_secondary || ''),
                    sources: Array.isArray(d?.sources)
                        ? d.sources.map((s: any) => ({
                            file: typeof s?.file === 'string' ? s.file : '',
                            pages: typeof s?.pages === 'string' ? s.pages : '',
                        })).filter((s: any) => s.file || s.pages)
                        : [],
                };
            });
            
            console.log('[drills-module] Setting generated content:', {
                count: normalized.length,
                firstItem: normalized[0] ? {
                    number: normalized[0].number,
                    question: normalized[0].question?.substring(0, 50) || 'EMPTY',
                    solution: normalized[0].solution?.substring(0, 50) || 'EMPTY',
                } : 'NONE',
            });
            
            setGeneratedContent('drills', normalized);
            setProgress(null);
        } catch (error: any) {
            console.error('Error generating drills:', error);
            alert(`Error generating drills: ${error.message || 'Unknown error'}. Check console for details.`);
            setProgress(null);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const buildPrimaryCopy = (d: Drill) =>
        `### Problem ${d.number ?? ''}: ${d.concept_name}\n**Points:** ${d.points ?? ''}\n**Type:** ${d.format || ''}\n**Reference:** ${d.suggested_page_ref}\n${
            (d.sources ?? []).length > 0
                ? `**Sources:** ${(d.sources ?? []).map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}\n`
                : ''
        }\n\n## Question (${primaryLanguage})\n${d.question}\n\n## Solution (${primaryLanguage})\n${d.solution}\n`;

    const buildSecondaryCopy = (d: Drill) =>
        `### Problem ${d.number ?? ''}: ${d.concept_name}\n**Points:** ${d.points ?? ''}\n**Type:** ${d.format || ''}\n**Reference:** ${d.suggested_page_ref}\n${
            (d.sources ?? []).length > 0
                ? `**Sources:** ${(d.sources ?? []).map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}\n`
                : ''
        }\n\n## Question (${secondaryLanguage})\n${d.question_secondary || ''}\n\n## Solution (${secondaryLanguage})\n${d.solution_secondary || ''}\n`;

    const handleRegenerate = async (index: number) => {
        if (contextFiles.length === 0) return;
        if (!llmConfig.apiKey) return;
        const target = drills?.[index];
        if (!target) return;

        setRegenerating((s) => ({ ...s, [index]: true }));
        try {
            const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

            // Use agent skills API for regeneration
            const response = await fetch('/api/generate-with-agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    moduleType: 'drills',
                    action: 'regenerate',
                    originalItem: target,
                    context,
                    taskParams: {
                        minutesPerProblem,
                        subject,
                        sourceDocuments,
                    },
                    llmConfig,
                    languageConfig: {
                        primaryLanguage,
                        secondaryLanguage,
                    },
                    subject,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
                throw new Error('Invalid regenerate response');
            }

            const newDrill = data.results[0];
            let merged = { ...target, ...newDrill };
            
            // Validate and ensure multiple_choice has options
            const format = String((merged as any)?.format || (target as any)?.format || '').toLowerCase();
            let options = (merged as any)?.options || (target as any)?.options;
            
            if (format === 'multiple_choice') {
                if (!Array.isArray(options) || options.length === 0) {
                    console.warn(`Regenerated multiple choice question ${index + 1} is missing options, creating defaults`);
                    options = ['Option A', 'Option B', 'Option C', 'Option D'];
                } else if (options.length !== 4) {
                    console.warn(`Regenerated multiple choice question ${index + 1} has ${options.length} options, padding to 4`);
                    while (options.length < 4) {
                        options.push(`Option ${String.fromCharCode(65 + options.length)}`);
                    }
                    options = options.slice(0, 4);
                }
                options = options.map((opt: any) => sanitizeMultipleChoiceOption(opt));
            }
            
            merged = {
                ...merged,
                number: Number.isFinite(Number((merged as any)?.number))
                    ? Number((merged as any).number)
                    : (target as any)?.number ?? index + 1,
                points: Number.isFinite(Number((merged as any)?.points))
                    ? Number((merged as any).points)
                    : (target as any)?.points ?? 5,
                format: format,
                options: options || (merged as any)?.options,
                options_secondary: (merged as any)?.options_secondary || options || (target as any)?.options_secondary,
                solution: ensureMarkdownCodeFences((merged as any).solution || ''),
                solution_secondary: ensureMarkdownCodeFences((merged as any).solution_secondary || ''),
                solution_explanation: ensureMarkdownCodeFences((merged as any).solution_explanation || ''),
                solution_explanation_secondary: ensureMarkdownCodeFences((merged as any).solution_explanation_secondary || ''),
                sources: Array.isArray((merged as any)?.sources)
                    ? (merged as any).sources
                        .map((s: any) => ({
                            file: typeof s?.file === 'string' ? s.file : '',
                            pages: typeof s?.pages === 'string' ? s.pages : '',
                        }))
                        .filter((s: any) => s.file || s.pages)
                    : (target as any)?.sources ?? [],
            };

            // If secondary language is enabled but secondary fields look un-translated, do a quick fix pass.
            if (secondaryLanguage !== 'none') {
                const secQ = (merged as any).question_secondary || '';
                const primQ = (merged as any).question || '';
                const bad =
                    !secQ ||
                    secQ.trim().length < 4 ||
                    (primQ && secQ && primQ.trim() === secQ.trim()) ||
                    ((secondaryLanguage.includes('中文') || secondaryLanguage.includes('繁體') || secondaryLanguage.includes('简体')) &&
                        !/[\u4e00-\u9fff]/.test(secQ));
                if (bad) {
                    // Use agent skills API for translation fix
                    try {
                        const fixResponse = await fetch('/api/generate-with-agents', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                moduleType: 'drills',
                                action: 'regenerate',
                                originalItem: merged,
                                context,
                                taskParams: {
                                    minutesPerProblem,
                                    subject,
                                    sourceDocuments,
                                },
                                llmConfig,
                                languageConfig: {
                                    primaryLanguage,
                                    secondaryLanguage,
                                },
                                subject,
                            }),
                        });
                        if (fixResponse.ok) {
                            const fixData = await fixResponse.json();
                            if (fixData.success && fixData.results?.[0]) {
                                merged = { ...merged, ...fixData.results[0] };
                            }
                        }
                    } catch (fixError) {
                        console.error('Translation fix failed:', fixError);
                        // Continue without fix
                    }
                }
            }

            const next = [...(drills || [])];
            next[index] = merged;
            setGeneratedContent('drills', next);
        } catch (e: any) {
            console.error('Error regenerating drill:', e);
            alert(`Error regenerating drill: ${e?.message || 'Unknown error'}. Check console for details.`);
        } finally {
            setRegenerating((s) => ({ ...s, [index]: false }));
        }
    };

    // Generate similar question (variant)
    const handleGenerateSimilar = async (itemId: string, originalItem: any) => {
        if (!llmConfig.apiKey) {
            alert('Please configure your API key first.');
            return;
        }

        setGeneratingSimilar((s) => ({ ...s, [itemId]: true }));
        try {
            const response = await fetch('/api/similar-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalItem,
                    moduleType: 'drills',
                    llmConfig: {
                        apiKey: llmConfig.apiKey,
                        baseURL: llmConfig.baseURL,
                        model: llmConfig.model,
                    },
                    primaryLanguage,
                    secondaryLanguage,
                }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to generate similar question');
            }

            const { variant } = await response.json();
            addVariant('drills', itemId, variant);

            // Auto-select the new variant for export
            setSelectedVariants((prev) => ({
                ...prev,
                [itemId]: [...(prev[itemId] || ['original']), variant.variantId],
            }));
        } catch (e: any) {
            console.error('Error generating similar:', e);
            alert(`Error generating similar question: ${e?.message || 'Unknown error'}`);
        } finally {
            setGeneratingSimilar((s) => ({ ...s, [itemId]: false }));
        }
    };

    // Toggle variant selection for export
    const handleToggleVariant = (itemId: string, variantId: string) => {
        setSelectedVariants((prev) => {
            const current = prev[itemId] || ['original'];
            if (current.includes(variantId)) {
                // Don't allow deselecting all variants
                if (current.length === 1) return prev;
                return { ...prev, [itemId]: current.filter((v) => v !== variantId) };
            }
            return { ...prev, [itemId]: [...current, variantId] };
        });
    };
    
    const handleDisplayVariant = (itemId: string, variantId: string) => {
        setDisplayedVariant((prev) => ({ ...prev, [itemId]: variantId }));
        // 同步將顯示的變體加入導出選擇，避免未被勾選導致缺檔
        setSelectedVariants((prev) => {
            const current = prev[itemId] || ['original'];
            if (current.includes(variantId)) return prev;
            return { ...prev, [itemId]: [...current, variantId] };
        });
    };
    
    // Get the drill content to display (either original or selected variant)
    const getDisplayedDrill = (drill: Drill, index: number) => {
        const itemId = `drill-${drill.number ?? index + 1}`;
        const displayVariantId = displayedVariant[itemId];
        
        if (!displayVariantId || displayVariantId === 'original') {
            return drill;
        }
        
        const variants = drillVariants[itemId] || [];
        const variant = variants.find((v: any) => v.variantId === displayVariantId);
        
        if (!variant) {
            return drill;
        }
        
        // Return variant as a Drill object - include ALL fields including options and format
        return {
            ...drill,
            format: variant.format || drill.format,
            question: variant.question || drill.question,
            solution: variant.solution || drill.solution,
            solution_explanation: variant.solution_explanation || drill.solution_explanation,
            question_secondary: variant.question_secondary || drill.question_secondary,
            solution_secondary: variant.solution_secondary || drill.solution_secondary,
            solution_explanation_secondary: variant.solution_explanation_secondary || drill.solution_explanation_secondary,
            options: variant.options || drill.options,
            options_secondary: variant.options_secondary || drill.options_secondary,
        };
    };

    // Get display text for variant preview
    const getVariantDisplayText = (item: any) => {
        return `## Question\n${item.question || ''}\n\n## Solution\n${item.solution || ''}\n\n## Explanation\n${item.solution_explanation || ''}`;
    };

    // Initialize selected variants for new items
    useEffect(() => {
        const newSelections: Record<string, string[]> = {};
        safeDrills.forEach((d, i) => {
            const itemId = `drill-${d.number ?? i + 1}`;
            if (!selectedVariants[itemId]) {
                newSelections[itemId] = ['original'];
            }
        });
        if (Object.keys(newSelections).length > 0) {
            setSelectedVariants((prev) => ({ ...prev, ...newSelections }));
        }
    }, [safeDrills]);

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Header */}
            <div className="space-y-2">
                <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">
                    In-Class Drills Generator
                </h2>
                <p className="text-muted-foreground text-lg">
                    Generate concept-focused drill questions that can be inserted throughout your course materials
                </p>
            </div>

            {/* Generation Controls */}
            <Card className="bg-gradient-to-br from-primary/5 via-transparent to-accent/5 border-primary/20">
                <CardHeader>
                    <CardTitle>Generate Drills</CardTitle>
                    <CardDescription>
                        The AI will analyze your course materials and create drill questions for key concepts
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                        <div className="space-y-2">
                            <Label htmlFor="drills-count">Number of Questions</Label>
                            <Input
                                id="drills-count"
                                type="number"
                                min={1}
                                max={50}
                                step={1}
                                inputMode="numeric"
                                value={numberOfQuestions}
                                onChange={(e) => setNumberOfQuestions(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="drills-minutes">Minutes per Problem</Label>
                            <Input
                                id="drills-minutes"
                                type="number"
                                min={1}
                                max={180}
                                step={1}
                                inputMode="numeric"
                                value={minutesPerProblem}
                                onChange={(e) => setMinutesPerProblem(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                            />
                        </div>

                    </div>

                    <div className="mb-4">
                        <QuestionTypeMix
                            title="Question Type Mix"
                            subjectLabel={subjectConfig.label}
                            types={drillsTypes}
                            total={numberOfQuestions}
                            weights={typeWeights}
                            counts={typeCounts}
                            onChange={setTypeWeights}
                        />
                    </div>
                    <Button
                        onClick={handleGenerate}
                        disabled={loading || contextFiles.length === 0}
                        className="w-full sm:w-auto"
                        size="lg"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                                Generating Drills...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-4 h-4" />
                                Generate In-Class Drills
                            </>
                        )}
                    </Button>
                    {progress && (
                        <div className="w-full space-y-2 mt-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{progress.message}</span>
                                <span className="font-medium text-foreground">
                                    {progress.current} / {progress.total}
                                </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                                <div
                                    className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {contextFiles.length === 0 && (
                        <p className="text-sm text-accent mt-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                            Please upload course materials first
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Results */}
            {safeDrills && safeDrills.length > 0 && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-display font-semibold text-foreground">
                            Generated Drills ({safeDrills.length})
                        </h3>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                                <input
                                    type="checkbox"
                                    checked={selectedNumbers.length === safeDrills.length}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedNumbers(safeDrills.map((d: any, i: number) => (d?.number ?? i + 1)));
                                        } else {
                                            setSelectedNumbers([]);
                                        }
                                    }}
                                />
                                Select all
                            </label>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const allDrills = safeDrills
                                    .map((d, i) => {
                                        const num = (d as any)?.number ?? (i + 1);
                                        const pts = (d as any)?.points ?? 5;
                                        const sources =
                                            (d as any)?.sources && Array.isArray((d as any).sources) && (d as any).sources.length > 0
                                                ? `Sources: ${(d as any).sources.map((s: any) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}\n`
                                                : '';
                                        return `# Problem ${num}: ${(d as any)?.concept_name || ''}\nPoints: ${pts}\nType: ${(d as any)?.format || ''}\nReference: ${(d as any)?.suggested_page_ref || ''}\n${sources}\n## ${primaryLanguage} Block\n### Question\n${(d as any)?.question || ''}\n\n### Solution\n${(d as any)?.solution || ''}\n\n${secondaryLanguage !== 'none' ? `## ${secondaryLanguage} Block\n### Question\n${(d as any)?.question_secondary || ''}\n\n### Solution\n${(d as any)?.solution_secondary || ''}\n\n` : ''}---\n\n`;
                                    })
                                    .join('');
                                handleCopy(allDrills, -1);
                            }}
                            >
                                {copiedIndex === -1 ? (
                                    <><Check className="mr-2 w-4 h-4" /> Copied!</>
                                ) : (
                                    <><Copy className="mr-2 w-4 h-4" /> Copy All</>
                                )}
                            </Button>
                        </div>
                    </div>

                    <ExportPanel
                        title="In-Class Drills"
                        moduleId="drills"
                        items={exportItems}
                        selectedNumbers={selectedNumbers}
                        variantInfo={Object.fromEntries(
                            safeDrills.map((d, i) => {
                                const itemId = `drill-${d.number ?? i + 1}`;
                                return [itemId, {
                                    itemId,
                                    variants: drillVariants[itemId] || [],
                                    selectedVariantIds: selectedVariants[itemId] || ['original'],
                                }];
                            })
                        )}
                    />

                    {safeDrills.map((drill, index) => {
                        const displayedDrill = getDisplayedDrill(drill, index);
                        return (
                        <Card key={index} className="hover:shadow-elevated transition-all duration-300 bg-card animate-slide-up" style={{ animationDelay: `${index * 0.05}s` }}>
                            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedNumbers.includes((drill as any)?.number ?? index + 1)}
                                                onChange={(e) => {
                                                    const num = (drill as any)?.number ?? index + 1;
                                                    setSelectedNumbers((prev) =>
                                                        e.target.checked ? Array.from(new Set([...prev, num])) : prev.filter((x) => x !== num)
                                                    );
                                                }}
                                            />
                                        <CardTitle className="text-lg">
                                            Problem {drill.number ?? index + 1}{displayedDrill.concept_name ? `: ${displayedDrill.concept_name}` : ''}
                                        </CardTitle>
                                        {displayedDrill.format && (
                                            <span className="ml-2 px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full">
                                                {String(displayedDrill.format).replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                            </span>
                                        )}
                                        </div>
                                        <CardDescription className="mt-1">
                                            Worth {drill.points ?? 5} points
                                        </CardDescription>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Estimated time: ~{minutesPerProblem} min
                                        </p>
                                        {displayedDrill.suggested_page_ref && displayedDrill.suggested_page_ref.trim().length > 0 && (
                                            <p className="mt-2 text-xs text-slate-500">
                                                <strong>Reference:</strong> {displayedDrill.suggested_page_ref}
                                            </p>
                                        )}
                                        {(drill.sources ?? []).length > 0 && (
                                            <p className="mt-2 text-xs text-slate-500">
                                                <strong>Sources:</strong>{' '}
                                                {(drill.sources ?? [])
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
                                            onClick={() => handleCopy(buildPrimaryCopy(displayedDrill), index)}
                                            title={`Copy (${primaryLanguage})`}
                                        >
                                            {copiedIndex === index ? (
                                                <Check className="w-4 h-4 text-green-600" />
                                            ) : (
                                                <Copy className="w-4 h-4" />
                                            )}
                                        </Button>
                                        {secondaryLanguage !== 'none' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                onClick={() => handleCopy(buildSecondaryCopy(drill), index)}
                                                title={`Copy (${secondaryLanguage})`}
                                            >
                                                <Copy className="w-4 h-4 text-blue-600" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0"
                                            disabled={loading || regenerating[index]}
                                            onClick={() => handleRegenerate(index)}
                                            title="Regenerate"
                                        >
                                            {regenerating[index] ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <RotateCcw className="w-4 h-4" />
                                            )}
                                        </Button>
                                        
                                        {/* Custom Source Selector */}
                                        <SourceSelector
                                            availableFiles={contextFiles}
                                            currentSources={drill.sources}
                                            isLoading={regenerating[index]}
                                            questionTypes={customQuestionTypes.drills || []}
                                            currentQuestionType={drill.format}
                                            onRegenerate={async (selectedFile, selectedPages, selectedQuestionType) => {
                                                setRegenerating((s) => ({ ...s, [index]: true }));
                                                try {
                                                    const target = drill;
                                                    const fileContent = contextFiles.find(f => f.name === selectedFile)?.content || '';
                                                    const context = `FILE: ${selectedFile}\n${fileContent}`;
                                                    
                                                    const response = await fetch('/api/generate-with-agents', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            moduleType: 'drills',
                                                            action: 'regenerate',
                                                            originalItem: target,
                                                            context,
                                                            taskParams: {
                                                                minutesPerProblem,
                                                                subject,
                                                                questionType: selectedQuestionType || drill.format,
                                                                selectedFile,
                                                                selectedPages,
                                                                availableFiles: [selectedFile],
                                                                sourceDocuments,
                                                            },
                                                            llmConfig,
                                                            languageConfig: {
                                                                primaryLanguage,
                                                                secondaryLanguage,
                                                            },
                                                            subject,
                                                        }),
                                                    });

                                                    if (!response.ok) {
                                                        const errorData = await response.json();
                                                        throw new Error(errorData.error || `HTTP ${response.status}`);
                                                    }

                                                    const data = await response.json();
                                                    
                                                    if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
                                                        throw new Error('Invalid regenerate response');
                                                    }

                                                    const newDrill = data.results[0];
                                                    // Force the selected source
                                                    const forcedSources = [{ file: selectedFile, pages: selectedPages }];
                                                    const merged = { 
                                                        ...target, 
                                                        ...newDrill,
                                                        sources: forcedSources,
                                                        format: selectedQuestionType || newDrill?.format || target?.format,
                                                    };

                                                    setGeneratedContent('drills', drills.map((d, i) =>
                                                        i === index ? merged : d
                                                    ));
                                                } catch (e: any) {
                                                    console.error('Error regenerating with custom source:', e);
                                                    alert(`Error: ${e?.message || 'Unknown error'}`);
                                                } finally {
                                                    setRegenerating((s) => ({ ...s, [index]: false }));
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                                
                                {/* Variant Selector */}
                                <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
                                    <VariantSelector
                                        itemId={`drill-${drill.number ?? index + 1}`}
                                        originalItem={drill}
                                        variants={drillVariants[`drill-${drill.number ?? index + 1}`] || []}
                                        selectedVariantIds={selectedVariants[`drill-${drill.number ?? index + 1}`] || ['original']}
                                        displayedVariantId={displayedVariant[`drill-${drill.number ?? index + 1}`] || 'original'}
                                        onToggleVariant={(variantId) => handleToggleVariant(`drill-${drill.number ?? index + 1}`, variantId)}
                                        onDisplayVariant={(variantId) => handleDisplayVariant(`drill-${drill.number ?? index + 1}`, variantId)}
                                        onGenerateSimilar={() => handleGenerateSimilar(`drill-${drill.number ?? index + 1}`, drill)}
                                        onRemoveVariant={(variantId) => removeVariant('drills', `drill-${drill.number ?? index + 1}`, variantId)}
                                        onReorderVariants={(variantIds) => reorderVariants('drills', `drill-${drill.number ?? index + 1}`, variantIds)}
                                        isGenerating={generatingSimilar[`drill-${drill.number ?? index + 1}`] || false}
                                        getDisplayText={getVariantDisplayText}
                                        primaryLanguage={primaryLanguage}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-4">
                                {/* Primary language block */}
                                <div className="space-y-4">
                                    <h4 className="font-semibold text-sm text-foreground">
                                        {primaryLanguage} Block
                                    </h4>
                                    <div className="bg-muted/30 p-4 rounded-xl border border-border/50">
                                        {/* Only trace format uses CodeBlock for question */}
                                        {/* All other types use MixedContent to properly render markdown and code blocks */}
                                        {displayedDrill.format === 'trace' ? (
                                            <CodeBlock code={displayedDrill.question || ''} />
                                        ) : (
                                            <MixedContent content={displayedDrill.question || ''} />
                                        )}
                                    </div>

                                    {/* Multiple Choice Options */}
                                    {displayedDrill.format === 'multiple_choice' && displayedDrill.options && displayedDrill.options.length > 0 && (
                                        <div className="mt-3 space-y-2">
                                            {displayedDrill.options.map((opt: string, optIdx: number) => (
                                                <div key={optIdx} className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/30 hover:bg-muted transition-colors">
                                                    <span className="font-bold text-primary min-w-[24px]">
                                                        {String.fromCharCode(65 + optIdx)}.
                                                    </span>
                                                    <span className="text-foreground">{opt}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowSolution({ ...showSolution, [index]: !showSolution[index] })}
                                    >
                                        {showSolution[index] ? 'Hide' : 'Show'} Solution
                                    </Button>
                                    {showSolution[index] && (
                                        <div className="mt-2 space-y-3">
                                            <div className={`max-w-none ${isCodingType(displayedDrill.format) ? '' : 'prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800'}`}>
                                                {isCodingType(displayedDrill.format) ? (
                                                    <CodeBlock code={displayedDrill.solution || ''} />
                                                ) : (
                                                    <div className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(displayedDrill.solution)}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                            {(displayedDrill.solution_explanation ?? '').trim().length > 0 && (
                                                <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                        {ensureMarkdownCodeFences(displayedDrill.solution_explanation)}
                                                    </ReactMarkdown>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Secondary language block */}
                                {secondaryLanguage !== 'none' && (
                                    <div className="space-y-4 pt-4 border-t border-border/50">
                                        <h4 className="font-semibold text-sm text-foreground">
                                            {secondaryLanguage} Block
                                        </h4>
                                        {(displayedDrill.question_secondary ?? '').trim().length > 0 && (
                                            <div className="bg-muted/30 p-4 rounded-xl border border-border/50">
                                                {/* Use MixedContent for all types to properly render markdown with code blocks */}
                                                {displayedDrill.format === 'trace' ? (
                                                    <CodeBlock code={displayedDrill.question_secondary || ''} />
                                                ) : (
                                                    <MixedContent content={displayedDrill.question_secondary || ''} />
                                                )}
                                            </div>
                                        )}

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setShowSecondarySolution({
                                                    ...showSecondarySolution,
                                                    [index]: !showSecondarySolution[index],
                                                })
                                            }
                                        >
                                            {showSecondarySolution[index] ? 'Hide' : 'Show'} Solution ({secondaryLanguage})
                                        </Button>
                                        {showSecondarySolution[index] && (displayedDrill.solution_secondary ?? '').trim().length > 0 && (
                                            <div className="mt-2 space-y-3">
                                                <div className="max-w-none">
                                                    {/* For coding types, use the same code block structure as primary language */}
                                                    {isCodingType(displayedDrill.format) ? (
                                                        <CodeBlock code={displayedDrill.solution || displayedDrill.solution_secondary || ''} />
                                                    ) : (
                                                        <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                {ensureMarkdownCodeFences(displayedDrill.solution_secondary)}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
                                                {(displayedDrill.solution_explanation_secondary ?? '').trim().length > 0 && (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(displayedDrill.solution_explanation_secondary)}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );})}
                </div>
            )}
        </div>
    );
}
