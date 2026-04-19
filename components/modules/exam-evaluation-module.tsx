'use client';

import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, FileText, ClipboardCheck, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, Download, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { CodeBlock } from '@/components/shared/code-block';

type ExamEvalFormat = 'docx' | 'pdf';

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function formatDateYYYYMMDD(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

interface QuestionEvaluation {
    questionNumber: number;
    questionText: string;
    correctAnswer: string;
    studentAnswer: string;
    maxPoints: number;
    awardedPoints: number;
    isCorrect: boolean;
    explanation: string;
    feedback: string;
}

interface EvaluationResult {
    studentId: string;
    studentName: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    evaluations: QuestionEvaluation[];
    overallFeedback: string;
    rawResponse?: string;
}

export function ExamEvaluationModule() {
    const { teacherFiles, studentFiles, llmConfig, languageConfig, subject, generatedContent, setGeneratedContent } = useStore();
    const [loading, setLoading] = useState(false);
    const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[]>(() => {
        const cached = (generatedContent as any)?.exam_evaluation;
        return Array.isArray(cached) ? (cached as EvaluationResult[]) : [];
    });
    const [expandedStudents, setExpandedStudents] = useState<Record<string, boolean>>({});
    const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState({ current: 0, total: 0, percentage: 0, studentName: '' });
    const [exportFormat, setExportFormat] = useState<ExamEvalFormat>('docx');
    // exportTarget is either 'all' or the array index of the selected student
    // (using index avoids collisions when two students have the same name / no id).
    const [exportTarget, setExportTarget] = useState<'all' | number>('all');
    const [exporting, setExporting] = useState(false);

    const handleEvaluate = async () => {
        if (teacherFiles.length === 0) {
            alert('Please upload teacher files with questions and correct answers.');
            return;
        }

        if (studentFiles.length === 0) {
            alert('Please upload student submission files.');
            return;
        }

        if (!llmConfig.apiKey) {
            alert('Please configure your API key in the settings.');
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: studentFiles.length, percentage: 0, studentName: '' });
        
        try {
            // Build context from teacher files (questions + correct answers)
            const teacherContext = teacherFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');
            
            // Each student file represents one student - send as array
            const studentFilesArray = studentFiles.map((f) => ({
                name: f.name,
                content: f.content,
            }));

            // Call evaluation API with streaming response
            const response = await fetch('/api/evaluate-exam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacherContext,
                    studentFiles: studentFilesArray,
                    subject,
                    llmConfig,
                    languageConfig,
                }),
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch {
                    errorMessage = response.statusText || `HTTP ${response.status} (no body)`;
                }
                throw new Error(errorMessage);
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('No response body');
            }

            let buffer = '';
            let results: EvaluationResult[] = [];

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            
                            if (data.type === 'progress') {
                                setProgress({
                                    current: data.current,
                                    total: data.total,
                                    percentage: data.percentage,
                                    studentName: data.studentName,
                                });
                            } else if (data.type === 'complete') {
                                results = data.results || [];
                                setEvaluationResults(results);
                                setGeneratedContent('exam_evaluation', results);
                                
                                // Auto-expand first student
                                if (results.length > 0) {
                                    setExpandedStudents({ [results[0].studentId]: true });
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data:', e);
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('Evaluation error:', error);
            alert(`Evaluation failed: ${error.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
            setProgress({ current: 0, total: 0, percentage: 0, studentName: '' });
        }
    };

    const buildStudentMarkdown = (result: EvaluationResult): string => {
        const lines: string[] = [];
        const name = result.studentName || result.studentId || 'Student';
        lines.push(`# ${name}`);
        lines.push('');
        lines.push(`**Score:** ${result.totalScore} / ${result.maxScore}  (${(result.percentage ?? 0).toFixed(1)}%)`);
        if (result.studentId) lines.push(`**Student ID:** ${result.studentId}`);
        lines.push('');
        if (result.overallFeedback) {
            lines.push('## Overall Feedback');
            lines.push('');
            lines.push(formatBilingual(result.overallFeedback));
            lines.push('');
        }
        if (Array.isArray(result.evaluations) && result.evaluations.length > 0) {
            lines.push('## Per-Question Evaluation');
            lines.push('');
            for (const ev of result.evaluations) {
                const status = ev.isCorrect ? 'Correct' : ev.awardedPoints > 0 ? 'Partial' : 'Incorrect';
                lines.push(`### Question ${ev.questionNumber}  —  ${ev.awardedPoints} / ${ev.maxPoints} pts  (${status})`);
                lines.push('');
                if (ev.questionText) {
                    lines.push('**Question:**');
                    lines.push('');
                    lines.push(ev.questionText);
                    lines.push('');
                }
                if (ev.correctAnswer) {
                    lines.push('**Correct Answer:**');
                    lines.push('');
                    lines.push(ev.correctAnswer);
                    lines.push('');
                }
                if (ev.studentAnswer) {
                    lines.push('**Student Answer:**');
                    lines.push('');
                    lines.push(ev.studentAnswer);
                    lines.push('');
                }
                if (ev.explanation) {
                    lines.push('**Grading Explanation:**');
                    lines.push('');
                    lines.push(formatBilingual(ev.explanation));
                    lines.push('');
                }
                if (ev.feedback) {
                    lines.push('**Learning Suggestions:**');
                    lines.push('');
                    lines.push(formatBilingual(ev.feedback));
                    lines.push('');
                }
                lines.push('---');
                lines.push('');
            }
        } else if (result.rawResponse) {
            lines.push('## Raw Response');
            lines.push('');
            lines.push(result.rawResponse);
        }
        return lines.join('\n');
    };

    const sanitizeFilename = (s: string) =>
        s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'student';

    const exportSingleStudent = async (
        result: EvaluationResult,
        format: ExamEvalFormat,
    ): Promise<{ filename: string; blob: Blob }> => {
        const dateSuffix = formatDateYYYYMMDD(new Date());
        const baseName = sanitizeFilename(result.studentName || result.studentId || 'student');
        const filename = `Evaluation_${baseName}_${dateSuffix}.${format}`;
        const md = buildStudentMarkdown(result);

        const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                exportKind: 'lecture',
                format,
                filename,
                language: 'primary',
                title: `Exam Evaluation — ${result.studentName || result.studentId || 'Student'}`,
                primaryLanguage: languageConfig?.primaryLanguage || 'English',
                secondaryLanguage: languageConfig?.secondaryLanguage || 'none',
                moduleId: 'exam_evaluation',
                items: [
                    {
                        number: 1,
                        title: result.studentName || 'Evaluation Report',
                        type: 'evaluation',
                        points: result.maxScore || 0,
                        sources: [],
                        primary: { question: md, solution: '', explanation: '' },
                    },
                ],
            }),
        });

        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try {
                const j = await res.json();
                msg = j?.error || msg;
            } catch {
                /* ignore */
            }
            throw new Error(msg);
        }

        const blob = await res.blob();
        return { filename, blob };
    };

    const handleExport = async () => {
        if (evaluationResults.length === 0) {
            alert('Please run an evaluation first.');
            return;
        }
        setExporting(true);
        try {
            if (exportTarget === 'all') {
                if (evaluationResults.length === 1) {
                    const a = await exportSingleStudent(evaluationResults[0], exportFormat);
                    downloadBlob(a.blob, a.filename);
                } else {
                    const zip = new JSZip();
                    for (const r of evaluationResults) {
                        const a = await exportSingleStudent(r, exportFormat);
                        zip.file(a.filename, a.blob);
                    }
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    downloadBlob(
                        zipBlob,
                        `Exam-Evaluations_${formatDateYYYYMMDD(new Date())}.zip`,
                    );
                }
            } else {
                const target = evaluationResults[exportTarget];
                if (!target) throw new Error('Selected student not found.');
                const a = await exportSingleStudent(target, exportFormat);
                downloadBlob(a.blob, a.filename);
            }
        } catch (e: any) {
            console.error('Evaluation export error:', e);
            alert(`Export failed: ${e?.message || 'Unknown error'}`);
        } finally {
            setExporting(false);
        }
    };

    const expandAll = () => {
        const next: Record<string, boolean> = {};
        evaluationResults.forEach((r, idx) => {
            next[r.studentId || String(idx)] = true;
        });
        setExpandedStudents(next);
    };

    const collapseAll = () => setExpandedStudents({});

    const classStats = useMemo(() => {
        if (evaluationResults.length === 0) return null;
        const total = evaluationResults.length;
        const avg =
            evaluationResults.reduce((s, r) => s + (r.percentage || 0), 0) / total;
        const passed = evaluationResults.filter((r) => (r.percentage || 0) >= 60)
            .length;
        const max = Math.max(...evaluationResults.map((r) => r.percentage || 0));
        const min = Math.min(...evaluationResults.map((r) => r.percentage || 0));
        return { total, avg, passed, max, min };
    }, [evaluationResults]);

    const toggleStudent = (studentId: string) => {
        setExpandedStudents(prev => ({
            ...prev,
            [studentId]: !prev[studentId]
        }));
    };

    const toggleQuestion = (key: string) => {
        setExpandedQuestions(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const getScoreColor = (percentage: number) => {
        if (percentage >= 80) return 'text-emerald-600 dark:text-emerald-400';
        if (percentage >= 60) return 'text-yellow-600 dark:text-yellow-400';
        return 'text-red-600 dark:text-red-400';
    };

    const getScoreBg = (percentage: number) => {
        if (percentage >= 80) return 'bg-emerald-100 dark:bg-emerald-900/30';
        if (percentage >= 60) return 'bg-yellow-100 dark:bg-yellow-900/30';
        return 'bg-red-100 dark:bg-red-900/30';
    };

    // Check if text looks like code
    const looksLikeCode = (text: string): boolean => {
        if (!text || text.trim().length === 0) return false;
        
        const trimmed = text.trim();
        
        // Check for common code patterns
        const codePatterns = [
            /^(def|class|import|from|for|while|if|elif|else|return|try|except|with|async|await)\b/, // Python
            /^(const|let|var|function|export|import|return)\b/, // JavaScript
            /^(public|private|protected|static|void|int|String|boolean|class)\b/, // Java
            /^#include\b/, // C/C++
            /console\.log\(|System\.out\.println\(|printf\(|print\(/, // Print statements
            /[{};]\s*$/, // Code blocks
            /^\s{2,}/, // Indented lines (likely code)
            /^[a-z_][a-z0-9_]*\s*=\s*[A-Z][a-zA-Z0-9_]*\s*\(/, // Class instantiation
            /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\(/, // Method calls
            /^#\s|^\/\//, // Comments
            /```/, // Code fences
        ];
        
        return codePatterns.some(pattern => pattern.test(trimmed));
    };

    // Format bilingual content: remove parentheses/brackets around second language, use blank line
    const formatBilingual = (text: string): string => {
        if (!text) return '';
        
        // Remove patterns like (中文) or [中文] at the end
        let formatted = text.replace(/\s*\([^)]*\)\s*$/g, '');
        formatted = formatted.replace(/\s*\[[^\]]*\]\s*$/g, '');
        
        // If there's a blank line, ensure it's properly formatted
        // Split by double newlines to separate languages
        const parts = formatted.split(/\n\s*\n/);
        if (parts.length > 1) {
            // Join with double newline (one blank line)
            return parts.map(p => p.trim()).join('\n\n');
        }
        
        return formatted;
    };

    // Render answer with code detection
    const renderAnswer = (answer: string, isCode: boolean = false) => {
        if (isCode || looksLikeCode(answer)) {
            return <CodeBlock code={answer} className="mt-2" />;
        }
        return <p className="whitespace-pre-wrap">{answer}</p>;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-xl">
                    <ClipboardCheck className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-display font-bold text-foreground">Exam Evaluation</h1>
                    <p className="text-sm text-muted-foreground">
                        Upload teacher answers and student submissions for automatic grading
                    </p>
                </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-2 gap-4">
                <Card className="border-emerald-200 dark:border-emerald-800">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="w-4 h-4 text-emerald-600" />
                            Teacher Files
                        </CardTitle>
                        <CardDescription>Questions & correct answers</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-emerald-600">{teacherFiles.length}</p>
                        <p className="text-xs text-muted-foreground mt-1">files uploaded</p>
                        {teacherFiles.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {teacherFiles.slice(0, 3).map(f => (
                                    <p key={f.id} className="text-xs text-muted-foreground truncate">• {f.name}</p>
                                ))}
                                {teacherFiles.length > 3 && (
                                    <p className="text-xs text-muted-foreground">... and {teacherFiles.length - 3} more</p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="border-blue-200 dark:border-blue-800">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="w-4 h-4 text-blue-600" />
                            Student Files
                        </CardTitle>
                        <CardDescription>Student submissions</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-blue-600">{studentFiles.length}</p>
                        <p className="text-xs text-muted-foreground mt-1">files uploaded</p>
                        {studentFiles.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {studentFiles.slice(0, 3).map(f => (
                                    <p key={f.id} className="text-xs text-muted-foreground truncate">• {f.name}</p>
                                ))}
                                {studentFiles.length > 3 && (
                                    <p className="text-xs text-muted-foreground">... and {studentFiles.length - 3} more</p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Generate Button */}
            <div className="flex flex-col items-center gap-4">
                <Button
                    onClick={handleEvaluate}
                    disabled={loading || teacherFiles.length === 0 || studentFiles.length === 0}
                    className="px-8 py-6 text-base rounded-xl transition-all duration-200 cursor-pointer disabled:cursor-not-allowed"
                    size="lg"
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Evaluating...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-5 h-5 mr-2" />
                            Start Evaluation
                        </>
                    )}
                </Button>

                {/* Progress Bar */}
                {loading && progress.total > 0 && (
                    <div className="w-full max-w-md space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                                Processing: {progress.current} / {progress.total} students
                            </span>
                            <span className="font-medium text-foreground">
                                {progress.percentage}%
                            </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                            <div
                                className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${progress.percentage}%` }}
                            />
                        </div>
                        {progress.studentName && (
                            <p className="text-xs text-muted-foreground text-center">
                                Currently evaluating: {progress.studentName}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Class Stats */}
            {classStats && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Class Summary</CardTitle>
                        <CardDescription>{classStats.total} student(s) evaluated</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div className="p-2 rounded-lg bg-muted/40">
                                <p className="text-xs text-muted-foreground">Average</p>
                                <p className={`text-xl font-bold ${getScoreColor(classStats.avg)}`}>
                                    {classStats.avg.toFixed(1)}%
                                </p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/40">
                                <p className="text-xs text-muted-foreground">Pass Rate (≥60%)</p>
                                <p className="text-xl font-bold">
                                    {classStats.passed} / {classStats.total}
                                </p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/40">
                                <p className="text-xs text-muted-foreground">Highest</p>
                                <p className="text-xl font-bold text-emerald-600">
                                    {classStats.max.toFixed(1)}%
                                </p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/40">
                                <p className="text-xs text-muted-foreground">Lowest</p>
                                <p className="text-xl font-bold text-red-600">
                                    {classStats.min.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Export Panel */}
            {evaluationResults.length > 0 && (
                <Card className="border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/50 to-sky-50/50 dark:from-indigo-950/20 dark:to-sky-950/20">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            Export Evaluations
                        </CardTitle>
                        <CardDescription>
                            Download grading reports as Word or PDF (multiple students get zipped automatically).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-3">
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Format</label>
                                <select
                                    value={exportFormat}
                                    onChange={(e) => setExportFormat(e.target.value as ExamEvalFormat)}
                                    className="text-sm border rounded-md px-3 py-2 bg-background"
                                >
                                    <option value="docx">Word (.docx)</option>
                                    <option value="pdf">PDF (.pdf)</option>
                                </select>
                            </div>
                            <div className="min-w-[180px]">
                                <label className="text-xs text-muted-foreground block mb-1">Target</label>
                                <select
                                    value={exportTarget === 'all' ? 'all' : String(exportTarget)}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setExportTarget(v === 'all' ? 'all' : Number(v));
                                    }}
                                    className="text-sm border rounded-md px-3 py-2 bg-background w-full"
                                >
                                    <option value="all">
                                        All students ({evaluationResults.length})
                                    </option>
                                    {evaluationResults.map((r, idx) => (
                                        <option key={`${r.studentId || 'student'}-${idx}`} value={idx}>
                                            {r.studentName || r.studentId || `Student ${idx + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <Button
                                onClick={handleExport}
                                disabled={exporting}
                                className="cursor-pointer"
                            >
                                {exporting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Exporting...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4 mr-2" />
                                        Export
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Results */}
            {evaluationResults.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <ClipboardCheck className="w-5 h-5" />
                            Evaluation Results
                        </h2>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={expandAll}
                                className="cursor-pointer"
                            >
                                <ChevronsUpDown className="w-4 h-4 mr-1" />
                                Expand all
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={collapseAll}
                                className="cursor-pointer"
                            >
                                <ChevronsDownUp className="w-4 h-4 mr-1" />
                                Collapse all
                            </Button>
                        </div>
                    </div>
                    
                    {evaluationResults.map((result, resultIndex) => (
                        <Card key={result.studentId || resultIndex} className="overflow-hidden">
                            {/* Student Header */}
                            <div 
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors duration-200"
                                onClick={() => toggleStudent(result.studentId || String(resultIndex))}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${getScoreBg(result.percentage)}`}>
                                        {result.percentage >= 60 ? (
                                            <CheckCircle2 className={`w-5 h-5 ${getScoreColor(result.percentage)}`} />
                                        ) : (
                                            <AlertCircle className={`w-5 h-5 ${getScoreColor(result.percentage)}`} />
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{result.studentName || `Student ${resultIndex + 1}`}</h3>
                                        <p className="text-sm text-muted-foreground">{result.studentId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        <p className={`text-2xl font-bold ${getScoreColor(result.percentage)}`}>
                                            {result.totalScore} / {result.maxScore}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {result.percentage.toFixed(1)}%
                                        </p>
                                    </div>
                                    {expandedStudents[result.studentId || String(resultIndex)] ? (
                                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                                    )}
                                </div>
                            </div>

                            {/* Expanded Content */}
                            {expandedStudents[result.studentId || String(resultIndex)] && (
                                <CardContent className="pt-0 border-t">
                                    {/* Overall Feedback */}
                                    {result.overallFeedback && (
                                        <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                                            <p className="text-sm font-medium mb-1">Overall Feedback</p>
                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                {formatBilingual(result.overallFeedback)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Question Evaluations */}
                                    <div className="space-y-3">
                                        {result.evaluations?.map((evaluation, evalIndex) => {
                                            const questionKey = `${result.studentId}-${evalIndex}`;
                                            const isExpanded = expandedQuestions[questionKey];
                                            
                                            return (
                                                <div 
                                                    key={evalIndex}
                                                    className={`border rounded-lg overflow-hidden ${
                                                        evaluation.isCorrect 
                                                            ? 'border-emerald-200 dark:border-emerald-800' 
                                                            : evaluation.awardedPoints > 0 
                                                                ? 'border-yellow-200 dark:border-yellow-800'
                                                                : 'border-red-200 dark:border-red-800'
                                                    }`}
                                                >
                                                    {/* Question Header */}
                                                    <div 
                                                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors duration-200"
                                                        onClick={() => toggleQuestion(questionKey)}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            {evaluation.isCorrect ? (
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                                            ) : evaluation.awardedPoints > 0 ? (
                                                                <AlertCircle className="w-4 h-4 text-yellow-600" />
                                                            ) : (
                                                                <XCircle className="w-4 h-4 text-red-600" />
                                                            )}
                                                            <span className="font-medium text-sm">
                                                                Question {evaluation.questionNumber}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`font-semibold text-sm ${
                                                                evaluation.isCorrect 
                                                                    ? 'text-emerald-600' 
                                                                    : evaluation.awardedPoints > 0 
                                                                        ? 'text-yellow-600'
                                                                        : 'text-red-600'
                                                            }`}>
                                                                {evaluation.awardedPoints} / {evaluation.maxPoints} pts
                                                            </span>
                                                            {isExpanded ? (
                                                                <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                                            ) : (
                                                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Question Details */}
                                                    {isExpanded && (
                                                        <div className="p-3 pt-0 space-y-3 text-sm">
                                                            <div>
                                                                <p className="font-medium text-muted-foreground mb-1">Question</p>
                                                                <p className="whitespace-pre-wrap">{evaluation.questionText}</p>
                                                            </div>
                                                            
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded">
                                                                    <p className="font-medium text-emerald-700 dark:text-emerald-400 mb-1">Correct Answer</p>
                                                                    <div className="text-emerald-800 dark:text-emerald-300">
                                                                        {renderAnswer(evaluation.correctAnswer, looksLikeCode(evaluation.correctAnswer))}
                                                                    </div>
                                                                </div>
                                                                <div className={`p-2 rounded ${
                                                                    evaluation.isCorrect 
                                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30' 
                                                                        : 'bg-red-50 dark:bg-red-950/30'
                                                                }`}>
                                                                    <p className={`font-medium mb-1 ${
                                                                        evaluation.isCorrect 
                                                                            ? 'text-emerald-700 dark:text-emerald-400' 
                                                                            : 'text-red-700 dark:text-red-400'
                                                                    }`}>Student Answer</p>
                                                                    <div className={`${
                                                                        evaluation.isCorrect 
                                                                            ? 'text-emerald-800 dark:text-emerald-300' 
                                                                            : 'text-red-800 dark:text-red-300'
                                                                    }`}>
                                                                        {renderAnswer(evaluation.studentAnswer, looksLikeCode(evaluation.studentAnswer))}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded">
                                                                <p className="font-medium text-blue-700 dark:text-blue-400 mb-1">Grading Explanation</p>
                                                                <p className="whitespace-pre-wrap text-blue-800 dark:text-blue-300">
                                                                    {formatBilingual(evaluation.explanation)}
                                                                </p>
                                                            </div>

                                                            {evaluation.feedback && (
                                                                <div className="p-2 bg-purple-50 dark:bg-purple-950/30 rounded">
                                                                    <p className="font-medium text-purple-700 dark:text-purple-400 mb-1">Learning Suggestions</p>
                                                                    <p className="whitespace-pre-wrap text-purple-800 dark:text-purple-300">
                                                                        {formatBilingual(evaluation.feedback)}
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Raw response fallback */}
                                    {result.rawResponse && !result.evaluations?.length && (
                                        <div className="mt-4 p-3 bg-muted rounded-lg">
                                            <p className="text-sm font-medium mb-2">Raw Response</p>
                                            <pre className="text-xs overflow-auto whitespace-pre-wrap">{result.rawResponse}</pre>
                                        </div>
                                    )}
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!loading && evaluationResults.length === 0 && (teacherFiles.length === 0 || studentFiles.length === 0) && (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <ClipboardCheck className="w-12 h-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium mb-2">Ready to Evaluate</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            Upload teacher files with questions and correct answers (top section),
                            and student submission files (bottom section) in the left panel,
                            then click "Start Evaluation" to begin.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
