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
import { defaultWeights, getSubjectConfig, getHomeworkTypes, weightsToCounts } from '@/lib/subjects';
import { ensureMarkdownCodeFences, wrapSolutionAsCodeIfCoding } from '@/lib/llm/format';
import { CodeBlock } from '@/components/shared/code-block';
import { MixedContent } from '@/components/shared/mixed-content';

// Helper function to check if a problem type is coding-related
function isCodingType(format: string | undefined): boolean {
    const normalized = String(format || '').toLowerCase();
    return normalized.includes('coding') || 
           normalized.includes('debugging') || 
           normalized.includes('trace') ||
           normalized === 'code';
}
import { QuestionTypeMix } from '@/components/shared/question-type-mix';
import { ExportPanel, type ExportItem } from '@/components/shared/export-panel';
import { VariantSelector } from '@/components/shared/variant-selector';
import { SourceSelector } from '@/components/shared/source-selector';

// Format type display with title case
function formatTypeDisplay(format: string | undefined): string {
    return String(format || '')
        .replace(/_/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

interface Homework {
    title: string;
    chapters_covered: string[];
    total_points: number;
    distribution?: Record<string, number>;
    typeDistribution?: Record<string, number>;
    problems: Array<{
        number: number;
        question_type?: string;
        title: string;
        description: string;
        description_secondary?: string;
        options?: string[];
        points: number;
        requirements: string[];
        requirements_secondary?: string[];
        sources?: Array<{ file: string; pages: string }>;
        solution: string;
        solution_secondary?: string;
        solution_explanation?: string;
        solution_explanation_secondary?: string;
    }>;
}

export function HomeworkModule() {
    const { contextFiles, llmConfig, languageConfig, subject, generatedContent, setGeneratedContent, variants, addVariant, removeVariant, reorderVariants, customQuestionTypes, includeWebResources } = useStore();
    const [loading, setLoading] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});
    const [showSecondarySolution, setShowSecondarySolution] = useState<Record<number, boolean>>({});
    const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
    const [generatingSimilar, setGeneratingSimilar] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
    const [numberOfProblems, setNumberOfProblems] = useState<number>(5);
    const [minutesPerProblem, setMinutesPerProblem] = useState<number>(20);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
    const [displayedVariant, setDisplayedVariant] = useState<Record<string, string>>({});
    const subjectConfig = useMemo(() => getSubjectConfig(subject), [subject]);
    const homeworkTypes = useMemo(() => getHomeworkTypes(subject, customQuestionTypes?.homework), [subject, customQuestionTypes?.homework]);
    const [typeWeights, setTypeWeights] = useState<Record<string, number>>(() => defaultWeights(homeworkTypes));

    useEffect(() => {
        setTypeWeights(defaultWeights(homeworkTypes));
    }, [homeworkTypes]);

    const typeCounts = useMemo(() => weightsToCounts(numberOfProblems, typeWeights), [numberOfProblems, typeWeights]);

    // Get safe problems array
    const homework = generatedContent.homework[0] as Homework | undefined;
    const safeProblems = homework?.problems ?? [];
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

    // Variant helpers
    const getItemId = (index: number) => `homework-${index + 1}`;
    const getVariantsForItem = (index: number) => {
        const itemId = getItemId(index);
        const moduleVariants = variants?.homework || {};
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
    const getDisplayedProblem = (index: number) => {
        const variantId = getDisplayedVariantId(index);
        if (variantId === 'original') return safeProblems[index] || null;
        const itemId = getItemId(index);
        const moduleVariants = variants?.homework || {};
        const itemVariants = moduleVariants[itemId] || [];
        const v = itemVariants.find((v: any) => v.variantId === variantId);
        return v || safeProblems[index] || null;
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
            const originalProblem = safeProblems[index];
            const res = await fetch('/api/similar-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalItem: originalProblem,
                    moduleType: 'homework',
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
                addVariant('homework', itemId, { ...data.variant, variantId });
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
        removeVariant('homework', itemId, variantId);
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
        reorderVariants('homework', itemId, variantIds);
    };

    const safeHomework = homework
        ? {
            ...homework,
            chapters_covered: Array.isArray((homework as any).chapters_covered) ? (homework as any).chapters_covered : [],
            problems: Array.isArray((homework as any).problems) ? (homework as any).problems : [],
        }
        : undefined;

    const exportItems: ExportItem[] = useMemo(() => {
        const probs = safeHomework?.problems ?? [];
        return probs.map((p: any, idx: number) => {
            const num = Number.isFinite(Number(p?.number)) ? Number(p.number) : idx + 1;
            const optionsBlock = Array.isArray(p?.options) && p.options.length > 0
                ? ['', `## Options`, ...p.options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}) ${o.replace(/^[A-D]\)\s*/, '')}`)]
                : [];
            const qPrimary = [
                `## Description`,
                String(p?.description || ''),
                ...optionsBlock,
                '',
                `## Requirements`,
                ...((p?.requirements ?? []).map((r: any) => `- ${r}`)),
            ].join('\n');
            const qSecondary = [
                `## Description`,
                String(p?.description_secondary || ''),
                ...optionsBlock,
                '',
                `## Requirements`,
                ...((p?.requirements_secondary ?? []).map((r: any) => `- ${r}`)),
            ].join('\n');
            return {
                number: num,
                title: String(p?.title || `Problem ${num}`),
                type: String(p?.question_type || ''),
                points: Number.isFinite(Number(p?.points)) ? Number(p.points) : 10,
                sources: Array.isArray(p?.sources) ? p.sources : [],
                primary: {
                    question: ensureMarkdownCodeFences(qPrimary),
                    solution: ensureMarkdownCodeFences(p?.solution),
                    explanation: ensureMarkdownCodeFences(p?.solution_explanation),
                },
                secondary: {
                    question: ensureMarkdownCodeFences(qSecondary),
                    solution: ensureMarkdownCodeFences(p?.solution_secondary),
                    explanation: ensureMarkdownCodeFences(p?.solution_explanation_secondary),
                },
            };
        });
    }, [safeHomework]);

    const handleGenerate = async () => {
        if (contextFiles.length === 0) {
            alert('Please upload at least one file to generate homework.');
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
                    moduleType: 'homework',
                    numberOfItems: numberOfProblems,
                    context,
                    taskParams: {
                        minutesPerProblem,
                        subject,
                        typeCounts,
                        availableFiles: contextFiles.map((f) => f.name),
                        sourceDocuments,
                        selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
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
            let data: { results?: any[]; type?: string; message?: string; current?: number; total?: number; title?: string; chapters_covered?: string[] } = {};

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
                console.error('[homework-module] Invalid stream response:', data);
                throw new Error('Invalid response from server');
            }

            const problems = results.map((p: any, i: number) => {
                // Process sources
                const sources = Array.isArray(p?.sources)
                    ? p.sources.map((s: any) => ({
                        file: typeof s?.file === 'string' ? s.file : '',
                        pages: typeof s?.pages === 'string' ? s.pages : '',
                    })).filter((s: any) => s.file || s.pages)
                    : [];
                
                // Extract title from metadata.key_concepts if title is missing
                let title = typeof p?.title === 'string' ? p.title : '';
                if (!title && p?.metadata?.key_concepts && Array.isArray(p.metadata.key_concepts) && p.metadata.key_concepts.length > 0) {
                    title = p.metadata.key_concepts[0];
                }
                if (!title) title = `Problem ${i + 1}`;
                
                // Extract all chapters from sources for distribution
                const allChapters = sources
                    .map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '')
                    .filter((c: string) => c);
                if (allChapters.length === 0) allChapters.push('Unknown');
                
                return {
                    number: Number.isFinite(Number(p?.number)) ? Number(p.number) : i + 1,
                    question_type: typeof p?.question_type === 'string' ? p.question_type : (typeof p?.format === 'string' ? p.format : ''),
                    title,
                    description: typeof p?.description === 'string' ? p.description : (typeof p?.question === 'string' ? p.question : ''),
                    description_secondary: typeof p?.description_secondary === 'string' ? p.description_secondary : (typeof p?.question_secondary === 'string' ? p.question_secondary : ''),
                    options: Array.isArray(p?.options) ? p.options : [],
                    points: Number.isFinite(Number(p?.points)) ? Number(p.points) : 10,
                    requirements: Array.isArray(p?.requirements) ? p.requirements : [],
                    requirements_secondary: Array.isArray(p?.requirements_secondary) ? p.requirements_secondary : [],
                    sources,
                    allChapters, // Store all chapters for distribution calculation
                    solution: ensureMarkdownCodeFences(p?.solution || ''),
                    solution_secondary: ensureMarkdownCodeFences(p?.solution_secondary || ''),
                    solution_explanation: ensureMarkdownCodeFences(p?.solution_explanation || ''),
                    solution_explanation_secondary: ensureMarkdownCodeFences(p?.solution_explanation_secondary || ''),
                };
            });

            // Calculate distributions
            const chapterDist: Record<string, number> = {};
            const typeDist: Record<string, number> = {};
            let totalPointsAccum = 0;
            
            for (const p of problems) {
                const pts = p.points || 0;
                totalPointsAccum += pts;
                
                // Source-based chapter distribution - distribute points across ALL source files
                const chapters = p.allChapters || ['Unknown'];
                const pointsPerChapter = pts / chapters.length;
                for (const ch of chapters) {
                    const chapterName = ch || 'Unknown';
                    chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                }
                
                // Type distribution
                const type = p.question_type || 'Unknown';
                typeDist[type] = (typeDist[type] || 0) + pts;
            }
            
            // Convert to percentages
            const chapterPercentages: Record<string, number> = {};
            const typePercentages: Record<string, number> = {};
            
            for (const [chapter, points] of Object.entries(chapterDist)) {
                chapterPercentages[chapter] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
            }
            for (const [type, points] of Object.entries(typeDist)) {
                typePercentages[type] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
            }
            
            const result = {
                title: typeof data.title === 'string' ? data.title : 'Homework Assignment',
                chapters_covered: Array.isArray(data.chapters_covered) ? data.chapters_covered : (selectedChapters.length > 0 ? selectedChapters : contextFiles.map((f) => f.name)),
                total_points: problems.reduce((s: number, p: any) => s + (Number(p.points) || 0), 0),
                distribution: chapterPercentages,
                typeDistribution: typePercentages,
                problems: problems,
            };

            setGeneratedContent('homework', [result]);
            setProgress(null);
        } catch (error: any) {
            console.error('Error generating homework:', error);
            alert(`Error generating homework: ${error.message || 'Unknown error'}. Check console for details.`);
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

    const buildPrimaryCopy = (p: Homework['problems'][number]) => {
        const reqs = (p.requirements ?? []).map((r) => `- ${r}`).join('\n') || '-';
        const sources = (p.sources ?? []).map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ');
        const explanation = p.solution_explanation?.trim()
            ? `\n\n## Explanation (${primaryLanguage})\n${p.solution_explanation}`
            : '';
        return `# Problem ${p.number}: ${p.title}\n${sources ? `Sources: ${sources}\n` : ''}\n## Description (${primaryLanguage})\n${p.description}\n\n## Requirements\n${reqs}\n\n## Solution (${primaryLanguage})\n${p.solution}${explanation}`;
    };

    const buildSecondaryCopy = (p: Homework['problems'][number]) => {
        const reqs = (p.requirements_secondary ?? []).map((r) => `- ${r}`).join('\n') || '-';
        const sources = (p.sources ?? []).map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ');
        const explanation = p.solution_explanation_secondary?.trim()
            ? `\n\n## Explanation (${secondaryLanguage})\n${p.solution_explanation_secondary}`
            : '';
        return `# Problem ${p.number}: ${p.title}\n${sources ? `Sources: ${sources}\n` : ''}\n## Description (${secondaryLanguage})\n${p.description_secondary || ''}\n\n## Requirements\n${reqs}\n\n## Solution (${secondaryLanguage})\n${p.solution_secondary || ''}${explanation}`;
    };

    const handleRegenerateProblem = async (index: number) => {
        if (!homework) return;
        if (contextFiles.length === 0) return;
        if (!llmConfig.apiKey) return;
        const target = homework.problems?.[index];
        if (!target) return;

        setRegenerating((s) => ({ ...s, [index]: true }));
        try {
            const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

            // Use agent skills API for regeneration
            const response = await fetch('/api/generate-with-agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    moduleType: 'homework',
                    action: 'regenerate',
                    originalItem: { ...target, assignment_title: homework.title, chapters_covered: homework.chapters_covered },
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
            
            // Process sources from the regenerated problem - always use new sources
            let newSources = Array.isArray(merged?.sources) ? merged.sources : [];
            // Only fallback to original if truly empty and no new data
            if (newSources.length === 0 && Array.isArray(target?.sources)) {
                newSources = target.sources;
            }
            
            // Extract title from metadata.key_concepts if title is missing
            let newTitle = merged?.title || '';
            if (!newTitle && merged?.metadata?.key_concepts && Array.isArray(merged.metadata.key_concepts) && merged.metadata.key_concepts.length > 0) {
                newTitle = merged.metadata.key_concepts[0];
            }
            
            merged = {
                ...merged,
                number: Number.isFinite(Number(merged?.number)) ? Number(merged.number) : target.number,
                points: Number.isFinite(Number(merged?.points)) ? Number(merged.points) : target.points,
                title: newTitle || target.title || `Problem ${target.number}`,
                solution: ensureMarkdownCodeFences(merged?.solution || ''),
                solution_secondary: ensureMarkdownCodeFences(merged?.solution_secondary || ''),
                solution_explanation: ensureMarkdownCodeFences(merged?.solution_explanation || ''),
                solution_explanation_secondary: ensureMarkdownCodeFences(merged?.solution_explanation_secondary || ''),
                sources: newSources,
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
                                moduleType: 'homework',
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

            const updatedProblems = homework.problems.map((p, i) =>
                i === index ? merged : p
            );
            
            // Recalculate distributions after regeneration
            const chapterDist: Record<string, number> = {};
            const typeDist: Record<string, number> = {};
            let totalPointsAccum = 0;
            
            for (const p of updatedProblems) {
                const pts = p.points || 0;
                totalPointsAccum += pts;
                
                // Source-based chapter distribution - distribute points across ALL source files
                const chapters = (p as any).allChapters || 
                    (p.sources || []).map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '').filter((c: string) => c);
                const chaptersToUse = chapters.length > 0 ? chapters : ['Unknown'];
                const pointsPerChapter = pts / chaptersToUse.length;
                for (const ch of chaptersToUse) {
                    const chapterName = ch || 'Unknown';
                    chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                }
                
                // Type distribution
                const type = p.question_type || 'Unknown';
                typeDist[type] = (typeDist[type] || 0) + pts;
            }
            
            // Convert to percentages
            const chapterPercentages: Record<string, number> = {};
            const typePercentages: Record<string, number> = {};
            
            for (const [chapter, points] of Object.entries(chapterDist)) {
                chapterPercentages[chapter] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
            }
            for (const [type, points] of Object.entries(typeDist)) {
                typePercentages[type] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
            }
            
            const nextHomework: Homework = {
                ...homework,
                problems: updatedProblems,
                distribution: chapterPercentages,
                typeDistribution: typePercentages,
            };
            setGeneratedContent('homework', [nextHomework]);
        } catch (e: any) {
            console.error('Error regenerating homework problem:', e);
            alert(`Error regenerating homework: ${e?.message || 'Unknown error'}. Check console for details.`);
        } finally {
            setRegenerating((s) => ({ ...s, [index]: false }));
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                    Homework Assignment Generator
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Synthesize concepts from multiple chapters into cohesive assignments
                </p>
            </div>

            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800">
                <CardHeader>
                    <CardTitle>Generate Homework</CardTitle>
                    <CardDescription>
                        Create a comprehensive homework assignment from uploaded materials
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="hw-num-problems">Number of Problems</Label>
                            <Input
                                id="hw-num-problems"
                                type="number"
                                min={1}
                                max={50}
                                step={1}
                                value={numberOfProblems}
                                onChange={(e) => setNumberOfProblems(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                            />
                        </div>
                        <div>
                            <Label htmlFor="hw-minutes">Minutes per Problem</Label>
                            <Input
                                id="hw-minutes"
                                type="number"
                                min={1}
                                max={180}
                                step={1}
                                value={minutesPerProblem}
                                onChange={(e) => setMinutesPerProblem(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                            />
                        </div>
                    </div>

                    <QuestionTypeMix
                        title="Question Type Mix"
                        subjectLabel={subjectConfig.label}
                        types={homeworkTypes}
                        total={numberOfProblems}
                        weights={typeWeights}
                        counts={typeCounts}
                        onChange={setTypeWeights}
                    />

                    <div>
                        <h4 className="text-sm font-medium mb-2">Chapter Selection (Optional)</h4>
                        <p className="text-xs text-slate-500 mb-2">
                            Leave empty to include all uploaded materials
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {contextFiles.map((file) => (
                                <button
                                    key={file.id}
                                    onClick={() => {
                                        if (selectedChapters.includes(file.name)) {
                                            setSelectedChapters(selectedChapters.filter(c => c !== file.name));
                                        } else {
                                            setSelectedChapters([...selectedChapters, file.name]);
                                        }
                                    }}
                                    className={`px-3 py-1 rounded-full text-sm transition-all ${selectedChapters.includes(file.name)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                                        }`}
                                >
                                    {file.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Button
                        onClick={handleGenerate}
                        disabled={loading || contextFiles.length === 0}
                        size="lg"
                        className="w-full"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                                Generating Assignment...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-4 h-4" />
                                Generate Homework Assignment
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

            {safeHomework && (
                <div className="space-y-4">
                    <Card className="bg-gradient-to-r from-green-500/10 to-emerald-500/10">
                        <CardHeader>
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-2xl">{safeHomework.title}</CardTitle>
                                    <CardDescription className="mt-2">
                                        Chapters: {(safeHomework.chapters_covered ?? []).join(', ')} | Total Points: {safeHomework.total_points}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            const text = `# ${safeHomework.title}\n\nTotal Points: ${safeHomework.total_points}\nChapters Covered: ${(safeHomework.chapters_covered ?? []).join(', ')}\n\n${(safeHomework.problems ?? []).map((p: any) =>
                                                buildPrimaryCopy(p)
                                            ).join('\n\n---\n\n')}`;
                                            handleCopy(text, -1);
                                        }}
                                        title={`Copy All (${primaryLanguage})`}
                                    >
                                        {copiedIndex === -1 ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    </Button>
                                    {secondaryLanguage !== 'none' && (
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                const text = `# ${safeHomework.title}\n\nTotal Points: ${safeHomework.total_points}\nChapters Covered: ${(safeHomework.chapters_covered ?? []).join(', ')}\n\n${(safeHomework.problems ?? []).map((p: any) =>
                                                    buildSecondaryCopy(p)
                                                ).join('\n\n---\n\n')}`;
                                                handleCopy(text, -2);
                                            }}
                                            title={`Copy All (${secondaryLanguage})`}
                                        >
                                            {copiedIndex === -2 ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                    </Card>

                    {/* Distribution Charts */}
                    {((safeHomework as any).distribution || (safeHomework as any).typeDistribution) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Score Distribution by Source */}
                            {Object.keys((safeHomework as any).distribution || {}).length > 0 && (
                                <Card>
                                    <CardHeader className="py-3">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            Score Distribution by Source
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="py-2">
                                        <div className="space-y-2">
                                            {Object.entries((safeHomework as any).distribution || {}).map(([source, percentage]: [string, any]) => (
                                                <div key={source} className="flex items-center gap-3">
                                                    <div className="w-24 text-sm font-medium truncate" title={source}>{source || 'Unknown'}</div>
                                                    <div className="flex-1">
                                                        <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-end pr-2 text-white text-xs font-semibold"
                                                                style={{ width: `${Math.max(percentage, 5)}%` }}
                                                            >
                                                                {percentage > 15 && `${percentage}%`}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="w-12 text-sm text-right">{percentage}%</div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Score Distribution by Question Type */}
                            {Object.keys((safeHomework as any).typeDistribution || {}).length > 0 && (
                                <Card>
                                    <CardHeader className="py-3">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            Score Distribution by Type
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="py-2">
                                        <div className="space-y-2">
                                            {Object.entries((safeHomework as any).typeDistribution || {}).map(([type, percentage]: [string, any]) => (
                                                <div key={type} className="flex items-center gap-3">
                                                    <div className="w-24 text-sm font-medium truncate" title={type}>{formatTypeDisplay(type)}</div>
                                                    <div className="flex-1">
                                                        <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-end pr-2 text-white text-xs font-semibold"
                                                                style={{ width: `${Math.max(percentage, 5)}%` }}
                                                            >
                                                                {percentage > 15 && `${percentage}%`}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="w-12 text-sm text-right">{percentage}%</div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <input
                                type="checkbox"
                                checked={selectedNumbers.length === (safeHomework.problems ?? []).length && (safeHomework.problems ?? []).length > 0}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedNumbers((safeHomework.problems ?? []).map((p: any, i: number) => p?.number ?? i + 1));
                                    } else {
                                        setSelectedNumbers([]);
                                    }
                                }}
                            />
                            Select all
                        </label>
                    </div>

                    <ExportPanel
                        title={safeHomework.title || 'Homework'}
                        moduleId="homework"
                        items={exportItems}
                        selectedNumbers={selectedNumbers}
                    />

                    {(safeHomework.problems ?? []).map((originalProblem: any, index: number) => {
                        const problem = getDisplayedProblem(index) || originalProblem;
                        const itemVariants = getVariantsForItem(index);
                        const selectedIds = getSelectedVariantIds(index);
                        const displayedId = getDisplayedVariantId(index);
                        const itemId = getItemId(index);
                        
                        return (
                        <Card key={index} className="hover:shadow-lg transition-shadow">
                            <CardHeader className="bg-slate-50 dark:bg-slate-800/50">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedNumbers.includes(originalProblem.number)}
                                                onChange={(e) => {
                                                    const num = originalProblem.number;
                                                    setSelectedNumbers((prev) =>
                                                        e.target.checked ? Array.from(new Set([...prev, num])) : prev.filter((x) => x !== num)
                                                    );
                                                }}
                                            />
                                            <CardTitle>Problem {originalProblem.number}: {problem.title}</CardTitle>
                                            {problem.question_type && (
                                                <span className="px-2 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                                                    {formatTypeDisplay(problem.question_type)}
                                                </span>
                                            )}
                                        </div>
                                        <CardDescription className="mt-1">
                                            Worth {problem.points} points
                                        </CardDescription>
                                        {(problem.sources ?? []).length > 0 && (
                                            <p className="mt-2 text-xs text-slate-500">
                                                <strong>Sources:</strong>{' '}
                                                {(problem.sources ?? [])
                                                    .map((s: any) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                                    .join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleCopy(buildPrimaryCopy(problem), index)}
                                            title={`Copy (${primaryLanguage})`}
                                        >
                                            {copiedIndex === index ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                        {secondaryLanguage !== 'none' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleCopy(buildSecondaryCopy(problem), index)}
                                                title={`Copy (${secondaryLanguage})`}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={loading || regenerating[index]}
                                            onClick={() => handleRegenerateProblem(index)}
                                            title="Regenerate"
                                        >
                                            {regenerating[index] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                        </Button>
                                        
                                        {/* Custom Source Selector */}
                                        <SourceSelector
                                            availableFiles={contextFiles}
                                            currentSources={problem.sources}
                                            isLoading={regenerating[index]}
                                            questionTypes={customQuestionTypes.homework || []}
                                            currentQuestionType={problem.type}
                                            onRegenerate={async (selectedFile, selectedPages, selectedQuestionType) => {
                                                if (!safeHomework) return;
                                                setRegenerating((s) => ({ ...s, [index]: true }));
                                                try {
                                                    const target = originalProblem;
                                                    const fileContent = contextFiles.find(f => f.name === selectedFile)?.content || '';
                                                    const context = `FILE: ${selectedFile}\n${fileContent}`;
                                                    
                                                    const response = await fetch('/api/generate-with-agents', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            moduleType: 'homework',
                                                            action: 'regenerate',
                                                            originalItem: { ...target, assignment_title: safeHomework.title, chapters_covered: safeHomework.chapters_covered },
                                                            context,
                                                            taskParams: {
                                                                minutesPerProblem,
                                                                subject,
                                                                questionType: selectedQuestionType || problem.type,
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

                                                    const newProblem = data.results[0];
                                                    // Force the selected source
                                                    const forcedSources = [{ file: selectedFile, pages: selectedPages }];
                                                    let merged = { 
                                                        ...target, 
                                                        ...newProblem,
                                                        sources: forcedSources,
                                                        question_type: selectedQuestionType || newProblem?.question_type || target?.question_type,
                                                        title: newProblem?.title || target?.title || `Problem ${target.number}`,
                                                    };

                                                    const updatedProblems = safeHomework.problems.map((p: any, i: number) =>
                                                        i === index ? merged : p
                                                    );
                                                    
                                                    // Recalculate distributions
                                                    const chapterDist: Record<string, number> = {};
                                                    const typeDist: Record<string, number> = {};
                                                    let totalPointsAccum = 0;
                                                    
                                                    for (const p of updatedProblems) {
                                                        const pts = p.points || 0;
                                                        totalPointsAccum += pts;
                                                        
                                                        // Distribute points across ALL source files
                                                        const chapters = (p as any).allChapters || 
                                                            (p.sources || []).map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '').filter((c: string) => c);
                                                        const chaptersToUse = chapters.length > 0 ? chapters : ['Unknown'];
                                                        const pointsPerChapter = pts / chaptersToUse.length;
                                                        for (const ch of chaptersToUse) {
                                                            const chapterName = ch || 'Unknown';
                                                            chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                                                        }
                                                        
                                                        const type = p.question_type || 'Unknown';
                                                        typeDist[type] = (typeDist[type] || 0) + pts;
                                                    }
                                                    
                                                    const chapterPercentages: Record<string, number> = {};
                                                    const typePercentages: Record<string, number> = {};
                                                    
                                                    for (const [chapter, points] of Object.entries(chapterDist)) {
                                                        chapterPercentages[chapter] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
                                                    }
                                                    for (const [type, points] of Object.entries(typeDist)) {
                                                        typePercentages[type] = Math.round((points / Math.max(totalPointsAccum, 1)) * 100);
                                                    }
                                                    
                                                    const nextHomework: Homework = {
                                                        ...safeHomework,
                                                        problems: updatedProblems,
                                                        distribution: chapterPercentages,
                                                        typeDistribution: typePercentages,
                                                    };
                                                    setGeneratedContent('homework', [nextHomework]);
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
                                        originalItem={originalProblem}
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
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                        {/* Only trace format uses CodeBlock for description */}
                                        {/* For other coding types, use MixedContent to properly render markdown and detect code blocks */}
                                        {problem.question_type?.toLowerCase() === 'trace' ? (
                                            <CodeBlock code={problem.description || ''} />
                                        ) : isCodingType(problem.question_type) ? (
                                            <MixedContent content={problem.description || ''} />
                                        ) : (
                                            <MixedContent content={problem.description || ''} />
                                        )}
                                    </div>

                                    {/* Multiple Choice Options */}
                                    {(problem.options ?? []).length > 0 && (
                                        <div className="mt-3 space-y-2">
                                            {(problem.options ?? []).map((opt: string, oi: number) => (
                                                <div
                                                    key={oi}
                                                    className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                                                >
                                                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 flex items-center justify-center text-sm font-semibold">
                                                        {String.fromCharCode(65 + oi)}
                                                    </span>
                                                    <span className="text-sm pt-0.5">{opt.replace(/^[A-D]\)\s*/, '')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <h4 className="font-semibold text-sm mb-2">Requirements:</h4>
                                    <ul className="list-disc list-inside space-y-1 text-sm">
                                        {(problem.requirements ?? []).map((req: any, i: number) => <li key={i}>{req}</li>)}
                                    </ul>

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
                                                {isCodingType(problem.question_type) ? (
                                                    <CodeBlock code={problem.solution || ''} />
                                                ) : (
                                                    <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(problem.solution)}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                            {problem.solution_explanation && problem.solution_explanation.trim().length > 0 && (
                                                <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                        {ensureMarkdownCodeFences(problem.solution_explanation)}
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
                                        {(problem.description_secondary ?? '').trim().length > 0 && (
                                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                                {/* Use MixedContent for all types to properly render markdown with code blocks */}
                                                {problem.question_type?.toLowerCase() === 'trace' ? (
                                                    <CodeBlock code={problem.description_secondary || ''} />
                                                ) : (
                                                    <MixedContent content={problem.description_secondary || ''} />
                                                )}
                                            </div>
                                        )}
                                        {(problem.requirements_secondary ?? []).length > 0 && (
                                            <div>
                                                <h4 className="font-semibold text-sm mb-2">Requirements:</h4>
                                                <ul className="list-disc list-inside space-y-1 text-sm">
                                                    {(problem.requirements_secondary ?? []).map((req: any, i: number) => <li key={i}>{req}</li>)}
                                                </ul>
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
                                        {showSecondarySolution[index] && (
                                            <div className="mt-2 space-y-3">
                                                {(problem.solution_secondary ?? '').trim().length > 0 && (
                                                    <div className="max-w-none">
                                                        {/* Solution should use CodeBlock for coding types */}
                                                        {isCodingType(problem.question_type) ? (
                                                            <CodeBlock code={problem.solution_secondary || ''} />
                                                        ) : (
                                                            <MixedContent content={problem.solution_secondary || ''} className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200" />
                                                        )}
                                                    </div>
                                                )}
                                                {(problem.solution_explanation_secondary ?? '').trim().length > 0 && (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(problem.solution_explanation_secondary)}
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
