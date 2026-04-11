import OpenAI from 'openai';
import { LLMConfig } from '../store';
import promptTemplates from './prompt-templates.json';

export function createLLMClient(config: LLMConfig) {
  return new OpenAI({
    apiKey: config.apiKey || 'dummy',
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true, // We are switching to server-side proxy, but keeping this for now just in case
  });
}

export function buildPrompt({
  context,
  taskType,
  additionalParams
}: {
  context: string;
  taskType: 'drills' | 'labs' | 'homework' | 'exams';
  additionalParams?: any;
}): any[] {
  const primaryLanguage = additionalParams?.primaryLanguage || 'English';
  const secondaryLanguage = additionalParams?.secondaryLanguage || 'none';
  const hasSecondaryLanguage = secondaryLanguage !== 'none';

  const baseSystemPrompt = `You are an expert AI Teaching Assistant designed to help instructors create high-quality, academic curriculum materials.
Your goal is to analyze the provided course context (files, text) and generate specific educational artifacts.
You must always output VALID JSON. Do not include markdown formatting (like \`\`\`json) in your response, just the raw JSON object.

LANGUAGE REQUIREMENTS:
- PRIMARY language: ${primaryLanguage}
${hasSecondaryLanguage ? `- Generate content ONLY in PRIMARY language (${primaryLanguage}). Secondary language will be automatically translated.` : '- Generate content only in the primary language'}`;

  let specificPrompt = '';
  let jsonFormat = '';

  // Common instruction for all task types
  const sourcesInstruction = `\n\nIMPORTANT: For each question/problem, you MUST cite the source materials:
- Include a "sources" array with objects containing "file" (the filename from context) and "pages" (relevant page numbers or slide numbers if known)
- Example: "sources": [{"file": "Lecture1.pdf", "pages": "10-12"}, {"file": "Chapter3.pptx", "pages": "Slide 5-7"}]
- If you cannot determine specific pages, still cite the file: {"file": "Lecture1.pdf", "pages": ""}`;

  switch (taskType) {
    case 'drills':
      // Build type distribution string from typeCounts
      const typeCounts = additionalParams?.typeCounts || {};
      const typeDistribution = Object.entries(typeCounts)
        .filter(([_, count]) => (count as number) > 0)
        .map(([type, count]) => `- ${count} "${type}" question(s)`)
        .join('\n');
      
      const typeInstruction = typeDistribution 
        ? `\n\nQUESTION TYPE DISTRIBUTION (MUST FOLLOW EXACTLY):\n${typeDistribution}\n\nYou MUST generate EXACTLY these counts for each type. Do NOT generate types that have 0 count.`
        : '';
      
      specificPrompt = `Task: Create ${additionalParams?.numberOfQuestions || 5} in-class drill questions based on the provided context.
Drills should focus on key concepts and be suitable for a "Think-Pair-Share" or quick check-in.
For each question, identify the Concept it tests, a Reference (if applicable), the Question text, and a detailed Solution/Answer.${sourcesInstruction}${typeInstruction}

IMPORTANT - Each drill MUST include:
- "concept_name": A SHORT descriptive title (2-5 words) summarizing what the drill tests (e.g., "List Slicing Basics", "Dictionary Lookup")
- "format": The question type - MUST match one of the types specified in the distribution above
- CRITICAL: If format is "multiple_choice", you MUST ALWAYS include an "options" array with exactly 4 string choices (A, B, C, D). This field is REQUIRED and cannot be omitted. The "solution" should state which option is correct (e.g., "B" or "Option B").
- If format is "trace": The "question" field should contain the code to trace, wrapped in a code block format.
- If format is "short_answer": The "question" field should contain clear instructions, not code blocks.`;
      jsonFormat = hasSecondaryLanguage 
        ? `{ "drills": [ { "number": number, "concept_name": "string (SHORT title, 2-5 words)", "format": "coding|trace|debugging|multiple_choice|short_answer", "points": number, "question": "string", "options": ["string", "string", "string", "string"] (REQUIRED if format is multiple_choice, must have exactly 4 options), "solution": "string", "solution_explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }
NOTE: *_secondary fields (question_secondary, solution_secondary, etc.) will be automatically translated - you do NOT need to generate them.`
        : `{ "drills": [ { "number": number, "concept_name": "string (SHORT title, 2-5 words)", "format": "coding|trace|debugging|multiple_choice|short_answer", "points": number, "question": "string", "options": ["string", "string", "string", "string"] (REQUIRED if format is multiple_choice, must have exactly 4 options), "solution": "string", "solution_explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }`;
      break;

    case 'labs':
      specificPrompt = `Task: Design a lab experiment worksheet based on the provided context.
The lab should take approximately ${additionalParams?.minutesPerProblem || 60} minutes per problem.
Include ${additionalParams?.numberOfProblems || 3} distinct problems/tasks.
Structure:
1. Title & Objective
2. Equipment/Prerequisites
3. Step-by-step Problems (with code stubs if coding lab, or procedure if science lab)
4. Verification/Solution for the instructor.${sourcesInstruction}

IMPORTANT - Each problem MUST include:
- "problem_number": Sequential number starting from 1
- "problem_type": The type of problem - one of: "coding", "analysis", "design", "research", "experiment"
- "estimated_time": Approximate minutes to complete this problem
- If problem_type is "coding": Include complete, runnable code in the solution`;
      jsonFormat = hasSecondaryLanguage
        ? `{ "problems": [ { "problem_number": number, "problem_type": "coding|analysis|design|research|experiment", "estimated_time": number, "title": "string", "description": "string", "requirements": ["string"], "hints": ["string"], "solution": "string", "solution_explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }
NOTE: *_secondary fields (title_secondary, description_secondary, etc.) will be automatically translated - you do NOT need to generate them.`
        : `{ "problems": [ { "problem_number": number, "problem_type": "coding|analysis|design|research|experiment", "estimated_time": number, "title": "string", "description": "string", "hints": ["string"], "solution": "string", "sources": [{"file": "string", "pages": "string"}] } ] }`;
      break;

    case 'homework':
      // Build type distribution from typeCounts (same as drills)
      const hwTypeCounts = additionalParams?.typeCounts || {};
      const hwAllowedTypes = additionalParams?.allowedTypes || ['coding', 'short_answer', 'calculation', 'analysis'];
      const hwTypeDistribution = Object.entries(hwTypeCounts)
        .filter(([_, count]) => (count as number) > 0)
        .map(([type, count]) => `- ${count} "${type}" question(s)`)
        .join('\n');
      
      const hwTypeInstruction = hwTypeDistribution 
        ? `\n\nQUESTION TYPE DISTRIBUTION (MUST FOLLOW EXACTLY):\n${hwTypeDistribution}\n\nYou MUST generate EXACTLY these counts for each type. Do NOT generate types with 0 count. ONLY use these allowed types: ${hwAllowedTypes.join(', ')}.`
        : `\n\nONLY use these allowed question types: ${hwAllowedTypes.join(', ')}.`;
      
      specificPrompt = `Task: Generate a homework assignment based on ${additionalParams?.selectedChapters?.length > 0 ? `Chapter(s): ${additionalParams.selectedChapters.join(', ')}` : 'the entire context'}.
Create ${additionalParams?.numberOfProblems || 5} problems.
Include a grading rubric or points breakdown.${sourcesInstruction}${hwTypeInstruction}

IMPORTANT - Each problem MUST include:
- "number": Sequential number starting from 1
- "question_type": MUST be one of the allowed types above
- If question_type is "coding": Include complete, runnable code in the solution`;
      jsonFormat = hasSecondaryLanguage
        ? `{ "problems": [ { "number": number, "question_type": "string", "title": "string", "description": "string", "requirements": ["string"], "points": number, "solution": "string", "solution_explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }
NOTE: *_secondary fields (title_secondary, description_secondary, etc.) will be automatically translated - you do NOT need to generate them.`
        : `{ "problems": [ { "number": number, "question_type": "string", "title": "string", "description": "string", "points": number, "solution": "string", "sources": [{"file": "string", "pages": "string"}] } ] }`;
      break;

    case 'exams':
      // Build type distribution from typeCounts
      const examTypeCounts = additionalParams?.typeCounts || {};
      const examAllowedTypes = additionalParams?.allowedTypes || ['multiple_choice', 'short_answer', 'coding'];
      const examTypeDistribution = Object.entries(examTypeCounts)
        .filter(([_, count]) => (count as number) > 0)
        .map(([type, count]) => `- ${count} "${type}" question(s)`)
        .join('\n');
      
      const examTypeInstruction = examTypeDistribution 
        ? `\n\nQUESTION TYPE DISTRIBUTION (MUST FOLLOW EXACTLY):\n${examTypeDistribution}\n\nYou MUST generate EXACTLY these counts for each type. Do NOT generate types with 0 count.`
        : `\n\nUse these question types: ${examAllowedTypes.join(', ')}.`;
      
      specificPrompt = `Task: Create a balanced exam with ${additionalParams?.numberOfQuestions || 10} questions based on the provided context.
Total Score: ${additionalParams?.totalScore || 100}.
Selected Chapters: ${additionalParams?.selectedChapters?.join(', ') || 'All'}.${sourcesInstruction}${examTypeInstruction}

IMPORTANT - Each question MUST include:
- "number": Sequential number starting from 1
- "title": A short descriptive title for the question
- "type": The question type
- "chapter": The chapter the question is from`;
      jsonFormat = hasSecondaryLanguage
        ? `{ "questions": [ { "number": number, "title": "string", "type": "string", "chapter": "string", "points": number, "question": "string", "options": ["string"] (if MC), "answer": "string", "explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }
NOTE: *_secondary fields (title_secondary, question_secondary, answer_secondary, etc.) will be automatically translated - you do NOT need to generate them.`
        : `{ "questions": [ { "number": number, "title": "string", "type": "string", "chapter": "string", "points": number, "question": "string", "options": ["string"] (if MC), "answer": "string", "explanation": "string", "sources": [{"file": "string", "pages": "string"}] } ] }`;
      break;
  }

  const template = (promptTemplates as any)[taskType];
  const addonSystem = template?.system || '';
  const addonUser = template?.user || '';

  return [
    {
      role: 'system',
      content: `${baseSystemPrompt}\n\nRequired JSON Output Format:\n${jsonFormat}${addonSystem ? `\n\n${addonSystem}` : ''}`
    },
    {
      role: 'user',
      content: `Context:\n${context.substring(0, 50000)}\n\n---\n\n${specificPrompt}${addonUser ? `\n\n${addonUser}` : ''}${hasSecondaryLanguage ? `\n\nIMPORTANT: Generate content ONLY in ${primaryLanguage}. Secondary language (${secondaryLanguage}) will be automatically translated from your primary language content.` : ''}`
    }
  ];
}

export function buildRegeneratePrompt({
  context,
  taskType,
  item,
  additionalParams
}: {
  context: string;
  taskType: 'drills' | 'labs' | 'homework' | 'exams';
  item: any;
  additionalParams?: any;
}): any[] {
  const template = (promptTemplates as any)[taskType];
  const addonSystem = template?.system || '';
  const addonUser = template?.user || '';

  const primaryLanguage = additionalParams?.primaryLanguage || 'English';
  const secondaryLanguage = additionalParams?.secondaryLanguage || 'none';

  const baseSystemPrompt = `You are an expert AI Teaching Assistant. You must regenerate a SINGLE item based on the provided context and original item.
You must always output VALID JSON. Do not include markdown formatting (like \`\`\`json) in your response, just the raw JSON object.`;

  let specificPrompt = '';
  let jsonFormat = '';

  switch (taskType) {
    case 'drills':
      const originalFormat = item?.format || '';
      const isMultipleChoice = String(originalFormat).toLowerCase() === 'multiple_choice';
      const optionsRequirement = isMultipleChoice 
        ? '\n\nCRITICAL: Since format is "multiple_choice", you MUST include an "options" array with exactly 4 string choices (A, B, C, D). This field is REQUIRED and cannot be omitted. Also include "options_secondary" array with 4 translated choices.'
        : '';
      specificPrompt = `Task: Regenerate this single drill question based on the provided context.
Keep the same concept or improve it. Generate content ONLY in PRIMARY language (${primaryLanguage}). Secondary language will be automatically translated.
Original item: ${JSON.stringify(item, null, 2).substring(0, 3000)}${optionsRequirement}`;
      jsonFormat = isMultipleChoice
        ? `{ "concept_name": "string", "format": "multiple_choice", "question": "string", "options": ["string", "string", "string", "string"] (REQUIRED - exactly 4 options), "solution": "string", "solution_explanation": "string", "number": number, "points": number, "sources": [{"file": "string", "pages": "string"}] }`
        : `{ "concept_name": "string", "format": "string", "question": "string", "solution": "string", "solution_explanation": "string", "number": number, "points": number, "sources": [{"file": "string", "pages": "string"}] }`;
      break;

    case 'labs':
      specificPrompt = `Task: Regenerate this single lab problem based on the provided context.
Improve clarity and completeness. Generate content ONLY in PRIMARY language (${primaryLanguage}). Secondary language will be automatically translated.
Original item: ${JSON.stringify(item, null, 2).substring(0, 3000)}`;
      jsonFormat = `{ "title": "string", "description": "string", "hints": ["string"], "solution": "string", "number": number, "points": number, "sources": [{"file": "string", "pages": "string"}] }`;
      break;

    case 'homework':
      specificPrompt = `Task: Regenerate this single homework question based on the provided context.
Improve clarity and difficulty appropriateness. Generate content ONLY in PRIMARY language (${primaryLanguage}). Secondary language will be automatically translated.
Original item: ${JSON.stringify(item, null, 2).substring(0, 3000)}`;
      jsonFormat = `{ "question": "string", "solution": "string", "explanation": "string", "number": number, "points": number, "type": "string", "sources": [{"file": "string", "pages": "string"}] }`;
      break;

    case 'exams':
      specificPrompt = `Task: Regenerate this single exam question based on the provided context.
Maintain appropriate difficulty and clarity. Generate content ONLY in PRIMARY language (${primaryLanguage}). Secondary language will be automatically translated.
Original item: ${JSON.stringify(item, null, 2).substring(0, 3000)}`;
      jsonFormat = `{ "number": number, "title": "string", "type": "string", "chapter": "string", "points": number, "question": "string", "options": ["string"] (if MC), "answer": "string", "explanation": "string", "sources": [{"file": "string", "pages": "string"}] }`;
      break;
  }

  return [
    {
      role: 'system',
      content: `${baseSystemPrompt}\n\nRequired JSON Output Format:\n${jsonFormat}${addonSystem ? `\n\n${addonSystem}` : ''}`
    },
    {
      role: 'user',
      content: `Context:\n${context.substring(0, 30000)}\n\n---\n\n${specificPrompt}${addonUser ? `\n\n${addonUser}` : ''}`
    }
  ];
}

export function buildSecondaryFixPrompt({
  taskType,
  primaryLanguage,
  secondaryLanguage,
  item
}: {
  taskType: 'drills' | 'labs' | 'homework' | 'exams';
  primaryLanguage: string;
  secondaryLanguage: string;
  item: any;
}): any[] {
  const baseSystemPrompt = `You are an expert translator for educational content. The secondary language fields in the provided item are missing or incorrect.
You must translate ALL fields from PRIMARY language (${primaryLanguage}) to SECONDARY language (${secondaryLanguage}).
You must always output VALID JSON. Do not include markdown formatting (like \`\`\`json) in your response, just the raw JSON object.`;

  let jsonFormat = '';

  switch (taskType) {
    case 'drills':
      jsonFormat = `{ "question_secondary": "string", "solution_secondary": "string", "solution_explanation_secondary": "string" }`;
      break;
    case 'labs':
      jsonFormat = `{ "title_secondary": "string", "description_secondary": "string", "hints_secondary": ["string"], "solution_secondary": "string" }`;
      break;
    case 'homework':
      jsonFormat = `{ "question_secondary": "string", "solution_secondary": "string", "explanation_secondary": "string" }`;
      break;
    case 'exams':
      jsonFormat = `{ "question_secondary": "string", "solution_secondary": "string", "explanation_secondary": "string" }`;
      break;
  }

  return [
    {
      role: 'system',
      content: `${baseSystemPrompt}\n\nRequired JSON Output Format:\n${jsonFormat}`
    },
    {
      role: 'user',
      content: `Item to translate (translate ALL *_secondary fields from PRIMARY to SECONDARY language):\n${JSON.stringify(item, null, 2).substring(0, 8000)}\n\nPRIMARY language: ${primaryLanguage}\nSECONDARY language: ${secondaryLanguage}\n\nOnly output the JSON with the *_secondary fields correctly translated.`
    }
  ];
}

export async function generateContent(
  _client: OpenAI, // Unused in proxy mode
  _model: string, // Unused, we use config
  messages: any[],
  config: LLMConfig
): Promise<any> {
  if (!config) {
    throw new Error("Configuration missing for API proxy call");
  }

  try {
    const response = await fetch('/api/proxy-llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.model,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error calling Generate API:", error);
    throw error;
  }
}
