'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Copy, Check, Loader2, RotateCcw } from 'lucide-react';
// Removed old LLM client imports - now using agent skills API
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { defaultWeights, getLabTypes, weightsToCounts } from '@/lib/subjects';
import { ensureMarkdownCodeFences, wrapSolutionAsCodeIfCoding } from '@/lib/llm/format';
import { getSubjectConfig } from '@/lib/subjects';
import { QuestionTypeMix } from '@/components/shared/question-type-mix';
import { ExportPanel, type ExportItem } from '@/components/shared/export-panel';
import { CodeBlock } from '@/components/shared/code-block';
import { MixedContent } from '@/components/shared/mixed-content';
import { VariantSelector } from '@/components/shared/variant-selector';
import { SourceSelector } from '@/components/shared/source-selector';

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

interface Lab {
    problem_number: number;
    problem_type?: string;
    title: string;
    title_secondary?: string;
    description: string;
    description_secondary?: string;
    requirements: string[];
    requirements_secondary?: string[];
    hints: string[];
    hints_secondary?: string[];
    solution: string;
    solution_secondary?: string;
    solution_explanation?: string;
    solution_explanation_secondary?: string;
    estimated_time: number;
    points?: number;
    sources?: Array<{ file: string; pages: string }>;
}

export function LabsModule() {
    const { contextFiles, llmConfig, languageConfig, subject, generatedContent, setGeneratedContent, variants, addVariant, removeVariant, reorderVariants, customQuestionTypes, includeWebResources } = useStore();
    const [loading, setLoading] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});
    const [showSecondarySolution, setShowSecondarySolution] = useState<Record<number, boolean>>({});
    const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
    const [generatingSimilar, setGeneratingSimilar] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [numberOfProblems, setNumberOfProblems] = useState(5);
    const [minutesPerProblem, setMinutesPerProblem] = useState(30);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
    const [displayedVariant, setDisplayedVariant] = useState<Record<string, string>>({});

    const labs = generatedContent.labs as Lab[];
    const safeLabs = Array.isArray(labs) ? labs : [];
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
    const primaryLanguage = languageConfig?.primaryLanguage || 'English';
    const secondaryLanguage = languageConfig?.secondaryLanguage || 'none';

    const subjectConfig = useMemo(() => getSubjectConfig(subject), [subject]);
    const labTypes = useMemo(() => getLabTypes(subject, customQuestionTypes?.labs), [subject, customQuestionTypes?.labs]);
    const [typeWeights, setTypeWeights] = useState<Record<string, number>>(() => defaultWeights(labTypes));
    useEffect(() => {
        setTypeWeights(defaultWeights(labTypes));
    }, [labTypes]);
    const typeCounts = useMemo(() => weightsToCounts(numberOfProblems, typeWeights), [numberOfProblems, typeWeights]);

    // Variant helpers
    const getItemId = (index: number) => `labs-${index + 1}`;
    const getVariantsForItem = (index: number) => {
        const itemId = getItemId(index);
        const moduleVariants = variants?.labs || {};
        const itemVariants = moduleVariants[itemId] || [];
        return Array.isArray(itemVariants) ? itemVariants : [];
    };
    const getSelectedVariantIds = (index: number) => {
        const itemId = getItemId(index);
        return selectedVariants[itemId] || ['original'];
    };
    const getDisplayedVariantId = (index: number) => {
        const itemId = getItemId(index);
        return displayedVariant[itemId] || 'original';
    };
    const getDisplayedLab = (index: number): Lab | null => {
        const variantId = getDisplayedVariantId(index);
        if (variantId === 'original') return safeLabs[index] || null;
        const itemId = getItemId(index);
        const moduleVariants = variants?.labs || {};
        const itemVariants = moduleVariants[itemId] || [];
        const v = itemVariants.find((v: any) => v.variantId === variantId);
        return v || safeLabs[index] || null;
    };

    const handleToggleVariant = (index: number, variantId: string) => {
        const itemId = getItemId(index);
        setSelectedVariants(prev => {
            const current = prev[itemId] || ['original'];
            const newSet = current.includes(variantId)
                ? current.filter(id => id !== variantId)
                : [...current, variantId];
            return { ...prev, [itemId]: newSet.length > 0 ? newSet : ['original'] };
        });
    };
    const handleDisplayVariant = (index: number, variantId: string) => {
        const itemId = getItemId(index);
        setDisplayedVariant(prev => ({ ...prev, [itemId]: variantId }));
    };
    const handleGenerateSimilar = async (index: number) => {
        if (!llmConfig.apiKey) {
            alert('Please configure your API key first.');
            return;
        }
        const itemId = getItemId(index);
        setGeneratingSimilar(prev => ({ ...prev, [itemId]: true }));
        try {
            const originalLab = safeLabs[index];
            const res = await fetch('/api/similar-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalItem: originalLab,
                    moduleType: 'labs',
                    llmConfig: {
                        apiKey: llmConfig.apiKey,
                        baseURL: llmConfig.baseURL,
                        model: llmConfig.model,
                    },
                    primaryLanguage,
                    secondaryLanguage,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `${res.status} ${res.statusText}`);
            }
            const data = await res.json();
            if (data.variant) {
                const variantId = `variant-${Date.now()}`;
                addVariant('labs', itemId, { ...data.variant, variantId });
                setSelectedVariants(prev => ({
                    ...prev,
                    [itemId]: [...(prev[itemId] || ['original']), variantId],
                }));
            }
        } catch (err: any) {
            console.error('Error generating similar question:', err);
            alert(`Error generating similar question: ${err?.message || 'Unknown error'}`);
        } finally {
            setGeneratingSimilar(prev => ({ ...prev, [itemId]: false }));
        }
    };
    const handleRemoveVariant = (index: number, variantId: string) => {
        const itemId = getItemId(index);
        removeVariant('labs', itemId, variantId);
        setSelectedVariants(prev => {
            const current = prev[itemId] || ['original'];
            return { ...prev, [itemId]: current.filter(id => id !== variantId) };
        });
        if (getDisplayedVariantId(index) === variantId) {
            setDisplayedVariant(prev => ({ ...prev, [itemId]: 'original' }));
        }
    };
    const handleReorderVariants = (index: number, variantIds: string[]) => {
        const itemId = getItemId(index);
        reorderVariants('labs', itemId, variantIds);
    };

    const exportItems: ExportItem[] = useMemo(() => {
        return safeLabs.map((lab: any, idx: number) => {
            const num = Number.isFinite(Number(lab?.problem_number)) ? Number(lab.problem_number) : idx + 1;
            const qPrimary = [
                `## Description`,
                safeString(lab?.description),
                '',
                `## Requirements`,
                ...((lab?.requirements ?? []).map((r: any) => `- ${r}`)),
                '',
                `## Hints`,
                ...((lab?.hints ?? []).map((h: any) => `- ${h}`)),
            ].join('\n');
            const qSecondary = [
                `## Description`,
                safeString(lab?.description_secondary),
                '',
                `## Requirements`,
                ...((lab?.requirements_secondary ?? []).map((r: any) => `- ${r}`)),
                '',
                `## Hints`,
                ...((lab?.hints_secondary ?? []).map((h: any) => `- ${h}`)),
            ].join('\n');
            
            // Build variants array
            const itemId = getItemId(idx);
            const itemVariants = getVariantsForItem(idx);
            const selectedIds = getSelectedVariantIds(idx);
            
            return {
                number: num,
                title: safeString(lab?.title),
                type: safeString(lab?.problem_type),
                points: Number.isFinite(Number(lab?.points)) ? Number(lab.points) : 10,
                sources: Array.isArray(lab?.sources) ? lab.sources : [],
                primary: {
                    question: ensureMarkdownCodeFences(qPrimary),
                    solution: ensureMarkdownCodeFences(lab?.solution),
                    explanation: ensureMarkdownCodeFences(lab?.solution_explanation),
                },
                secondary: {
                    question: ensureMarkdownCodeFences(qSecondary),
                    solution: ensureMarkdownCodeFences(lab?.solution_secondary),
                    explanation: ensureMarkdownCodeFences(lab?.solution_explanation_secondary),
                },
                variants: itemVariants,
                selectedVariantIds: selectedIds,
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [safeLabs, primaryLanguage, secondaryLanguage, variants, selectedVariants]);

    function safeString(x: any) {
        return typeof x === 'string' ? x : '';
    }

    const handleGenerate = async () => {
        if (contextFiles.length === 0) {
            alert('Please upload at least one file to generate labs.');
            return;
        }

        if (!llmConfig.apiKey) {
            alert('Please configure your API key in the settings.');
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: numberOfProblems, message: 'Starting...' });
        try {
            const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

            const response = await fetch('/api/generate-with-agents-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    moduleType: 'labs',
                    numberOfItems: numberOfProblems,
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
                    includeWebResources: includeWebResources || false,
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
                                total: parsed.total ?? numberOfProblems,
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
                console.error('[labs-module] Invalid stream response:', data);
                throw new Error('Invalid response from server');
            }

            const problems = results.map((p: any, i: number) => ({
                problem_number: Number.isFinite(Number(p?.problem_number)) ? Number(p.problem_number) : i + 1,
                problem_type: typeof p?.problem_type === 'string' ? p.problem_type : (typeof p?.format === 'string' ? p.format : ''),
                title: typeof p?.title === 'string' ? p.title : `Problem ${i + 1}`,
                title_secondary: typeof p?.title_secondary === 'string' ? p.title_secondary : '',
                description: typeof p?.description === 'string' ? p.description : (typeof p?.question === 'string' ? p.question : ''),
                description_secondary: typeof p?.description_secondary === 'string' ? p.description_secondary : (typeof p?.question_secondary === 'string' ? p.question_secondary : ''),
                estimated_time: Number.isFinite(Number(p?.estimated_time)) ? Number(p.estimated_time) : minutesPerProblem,
                points: Number.isFinite(Number(p?.points)) ? Number(p.points) : 10,
                requirements: Array.isArray(p?.requirements) ? p.requirements : [],
                requirements_secondary: Array.isArray(p?.requirements_secondary) ? p.requirements_secondary : [],
                hints: Array.isArray(p?.hints) ? p.hints : [],
                hints_secondary: Array.isArray(p?.hints_secondary) ? p.hints_secondary : [],
                solution: ensureMarkdownCodeFences(p?.solution || ''),
                solution_secondary: ensureMarkdownCodeFences(p?.solution_secondary || ''),
                solution_explanation: ensureMarkdownCodeFences(p?.solution_explanation || ''),
                solution_explanation_secondary: ensureMarkdownCodeFences(p?.solution_explanation_secondary || ''),
                sources: Array.isArray(p?.sources)
                    ? p.sources.map((s: any) => ({
                        file: typeof s?.file === 'string' ? s.file : '',
                        pages: typeof s?.pages === 'string' ? s.pages : '',
                    })).filter((s: any) => s.file || s.pages)
                    : [],
            }));

            setGeneratedContent('labs', problems);
            setProgress(null);
        } catch (error: any) {
            console.error('Error generating labs:', error);
            alert(`Error generating labs: ${error.message || 'Unknown error'}. Check console for details.`);
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

    const handleRegenerate = async (index: number) => {
        if (contextFiles.length === 0) return;
        if (!llmConfig.apiKey) return;
        const target = safeLabs[index];
        if (!target) return;

        setRegenerating((s) => ({ ...s, [index]: true }));
        try {
            const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

            // Use agent skills API for regeneration
            const response = await fetch('/api/generate-with-agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    moduleType: 'labs',
                    action: 'regenerate',
                    originalItem: target,
                    context,
                    taskParams: {
                        minutesPerProblem,
                        subject,
                        availableFiles: contextFiles.map((f) => f.name),
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

            const newProblem = data.results[0];
            let merged = { ...target, ...newProblem };
            
            merged = {
                ...merged,
                problem_number: target.problem_number,
                solution: ensureMarkdownCodeFences((merged as any).solution || ''),
                solution_secondary: ensureMarkdownCodeFences((merged as any).solution_secondary || ''),
                solution_explanation: ensureMarkdownCodeFences((merged as any).solution_explanation || ''),
                solution_explanation_secondary: ensureMarkdownCodeFences((merged as any).solution_explanation_secondary || ''),
                sources: Array.isArray((merged as any)?.sources) ? (merged as any).sources : target.sources ?? [],
            };

            // If secondary language is enabled but secondary fields look un-translated, do a quick fix pass.
            if (secondaryLanguage !== 'none') {
                const secDesc = (merged as any).description_secondary || '';
                const primDesc = (merged as any).description || '';
                const bad =
                    !secDesc ||
                    secDesc.trim().length < 4 ||
                    (primDesc && secDesc && primDesc.trim() === secDesc.trim()) ||
                    ((secondaryLanguage.includes('中文') || secondaryLanguage.includes('繁體') || secondaryLanguage.includes('简体')) &&
                        !/[\u4e00-\u9fff]/.test(secDesc));
                if (bad) {
                    // Use agent skills API for translation fix
                    try {
                        const fixResponse = await fetch('/api/generate-with-agents', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                moduleType: 'labs',
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

            const next = [...safeLabs];
            next[index] = merged;
            setGeneratedContent('labs', next);
        } catch (e: any) {
            console.error('Error regenerating lab problem:', e);
            alert(`Error regenerating lab: ${e?.message || 'Unknown error'}. Check console for details.`);
        } finally {
            setRegenerating((s) => ({ ...s, [index]: false }));
        }
    };

    const buildPrimaryCopy = (lab: Lab) => {
        const reqs = (lab.requirements ?? []).map((r) => `- ${r}`).join('\n') || '-';
        const hints = (lab.hints ?? []).map((h) => `- ${h}`).join('\n') || '-';
        const sources =
            (lab.sources ?? []).length > 0
                ? `\n\n## Sources\n${(lab.sources ?? []).map((s) => `- ${s.file}${s.pages ? ` (${s.pages})` : ''}`).join('\n')}`
                : '';
        const explanation = lab.solution_explanation?.trim()
            ? `\n\n## Explanation (${primaryLanguage})\n${lab.solution_explanation}`
            : '';
        return `# Problem ${lab.problem_number}: ${lab.title}\n\n## Description (${primaryLanguage})\n${lab.description}\n\n## Requirements\n${reqs}\n\n## Hints\n${hints}${sources}\n\n## Solution (${primaryLanguage})\n${lab.solution}${explanation}`;
    };

    const buildSecondaryCopy = (lab: Lab) => {
        const reqs = (lab.requirements_secondary ?? []).map((r) => `- ${r}`).join('\n') || '-';
        const hints = (lab.hints_secondary ?? []).map((h) => `- ${h}`).join('\n') || '-';
        const sources =
            (lab.sources ?? []).length > 0
                ? `\n\n## Sources\n${(lab.sources ?? []).map((s) => `- ${s.file}${s.pages ? ` (${s.pages})` : ''}`).join('\n')}`
                : '';
        const explanation = lab.solution_explanation_secondary?.trim()
            ? `\n\n## Explanation (${secondaryLanguage})\n${lab.solution_explanation_secondary}`
            : '';
        return `# Problem ${lab.problem_number}: ${lab.title_secondary || lab.title}\n\n## Description (${secondaryLanguage})\n${lab.description_secondary || ''}\n\n## Requirements\n${reqs}\n\n## Hints\n${hints}${sources}\n\n## Solution (${secondaryLanguage})\n${lab.solution_secondary || ''}${explanation}`;
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                    Lab Practices Generator
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Create complex coding experiments with time-based difficulty calibration
                </p>
            </div>

            <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
                <CardHeader>
                    <CardTitle>Lab Configuration</CardTitle>
                    <CardDescription>
                        Define the number of problems and time allocation
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="num-problems">Number of Problems</Label>
                            <Input
                                id="num-problems"
                                type="number"
                                min="1"
                                max="999"
                                step={1}
                                inputMode="numeric"
                                value={numberOfProblems}
                                onChange={(e) => setNumberOfProblems(Math.max(1, Math.min(999, parseInt(e.target.value) || 1)))}
                            />
                        </div>
                        <div>
                            <Label htmlFor="minutes-per">Minutes per Problem</Label>
                            <Input
                                id="minutes-per"
                                type="number"
                                min="10"
                                max="120"
                                step={1}
                                inputMode="numeric"
                                value={minutesPerProblem}
                                onChange={(e) => setMinutesPerProblem(parseInt(e.target.value) || 10)}
                            />
                        </div>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                        <p className="text-sm text-blue-800 dark:text-blue-300">
                            <strong>Total Lab Time:</strong> {numberOfProblems * minutesPerProblem} minutes
                        </p>
                    </div>

                    <QuestionTypeMix
                        title="Question Type Mix"
                        subjectLabel={subjectConfig.label}
                        types={labTypes}
                        total={numberOfProblems}
                        weights={typeWeights}
                        counts={typeCounts}
                        onChange={setTypeWeights}
                    />

                    <Button
                        onClick={handleGenerate}
                        disabled={loading || contextFiles.length === 0}
                        size="lg"
                        className="w-full"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                                Generating Lab...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-4 h-4" />
                                Generate Lab Practices
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
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                            ⚠️ Please upload course materials first
                        </p>
                    )}
                </CardContent>
            </Card>

            {safeLabs.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                            Lab Worksheet ({safeLabs.length} Problems)
                        </h3>
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <input
                                type="checkbox"
                                checked={selectedNumbers.length === safeLabs.length}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedNumbers(safeLabs.map((l: any, i: number) => l?.problem_number ?? i + 1));
                                    } else {
                                        setSelectedNumbers([]);
                                    }
                                }}
                            />
                            Select all
                        </label>
                    </div>

                    <ExportPanel
                        title="Lab Practices"
                        moduleId="labs"
                        items={exportItems}
                        selectedNumbers={selectedNumbers}
                    />

                    {safeLabs.map((originalLab, index) => {
                        const lab = getDisplayedLab(index) || originalLab;
                        const itemVariants = getVariantsForItem(index);
                        const selectedIds = getSelectedVariantIds(index);
                        const displayedId = getDisplayedVariantId(index);
                        const itemId = getItemId(index);
                        
                        return (
                        <Card key={index} className="hover:shadow-lg transition-shadow">
                            <CardHeader className="bg-gradient-to-r from-purple-500/10 to-pink-500/10">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedNumbers.includes(originalLab.problem_number)}
                                                onChange={(e) => {
                                                    const num = originalLab.problem_number;
                                                    setSelectedNumbers((prev) =>
                                                        e.target.checked ? Array.from(new Set([...prev, num])) : prev.filter((x) => x !== num)
                                                    );
                                                }}
                                            />
                                            <CardTitle>Problem {originalLab.problem_number}: {lab.title}</CardTitle>
                                            {lab.problem_type && (
                                                <span className="px-2 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                                                    {formatTypeDisplay(lab.problem_type)}
                                                </span>
                                            )}
                                        </div>
                                        <CardDescription className="mt-1">
                                            Worth {lab.points ?? 10} points • ⏱️ Estimated Time: {lab.estimated_time} minutes
                                        </CardDescription>
                                        {(lab.sources ?? []).length > 0 && (
                                            <p className="mt-2 text-xs text-slate-500">
                                                <strong>Sources:</strong>{' '}
                                                {(lab.sources ?? [])
                                                    .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                                    .join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleCopy(buildPrimaryCopy(lab), index)}
                                            title={`Copy (${primaryLanguage})`}
                                        >
                                            {copiedIndex === index ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                        {secondaryLanguage !== 'none' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleCopy(buildSecondaryCopy(lab), index)}
                                                title={`Copy (${secondaryLanguage})`}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
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
                                            currentSources={lab.sources}
                                            isLoading={regenerating[index]}
                                            questionTypes={customQuestionTypes.labs || []}
                                            currentQuestionType={lab.problem_type}
                                            onRegenerate={async (selectedFile, selectedPages, selectedQuestionType) => {
                                                setRegenerating((s) => ({ ...s, [index]: true }));
                                                try {
                                                    const target = originalLab;
                                                    const fileContent = contextFiles.find(f => f.name === selectedFile)?.content || '';
                                                    const context = `FILE: ${selectedFile}\n${fileContent}`;
                                                    
                                                    const response = await fetch('/api/generate-with-agents', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            moduleType: 'labs',
                                                            action: 'regenerate',
                                                            originalItem: target,
                                                            context,
                                                            taskParams: {
                                                                minutesPerProblem,
                                                                subject,
                                                                questionType: selectedQuestionType || lab.problem_type,
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

                                                    const newLab = data.results[0];
                                                    // Force the selected source
                                                    const forcedSources = [{ file: selectedFile, pages: selectedPages }];
                                                    const merged = { 
                                                        ...target, 
                                                        ...newLab,
                                                        sources: forcedSources,
                                                        problem_type: selectedQuestionType || newLab?.problem_type || target?.problem_type,
                                                    };

                                                    setGeneratedContent('labs', safeLabs.map((l, i) =>
                                                        i === index ? merged : l
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
                                        itemId={itemId}
                                        originalItem={originalLab}
                                        variants={itemVariants}
                                        selectedVariantIds={selectedIds}
                                        displayedVariantId={displayedId}
                                        onToggleVariant={(variantId) => handleToggleVariant(index, variantId)}
                                        onDisplayVariant={(variantId) => handleDisplayVariant(index, variantId)}
                                        onGenerateSimilar={() => handleGenerateSimilar(index)}
                                        onRemoveVariant={(variantId) => handleRemoveVariant(index, variantId)}
                                        onReorderVariants={(variantIds) => handleReorderVariants(index, variantIds)}
                                        isGenerating={generatingSimilar[itemId] || false}
                                        getDisplayText={(v) => v.description || v.title || ''}
                                        primaryLanguage={primaryLanguage}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-4">
                                {/* Primary language block */}
                                <div className="space-y-4">
                                    <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                                        {primaryLanguage} Block
                                    </h4>

                                    <div>
                                        <h5 className="font-semibold text-sm mb-2">Description ({primaryLanguage}):</h5>
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                            {/* Only trace format uses CodeBlock for description */}
                                            {/* For other coding types, use MixedContent to properly render markdown and detect code blocks */}
                                            {lab.problem_type?.toLowerCase() === 'trace' ? (
                                                <CodeBlock code={lab.description || ''} />
                                            ) : isCodingType(lab.problem_type) ? (
                                                <MixedContent content={lab.description || ''} />
                                            ) : (
                                                <MixedContent content={lab.description || ''} />
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <h5 className="font-semibold text-sm mb-2">Requirements:</h5>
                                        <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                            {(lab.requirements ?? []).map((req, i) => <li key={i}>{req}</li>)}
                                        </ul>
                                    </div>

                                    <div>
                                        <h5 className="font-semibold text-sm mb-2">Hints:</h5>
                                        <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 dark:text-slate-400">
                                            {(lab.hints ?? []).map((hint, i) => <li key={i}>{hint}</li>)}
                                        </ul>
                                    </div>

                                    <div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowSolution({ ...showSolution, [index]: !showSolution[index] })}
                                        >
                                            {showSolution[index] ? 'Hide' : 'Show'} Solution
                                        </Button>
                                        {showSolution[index] && (
                                            <div className="mt-2 space-y-3">
                                                <div className="max-w-none">
                                                    {isCodingType(lab.problem_type) ? (
                                                        <CodeBlock code={lab.solution || ''} />
                                                    ) : (
                                                        <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                {ensureMarkdownCodeFences(lab.solution)}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
                                                {lab.solution_explanation && lab.solution_explanation.trim().length > 0 && (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(lab.solution_explanation)}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Secondary language block */}
                                {secondaryLanguage !== 'none' && (
                                    <div className="space-y-4 pt-4 border-t border-slate-200/60 dark:border-slate-700/60">
                                        <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                                            {secondaryLanguage} Block
                                        </h4>

                                        {lab.description_secondary && lab.description_secondary.trim().length > 0 && (
                                            <div>
                                                <h5 className="font-semibold text-sm mb-2">Description ({secondaryLanguage}):</h5>
                                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                                    {/* Use MixedContent for all types to properly render markdown with code blocks */}
                                                    {lab.problem_type?.toLowerCase() === 'trace' ? (
                                                        <CodeBlock code={lab.description_secondary || ''} />
                                                    ) : (
                                                        <MixedContent content={lab.description_secondary || ''} />
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {(lab.requirements_secondary ?? []).length > 0 && (
                                            <div>
                                                <h5 className="font-semibold text-sm mb-2">Requirements:</h5>
                                                <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                                    {(lab.requirements_secondary ?? []).map((req, i) => <li key={i}>{req}</li>)}
                                                </ul>
                                            </div>
                                        )}

                                        {(lab.hints_secondary ?? []).length > 0 && (
                                            <div>
                                                <h5 className="font-semibold text-sm mb-2">Hints:</h5>
                                                <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 dark:text-slate-400">
                                                    {(lab.hints_secondary ?? []).map((hint, i) => <li key={i}>{hint}</li>)}
                                                </ul>
                                            </div>
                                        )}

                                        <div>
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
                                        </div>

                                        {showSecondarySolution[index] && (lab.solution_secondary || lab.solution_explanation_secondary) && (
                                            <div className="space-y-3">
                                                {lab.solution_secondary && lab.solution_secondary.trim().length > 0 && (
                                                    <div className="max-w-none">
                                                        {isCodingType(lab.problem_type) ? (
                                                            <CodeBlock code={lab.solution_secondary || ''} />
                                                        ) : (
                                                            <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                    {ensureMarkdownCodeFences(lab.solution_secondary)}
                                                                </ReactMarkdown>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {lab.solution_explanation_secondary && lab.solution_explanation_secondary.trim().length > 0 && (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(lab.solution_explanation_secondary)}
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
                    })}
                </div>
            )}
        </div>
    );
}
