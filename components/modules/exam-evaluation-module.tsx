'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, FileText, ClipboardCheck, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CodeBlock } from '@/components/shared/code-block';

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
    const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[]>([]);
    const [expandedStudents, setExpandedStudents] = useState<Record<string, boolean>>({});
    const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState({ current: 0, total: 0, percentage: 0, studentName: '' });

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

            {/* Results */}
            {evaluationResults.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <ClipboardCheck className="w-5 h-5" />
                        Evaluation Results
                    </h2>
                    
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
