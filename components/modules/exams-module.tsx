'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Copy, Check, Loader2, PieChart, RotateCcw } from 'lucide-react';
// Removed old LLM client imports - now using agent skills API
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { defaultWeights, getSubjectConfig, getExamTypes, weightsToCounts } from '@/lib/subjects';
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

function sanitizeMultipleChoiceOption(option: any): string {
    return String(option ?? '')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^[A-Da-d][\)\.\:\-]\s*/g, '')
        .replace(/^Option\s+[A-Da-d][\)\.\:\-]\s*/i, '')
        .trim();
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

interface ExamQuestion {
    number: number;
    type: string;
    chapter: string;
    points: number;
    title?: string; // Question title
    title_secondary?: string;
    question: string;
    question_secondary?: string;
    options?: string[];
    answer: string;
    answer_secondary?: string;
    explanation: string;
    explanation_secondary?: string;
    sources?: Array<{ file: string; pages: string }>;
}

interface Exam {
    exam_title: string;
    total_score: number;
    distribution: Record<string, number>;
    typeDistribution?: Record<string, number>;
    questions: ExamQuestion[];
}

export function ExamsModule() {
    const { contextFiles, llmConfig, languageConfig, subject, generatedContent, setGeneratedContent, variants, addVariant, removeVariant, reorderVariants, customQuestionTypes, includeWebResources } = useStore();
    const [loading, setLoading] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [showAnswers, setShowAnswers] = useState<Record<number, boolean>>({});
    const [showSecondaryAnswers, setShowSecondaryAnswers] = useState<Record<number, boolean>>({});
    const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
    const [generatingSimilar, setGeneratingSimilar] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
    const [displayedVariant, setDisplayedVariant] = useState<Record<string, string>>({});
    const [totalScore, setTotalScore] = useState(100);
    const [numberOfQuestions, setNumberOfQuestions] = useState(10);
    const [minutesPerQuestion, setMinutesPerQuestion] = useState(5);
    const [selectedChapters, setSelectedChapters] = useState<string[]>([]);

    const exam = generatedContent.exams[0] as Exam | undefined;
    const safeQuestions = exam?.questions ?? [];
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
    const examTypes = useMemo(() => getExamTypes(subject, customQuestionTypes?.exams), [subject, customQuestionTypes?.exams]);
    const [typeWeights, setTypeWeights] = useState<Record<string, number>>(() => defaultWeights(examTypes));

    // Variant helpers
    const getItemId = (index: number) => `exams-${index + 1}`;
    const getVariantsForItem = (index: number) => {
        const itemId = getItemId(index);
        const moduleVariants = variants?.exams || {};
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
    const getDisplayedQuestion = (index: number): ExamQuestion | null => {
        const variantId = getDisplayedVariantId(index);
        if (variantId === 'original') return safeQuestions[index] || null;
        const itemId = getItemId(index);
        const moduleVariants = variants?.exams || {};
        const itemVariants = moduleVariants[itemId] || [];
        const v = itemVariants.find((v: any) => v.variantId === variantId);
        return v || safeQuestions[index] || null;
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
            const originalQuestion = safeQuestions[index];
            const res = await fetch('/api/similar-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalItem: originalQuestion,
                    moduleType: 'exams',
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
            console.log('[exams-module] handleGenerateSimilar response:', JSON.stringify(data).substring(0, 500));
            
            if (data.variant) {
                console.log('[exams-module] Variant received:', {
                    variantId: data.variant.variantId,
                    hasQuestion: !!data.variant.question,
                    hasAnswer: !!data.variant.answer,
                    keys: Object.keys(data.variant),
                });
                const variantId = `variant-${Date.now()}`;
                addVariant('exams', itemId, { ...data.variant, variantId });
                setSelectedVariants(prev => ({
                    ...prev,
                    [itemId]: [...(prev[itemId] || ['original']), variantId],
                }));
            } else {
                console.error('[exams-module] No variant in response:', data);
                throw new Error('No variant returned from API');
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
        removeVariant('exams', itemId, variantId);
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
        reorderVariants('exams', itemId, variantIds);
    };

    useEffect(() => {
        setTypeWeights(defaultWeights(examTypes));
    }, [examTypes]);

    const typeCounts = useMemo(() => weightsToCounts(numberOfQuestions, typeWeights), [numberOfQuestions, typeWeights]);

    const exportItems: ExportItem[] = useMemo(() => {
        const qs = exam?.questions ?? [];
        return qs.map((q: any, idx: number) => {
            const num = Number.isFinite(Number(q?.number)) ? Number(q.number) : idx + 1;
            const options = Array.isArray(q?.options) ? q.options : [];
            const optBlock =
                options.length > 0
                    ? `\n\n## Options\n${options.map((o: string, i: number) => `- ${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`
                    : '';
            return {
                number: num,
                title: `Question ${num}`,
                type: String(q?.type || ''),
                points: Number.isFinite(Number(q?.points)) ? Number(q.points) : 0,
                sources: Array.isArray(q?.sources) ? q.sources : [],
                primary: {
                    question: ensureMarkdownCodeFences(`${String(q?.question || '')}${optBlock}`),
                    solution: ensureMarkdownCodeFences(String(q?.answer || '')),
                    explanation: ensureMarkdownCodeFences(String(q?.explanation || '')),
                },
                secondary: {
                    question: ensureMarkdownCodeFences(`${String(q?.question_secondary || '')}${optBlock}`),
                    solution: ensureMarkdownCodeFences(String(q?.answer_secondary || '')),
                    explanation: ensureMarkdownCodeFences(String(q?.explanation_secondary || '')),
                },
            };
        });
    }, [exam]);

    const handleGenerate = async () => {
        if (contextFiles.length === 0) {
            alert('Please upload at least one file to generate exams.');
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
                    moduleType: 'exams',
                    numberOfItems: numberOfQuestions,
                    context,
                    taskParams: {
                        totalScore,
                        minutesPerQuestion,
                        subject,
                        typeCounts,
                        availableFiles: contextFiles.map((f) => f.name),
                        selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
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
            let data: { results?: any[]; type?: string; message?: string; current?: number; total?: number; exam_title?: string; distribution?: any } = {};

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
                console.error('[exams-module] Invalid stream response:', data);
                throw new Error('Invalid response from server');
            }

            const questions = results.map((q: any, i: number) => {
                const qType = String(q?.type || '').toLowerCase();
                let options = q?.options;
                
                // Validate and ensure multiple_choice has options
                if (qType === 'multiple_choice' || qType === 'mcq') {
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
                
                // Process sources
                const sources = Array.isArray(q?.sources)
                    ? q.sources.map((s: any) => ({
                        file: typeof s?.file === 'string' ? s.file : '',
                        pages: typeof s?.pages === 'string' ? s.pages : '',
                    })).filter((s: any) => s.file || s.pages)
                    : [];
                
                // Extract chapters from ALL sources (not just the first one)
                // This ensures proper distribution when multiple file types are uploaded
                const chaptersFromSources = sources
                    .map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '')
                    .filter((c: string) => c);
                
                // Use explicit chapter if provided, otherwise combine all source file names
                let chapter = typeof q?.chapter === 'string' && q.chapter ? q.chapter : '';
                if (!chapter && chaptersFromSources.length > 0) {
                    // Use all unique source files as the chapter (for distribution purposes)
                    chapter = chaptersFromSources[0]; // Primary chapter for display
                }
                if (!chapter) chapter = 'Unknown';
                
                // Store all source chapters for distribution calculation
                const allChapters = chaptersFromSources.length > 0 ? chaptersFromSources : [chapter];
                
                // Extract title from metadata.key_concepts if title is missing
                let title = typeof q?.title === 'string' ? q.title : '';
                if (!title && q?.metadata?.key_concepts && Array.isArray(q.metadata.key_concepts) && q.metadata.key_concepts.length > 0) {
                    title = q.metadata.key_concepts[0];
                }
                
                return {
                    number: Number.isFinite(Number(q?.number)) ? Number(q.number) : i + 1,
                    type: qType || q?.type,
                    chapter,
                    allChapters, // Store all chapters for distribution calculation
                    points: Number.isFinite(Number(q?.points)) ? Number(q.points) : Math.floor(totalScore / numberOfQuestions),
                    title: title || undefined,
                    title_secondary: typeof q?.title_secondary === 'string' ? q.title_secondary : undefined,
                    question: ensureMarkdownCodeFences(q?.question || ''),
                    question_secondary: ensureMarkdownCodeFences(q?.question_secondary || ''),
                    options: options || q?.options,
                    answer: ensureMarkdownCodeFences(q?.answer || ''),
                    answer_secondary: ensureMarkdownCodeFences(q?.answer_secondary || ''),
                    explanation: ensureMarkdownCodeFences(q?.explanation || ''),
                    explanation_secondary: ensureMarkdownCodeFences(q?.explanation_secondary || ''),
                    sources,
                };
            });

            // Calculate distributions from questions
            const chapterDist: Record<string, number> = {};
            const typeDist: Record<string, number> = {};
            let totalPointsAccum = 0;
            
            for (const q of questions) {
                const pts = q.points || 0;
                totalPointsAccum += pts;
                
                // Chapter distribution - distribute points across ALL source chapters
                const chapters = q.allChapters || [q.chapter || 'Unknown'];
                const pointsPerChapter = pts / chapters.length;
                for (const ch of chapters) {
                    const chapterName = ch || 'Unknown';
                    chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                }
                
                // Type distribution
                const type = q.type || 'Unknown';
                typeDist[type] = (typeDist[type] || 0) + pts;
            }
            
            // Convert to percentages
            const chapterPercentages: Record<string, number> = {};
            const typePercentages: Record<string, number> = {};
            
            for (const [chapter, points] of Object.entries(chapterDist)) {
                chapterPercentages[chapter] = Math.round((points / totalPointsAccum) * 100);
            }
            for (const [type, points] of Object.entries(typeDist)) {
                typePercentages[type] = Math.round((points / totalPointsAccum) * 100);
            }
            
            const examResult = {
                exam_title: typeof data.exam_title === 'string' ? data.exam_title : 'Exam',
                total_score: totalScore,
                distribution: chapterPercentages,
                typeDistribution: typePercentages,
                questions: questions,
            };

            setGeneratedContent('exams', [examResult]);
            setProgress(null);
        } catch (error: any) {
            console.error('Error generating exam:', error);
            alert(`Error generating exam: ${error.message || 'Unknown error'}. Check console for details.`);
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

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                    Exam Generator
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Create balanced exams with question distribution analytics
                </p>
            </div>

            <Card className="bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20 border-orange-200 dark:border-orange-800">
                <CardHeader>
                    <CardTitle>Exam Configuration</CardTitle>
                    <CardDescription>
                        Set total score and select chapters to include
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="total-score">Total Score</Label>
                        <Input
                            id="total-score"
                            type="number"
                            min="50"
                            max="200"
                            step={1}
                            inputMode="numeric"
                            value={totalScore}
                            onChange={(e) => setTotalScore(parseInt(e.target.value) || 100)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="num-questions">Number of Questions</Label>
                            <Input
                                id="num-questions"
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                value={numberOfQuestions}
                                onChange={(e) => setNumberOfQuestions(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                            />
                        </div>
                        <div>
                            <Label htmlFor="minutes-q">Minutes per Question</Label>
                            <Input
                                id="minutes-q"
                                type="number"
                                min={1}
                                max={180}
                                step={1}
                                value={minutesPerQuestion}
                                onChange={(e) => setMinutesPerQuestion(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                            />
                        </div>
                    </div>

                    <QuestionTypeMix
                        title="Question Type Mix"
                        subjectLabel={subjectConfig.label}
                        types={examTypes}
                        total={numberOfQuestions}
                        weights={typeWeights}
                        counts={typeCounts}
                        onChange={setTypeWeights}
                    />

                    <div>
                        <h4 className="text-sm font-medium mb-2">Chapter Selection (Optional)</h4>
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
                                        : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300'
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
                                Generating Exam...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-4 h-4" />
                                Generate Exam
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

            {exam && (
                <div className="space-y-4">
                    {/* Exam Header */}
                    <Card className="bg-gradient-to-r from-orange-500/10 to-red-500/10">
                        <CardHeader>
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-2xl">{exam.exam_title}</CardTitle>
                                    <CardDescription className="mt-2">
                                        Total Score: {exam.total_score} points | {exam.questions.length} Questions
                                    </CardDescription>
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        const examText = `# ${exam.exam_title}\n\nTotal Score: ${exam.total_score}\n\n${exam.questions.map(q =>
                                            `## Problem ${q.number} (${q.points} pts) - ${q.type}\nChapter: ${q.chapter}\n${(q.sources ?? []).length > 0 ? `Sources: ${(q.sources ?? []).map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ')}\n` : ''}\n\n## ${primaryLanguage} Block\n### Question\n${q.question}\n\n${q.options ? `### Options\n${q.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}\n\n` : ''}### Answer\n${q.answer}\n\n### Explanation\n${q.explanation}\n\n${secondaryLanguage !== 'none' ? `## ${secondaryLanguage} Block\n### Question\n${q.question_secondary || ''}\n\n### Answer\n${q.answer_secondary || ''}\n\n### Explanation\n${q.explanation_secondary || ''}\n\n` : ''}`
                                        ).join('\n\n---\n\n')}`;
                                        handleCopy(examText, -1);
                                    }}
                                >
                                    {copiedIndex === -1 ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </Button>
                            </div>
                        </CardHeader>
                    </Card>

                    {/* Distribution Charts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Score Distribution by Chapter */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <PieChart className="w-5 h-5" />
                                    Score Distribution by Chapter
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {Object.entries(exam.distribution || {}).length > 0 ? (
                                        Object.entries(exam.distribution).map(([chapter, percentage]) => (
                                            <div key={chapter} className="flex items-center gap-3">
                                                <div className="w-24 text-sm font-medium truncate" title={chapter}>{chapter || 'Unknown'}</div>
                                                <div className="flex-1">
                                                    <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-orange-500 to-red-500 flex items-center justify-end pr-2 text-white text-xs font-semibold"
                                                            style={{ width: `${Math.max(percentage, 5)}%` }}
                                                        >
                                                            {percentage > 15 && `${percentage}%`}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="w-12 text-sm text-right">{percentage}%</div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-slate-500 italic">No chapter distribution available</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Score Distribution by Question Type */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <PieChart className="w-5 h-5" />
                                    Score Distribution by Type
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {Object.entries(exam.typeDistribution || {}).length > 0 ? (
                                        Object.entries(exam.typeDistribution || {}).map(([type, percentage]) => (
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
                                        ))
                                    ) : (
                                        <p className="text-sm text-slate-500 italic">No type distribution available</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Questions */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                                Exam Questions
                            </h3>
                            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={selectedNumbers.length === exam.questions.length && exam.questions.length > 0}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedNumbers(exam.questions.map((q) => q.number));
                                        } else {
                                            setSelectedNumbers([]);
                                        }
                                    }}
                                />
                                Select all
                            </label>
                        </div>

                        <ExportPanel
                            title={exam.exam_title || 'Exam'}
                            moduleId="exams"
                            items={exportItems}
                            selectedNumbers={selectedNumbers}
                        />

                        {exam.questions.map((originalQuestion, index) => {
                            const question = getDisplayedQuestion(index) || originalQuestion;
                            const itemVariants = getVariantsForItem(index);
                            const selectedIds = getSelectedVariantIds(index);
                            const displayedId = getDisplayedVariantId(index);
                            const itemId = getItemId(index);
                            
                            return (
                            <Card key={index} className="hover:shadow-lg transition-shadow">
                                <CardHeader className="bg-slate-50 dark:bg-slate-800/50">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedNumbers.includes(originalQuestion.number)}
                                                    onChange={(e) => {
                                                        const num = originalQuestion.number;
                                                        setSelectedNumbers((prev) =>
                                                            e.target.checked ? Array.from(new Set([...prev, num])) : prev.filter((x) => x !== num)
                                                        );
                                                    }}
                                                />
                                                <CardTitle className="text-lg">Problem {originalQuestion.number}{question.title ? `: ${question.title}` : ''}</CardTitle>
                                                <span className="px-2 py-1 text-xs font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">
                                                    {formatTypeDisplay(question.type)}
                                                </span>
                                            </div>
                                            <CardDescription>Worth {question.points} points</CardDescription>
                                            {(question.sources ?? []).length > 0 && (
                                                <p className="mt-2 text-xs text-slate-500">
                                                    <strong>Sources:</strong>{' '}
                                                    {(question.sources ?? [])
                                                        .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                                        .join(', ')}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const sources = (question.sources ?? [])
                                                        .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                                        .join(', ');
                                                    handleCopy(
                                                        `# Problem ${question.number}\nPoints: ${question.points}\nType: ${question.type}\nChapter: ${question.chapter}\n${sources ? `Sources: ${sources}\n` : ''}\n\n## ${primaryLanguage} Block\n### Question\n${question.question}\n\n${question.options ? `### Options\n${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}\n\n` : ''}### Answer\n${question.answer}\n\n### Explanation\n${question.explanation}\n`,
                                                        index
                                                    );
                                                }}
                                                title={`Copy (${primaryLanguage})`}
                                            >
                                                {copiedIndex === index ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                            </Button>
                                            {secondaryLanguage !== 'none' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        const sources = (question.sources ?? [])
                                                            .map((s) => `${s.file}${s.pages ? ` (${s.pages})` : ''}`)
                                                            .join(', ');
                                                        handleCopy(
                                                            `# Problem ${question.number}\nPoints: ${question.points}\nType: ${question.type}\nChapter: ${question.chapter}\n${sources ? `Sources: ${sources}\n` : ''}\n\n## ${secondaryLanguage} Block\n### Question\n${question.question_secondary || ''}\n\n### Answer\n${question.answer_secondary || ''}\n\n### Explanation\n${question.explanation_secondary || ''}\n`,
                                                            index
                                                        );
                                                    }}
                                                    title={`Copy (${secondaryLanguage})`}
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={loading || regenerating[index]}
                                                onClick={async () => {
                                                    if (!exam) return;
                                                    if (contextFiles.length === 0) return;
                                                    if (!llmConfig.apiKey) return;
                                                    const target = exam.questions?.[index];
                                                    if (!target) return;

                                                    setRegenerating((s) => ({ ...s, [index]: true }));
                                                    try {
                                                        const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

                                                        // Use agent skills API for regeneration
                                                        const response = await fetch('/api/generate-with-agents', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                moduleType: 'exams',
                                                                action: 'regenerate',
                                                                originalItem: target,
                                                                context,
                                                                taskParams: {
                                                                    minutesPerQuestion,
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

                                                        const newQ = data.results[0];
                                                        let merged: any = { ...target, ...newQ };
                                                        
                                                        // Validate and ensure multiple_choice has options
                                                        const qType = String((merged as any)?.type || (target as any)?.type || '').toLowerCase();
                                                        let options = (merged as any)?.options || (target as any)?.options;
                                                        
                                                        // If type is multiple_choice but options are missing or invalid, create default options
                                                        if (qType === 'multiple_choice' || qType === 'mcq') {
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
                                                        
                                                        // Process sources from the regenerated question - always use new sources
                                                        let newSources = Array.isArray(merged?.sources) ? merged.sources : [];
                                                        // Only fallback to original if truly empty and no new data
                                                        if (newSources.length === 0 && Array.isArray((target as any)?.sources)) {
                                                            newSources = (target as any).sources;
                                                        }
                                                        
                                                        merged = {
                                                            ...merged,
                                                            type: qType || (target as any)?.type,
                                                            title: merged?.title || (target as any)?.title || '',
                                                            options: options || (merged as any)?.options,
                                                            sources: newSources,
                                                            question: ensureMarkdownCodeFences(typeof merged?.question === 'string' ? merged.question : ''),
                                                            question_secondary: ensureMarkdownCodeFences(typeof merged?.question_secondary === 'string' ? merged.question_secondary : ''),
                                                            answer: ensureMarkdownCodeFences(typeof merged?.answer === 'string' ? merged.answer : ''),
                                                            answer_secondary: ensureMarkdownCodeFences(typeof merged?.answer_secondary === 'string' ? merged.answer_secondary : ''),
                                                            explanation: ensureMarkdownCodeFences(typeof merged?.explanation === 'string' ? merged.explanation : ''),
                                                            explanation_secondary: ensureMarkdownCodeFences(typeof merged?.explanation_secondary === 'string' ? merged.explanation_secondary : ''),
                                                        };

                                                        // If secondary is enabled but looks missing/untranslated, do a quick fix pass.
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
                                                                            moduleType: 'exams',
                                                                            action: 'regenerate',
                                                                            originalItem: merged,
                                                                            context,
                                                                            taskParams: {
                                                                                minutesPerQuestion,
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

                                                        const updatedQuestions = exam.questions.map((q, i) => (i === index ? merged : q));
                                                        
                                                        // Recalculate distributions after regeneration
                                                        const chapterDist: Record<string, number> = {};
                                                        const typeDist: Record<string, number> = {};
                                                        let totalPointsAccum = 0;
                                                        
                                                        for (const q of updatedQuestions) {
                                                            const pts = q.points || 0;
                                                            totalPointsAccum += pts;
                                                            
                                                            // Chapter distribution - distribute points across ALL source files
                                                            const chapters = (q as any).allChapters || 
                                                                (q.sources || []).map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '').filter((c: string) => c);
                                                            const chaptersToUse = chapters.length > 0 ? chapters : [q.chapter || 'Unknown'];
                                                            const pointsPerChapter = pts / chaptersToUse.length;
                                                            for (const ch of chaptersToUse) {
                                                                const chapterName = ch || 'Unknown';
                                                                chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                                                            }
                                                            
                                                            // Type distribution
                                                            const type = q.type || 'Unknown';
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
                                                        
                                                        const nextExam: Exam = {
                                                            ...exam,
                                                            questions: updatedQuestions,
                                                            distribution: chapterPercentages,
                                                            typeDistribution: typePercentages,
                                                        };
                                                        setGeneratedContent('exams', [nextExam]);
                                                    } catch (e: any) {
                                                        console.error('Error regenerating exam question:', e);
                                                        alert(`Error regenerating exam question: ${e?.message || 'Unknown error'}. Check console for details.`);
                                                    } finally {
                                                        setRegenerating((s) => ({ ...s, [index]: false }));
                                                    }
                                                }}
                                                title="Regenerate"
                                            >
                                                {regenerating[index] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                            </Button>
                                            
                                            {/* Custom Source Selector */}
                                            <SourceSelector
                                                availableFiles={contextFiles}
                                                currentSources={question.sources}
                                                isLoading={regenerating[index]}
                                                questionTypes={customQuestionTypes.exams || []}
                                                currentQuestionType={question.type}
                                                onRegenerate={async (selectedFile, selectedPages, selectedQuestionType) => {
                                                    setRegenerating((s) => ({ ...s, [index]: true }));
                                                    try {
                                                        // Extract content for the selected file and pages
                                                        const fileContent = contextFiles.find(f => f.name === selectedFile)?.content || '';
                                                        const context = `FILE: ${selectedFile}\n${fileContent}`;
                                                        
                                                        const targetQuestion = originalQuestion;
                                                        const response = await fetch('/api/generate-with-agents', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                moduleType: 'exams',
                                                                action: 'regenerate',
                                                                originalItem: targetQuestion,
                                                                context,
                                                                taskParams: {
                                                                    minutesPerQuestion,
                                                                    subject,
                                                                    questionType: selectedQuestionType || question.type,
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

                                                        const newQ = data.results[0];
                                                        // Force the selected source
                                                        const forcedSources = [{ file: selectedFile, pages: selectedPages }];
                                                        let merged: any = { 
                                                            ...targetQuestion, 
                                                            ...newQ,
                                                            sources: forcedSources,
                                                            type: selectedQuestionType || newQ?.type || targetQuestion?.type,
                                                            title: newQ?.title || targetQuestion?.title || '',
                                                        };
                                                        
                                                        // Recalculate chapter from new source
                                                        merged.chapter = selectedFile.replace(/\.(pdf|pptx|docx|txt)$/i, '');

                                                        const updatedQuestions = exam.questions.map((q, i) => (i === index ? merged : q));
                                                        
                                                        // Recalculate distributions
                                                        const chapterDist: Record<string, number> = {};
                                                        const typeDist: Record<string, number> = {};
                                                        let totalPointsAccum = 0;
                                                        
                                                        for (const q of updatedQuestions) {
                                                            const pts = q.points || 0;
                                                            totalPointsAccum += pts;
                                                            
                                                            // Chapter distribution - distribute points across ALL source files
                                                            const chapters = (q as any).allChapters || 
                                                                (q.sources || []).map((s: any) => s.file ? s.file.replace(/\.(pdf|pptx|docx|txt)$/i, '') : '').filter((c: string) => c);
                                                            const chaptersToUse = chapters.length > 0 ? chapters : [q.chapter || 'Unknown'];
                                                            const pointsPerChapter = pts / chaptersToUse.length;
                                                            for (const ch of chaptersToUse) {
                                                                const chapterName = ch || 'Unknown';
                                                                chapterDist[chapterName] = (chapterDist[chapterName] || 0) + pointsPerChapter;
                                                            }
                                                            
                                                            const type = q.type || 'Unknown';
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
                                                        
                                                        const nextExam: Exam = {
                                                            ...exam,
                                                            questions: updatedQuestions,
                                                            distribution: chapterPercentages,
                                                            typeDistribution: typePercentages,
                                                        };
                                                        setGeneratedContent('exams', [nextExam]);
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
                                            originalItem={originalQuestion}
                                            variants={itemVariants}
                                            selectedVariantIds={selectedIds}
                                            displayedVariantId={displayedId}
                                            onToggleVariant={(variantId) => handleToggleVariant(index, variantId)}
                                            onDisplayVariant={(variantId) => handleDisplayVariant(index, variantId)}
                                            onGenerateSimilar={() => handleGenerateSimilar(index)}
                                            onRemoveVariant={(variantId) => handleRemoveVariant(index, variantId)}
                                            onReorderVariants={(variantIds) => handleReorderVariants(index, variantIds)}
                                            isGenerating={generatingSimilar[itemId] || false}
                                            getDisplayText={(v) => v.question || ''}
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
                                            {/* Only trace format uses CodeBlock for question */}
                                            {/* For all other types, use MixedContent to properly render markdown and detect code blocks */}
                                            {question.type?.toLowerCase() === 'trace' ? (
                                                <CodeBlock code={question.question || ''} />
                                            ) : (
                                                <MixedContent content={question.question || ''} />
                                            )}
                                        </div>

                                        {question.options && (
                                            <div className="space-y-2">
                                                {question.options.map((option, i) => (
                                                    <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded">
                                                        <span className="font-semibold text-sm">{String.fromCharCode(65 + i)}.</span>
                                                        <span className="text-sm">{option}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowAnswers({ ...showAnswers, [index]: !showAnswers[index] })}
                                        >
                                            {showAnswers[index] ? 'Hide' : 'Show'} Answer & Explanation
                                        </Button>

                                        {showAnswers[index] && (
                                            <div className="mt-2 space-y-3">
                                                <div className="max-w-none">
                                                    {isCodingType(question.type) ? (
                                                        <CodeBlock code={question.answer || ''} />
                                                    ) : (
                                                        <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                {ensureMarkdownCodeFences(question.answer)}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
                                                {(question.explanation ?? '').trim().length > 0 && (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                            {ensureMarkdownCodeFences(question.explanation)}
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
                                            {(question.question_secondary ?? '').trim().length > 0 && (
                                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                                    {/* Use MixedContent for all types to properly render markdown with code blocks */}
                                                    {question.type?.toLowerCase() === 'trace' ? (
                                                        <CodeBlock code={question.question_secondary || ''} />
                                                    ) : (
                                                        <MixedContent content={question.question_secondary || ''} />
                                                    )}
                                                </div>
                                            )}

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    setShowSecondaryAnswers({
                                                        ...showSecondaryAnswers,
                                                        [index]: !showSecondaryAnswers[index],
                                                    })
                                                }
                                            >
                                                {showSecondaryAnswers[index] ? 'Hide' : 'Show'} Answer & Explanation ({secondaryLanguage})
                                            </Button>

                                            {showSecondaryAnswers[index] && (
                                                <div className="mt-2 space-y-3">
                                                    {(question.answer_secondary ?? '').trim().length > 0 && (
                                                        <div className="max-w-none">
                                                            {/* For coding types, use CodeBlock for the entire answer block */}
                                                            {isCodingType(question.type) ? (
                                                                <CodeBlock code={question.answer_secondary || question.answer || ''} />
                                                            ) : (
                                                                <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                        {ensureMarkdownCodeFences(question.answer_secondary)}
                                                                    </ReactMarkdown>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(question.explanation_secondary ?? '').trim().length > 0 && (
                                                        <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                {ensureMarkdownCodeFences(question.explanation_secondary)}
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
                </div>
            )}
        </div>
    );
}
