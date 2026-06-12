import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { getRequiredPlatformLLMConfig } from '@/lib/llm/platform';
import { requireUserSession, logServerError, publicErrorMessage } from '@/lib/server/api';
import type { LLMConfig } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Test endpoint to verify route exists
export async function GET(req: NextRequest) {
    const auth = await requireUserSession();
    if (auth.response) return auth.response;

    return NextResponse.json({ 
        message: 'Exam Evaluation API is working',
        endpoint: '/api/evaluate-exam',
        methods: ['GET', 'POST']
    });
}

interface StudentFile {
    name: string;
    content: string;
    sourceFiles?: string[];
    warnings?: string[];
}

interface EvaluationRequest {
    action?: 'parse_teacher' | 'evaluate';
    teacherContext: string;
    teacherPaper?: TeacherPaper;
    studentFiles: StudentFile[]; // Changed from studentContext to studentFiles array
    subject: string;
    languageConfig: {
        primaryLanguage: string;
        secondaryLanguage: string;
    };
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

async function parseLlmJson(content: string): Promise<any> {
    const trimmed = content.trim();
    const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)?.[1]
        ?? trimmed.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
    const candidate = (fenced ?? trimmed).trim();

    try {
        return JSON.parse(candidate);
    } catch {
        const jsonMatch = candidate.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No valid JSON found in response');
        return JSON.parse(jsonrepair(jsonMatch[0]));
    }
}

function clampScore(value: any, maxPoints: number) {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(score, maxPoints));
}

function normalizeAnswer(value: string) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[。．.，,;；:：!！?？()[\]{}"'`]/g, '')
        .trim();
}

function extractChoiceLetter(value: string) {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(?:option\s*)?([A-D])(?:[.)、\s]|$)/i);
    return match?.[1]?.toUpperCase() || null;
}

function parsePlainNumber(value: string) {
    const normalized = String(value || '')
        .trim()
        .replace(/,/g, '')
        .replace(/\s+/g, '');
    if (!/^-?\d+(?:\.\d+)?%?$/.test(normalized)) return null;
    const isPercent = normalized.endsWith('%');
    const number = Number(normalized.replace(/%$/, ''));
    if (!Number.isFinite(number)) return null;
    return isPercent ? number / 100 : number;
}

async function callExamJson(
    systemPrompt: string,
    userPrompt: string,
    llmConfig: Pick<LLMConfig, 'apiKey' | 'baseURL' | 'model'>,
    options?: { temperature?: number; maxOutputTokens?: number }
) {
    const baseURL = (llmConfig.baseURL || 'https://api.openai.com/v1').trim();
    const model = (llmConfig.model || 'gpt-5.5').trim();
    const apiKey = llmConfig.apiKey;
    const isGemini = baseURL.includes('generativelanguage.googleapis.com') || model.includes('gemini');
    let content = '';

    if (isGemini) {
        const geminiBase = baseURL.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
        const apiVersion = 'v1beta';
        const geminiModel = model.replace(/^models\//, '') || 'gemini-1.5-flash';
        const apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
                }],
                generationConfig: {
                    temperature: options?.temperature ?? 0.3,
                    maxOutputTokens: options?.maxOutputTokens ?? 4000,
                    responseMimeType: 'application/json',
                },
            }),
        });
        if (!response.ok) throw new Error(`AI service error (${response.status})`);
        const data = await response.json();
        content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
        const client = new OpenAI({ apiKey, baseURL });
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: options?.temperature ?? 0.3,
            response_format: { type: 'json_object' },
            max_completion_tokens: options?.maxOutputTokens ?? 4000,
        });
        content = response.choices[0]?.message?.content || '';
    }

    if (!content) throw new Error('No content received from AI service');
    return parseLlmJson(content);
}

function normalizeTeacherPaper(parsed: any): TeacherPaper {
    const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.map((w: any) => String(w)) : [];
    const questions: TeacherQuestion[] = rawQuestions.map((question: any, index: number): TeacherQuestion => {
        const maxPoints = Math.max(0, Number(question?.maxPoints ?? question?.points ?? 0) || 0);
        const itemWarnings = Array.isArray(question?.warnings)
            ? question.warnings.map((warning: any) => String(warning))
            : [];
        const normalized: TeacherQuestion = {
            questionNumber: Number(question?.questionNumber ?? question?.number ?? index + 1) || index + 1,
            questionText: String(question?.questionText ?? question?.question ?? '').trim(),
            correctAnswer: String(question?.correctAnswer ?? question?.answer ?? '').trim(),
            maxPoints,
            gradingNotes: String(question?.gradingNotes ?? question?.rubric ?? '').trim(),
            warnings: itemWarnings,
        };
        normalized.needsReview =
            Boolean(question?.needsReview) ||
            !normalized.questionText ||
            !normalized.correctAnswer ||
            normalized.maxPoints <= 0 ||
            itemWarnings.length > 0;
        if (normalized.needsReview && normalized.warnings?.length === 0) {
            normalized.warnings = ['Question, answer, or point value needs teacher confirmation.'];
        }
        return normalized;
    });
    const totalPoints = questions.reduce((sum, question) => sum + question.maxPoints, 0);
    const needsReview =
        Boolean(parsed?.needsReview) ||
        questions.length === 0 ||
        questions.some((question) => question.needsReview) ||
        warnings.length > 0;

    if (questions.length === 0) {
        warnings.push('No questions could be confidently extracted from the teacher materials.');
    }

    return {
        questions,
        totalPoints: Number(parsed?.totalPoints) > 0 ? Number(parsed.totalPoints) : totalPoints,
        needsReview,
        warnings,
        confirmed: false,
    };
}

function buildTeacherPaperContext(teacherPaper: TeacherPaper) {
    return teacherPaper.questions.map((question) => [
        `Question ${question.questionNumber}`,
        `Points: ${question.maxPoints}`,
        `Question: ${question.questionText || '[NEEDS TEACHER CONFIRMATION]'}`,
        `Correct answer: ${question.correctAnswer || '[NEEDS TEACHER CONFIRMATION]'}`,
        question.gradingNotes ? `Teacher grading notes: ${question.gradingNotes}` : '',
        question.needsReview ? `Warnings: ${(question.warnings || []).join(' | ') || 'Needs teacher review'}` : '',
    ].filter(Boolean).join('\n')).join('\n\n---\n\n');
}

async function parseTeacherPaper(
    teacherContext: string,
    subject: string,
    llmConfig: Pick<LLMConfig, 'apiKey' | 'baseURL' | 'model'>
): Promise<TeacherPaper> {
    const systemPrompt = `You help teachers prepare an exam answer key for grading. Extract the teacher's questions, correct answers, point values, and grading notes. Return valid JSON only. Mark anything unclear as needsReview.`;
    const userPrompt = `Subject: ${subject || 'general'}

Teacher materials:
${teacherContext}

Return JSON in this shape:
{
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "full question text",
      "correctAnswer": "teacher's correct answer",
      "maxPoints": 10,
      "gradingNotes": "short teacher-facing grading guidance",
      "needsReview": false,
      "warnings": []
    }
  ],
  "totalPoints": 100,
  "needsReview": false,
  "warnings": []
}`;

    const parsed = await callExamJson(systemPrompt, userPrompt, llmConfig, {
        temperature: 0.2,
        maxOutputTokens: 6000,
    });
    return normalizeTeacherPaper(parsed);
}

function applyFixedRuleChecks(ev: QuestionEvaluation): QuestionEvaluation {
    const maxPoints = Math.max(0, Number(ev.maxPoints) || 0);
    const warnings = Array.isArray(ev.warnings) ? [...ev.warnings] : [];
    let awardedPoints = clampScore(ev.awardedPoints, maxPoints);
    let isCorrect = Boolean(ev.isCorrect);
    let gradingMethod = ev.gradingMethod || 'ai_semantic_review';

    const studentAnswer = String(ev.studentAnswer || '');
    const correctAnswer = String(ev.correctAnswer || '');
    const normalizedStudent = normalizeAnswer(studentAnswer);
    const normalizedCorrect = normalizeAnswer(correctAnswer);
    const studentChoice = extractChoiceLetter(studentAnswer);
    const correctChoice = extractChoiceLetter(correctAnswer);
    const studentNumber = parsePlainNumber(studentAnswer);
    const correctNumber = parsePlainNumber(correctAnswer);

    if (maxPoints > 0 && normalizedStudent && normalizedCorrect && normalizedStudent === normalizedCorrect) {
        awardedPoints = maxPoints;
        isCorrect = true;
        gradingMethod = 'fixed_rule_exact_match';
    } else if (maxPoints > 0 && studentChoice && correctChoice && studentChoice === correctChoice) {
        awardedPoints = maxPoints;
        isCorrect = true;
        gradingMethod = 'fixed_rule_choice_match';
    } else if (
        maxPoints > 0 &&
        studentNumber !== null &&
        correctNumber !== null &&
        Math.abs(studentNumber - correctNumber) <= Math.max(1e-9, Math.abs(correctNumber) * 1e-6)
    ) {
        awardedPoints = maxPoints;
        isCorrect = true;
        gradingMethod = 'fixed_rule_numeric_match';
    }

    const needsReview =
        Boolean(ev.needsReview) ||
        maxPoints <= 0 ||
        !String(ev.questionText || '').trim() ||
        !String(ev.correctAnswer || '').trim() ||
        /\[(?:NO ANSWER FOUND|UNREADABLE|WARNING|UNKNOWN BINARY|ERROR)/i.test(studentAnswer);

    if (needsReview && !warnings.some((warning) => /review|確認/i.test(warning))) {
        warnings.push('Teacher review recommended for this question.');
    }

    return {
        ...ev,
        maxPoints,
        awardedPoints,
        isCorrect,
        gradingMethod,
        needsReview,
        warnings,
    };
}

function normalizeEvaluationResult(
    parsedResult: EvaluationResult,
    studentFile: StudentFile,
    rawResponse?: string
): EvaluationResult {
    const evaluations = Array.isArray(parsedResult.evaluations)
        ? parsedResult.evaluations.map(applyFixedRuleChecks)
        : [];

    const totalScore = evaluations.length > 0
        ? evaluations.reduce((sum, ev) => sum + (Number(ev.awardedPoints) || 0), 0)
        : Number(parsedResult.totalScore) || 0;
    const maxScore = evaluations.length > 0
        ? evaluations.reduce((sum, ev) => sum + (Number(ev.maxPoints) || 0), 0)
        : Number(parsedResult.maxScore) || 0;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const intakeWarnings = Array.isArray(studentFile.warnings) ? studentFile.warnings : [];
    const needsReview =
        Boolean(parsedResult.needsReview) ||
        intakeWarnings.length > 0 ||
        evaluations.some((ev) => ev.needsReview);

    return {
        ...parsedResult,
        studentId: parsedResult.studentId || studentFile.name.replace(/\.[^/.]+$/, ''),
        studentName: parsedResult.studentName || studentFile.name.replace(/\.[^/.]+$/, '') || 'Unknown',
        totalScore,
        maxScore,
        percentage,
        evaluations,
        overallFeedback: parsedResult.overallFeedback || '',
        sourceFiles: studentFile.sourceFiles || [],
        intakeWarnings,
        needsReview,
        rawResponse,
    };
}

// Helper function to evaluate a single student
async function evaluateSingleStudent(
    teacherPaper: TeacherPaper,
    studentFile: StudentFile,
    subject: string,
    llmConfig: Pick<LLMConfig, 'apiKey' | 'baseURL' | 'model'>,
    languageConfig: { primaryLanguage: string; secondaryLanguage: string }
): Promise<EvaluationResult> {
    const primaryLang = languageConfig?.primaryLanguage || 'English';
    const secondaryLang = languageConfig?.secondaryLanguage || 'none';
    const baseURL = (llmConfig.baseURL || 'https://api.openai.com/v1').trim();
    const model = (llmConfig.model || 'gpt-5.5').trim();
    const apiKey = llmConfig.apiKey;
    const isGemini = baseURL.includes('generativelanguage.googleapis.com') || model.includes('gemini');

    const systemPrompt = `You are an expert exam evaluator and grader. Your task is to evaluate student answers against the correct answers provided by the teacher.

IMPORTANT RULES:
1. Be fair and objective in your evaluation
2. Award partial credit when appropriate - if a student shows partial understanding, give proportional points
3. For each question, provide a clear explanation of why the answer is correct or incorrect
4. Give constructive feedback to help students learn
5. Consider the subject domain: ${subject}

OUTPUT FORMAT:
You must return a valid JSON object with the following structure:
{
  "studentId": "extracted from filename or content, e.g., 'student_001' or filename without extension",
  "studentName": "extracted name or 'Unknown'",
  "totalScore": <number>,
  "maxScore": <number>,
  "percentage": <number>,
  "evaluations": [
    {
      "questionNumber": <number>,
      "questionText": "the question",
      "correctAnswer": "the correct answer from teacher",
      "studentAnswer": "the student's answer",
      "maxPoints": <number>,
      "awardedPoints": <number>,
      "isCorrect": <boolean>,
      "gradingMethod": "fixed_rule|ai_semantic_review|teacher_review_required",
      "needsReview": <boolean>,
      "warnings": ["short warning strings when answer matching, reading, or grading is uncertain"],
      "explanation": "detailed explanation of the evaluation in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same explanation in ${secondaryLang}` : ''}",
      "feedback": "constructive feedback for the student in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same feedback in ${secondaryLang}` : ''}"
    }
  ],
  "overallFeedback": "overall feedback for the student in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same feedback in ${secondaryLang}` : ''}",
  "needsReview": <boolean>
}

${secondaryLang !== 'none' ? `\n\nIMPORTANT: For "explanation" and "feedback" fields, provide the content in ${primaryLang} first, then add a blank line, then provide the translation in ${secondaryLang}. Do NOT use parentheses or brackets around the second language - just use a blank line to separate them.\n\nExample format:\nexplanation: "This answer is correct because...\n\n這個答案是正確的，因為..."` : ''}`;

    const teacherContext = buildTeacherPaperContext(teacherPaper);
    const userPrompt = `Please evaluate the following student answers against the confirmed teacher questions and correct answers.

=== CONFIRMED TEACHER QUESTION SET ===
${teacherContext}

=== STUDENT'S SUBMITTED ANSWERS ===
FILE: ${studentFile.name}
${studentFile.sourceFiles?.length ? `SOURCE FILES:\n${studentFile.sourceFiles.join('\n')}\n` : ''}
${studentFile.warnings?.length ? `READING WARNINGS:\n${studentFile.warnings.join('\n')}\n` : ''}
${studentFile.content}

Instructions:
1. First, parse and identify each question from the teacher's material, including the point value for each question.
2. Match each student answer to the corresponding question. Treat "Q1", "1.", "Question 1", and equivalent localized labels as the same question.
3. If a student answer cannot be matched clearly, set needsReview=true and add a warning. Do not silently attach it to the wrong question.
4. If a student appears to have skipped a question, use studentAnswer="[NO ANSWER FOUND]", awardedPoints=0, and add a warning.
5. For objective answers such as multiple choice, exact fill-in answers, and clearly numeric answers, use gradingMethod="fixed_rule".
6. For short answer, essay, code explanation, or partial-credit reasoning, use gradingMethod="ai_semantic_review".
7. If teacher points, teacher answer, or student answer text is unreadable or missing, set needsReview=true.
8. Award full, partial, or zero points based on correctness. Do not award more than maxPoints.
9. Provide clear explanations for each evaluation and constructive feedback for the student.
10. Calculate the total score.
11. Extract student ID from the filename or the "STUDENT:" line in the submitted answers.

Return the evaluation as a JSON object following the specified format.`;

    let content = '';

    if (isGemini) {
        // Handle Gemini API with retry logic
        const geminiBase = baseURL.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
        const apiVersion = 'v1beta';
        let geminiModel = model || 'gemini-1.5-flash';
        
        if (geminiModel.startsWith('models/')) {
            geminiModel = geminiModel.replace(/^models\//, '');
        }
        
        const apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        
        const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
        const geminiPayload = {
            contents: [{
                role: 'user',
                parts: [{ text: combinedPrompt }]
            }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 4000,
            }
        };

        const maxRetries = 3;
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const geminiResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(geminiPayload),
                });

                if (geminiResponse.ok) {
                    const geminiData = await geminiResponse.json();
                    content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    
                    if (!content) {
                        throw new Error('No content received from Gemini API');
                    }
                    break;
                }

                const status = geminiResponse.status;
                const isRetryable = status === 503 || status === 429 || status === 500 || status === 502;
                
                let errorText = '';
                try {
                    errorText = await geminiResponse.text();
                } catch {
                    // Ignore text parsing errors
                }
                
                lastError = new Error(`Gemini API Error: ${status}${errorText ? ` - ${errorText}` : ''}`);
                
                if (!isRetryable) {
                    throw lastError;
                }
                
                if (attempt === maxRetries - 1) {
                    throw lastError;
                }
                
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`Gemini API error ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                
            } catch (error: any) {
                const isRetryableError = error.message?.includes('503') || 
                                       error.message?.includes('429') || 
                                       error.message?.includes('500') ||
                                       error.message?.includes('502') ||
                                       error.message?.includes('No content received');
                
                if (!isRetryableError || attempt === maxRetries - 1) {
                    throw error;
                }
                
                lastError = error;
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`Gemini API error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        if (!content) {
            throw lastError || new Error('Failed to get content from Gemini API after retries');
        }
    } else {
        // Handle OpenAI-compatible API
        const client = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
        });

        const response = await client.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            // gpt-5.4-mini may reject `max_tokens`; use `max_completion_tokens`.
            max_completion_tokens: 4000,
        });

        content = response.choices[0]?.message?.content || '';
        
        if (!content) {
            throw new Error('No content received from LLM');
        }
    }
    
    // Parse the JSON response
    let parsedResult: EvaluationResult;
    try {
        parsedResult = await parseLlmJson(content);
    } catch (parseError) {
        console.error('Failed to parse LLM response:', parseError);
        // Return a default result with raw content
        parsedResult = {
            studentId: studentFile.name.replace(/\.[^/.]+$/, ''), // Remove file extension
            studentName: 'Unknown',
            totalScore: 0,
            maxScore: 100,
            percentage: 0,
            evaluations: [],
            overallFeedback: content,
            sourceFiles: studentFile.sourceFiles || [],
            intakeWarnings: studentFile.warnings || [],
            needsReview: true,
            rawResponse: content,
        };
    }

    return normalizeEvaluationResult(parsedResult, studentFile, content);
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireUserSession();
        if (auth.response) return auth.response;

        const body: EvaluationRequest = await req.json();
        const {
            action = 'evaluate',
            teacherContext,
            teacherPaper,
            studentFiles,
            subject,
            languageConfig,
        } = body;
        const llmConfig = getRequiredPlatformLLMConfig();

        if (!teacherContext) {
            return NextResponse.json(
                { error: 'Teacher context is required' },
                { status: 400 }
            );
        }

        if (action === 'parse_teacher') {
            const paper = await parseTeacherPaper(teacherContext, subject, llmConfig);
            return NextResponse.json({ success: true, paper });
        }

        if (!teacherPaper?.confirmed || !Array.isArray(teacherPaper.questions) || teacherPaper.questions.length === 0) {
            return NextResponse.json(
                { error: 'Teacher question set must be reviewed and confirmed before evaluation' },
                { status: 400 }
            );
        }

        if (!studentFiles || !Array.isArray(studentFiles) || studentFiles.length === 0) {
            return NextResponse.json(
                { error: 'At least one student file is required' },
                { status: 400 }
            );
        }

        // Create a readable stream for progress updates
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const totalStudents = studentFiles.length;
                const results: EvaluationResult[] = [];
                let completed = 0;

                // Send initial progress
                const sendProgress = (current: number, total: number, studentName?: string) => {
                    const progress = {
                        type: 'progress',
                        current,
                        total,
                        percentage: Math.round((current / total) * 100),
                        studentName: studentName || '',
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
                };

                // Send initial progress
                sendProgress(0, totalStudents);

                const resultSlots = new Array<EvaluationResult>(totalStudents);
                let nextIndex = 0;
                const concurrency = Math.min(3, totalStudents);

                const evaluateNext = async () => {
                    while (nextIndex < totalStudents) {
                        const index = nextIndex++;
                        const studentFile = studentFiles[index];
                        try {
	                            resultSlots[index] = await evaluateSingleStudent(
	                                teacherPaper,
	                                studentFile,
	                                subject,
	                                llmConfig,
                                languageConfig
                            );
	                        } catch (error: any) {
	                            logServerError(`Error evaluating student ${studentFile.name}:`, error);
                                const message = publicErrorMessage(error, 'Unable to evaluate this student. Teacher review required.');
	                            resultSlots[index] = {
	                                studentId: studentFile.name.replace(/\.[^/.]+$/, ''),
	                                studentName: 'Error',
                                totalScore: 0,
	                                maxScore: 100,
	                                percentage: 0,
	                                evaluations: [],
	                                overallFeedback: message,
	                                sourceFiles: studentFile.sourceFiles || [],
	                                intakeWarnings: studentFile.warnings || [],
	                                needsReview: true,
                            } as EvaluationResult;
                        } finally {
                            completed++;
                            sendProgress(completed, totalStudents, studentFile.name);
                        }
                    }
                };

                await Promise.all(Array.from({ length: concurrency }, evaluateNext));
                results.push(...resultSlots);

                // Send final result
                const finalData = {
                    type: 'complete',
                    results,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));
                controller.close();
            },
        });

        // Return streaming response
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error: any) {
        logServerError('Evaluation API error:', error);
        return NextResponse.json(
            { error: publicErrorMessage(error, 'Failed to evaluate exam') },
            { status: 500 }
        );
    }
}
