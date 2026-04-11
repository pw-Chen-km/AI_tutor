/**
 * Solution Generator Skill
 * 
 * Generates solution and explanation for a given question.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';
import { QUESTION_TYPE_SPECS } from './question-type-specs';

function stripCodeFences(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const fencedMatch = raw.match(/```[A-Za-z0-9_-]*\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return raw
    .replace(/^```[A-Za-z0-9_-]*\s*/g, '')
    .replace(/\s*```$/g, '')
    .trim();
}

function looksLikeCode(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (raw.includes('```')) return true;

  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  let score = 0;
  for (const line of lines) {
    if (/^(def|class|return|if|elif|else|for|while|try|except|with|import|from)\b/.test(line)) score += 2;
    if (/^(function|const|let|var|public|private|protected)\b/.test(line)) score += 2;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+/.test(line)) score += 1;
    if (/[{};]$/.test(line)) score += 1;
    if (/[()[\]:]/.test(line)) score += 1;
  }

  return score >= 3;
}

function normalizeCodingSolutionPayload(payload: any, questionType: string): any {
  if (questionType !== 'coding' && questionType !== 'debugging') {
    return payload;
  }

  const content = payload && typeof payload === 'object' ? { ...payload } : {};
  const rawSolution = typeof content.solution === 'string' ? content.solution : '';
  const rawCode = typeof content.code === 'string' ? content.code : '';
  const normalizedCode = stripCodeFences(rawCode || rawSolution);
  const solutionLooksLikeCode = looksLikeCode(rawSolution);
  const codeLooksLikeCode = looksLikeCode(rawCode);

  if (codeLooksLikeCode || solutionLooksLikeCode) {
    content.code = normalizedCode;
    content.solution = normalizedCode;
  } else {
    content.code = '';
    content.solution = '';
  }

  if (!content.explanation || !String(content.explanation).trim()) {
    if (rawSolution && !solutionLooksLikeCode) {
      content.explanation = rawSolution.trim();
    }
  } else {
    content.explanation = String(content.explanation).trim();
  }

  return content;
}

export class SolutionGeneratorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'solution_generator',
    description: 'Generate solution and explanation for a given question',
    category: 'content_generation',
    version: '1.0.0',
    estimatedTokens: 800,
    requiredInputs: ['question', 'questionType'],
    optionalInputs: ['context', 'hints', 'detailLevel', 'pdfFileData', 'pdfFilename'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    this.log('info', `Generating solution for ${input.questionType} question`);

    try {
      const { question, questionType, context: additionalContext, hints, detailLevel } = input;
      const pdfFileData = typeof input.pdfFileData === 'string' ? input.pdfFileData : '';
      const pdfFilename = typeof input.pdfFilename === 'string' ? input.pdfFilename : '';
      const hasDirectPdfAttachment = Boolean(pdfFileData && pdfFilename);

      // Get question type specific solution requirements
      const spec = QUESTION_TYPE_SPECS[questionType];
      let solutionGuidelines = '';
      
      if (spec) {
        solutionGuidelines = `
Question Type: ${spec.label}
Solution Requirements:
${spec.requirements.map(r => `- ${r}`).join('\n')}

For ${questionType} questions, ensure:
- Solution matches the question type structure
- All requirements from the question are addressed
- Step-by-step approach is clear and logical`;
      }

      // Type-specific solution format
      let solutionFormat = '';
      if (questionType === 'multiple_choice') {
        solutionFormat = `
- "solution": "The correct answer (e.g., 'Option A')"
- "explanation": "Why this answer is correct AND why other options are incorrect"`;
      } else if (questionType === 'coding' || questionType === 'debugging') {
        solutionFormat = `
- "solution": "ONLY the final code answer as plain code text, with no prose before or after it"
- "code": "The same final code answer again as plain code text (required for coding/debugging questions)"
- "explanation": "Short prose explanation of the code logic and key steps"`; 
      } else if (questionType === 'calculation' || questionType === 'proof' || questionType === 'derivation') {
        solutionFormat = `
- "solution": "Complete step-by-step solution with all calculations/proof steps"
- "explanation": "Explanation of each step and the reasoning behind it"`;
      } else {
        solutionFormat = `
- "solution": "The complete answer/solution"
- "explanation": "Step-by-step explanation of how to arrive at the solution"`;
      }

      // Determine solution complexity based on question context
      // Extract module type from context if available
      const moduleType = (additionalContext?.match(/taskType[:\s]+(drills|labs|homework|exams)/i) || [])[1] || '';
      const isDrills = moduleType.toLowerCase() === 'drills';
      
      const complexityGuidance = isDrills 
        ? `CRITICAL FOR DRILLS: Keep the solution SIMPLE and CONCISE. Focus on the essential steps only. Avoid overly detailed explanations or complex multi-step reasoning. Students need quick reinforcement, not comprehensive tutorials.`
        : detailLevel === 'concise'
        ? 'Keep the solution concise but complete.'
        : 'Provide a comprehensive solution with detailed explanations.';
      const sourceEvidenceGuidance = hasDirectPdfAttachment
        ? `PDF SOURCE HANDLING:
- A sampled PDF is attached for this question.
- Treat the attached PDF as the primary source of truth.
- Use the additional text context and teacher contract only as supporting guidance.
- If diagrams, tables, screenshots, or layout matter, resolve them from the attached PDF instead of guessing.`
        : '';
      const teacherContractGuidance =
        hints && typeof hints === 'object' && typeof hints.teacher_contract === 'string' && hints.teacher_contract.trim()
          ? `Follow this teacher contract exactly:
${hints.teacher_contract.trim()}`
          : '';

      const messages = [
        {
          role: 'system',
          content: `You are an expert educator providing solutions to student questions.

Task: Generate a complete solution with explanation for the given ${questionType} question.

${solutionGuidelines}

General Requirements:
- Provide a clear, step-by-step solution
- Explain the reasoning behind each step
- Detail level: ${detailLevel || 'comprehensive'}
- For coding questions: include clean, well-commented code
- For multiple choice: explain why the correct answer is right AND why others are wrong
- For calculations: show all intermediate steps
- For proofs: provide logical progression with clear reasoning
- For coding/debugging questions: the "solution" field MUST be code, not prose.
- For coding/debugging questions: put all natural-language explanation in "explanation", not in "solution".
- For coding/debugging questions: if you provide both "solution" and "code", they must contain the same final code.
- For coding/debugging questions: do not say "Here is the code" or describe the approach inside the "solution" field.

${complexityGuidance}
${sourceEvidenceGuidance ? `\n\n${sourceEvidenceGuidance}` : ''}
${teacherContractGuidance ? `\n\n${teacherContractGuidance}` : ''}

- Never invent hidden requirements, extra rules, or unsupported assumptions.
- If the provided evidence does not support a claim, do not guess.
- For debugging questions, fix only objective behavior violations supported by the prompt/source.
- For labs, preserve the stated deliverable, requirements, and scope.

⚠️ CRITICAL: You MUST output ONLY valid JSON. No markdown, no code fences, no explanations, no additional text.
Output ONLY this JSON structure:
{
  ${solutionFormat}
  "key_points": ["string (main concepts covered)"],
  "common_mistakes": ["string (common errors students might make)"]
}`
        },
        {
          role: 'user',
          content: `Question: ${question}\n\n${additionalContext ? `Additional context: ${additionalContext}\n\n` : ''}${hints ? `Hints provided: ${JSON.stringify(hints)}\n\n` : ''}Generate the solution now. ${isDrills ? 'Remember: Keep it SIMPLE and CONCISE for drills.' : ''} Return ONLY valid JSON, no other text.`
        }
      ];

      const { content, tokensUsed } = await this.callLLM(messages, context, {
        pdfFileData: pdfFileData || undefined,
        pdfFilename: pdfFilename || undefined,
      });
      const normalizedContent = normalizeCodingSolutionPayload(content, questionType);

      this.log('info', `Solution generated successfully`);
      
      return this.success(normalizedContent, tokensUsed, {
        questionType,
      });

    } catch (error: any) {
      this.log('error', 'Failed to generate solution', error);
      return this.error(error.message || 'Failed to generate solution');
    }
  }
}



