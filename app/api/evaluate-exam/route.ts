import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout

// Test endpoint to verify route exists
export async function GET(req: NextRequest) {
    return NextResponse.json({ 
        message: 'Exam Evaluation API is working',
        endpoint: '/api/evaluate-exam',
        methods: ['GET', 'POST']
    });
}

interface StudentFile {
    name: string;
    content: string;
}

interface EvaluationRequest {
    teacherContext: string;
    studentFiles: StudentFile[]; // Changed from studentContext to studentFiles array
    subject: string;
    llmConfig: {
        apiKey: string;
        baseURL: string;
        model: string;
    };
    languageConfig: {
        primaryLanguage: string;
        secondaryLanguage: string;
    };
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
}

// Helper function to evaluate a single student
async function evaluateSingleStudent(
    teacherContext: string,
    studentFile: StudentFile,
    subject: string,
    llmConfig: { apiKey: string; baseURL: string; model: string },
    languageConfig: { primaryLanguage: string; secondaryLanguage: string }
): Promise<EvaluationResult> {
    const primaryLang = languageConfig?.primaryLanguage || 'English';
    const secondaryLang = languageConfig?.secondaryLanguage || 'none';
    const baseURL = (llmConfig.baseURL || 'https://api.openai.com/v1').trim();
    const model = (llmConfig.model || 'gpt-4').trim();
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
      "explanation": "detailed explanation of the evaluation in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same explanation in ${secondaryLang}` : ''}",
      "feedback": "constructive feedback for the student in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same feedback in ${secondaryLang}` : ''}"
    }
  ],
  "overallFeedback": "overall feedback for the student in ${primaryLang}${secondaryLang !== 'none' ? `, followed by a blank line, then the same feedback in ${secondaryLang}` : ''}"
}

${secondaryLang !== 'none' ? `\n\nIMPORTANT: For "explanation" and "feedback" fields, provide the content in ${primaryLang} first, then add a blank line, then provide the translation in ${secondaryLang}. Do NOT use parentheses or brackets around the second language - just use a blank line to separate them.\n\nExample format:\nexplanation: "This answer is correct because...\n\n這個答案是正確的，因為..."` : ''}`;

    const userPrompt = `Please evaluate the following student answers against the teacher's questions and correct answers.

=== TEACHER'S QUESTIONS AND CORRECT ANSWERS ===
${teacherContext}

=== STUDENT'S SUBMITTED ANSWERS ===
FILE: ${studentFile.name}
${studentFile.content}

Instructions:
1. First, parse and identify each question from the teacher's material, including the point value for each question
2. Match each student answer to the corresponding question
3. Compare student answers with correct answers
4. Award full, partial, or zero points based on correctness
5. Provide clear explanations for each evaluation
6. Calculate the total score
7. Extract student ID from the filename (e.g., if filename is "student_001.pdf", studentId should be "student_001")

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
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('No valid JSON found in response');
        }
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
        };
    }

    return parsedResult;
}

export async function POST(req: NextRequest) {
    try {
        const body: EvaluationRequest = await req.json();
        const { teacherContext, studentFiles, subject, llmConfig, languageConfig } = body;

        if (!teacherContext) {
            return NextResponse.json(
                { error: 'Teacher context is required' },
                { status: 400 }
            );
        }

        if (!studentFiles || !Array.isArray(studentFiles) || studentFiles.length === 0) {
            return NextResponse.json(
                { error: 'At least one student file is required' },
                { status: 400 }
            );
        }

        if (!llmConfig?.apiKey) {
            return NextResponse.json(
                { error: 'API key is required' },
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

                // Evaluate each student file separately in parallel
                const evaluationPromises = studentFiles.map(async (studentFile, index) => {
                    try {
                        const result = await evaluateSingleStudent(
                            teacherContext,
                            studentFile,
                            subject,
                            llmConfig,
                            languageConfig
                        );
                        completed++;
                        sendProgress(completed, totalStudents, studentFile.name);
                        return { success: true, result, index };
                    } catch (error: any) {
                        console.error(`Error evaluating student ${studentFile.name}:`, error);
                        const errorResult = {
                            studentId: studentFile.name.replace(/\.[^/.]+$/, ''), // Remove file extension
                            studentName: 'Error',
                            totalScore: 0,
                            maxScore: 100,
                            percentage: 0,
                            evaluations: [],
                            overallFeedback: `Error evaluating this student: ${error.message || 'Unknown error'}`,
                        } as EvaluationResult;
                        completed++;
                        sendProgress(completed, totalStudents, studentFile.name);
                        return { success: false, result: errorResult, index };
                    }
                });

                // Wait for all evaluations to complete
                const settledResults = await Promise.allSettled(evaluationPromises);
                
                // Process results in order
                const sortedResults = settledResults
                    .map((settled, index) => {
                        if (settled.status === 'fulfilled') {
                            return settled.value;
                        } else {
                            // Handle unexpected errors
                            const studentFile = studentFiles[index];
                            return {
                                success: false,
                                result: {
                                    studentId: studentFile.name.replace(/\.[^/.]+$/, ''),
                                    studentName: 'Error',
                                    totalScore: 0,
                                    maxScore: 100,
                                    percentage: 0,
                                    evaluations: [],
                                    overallFeedback: `Unexpected error: ${settled.reason?.message || 'Unknown error'}`,
                                } as EvaluationResult,
                                index,
                            };
                        }
                    })
                    .sort((a, b) => a.index - b.index);

                // Collect results
                sortedResults.forEach(({ result }) => {
                    results.push(result);
                });

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
        console.error('Evaluation API error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to evaluate exam' },
            { status: 500 }
        );
    }
}
