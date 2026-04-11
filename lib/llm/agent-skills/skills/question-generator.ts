/**
 * Question Generator Skill
 * 
 * Generates a single question based on context and constraints.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';
import promptTemplates from '../../prompt-templates.json';
import { calculateDifficulty, getQuestionTypeGuidelines, getQuestionTypePromptAddendum } from './question-type-specs';

function sanitizeMultipleChoiceOption(option: any): string {
  let text = String(option ?? '').trim();
  if (!text) return '';

  text = text
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[A-Da-d][\)\.\:\-]\s*/g, '')
    .replace(/^Option\s+[A-Da-d][\)\.\:\-]\s*/i, '')
    .trim();

  return text;
}

function normalizeMultipleChoiceAnswer(value: any, options: string[]): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const letterMatch = raw.match(/\b([A-D])\b/i);
  if (letterMatch?.[1]) {
    return letterMatch[1].toUpperCase();
  }

  const cleaned = sanitizeMultipleChoiceOption(raw);
  const optionIndex = options.findIndex((option) => option === cleaned);
  return optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : '';
}

function normalizeQuestionPayload(payload: any, questionType: string): any {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const normalized = { ...payload };
  if (questionType !== 'multiple_choice') {
    return normalized;
  }

  const normalizedOptions = Array.isArray(normalized.options)
    ? normalized.options.map((option: any) => sanitizeMultipleChoiceOption(option)).filter(Boolean)
    : [];

  const normalizedCorrectOptionText = sanitizeMultipleChoiceOption(normalized.correct_option_text || '');
  let normalizedCorrectAnswer = normalizeMultipleChoiceAnswer(normalized.correct_answer, normalizedOptions);

  if (!normalizedCorrectAnswer && normalizedCorrectOptionText) {
    normalizedCorrectAnswer = normalizeMultipleChoiceAnswer(normalizedCorrectOptionText, normalizedOptions);
  }

  const derivedCorrectOptionText =
    normalizedCorrectOptionText ||
    (normalizedCorrectAnswer
      ? normalizedOptions[normalizedCorrectAnswer.charCodeAt(0) - 65] || ''
      : '');

  normalized.options = normalizedOptions;
  normalized.correct_answer = normalizedCorrectAnswer;
  normalized.correct_option_text = derivedCorrectOptionText;
  normalized.explanation = typeof normalized.explanation === 'string' ? normalized.explanation.trim() : '';

  return normalized;
}

function buildQuestionShapeGuidance(questionType: string): string {
  const guidance: Record<string, string> = {
    multiple_choice: `QUESTION SHAPE:
- Put only the stem in the "question" field.
- Put all four options in the "options" array and nowhere else.
- Store option text only. Do not include "A)", "B)", etc. inside the option strings.
- Include a correct-answer key and a short explanation aligned to that answer.
- Make the stem answerable without extra unstated assumptions.`,
    fill_in_blank: `QUESTION SHAPE:
- Use a single clearly marked blank such as "_____".
- Keep the missing answer short and objectively recoverable from the prompt.
- Do not create a blank with multiple equally reasonable completions.`,
    short_answer: `QUESTION SHAPE:
- Ask for one bounded explanation, comparison, justification, or identification.
- Make the intended response scope fit 1-3 short sentences.
- Do not ask for an essay or open-ended discussion.`,
    calculation: `QUESTION SHAPE:
- State the givens, units, and target quantity explicitly.
- Make the expected answer form clear, including units or rounding if relevant.
- Avoid hidden constants or implied formulas not supported by context.`,
    proof: `QUESTION SHAPE:
- State the exact proposition to prove.
- Include any assumptions, allowed methods, or starting facts needed.
- Make the proof target formal enough that completion is unambiguous.`,
    derivation: `QUESTION SHAPE:
- State the starting expression and the target expression explicitly.
- Frame the task as deriving one from the other.
- Keep the task focused on transformation, not open-ended proof.`,
    coding: `QUESTION SHAPE:
- Define the function or program contract explicitly.
- State inputs, outputs, invalid-case behavior, and 2-3 concrete requirements.
- Include example calls, sample I/O, or edge cases when needed to remove ambiguity.`,
    debugging: `QUESTION SHAPE:
- Include an "Expected behavior" section before the buggy code.
- Then include the faulty code and a focused debugging task.
- Every bug described must violate a stated requirement, not a style preference or design opinion.`,
    trace: `QUESTION SHAPE:
- Include the exact input or initial state.
- Ask for the final output, exact trace, or specific state transitions.
- Keep the target of the trace explicit and deterministic.`,
    design: `QUESTION SHAPE:
- State a concrete deliverable such as API design, data model, module structure, or algorithm plan.
- Include explicit requirements and constraints.
- Require trade-off reasoning tied to those constraints.`,
    data_analysis: `QUESTION SHAPE:
- Give enough data description or observed values to support the requested analysis.
- State whether students should describe, compare, infer, predict, or recommend.
- Keep the requested conclusion bounded and evidence-based.`,
    case_study: `QUESTION SHAPE:
- Present only decision-relevant scenario facts.
- Ask one main judgment question with at most a small number of tightly related sub-questions.
- State the evaluation lens explicitly.`,
  };

  return guidance[questionType] || `QUESTION SHAPE:
- Make the task self-contained, objective, and gradeable.
- Keep the expected answer aligned with the prompt.`;
}

function buildQuestionSelfCheck(questionType: string): string {
  const checks: Record<string, string[]> = {
    multiple_choice: [
      'Exactly one option is defensibly correct.',
      'Each distractor is plausible but clearly incorrect.',
      'The correct answer does not depend on teacher interpretation.',
      'The explanation supports the same option named in the answer key.',
    ],
    fill_in_blank: [
      'There is one canonical answer or one tightly controlled acceptable set.',
      'The blank cannot be solved by syntax alone.',
      'Context removes ambiguity.',
    ],
    short_answer: [
      'A grader could score the answer using a small finite set of key points.',
      'The prompt is bounded rather than essay-like.',
      'The required depth is obvious from the wording.',
    ],
    calculation: [
      'All givens and assumptions needed for the computation are explicit.',
      'The final answer form is clear.',
      'A reasonable student would follow one intended solution path.',
    ],
    proof: [
      'The theorem statement is formal and complete.',
      'No unstated lemma is required.',
      'The task is genuinely a proof task, not a derivation or explanation task.',
    ],
    derivation: [
      'The starting point and target are explicit.',
      'Needed identities or assumptions are available from context.',
      'The task is a derivation, not a proof-by-opinion.',
    ],
    coding: [
      'The function/program contract is explicit.',
      'Invalid input and edge-case behavior are defined.',
      'Correctness can be judged without relying on style preference.',
    ],
    debugging: [
      'Expected behavior is defined before calling anything a bug.',
      'Each bug is an objective contract violation.',
      'No design-choice or style issue is mislabeled as a bug.',
    ],
    trace: [
      'The exact input and trace target are explicit.',
      'The code path is deterministic.',
      'There is one unambiguous final trace result.',
    ],
    design: [
      'A concrete deliverable is requested.',
      'Constraints are strong enough to force trade-offs.',
      'Answers can be compared against explicit evaluation criteria.',
    ],
    data_analysis: [
      'The requested inference is supported by the supplied data.',
      'Observation and interpretation are not conflated.',
      'The analysis goal is explicit.',
    ],
    case_study: [
      'The scenario contains enough facts to defend a best answer.',
      'The main decision question is bounded.',
      'The evaluation lens is explicit.',
    ],
  };

  const selectedChecks = checks[questionType] || [
    'The task is self-contained.',
    'The grading target is objective.',
    'A grader can defend the official answer from the prompt alone.',
  ];

  return `Before finalizing the JSON, silently verify:
${selectedChecks.map((check) => `- ${check}`).join('\n')}`;
}

function buildQuestionSchemaAddendum(questionType: string): string {
  const schemaByType: Record<string, string> = {
    multiple_choice: `  "options": ["Clear option text", "Clear option text", "Clear option text", "Clear option text"],
  "correct_answer": "A",
  "correct_option_text": "Clear option text",
  "explanation": "Brief explanation of why the correct answer is right and why the distractors are wrong",
  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "answer_check": {
      "single_correct_answer": true,
      "correct_answer": "A",
      "distractor_focus": ["string", "string", "string"]
    }
  }`,
    fill_in_blank: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "answer_check": {
      "canonical_answer": "string",
      "accepted_answers": ["string"]
    }
  }`,
    short_answer: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "grading_focus": ["string", "string", "string"]
  }`,
    calculation: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "givens": ["string", "string"],
    "target_quantity": "string",
    "answer_form": "string"
  }`,
    proof: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "claim_to_prove": "string",
    "allowed_methods": ["string"]
  }`,
    derivation: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "starting_expression": "string",
    "target_expression": "string"
  }`,
    coding: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "function_contract": {
      "inputs": ["string", "string"],
      "output": "string",
      "invalid_input_behavior": "string"
    },
    "requirements": ["string", "string", "string"],
    "examples": ["string", "string"]
  }`,
    debugging: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "expected_behavior": ["string", "string"],
    "bug_focus": ["logic error", "edge case", "exception handling"],
    "design_note": "Only contract violations count as bugs."
  }`,
    trace: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "initial_state": "string",
    "trace_target": "string"
  }`,
    design: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "requirements": ["string", "string"],
    "constraints": ["string", "string"],
    "evaluation_dimensions": ["string", "string"]
  }`,
    data_analysis: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "analysis_goal": "string",
    "evidence_focus": ["string", "string"]
  }`,
    case_study: `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"],
    "decision_focus": "string",
    "evaluation_lens": ["string", "string"]
  }`,
  };

  return schemaByType[questionType] || `  "metadata": {
    "estimated_time": number,
    "key_concepts": ["string"]
  }`;
}

function buildQuestionGenerationProtocol(questionType: string): string {
  const protocolByType: Record<string, string> = {
    coding: `GENERATION PROTOCOL FOR CODING:
1. Identify one specific concept from the context.
2. Define a function or program contract before writing the task.
3. State invalid-input or edge-case behavior if relevant.
4. Add 2-3 concrete behavioral requirements.
5. Ensure the task is judged by correctness, not coding style preference.`,
    debugging: `GENERATION PROTOCOL FOR DEBUGGING:
1. Identify one specific concept from the context.
2. Write expected behavior first.
3. Then write faulty code that violates that behavior.
4. Make the debugging target objective and reproducible.
5. Do not convert API design ambiguity or style preference into a bug.`,
    trace: `GENERATION PROTOCOL FOR TRACE:
1. Fix the input or initial state explicitly.
2. Choose one deterministic mechanism to trace.
3. Ask for one exact output or trace result.
4. Avoid ambiguity about execution order or runtime behavior.`,
    calculation: `GENERATION PROTOCOL FOR CALCULATION:
1. State givens and assumptions explicitly.
2. Choose one intended solution path for the student level.
3. State the target quantity and answer form.
4. Avoid hidden conversions or unstated formulas.`,
  };

  return protocolByType[questionType] || `GENERATION PROTOCOL:
1. Identify one specific concept from the context.
2. Turn it into a bounded, objective task.
3. Remove hidden assumptions before finalizing the question.`;
}

export class QuestionGeneratorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'question_generator',
    description: 'Generate a single question based on context, type, and difficulty',
    category: 'content_generation',
    version: '1.0.0',
    estimatedTokens: 600,
    requiredInputs: ['context', 'taskType', 'questionType'],
    optionalInputs: ['difficulty', 'constraints', 'timeLimit', 'points'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    this.log('info', `Generating ${input.questionType} question for ${input.taskType}`);

    try {
      const { context: userContext, taskType, questionType, difficulty: providedDifficulty, constraints, timeLimit, points } = input;
      const pdfFileData = typeof (input as any).pdfFileData === 'string' ? (input as any).pdfFileData : '';
      const pdfFilename = typeof (input as any).pdfFilename === 'string' ? (input as any).pdfFilename : '';
      const hasDirectPdfAttachment = Boolean(pdfFileData && pdfFilename);

      // Calculate difficulty based on module type and time limit if not provided
      const difficulty = providedDifficulty || calculateDifficulty(taskType, timeLimit);

      // Get question type specific guidelines (using new skills)
      const questionTypeGuidelines = getQuestionTypeGuidelines(questionType, difficulty as 'easy' | 'medium' | 'hard', taskType, timeLimit);
      const questionTypePromptAddendum = getQuestionTypePromptAddendum(questionType);
      const questionShapeGuidance = buildQuestionShapeGuidance(questionType);
      const questionSelfCheck = buildQuestionSelfCheck(questionType);
      const questionSchemaAddendum = buildQuestionSchemaAddendum(questionType);
      const questionGenerationProtocol = buildQuestionGenerationProtocol(questionType);

      this.log('info', `Using question type guidelines for ${questionType} (${difficulty} difficulty, ${timeLimit || 'N/A'} min)`);

      // Get task-specific prompt template
      const template = (promptTemplates as any)[taskType];
      const systemAddon = template?.system || '';
      const userAddon = template?.user || '';

      // Extract source file information
      // Priority: 1) selectedFile from taskParams, 2) FILE: markers in context, 3) availableFiles
      const sourceFiles: Array<{ file: string; pages?: string }> = [];
      
      // Check if we have pre-selected sources from orchestrator
      const selectedSources = (input as any).selectedSources;
      const selectedFile = (input as any).selectedFile;
      const selectedPages = (input as any).selectedPages;
      
      if (Array.isArray(selectedSources) && selectedSources.length > 0) {
        for (const s of selectedSources) {
          if (s?.file) {
            sourceFiles.push({ file: s.file, pages: s.pages || undefined });
          }
        }
        this.log('info', `Using pre-selected sources: ${JSON.stringify(sourceFiles)}`);
      } else if (selectedFile) {
        // Use the pre-selected file as the primary source
        sourceFiles.push({ file: selectedFile, pages: selectedPages || undefined });
        this.log('info', `Using pre-selected source file: ${selectedFile} (pages: ${selectedPages || 'N/A'})`);
      } else {
        // Fallback: extract from context FILE: markers
        const fileMatches = userContext.match(/FILE:\s*([^\n]+)/g);
        if (fileMatches) {
          for (const match of fileMatches) {
            const fileName = match.replace(/FILE:\s*/, '').trim();
            if (!sourceFiles.find(s => s.file === fileName)) {
              sourceFiles.push({ file: fileName });
            }
          }
        }
        
        // If still no sources, try availableFiles
        if (sourceFiles.length === 0) {
          const availableFiles = (input as any).availableFiles || [];
          if (Array.isArray(availableFiles) && availableFiles.length > 0) {
            for (const fileName of availableFiles) {
              if (typeof fileName === 'string' && fileName.trim()) {
                sourceFiles.push({ file: fileName.trim() });
              }
            }
          }
        }
      }
      
      // If no sources found, add a placeholder
      if (sourceFiles.length === 0) {
        sourceFiles.push({ file: 'Unknown', pages: 'N/A' });
      }

      // Build JSON schema example string
      const timeEstimate = timeLimit ? String(timeLimit) : 'number matching difficulty level';
      
      // Build a more helpful sources example based on available files
      const sourcesExample = sourceFiles.length > 0 
        ? sourceFiles.slice(0, 2).map(s => `{"file": "${s.file}", "pages": "3-5"}`).join(', ')
        : '{"file": "filename.pdf", "pages": "3-5"}';
      
      const jsonSchemaExample = `{
  "question": "string (the actual question text - this is REQUIRED and must not be empty)",
  "type": "${questionType}",
  "difficulty": "${difficulty}",
  "title": "string (a short descriptive title for this question, e.g., 'List Comprehension' or 'Binary Search')",
  "sources": [${sourcesExample}],
${questionSchemaAddendum.replace(/number/g, timeEstimate).replace(/"string"/g, '"string"')}
}`;

      // Build module-specific guidance
      const moduleGuidance = taskType === 'drills' 
        ? 'Keep solutions SIMPLE - avoid complex multi-step solutions. Focus on quick reinforcement.'
        : taskType === 'labs'
        ? 'Moderate complexity is acceptable for hands-on practice.'
        : taskType === 'homework'
        ? 'Can include deeper analysis and multi-step solutions.'
        : 'Balance complexity with time constraints.';
      const pdfPrimarySourceNote = hasDirectPdfAttachment
        ? `PDF SOURCE HANDLING:
- A sampled PDF is attached for this request.
- Treat the attached PDF as the primary source of truth.
- The extracted text context may be partial or noisy; use it only as supporting metadata for filenames, page markers, and quick navigation.`
        : '';
      const contextLead = hasDirectPdfAttachment
        ? 'SUPPORTING EXTRACTED TEXT FROM THE SAME SELECTED PDF/PAGES (PRIMARY EVIDENCE IS THE ATTACHED PDF):'
        : 'EXACT CONTENT FROM SELECTED FILE PAGES (YOU MUST USE THIS CONTENT ONLY):';

      // Build focused prompt for question generation only
      const messages = [
        {
          role: 'system',
          content: `You are an expert question generator for educational content.
Your task is to generate ONE ${questionType} question for ${taskType} assessment.

${questionTypeGuidelines}
${questionTypePromptAddendum}
${questionShapeGuidance}
${questionGenerationProtocol}

CONSTRAINTS:
- Question type: ${questionType}
- Difficulty: ${difficulty}
${timeLimit ? `- Target time: ${timeLimit} minutes (CRITICAL: Question must be completable within this time. This is a hard constraint - adjust complexity accordingly.)` : ''}
${points ? `- Point value: ${points}` : ''}
${constraints ? `- Additional constraints: ${constraints}` : ''}
${sourceFiles.length > 0 ? `- Source files available: ${sourceFiles.map(s => s.file).join(', ')}` : ''}

MODULE-SPECIFIC COMPLEXITY GUIDELINES:
- drills (in-class drills): Keep solutions SIMPLE and QUICK. Focus on basic understanding, not complex implementations.
- labs: Hands-on practice level - moderate complexity acceptable.
- homework: Deep understanding required - can be more complex.
- exams: Time-constrained - balance complexity with time limit.

${systemAddon}
${pdfPrimarySourceNote ? `\n${pdfPrimarySourceNote}\n` : ''}

⚠️ CRITICAL: You MUST output ONLY valid JSON. No markdown, no code fences, no explanations, no additional text.
Output ONLY this JSON structure:
${jsonSchemaExample}

IMPORTANT: 
- The "question" field MUST contain the actual question text. Do not leave it empty or use placeholders.
- CRITICAL: The question MUST be generated based EXCLUSIVELY on the content provided in the Context. Do NOT generate generic questions or questions from your training data.
- The question MUST be directly related to concepts, examples, or problems found in the uploaded files.
- If a sampled PDF is attached, treat that PDF as the primary source evidence and use the text context only as supporting extraction metadata.
- The "title" field MUST be a short, descriptive name for what this question tests (e.g., "List Comprehension", "Binary Search", "OOP Inheritance"). This is NOT the same as the question text.
- The "metadata.key_concepts" MUST contain the main programming/learning concept being tested.
- Populate type-specific metadata fields when they appear in the schema example. They are part of the contract, not decorative extras.
- Ensure the question complexity matches the ${difficulty} difficulty level for ${taskType} module.
- If timeLimit is ${timeLimit} minutes, ensure the question can be completed within that time.
- Enforce module length guidance: drills 40-120 words, labs 60-160 words, homework 60-150 words, exams 150-260 words.
- MUST include "sources" array with SPECIFIC file and page numbers. 
  * Look for "FILE: filename" markers to identify which file(s) are available.
  * Look for [PAGE: X] markers to identify specific page numbers within each file.
  * Choose ONLY the file(s) that the question is actually based on - do NOT list all available files.
  * For example: {"file": "CH1-final.pdf", "pages": "3-5"} or {"file": "lecture.pptx", "pages": "12"}.
  * NEVER use "N/A" for pages if there are [PAGE: X] markers in the context.
  * If the question is based on content from a PDF file, use that PDF file in sources. If from a PPTX file, use that PPTX file.
- For ${taskType}: ${moduleGuidance}
- The "question" field should contain plain text with proper formatting. Use markdown syntax (e.g., **bold**, *italic*, lists) but DO NOT wrap the entire question in code fences unless it's actually code. Only actual code snippets should be in code blocks.
- CRITICAL FOR MULTIPLE CHOICE: If questionType is "multiple_choice", you MUST include an "options" array with exactly 4 options, a "correct_answer" field containing only A, B, C, or D, a matching "correct_option_text", and an "explanation".
- CRITICAL FOR MULTIPLE CHOICE: Each option string must contain only the option text itself. Do NOT include prefixes like "A)", "B)", or "Option C" inside the option strings. The UI will label them.
- CRITICAL FOR MULTIPLE CHOICE: The "question" field should contain ONLY the question stem—do NOT embed the options inside the question text.
- CRITICAL FOR DEBUGGING: If questionType is "debugging", define expected behavior before showing faulty code. Only label something as a bug if it violates that stated behavior. Do NOT treat design preferences, API redesign choices, or coding style as bugs.
- CRITICAL FOR CODING: If questionType is "coding", define the function or program contract explicitly, including inputs, outputs, and invalid-case behavior whenever relevant.
- CRITICAL FOR FILL IN THE BLANK: If questionType is "fill_in_blank", ensure the blank has one canonical answer or one tightly controlled accepted set. Do NOT create a multi-answer blank.
- CRITICAL FOR TRACE/CALCULATION/PROOF/DERIVATION: state enough givens, assumptions, targets, or starting conditions that a strong student does not need to guess hidden rules.
- CRITICAL FOR LABS: state the concrete deliverable/output students must produce, and include at least 3 objective acceptance requirements when the task is coding, debugging, design, or another hands-on activity.
- CRITICAL FOR DRILLS: keep one main objective only. Avoid hidden sub-parts, vague deliverables, or multi-stage tasks that exceed quick in-class practice.
- CONCISENESS: Keep questions direct and to-the-point. Avoid long stories, excessive context, or verbose preambles. State what is being asked clearly in as few words as possible.
${questionSelfCheck}`
        },
        {
          role: 'user',
          content: `${contextLead}
---BEGIN CONTEXT---
${userContext.substring(0, 8000)}
---END CONTEXT---

${userAddon}

⚠️ ABSOLUTE REQUIREMENTS - FAILURE TO COMPLY WILL RESULT IN REJECTION:

1. YOUR QUESTION MUST BE ABOUT A SPECIFIC TOPIC/CONCEPT THAT APPEARS IN THE CONTEXT ABOVE.
   - Read the context carefully and identify the main topics discussed.
   - Your question MUST test understanding of those specific topics.
   - DO NOT create questions about topics NOT mentioned in the context.
   ${hasDirectPdfAttachment ? '- If the extracted text is incomplete, use the attached PDF pages to resolve missing details before writing the question.' : ''}

2. The "title" field MUST be the specific concept from the context (e.g., if context discusses "Error Types", title should be "Error Types" or similar).

3. Look for [PAGE: X] markers in the context - these indicate page numbers. Use them in your "sources" array.

4. DO NOT generate generic programming questions. The question must reference specific content from the provided context.

5. Make the task objectively gradeable. If the question type is debugging, coding, trace, proof, derivation, or calculation, define enough assumptions so students are not forced to guess hidden rules.

EXAMPLE: If context discusses "Arithmetic Operators" with examples like "5 + 2 = 7", your question should be about arithmetic operators, NOT about loops or functions.

Generate ONE ${questionType} question now based EXCLUSIVELY on the provided source material. Return ONLY valid JSON.`
        }
      ];

      const { content, tokensUsed } = await this.callLLM(messages, context, {
        pdfFileData: pdfFileData || undefined,
        pdfFilename: pdfFilename || undefined,
      });
      const normalizedContent = normalizeQuestionPayload(content, questionType);

      this.log('info', `Question generated successfully`);
      
      return this.success(normalizedContent, tokensUsed, {
        questionType,
        taskType,
      });

    } catch (error: any) {
      this.log('error', 'Failed to generate question', error);
      return this.error(error.message || 'Failed to generate question');
    }
  }
}
