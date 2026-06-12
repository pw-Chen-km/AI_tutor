'use client';

import { useEffect, useMemo, useState } from 'react';
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
    gradingMethod?: string;
    needsReview?: boolean;
    warnings?: string[];
}

interface EvaluationResult {
    studentId: string;
    studentName: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    evaluations: QuestionEvaluation[];
    overallFeedback: string;
    sourceFiles?: string[];
    intakeWarnings?: string[];
    needsReview?: boolean;
    rawResponse?: string;
}

interface TeacherQuestion {
    questionNumber: number;
    questionText: string;
    correctAnswer: string;
    maxPoints: number;
    gradingNotes?: string;
    needsReview?: boolean;
    warnings?: string[];
}

interface TeacherPaper {
    questions: TeacherQuestion[];
    totalPoints: number;
    needsReview: boolean;
    warnings: string[];
    confirmed?: boolean;
}

export function ExamEvaluationModule() {
    const { teacherFiles, studentFiles, languageConfig, subject, generatedContent, setGeneratedContent } = useStore();
    const [loading, setLoading] = useState(false);
    const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[]>(() => {
        const cached = (generatedContent as any)?.exam_evaluation;
        return Array.isArray(cached) ? (cached as EvaluationResult[]) : [];
    });
    // Track modified scores for validation: studentId -> questionNumber -> {awardedPoints, isModified}
    const [modifiedScores, setModifiedScores] = useState<Record<string, Record<number, { awardedPoints: number; isModified: boolean }>>>({});
    const [expandedStudents, setExpandedStudents] = useState<Record<string, boolean>>({});
    const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState({ current: 0, total: 0, percentage: 0, studentName: '' });
    const [exportFormat, setExportFormat] = useState<ExamEvalFormat>('docx');
    // exportTarget is either 'all' or the array index of the selected student
    // (using index avoids collisions when two students have the same name / no id).
    const [exportTarget, setExportTarget] = useState<'all' | number>('all');
    const [exporting, setExporting] = useState(false);
    const [teacherPaper, setTeacherPaper] = useState<TeacherPaper | null>(null);
    const [paperLoading, setPaperLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

    const teacherSignature = useMemo(
        () => teacherFiles.map((file) => `${file.id}:${file.name}:${String(file.content || '').length}`).join('|'),
        [teacherFiles]
    );

    useEffect(() => {
        setTeacherPaper(null);
        setStatusMessage(null);
    }, [teacherSignature]);

    const buildTeacherContext = () => teacherFiles.map((f) => {
        const warnings = Array.isArray(f.intake?.warnings) && f.intake.warnings.length > 0
            ? `\nREADING WARNINGS:\n${f.intake.warnings.join('\n')}\n`
            : '';
        return `FILE: ${f.name}${warnings}\n${f.content}`;
    }).join('\n\n---\n\n');

    const buildStudentFilesPayload = () => studentFiles.map((f) => ({
        name: f.name,
        content: f.content,
        sourceFiles: Array.isArray(f.intake?.metadata?.sourceFiles)
            ? f.intake?.metadata?.sourceFiles
            : [],
        warnings: Array.isArray(f.intake?.warnings) ? f.intake?.warnings : [],
    }));

    const recomputeTeacherPaper = (paper: TeacherPaper, confirmed = false): TeacherPaper => {
        const questions = paper.questions.map((question, index) => {
            const maxPoints = Math.max(0, Number(question.maxPoints) || 0);
            const warnings = Array.isArray(question.warnings) ? question.warnings : [];
            const missing = !question.questionText.trim() || !question.correctAnswer.trim() || maxPoints <= 0;
            return {
                ...question,
                questionNumber: Number(question.questionNumber) || index + 1,
                maxPoints,
                needsReview: Boolean(question.needsReview) || missing || warnings.length > 0,
            };
        });
        return {
            ...paper,
            questions,
            totalPoints: questions.reduce((sum, question) => sum + (Number(question.maxPoints) || 0), 0),
            needsReview: questions.some((question) => question.needsReview) || (paper.warnings || []).length > 0,
            confirmed,
        };
    };

    const teacherPaperHasMissingRequiredFields = (paper: TeacherPaper | null) => {
        if (!paper || paper.questions.length === 0) return true;
        return paper.questions.some((question) =>
            !question.questionText.trim() ||
            !question.correctAnswer.trim() ||
            (Number(question.maxPoints) || 0) <= 0
        );
    };

    const handleParseTeacherPaper = async () => {
        if (teacherFiles.length === 0) {
            setStatusMessage({ type: 'error', text: 'Please upload teacher files with questions and correct answers.' });
            return;
        }

        setPaperLoading(true);
        setStatusMessage(null);

        try {
            const response = await fetch('/api/evaluate-exam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'parse_teacher',
                    teacherContext: buildTeacherContext(),
                    subject,
                    languageConfig,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const parsedPaper = recomputeTeacherPaper(data.paper, false);
            setTeacherPaper(parsedPaper);
            setEvaluationResults([]);
            setGeneratedContent('exam_evaluation', []);
            setStatusMessage({
                type: parsedPaper.needsReview ? 'warning' : 'success',
                text: parsedPaper.needsReview
                    ? 'Teacher question set was read, but some items need confirmation.'
                    : 'Teacher question set was read successfully. Please review and confirm it.',
            });
        } catch (error: any) {
            console.error('Teacher paper parse error:', error);
            setStatusMessage({ type: 'error', text: `Failed to read teacher question set: ${error?.message || 'Unknown error'}` });
        } finally {
            setPaperLoading(false);
        }
    };

    const updateTeacherQuestion = (index: number, patch: Partial<TeacherQuestion>) => {
        setTeacherPaper((prev) => {
            if (!prev) return prev;
            const next = {
                ...prev,
                questions: prev.questions.map((question, questionIndex) =>
                    questionIndex === index ? { ...question, ...patch } : question
                ),
            };
            return recomputeTeacherPaper(next, false);
        });
    };

    const confirmTeacherPaper = () => {
        if (!teacherPaper) return;
        if (teacherPaperHasMissingRequiredFields(teacherPaper)) {
            setStatusMessage({ type: 'error', text: 'Please fill in every question, correct answer, and point value before confirming.' });
            return;
        }
        const confirmedPaper = recomputeTeacherPaper(teacherPaper, true);
        setTeacherPaper(confirmedPaper);
        setStatusMessage({ type: 'success', text: 'Teacher question set confirmed. You can start evaluating students.' });
    };

    const handleEvaluate = async () => {
        if (teacherFiles.length === 0) {
            setStatusMessage({ type: 'error', text: 'Please upload teacher files with questions and correct answers.' });
            return;
        }

        if (studentFiles.length === 0) {
            setStatusMessage({ type: 'error', text: 'Please upload student submission files.' });
            return;
        }

        if (!teacherPaper?.confirmed) {
            setStatusMessage({ type: 'error', text: 'Please review and confirm the teacher question set before evaluating students.' });
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: studentFiles.length, percentage: 0, studentName: '' });
        
        try {
            // Call evaluation API with streaming response
            const response = await fetch('/api/evaluate-exam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'evaluate',
                    teacherContext: buildTeacherContext(),
                    teacherPaper,
                    studentFiles: buildStudentFilesPayload(),
                    subject,
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
                                setStatusMessage({ type: 'success', text: `Evaluation complete for ${results.length} student(s).` });
                                
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
            setStatusMessage({ type: 'error', text: `Evaluation failed: ${error.message || 'Unknown error'}` });
        } finally {
            setLoading(false);
            setProgress({ current: 0, total: 0, percentage: 0, studentName: '' });
        }
    };
    
    // Update score for a question with validation
    const handleScoreUpdate = (
        studentId: string,
        questionNumber: number,
        newScore: number,
        maxPoints: number
    ) => {
        const clampedScore = Math.max(0, Math.min(newScore, maxPoints));
        setModifiedScores(prev => ({
            ...prev,
            [studentId]: {
                ...prev[studentId],
                [questionNumber]: {
                    awardedPoints: clampedScore,
                    isModified: true,
                },
            },
        }));
    };
    
    // Recalculate totals when scores are modified
    const getEffectiveScore = (result: EvaluationResult, ev: QuestionEvaluation) => {
        const studentMod = modifiedScores[result.studentId];
        const questionMod = studentMod?.[ev.questionNumber];
        if (questionMod?.isModified) {
            return questionMod.awardedPoints;
        }
        return ev.awardedPoints;
    };
    
    // Calculate effective totals for a student
    const getEffectiveTotals = (result: EvaluationResult) => {
        let totalScore = 0;
        for (const ev of result.evaluations) {
            totalScore += getEffectiveScore(result, ev);
        }
        const maxScore = result.maxScore;
        const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
        return { totalScore, maxScore, percentage };
    };
    
    // Validation warnings
    const getScoreWarnings = (ev: QuestionEvaluation, modifiedScore?: number): string[] => {
        const warnings: string[] = [];
        const score = modifiedScore ?? ev.awardedPoints;
        
        // Warning: score differs from what LLM determined for clear right/wrong
        const studentAnswer = ev.studentAnswer?.trim().toLowerCase() || '';
        const correctAnswer = ev.correctAnswer?.trim().toLowerCase() || '';
        
        // Check for exact match (case insensitive)
        const isExactMatch = studentAnswer === correctAnswer && studentAnswer.length > 0;
        const isSimilar = studentAnswer && correctAnswer && 
            (studentAnswer.includes(correctAnswer) || correctAnswer.includes(studentAnswer));
        
        if (score === 0 && (isExactMatch || (isSimilar && studentAnswer.length > 5))) {
            warnings.push('答案看起來正確但給了 0 分');
        }
        if (score === ev.maxPoints && studentAnswer !== correctAnswer && !isSimilar && studentAnswer.length > 0) {
            warnings.push('答案似乎不正確但給了滿分');
        }
        
        return warnings;
    };

    const buildStudentMarkdown = (result: EvaluationResult): string => {
        const lines: string[] = [];
        const name = result.studentName || result.studentId || 'Student';
        const { totalScore, maxScore, percentage } = getEffectiveTotals(result);
        const hasModifications = Object.keys(modifiedScores[result.studentId] || {}).length > 0;
        
        lines.push(`# ${name}`);
        lines.push('');
        lines.push(`**Score:** ${totalScore} / ${maxScore}  (${percentage.toFixed(1)}%)`);
        if (hasModifications) lines.push('*分數已人工調整*');
        if (result.studentId) lines.push(`**Student ID:** ${result.studentId}`);
        if (Array.isArray(result.sourceFiles) && result.sourceFiles.length > 0) {
            lines.push(`**Source Files:** ${result.sourceFiles.join(', ')}`);
        }
        if (Array.isArray(result.intakeWarnings) && result.intakeWarnings.length > 0) {
            lines.push('');
            lines.push('**Reading Warnings:**');
            lines.push('');
            result.intakeWarnings.forEach((warning) => lines.push(`- ${warning}`));
        }
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
                const effectiveScore = getEffectiveScore(result, ev);
                const isModified = modifiedScores[result.studentId]?.[ev.questionNumber]?.isModified ?? false;
                const status = effectiveScore === ev.maxPoints ? 'Correct' : effectiveScore > 0 ? 'Partial' : 'Incorrect';
                const modMarker = isModified ? ' *(已修改)*' : '';
                lines.push(`### Question ${ev.questionNumber}  —  ${effectiveScore} / ${ev.maxPoints} pts  (${status})${modMarker}`);
                lines.push('');
                if (ev.gradingMethod) {
                    lines.push(`**Grading Method:** ${ev.gradingMethod}`);
                    lines.push('');
                }
                if (ev.needsReview || (Array.isArray(ev.warnings) && ev.warnings.length > 0)) {
                    lines.push('**Needs Teacher Review:** Yes');
                    lines.push('');
                    if (Array.isArray(ev.warnings) && ev.warnings.length > 0) {
                        ev.warnings.forEach((warning) => lines.push(`- ${warning}`));
                        lines.push('');
                    }
                }
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
            setStatusMessage({ type: 'error', text: 'Please run an evaluation first.' });
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
            setStatusMessage({ type: 'error', text: `Export failed: ${e?.message || 'Unknown error'}` });
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
        // Use effective totals (modified scores) for class stats
        const effectivePercentages = evaluationResults.map(r => getEffectiveTotals(r).percentage);
        const avg = effectivePercentages.reduce((s, p) => s + p, 0) / total;
        const passed = effectivePercentages.filter(p => p >= 60).length;
        const max = Math.max(...effectivePercentages);
        const min = Math.min(...effectivePercentages);
        return { total, avg, passed, max, min };
    }, [evaluationResults, modifiedScores]);

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

    const getFileWarnings = (file: any): string[] => {
        return Array.isArray(file?.intake?.warnings) ? file.intake.warnings : [];
    };

    const getSourceFiles = (file: any): string[] => {
        return Array.isArray(file?.intake?.metadata?.sourceFiles)
            ? file.intake.metadata.sourceFiles
            : [];
    };

    const getPreview = (content: string, maxLength = 320) => {
        const text = String(content || '').replace(/\s+/g, ' ').trim();
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength)}...`;
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

            {statusMessage && (
                <div
                    className={`rounded-md border px-4 py-3 text-sm ${
                        statusMessage.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : statusMessage.type === 'warning'
                                ? 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200'
                                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'
                    }`}
                >
                    {statusMessage.text}
                </div>
            )}

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

            {(teacherFiles.length > 0 || studentFiles.length > 0) && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">System Read Preview</CardTitle>
                        <CardDescription>
                            What the evaluator will use before scoring.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-foreground">Teacher Materials</p>
                                {teacherFiles.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No teacher material read yet.</p>
                                ) : (
                                    teacherFiles.map((file) => {
                                        const warnings = getFileWarnings(file);
                                        const sourceFiles = getSourceFiles(file);
                                        return (
                                            <div key={file.id} className="rounded-md border p-3 bg-muted/20">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                {sourceFiles.length > 0 && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        Sources: {sourceFiles.slice(0, 4).join(', ')}
                                                        {sourceFiles.length > 4 ? ` +${sourceFiles.length - 4}` : ''}
                                                    </p>
                                                )}
                                                {warnings.length > 0 && (
                                                    <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                                                        Needs check: {warnings.slice(0, 2).join(' | ')}
                                                    </p>
                                                )}
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    {getPreview(file.content)}
                                                </p>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-foreground">Student Submissions</p>
                                {studentFiles.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No student submission read yet.</p>
                                ) : (
                                    studentFiles.slice(0, 6).map((file) => {
                                        const warnings = getFileWarnings(file);
                                        const sourceFiles = getSourceFiles(file);
                                        return (
                                            <div key={file.id} className="rounded-md border p-3 bg-muted/20">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                {sourceFiles.length > 0 && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        Sources: {sourceFiles.slice(0, 4).join(', ')}
                                                        {sourceFiles.length > 4 ? ` +${sourceFiles.length - 4}` : ''}
                                                    </p>
                                                )}
                                                {warnings.length > 0 && (
                                                    <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                                                        Needs check: {warnings.slice(0, 2).join(' | ')}
                                                    </p>
                                                )}
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    {getPreview(file.content)}
                                                </p>
                                            </div>
                                        );
                                    })
                                )}
                                {studentFiles.length > 6 && (
                                    <p className="text-xs text-muted-foreground">
                                        Showing 6 of {studentFiles.length} students.
                                    </p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <ClipboardCheck className="w-4 h-4" />
                                System Understood Question Set
                            </CardTitle>
                            <CardDescription>
                                Review the questions, answers, and points before grading students.
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleParseTeacherPaper}
                                disabled={paperLoading || teacherFiles.length === 0}
                            >
                                {paperLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Reading...
                                    </>
                                ) : (
                                    <>
                                        <FileText className="w-4 h-4 mr-2" />
                                        Read Teacher Files
                                    </>
                                )}
                            </Button>
                            <Button
                                size="sm"
                                onClick={confirmTeacherPaper}
                                disabled={!teacherPaper || paperLoading || teacherPaperHasMissingRequiredFields(teacherPaper)}
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Confirm Question Set
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {!teacherPaper ? (
                        <p className="text-sm text-muted-foreground">
                            Upload teacher files, then read them to create the question set for review.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                                <span className="font-medium">{teacherPaper.questions.length} question(s)</span>
                                <span className="text-muted-foreground">Total: {teacherPaper.totalPoints} pts</span>
                                {teacherPaper.confirmed ? (
                                    <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                                        Confirmed
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
                                        Needs confirmation
                                    </span>
                                )}
                            </div>
                            {teacherPaper.warnings.length > 0 && (
                                <div className="rounded-md bg-orange-50 p-3 text-xs text-orange-700 dark:bg-orange-950/20 dark:text-orange-300">
                                    {teacherPaper.warnings.map((warning, index) => (
                                        <p key={index}>• {warning}</p>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-3">
                                {teacherPaper.questions.map((question, index) => (
                                    <div key={`${question.questionNumber}-${index}`} className="rounded-md border p-3 bg-muted/20 space-y-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="text-xs text-muted-foreground">
                                                Question #
                                                <input
                                                    type="number"
                                                    min={1}
                                                    className="ml-2 w-20 rounded-md border bg-background px-2 py-1 text-sm"
                                                    value={question.questionNumber}
                                                    onChange={(e) => updateTeacherQuestion(index, { questionNumber: Number(e.target.value) || index + 1 })}
                                                />
                                            </label>
                                            <label className="text-xs text-muted-foreground">
                                                Points
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step="0.5"
                                                    className="ml-2 w-24 rounded-md border bg-background px-2 py-1 text-sm"
                                                    value={question.maxPoints}
                                                    onChange={(e) => updateTeacherQuestion(index, { maxPoints: Number(e.target.value) || 0 })}
                                                />
                                            </label>
                                            {(question.needsReview || (question.warnings || []).length > 0) && (
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
                                                    Needs check
                                                </span>
                                            )}
                                        </div>
                                        <label className="block text-xs text-muted-foreground">
                                            Question
                                            <textarea
                                                className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                                value={question.questionText}
                                                onChange={(e) => updateTeacherQuestion(index, { questionText: e.target.value })}
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Correct Answer
                                            <textarea
                                                className="mt-1 min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                                value={question.correctAnswer}
                                                onChange={(e) => updateTeacherQuestion(index, { correctAnswer: e.target.value })}
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Grading Notes
                                            <textarea
                                                className="mt-1 min-h-14 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                                value={question.gradingNotes || ''}
                                                onChange={(e) => updateTeacherQuestion(index, { gradingNotes: e.target.value })}
                                            />
                                        </label>
                                        {(question.warnings || []).length > 0 && (
                                            <div className="rounded-md bg-orange-50 p-2 text-xs text-orange-700 dark:bg-orange-950/20 dark:text-orange-300">
                                                {(question.warnings || []).map((warning, warningIndex) => (
                                                    <p key={warningIndex}>• {warning}</p>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Generate Button */}
            <div className="flex flex-col items-center gap-4">
                <Button
                    onClick={handleEvaluate}
                    disabled={loading || teacherFiles.length === 0 || studentFiles.length === 0 || !teacherPaper?.confirmed}
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
                            {teacherPaper?.confirmed ? 'Start Evaluation' : 'Confirm Question Set First'}
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
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-semibold">{result.studentName || `Student ${resultIndex + 1}`}</h3>
                                            {result.needsReview && (
                                                <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full">
                                                    需要檢查
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">{result.studentId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        {(() => {
                                            const { totalScore, maxScore, percentage } = getEffectiveTotals(result);
                                            const hasModifications = Object.keys(modifiedScores[result.studentId] || {}).length > 0;
                                            return (
                                                <>
                                                    <p className={`text-2xl font-bold ${getScoreColor(percentage)}`}>
                                                        {totalScore} / {maxScore}
                                                        {hasModifications && (
                                                            <span className="text-sm font-normal text-blue-600 ml-2">(已調整)</span>
                                                        )}
                                                    </p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {percentage.toFixed(1)}%
                                                    </p>
                                                </>
                                            );
                                        })()}
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

                                    {Array.isArray(result.sourceFiles) && result.sourceFiles.length > 0 && (
                                        <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                                            <p className="text-sm font-medium mb-1">Source Files</p>
                                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                                {result.sourceFiles.join('\n')}
                                            </p>
                                        </div>
                                    )}

                                    {Array.isArray(result.intakeWarnings) && result.intakeWarnings.length > 0 && (
                                        <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                                            <p className="text-sm font-medium text-orange-700 dark:text-orange-300 mb-1">Reading Warnings</p>
                                            <ul className="text-xs text-orange-600 dark:text-orange-300 list-disc list-inside">
                                                {result.intakeWarnings.map((warning, idx) => (
                                                    <li key={idx}>{warning}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* Question Evaluations */}
                                    <div className="space-y-3">
                                        {result.evaluations?.map((evaluation, evalIndex) => {
                                            const questionKey = `${result.studentId}-${evalIndex}`;
                                            const isExpanded = expandedQuestions[questionKey];
                                            const effectiveScore = getEffectiveScore(result, evaluation);
                                            const isModified = modifiedScores[result.studentId]?.[evaluation.questionNumber]?.isModified ?? false;
                                            const warnings = [
                                                ...getScoreWarnings(evaluation, effectiveScore),
                                                ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
                                            ];
                                            const needsReview = Boolean(evaluation.needsReview) || warnings.length > 0;
                                            
                                            return (
                                                <div 
                                                    key={evalIndex}
                                                    className={`border rounded-lg overflow-hidden ${
                                                        effectiveScore === evaluation.maxPoints
                                                            ? 'border-emerald-200 dark:border-emerald-800' 
                                                            : effectiveScore > 0 
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
                                                            {effectiveScore === evaluation.maxPoints ? (
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                                            ) : effectiveScore > 0 ? (
                                                                <AlertCircle className="w-4 h-4 text-yellow-600" />
                                                            ) : (
                                                                <XCircle className="w-4 h-4 text-red-600" />
                                                            )}
                                                            <span className="font-medium text-sm">
                                                                Question {evaluation.questionNumber}
                                                            </span>
                                                            {needsReview && (
                                                                <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full" title={warnings.join(', ')}>
                                                                    需要檢查
                                                                </span>
                                                            )}
                                                            {isModified && (
                                                                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                                                                    已修改
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`font-semibold text-sm ${
                                                                effectiveScore === evaluation.maxPoints
                                                                    ? 'text-emerald-600' 
                                                                    : effectiveScore > 0 
                                                                        ? 'text-yellow-600'
                                                                        : 'text-red-600'
                                                            }`}>
                                                                {effectiveScore} / {evaluation.maxPoints} pts
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
                                                            {/* Score Editor */}
                                                            <div className="p-3 bg-gray-50 dark:bg-gray-900/30 rounded border">
                                                                <div className="flex items-center gap-3 flex-wrap">
                                                                    <span className="font-medium text-muted-foreground">Score:</span>
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            max={evaluation.maxPoints}
                                                                            value={effectiveScore}
                                                                            onChange={(e) => handleScoreUpdate(
                                                                                result.studentId,
                                                                                evaluation.questionNumber,
                                                                                parseFloat(e.target.value) || 0,
                                                                                evaluation.maxPoints
                                                                            )}
                                                                            className="w-20 px-2 py-1 text-sm border rounded bg-background"
                                                                        />
                                                                        <span className="text-muted-foreground">/ {evaluation.maxPoints} pts</span>
                                                                    </div>
                                                                    {isModified && (
                                                                        <button
                                                                            onClick={() => {
                                                                                setModifiedScores(prev => {
                                                                                    const studentMod = { ...prev[result.studentId] };
                                                                                    delete studentMod[evaluation.questionNumber];
                                                                                    return { ...prev, [result.studentId]: studentMod };
                                                                                });
                                                                            }}
                                                                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                                                                        >
                                                                            重置為 LLM 評分 ({evaluation.awardedPoints})
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {warnings.length > 0 && (
                                                                    <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/20 rounded">
                                                                        <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1">注意：</p>
                                                                        <ul className="text-xs text-orange-600 dark:text-orange-300 list-disc list-inside">
                                                                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                                                        </ul>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {evaluation.gradingMethod && (
                                                                <div className="p-2 bg-muted/30 rounded">
                                                                    <p className="font-medium text-muted-foreground mb-1">Grading Method</p>
                                                                    <p className="text-muted-foreground">{evaluation.gradingMethod}</p>
                                                                </div>
                                                            )}
                                                            
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
