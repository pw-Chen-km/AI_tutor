/**
 * Content Formatter Skill
 * 
 * Formats and structures generated content for specific modules.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class ContentFormatterSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'content_formatter',
    description: 'Format and structure content for specific modules (drills/labs/homework/exams)',
    category: 'content_enhancement',
    version: '1.0.0',
    estimatedTokens: 200,
    requiredInputs: ['content', 'moduleType'],
    optionalInputs: ['includeMetadata'],
  };

  private isCodingLikeType(questionType: any): boolean {
    const normalized = String(questionType || '').toLowerCase();
    return normalized.includes('coding') ||
      normalized.includes('debugging') ||
      normalized.includes('trace') ||
      normalized === 'code';
  }

  private stripCodeFences(text: string): string {
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

  private looksLikeCode(text: string): boolean {
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

  private sanitizeMultipleChoiceOption(option: any): string {
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

  private normalizeMultipleChoiceOptions(options: any): string[] {
    if (!Array.isArray(options)) return [];
    return options
      .map((option: any) => this.sanitizeMultipleChoiceOption(option))
      .filter(Boolean);
  }

  private toStringArray(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item: any) => String(item ?? '').trim())
      .filter(Boolean);
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  private deriveRequirements(content: any, questionData: any): string[] {
    const metadata = questionData?.metadata && typeof questionData.metadata === 'object'
      ? questionData.metadata
      : {};
    const requirements = [
      ...this.toStringArray(content?.requirements),
      ...this.toStringArray(questionData?.requirements),
      ...this.toStringArray(metadata?.requirements),
    ];

    if (metadata?.function_contract && typeof metadata.function_contract === 'object') {
      const inputs = this.toStringArray(metadata.function_contract.inputs);
      const output = String(metadata.function_contract.output || '').trim();
      const invalidInputBehavior = String(metadata.function_contract.invalid_input_behavior || '').trim();

      if (inputs.length > 0) {
        requirements.push(`Input contract: ${inputs.join(', ')}`);
      }
      if (output) {
        requirements.push(`Output contract: ${output}`);
      }
      if (invalidInputBehavior) {
        requirements.push(`Invalid input behavior: ${invalidInputBehavior}`);
      }
    }

    const expectedBehavior = this.toStringArray(metadata?.expected_behavior);
    for (const item of expectedBehavior) {
      requirements.push(`Expected behavior: ${item}`);
    }

    return this.uniqueStrings(requirements);
  }

  private deriveHints(content: any, questionData: any, solutionData: any): string[] {
    const metadata = questionData?.metadata && typeof questionData.metadata === 'object'
      ? questionData.metadata
      : {};

    const hints = [
      ...this.toStringArray(content?.hints),
      ...this.toStringArray(questionData?.hints),
      ...this.toStringArray(solutionData?.key_points),
    ];

    const examples = this.toStringArray(metadata?.examples).slice(0, 2);
    for (const example of examples) {
      hints.push(`Example to anchor the task: ${example}`);
    }

    const gradingFocus = this.toStringArray(metadata?.grading_focus).slice(0, 3);
    if (gradingFocus.length > 0) {
      hints.push(`Focus on: ${gradingFocus.join(', ')}`);
    }

    const evaluationDimensions = this.toStringArray(metadata?.evaluation_dimensions).slice(0, 3);
    if (evaluationDimensions.length > 0) {
      hints.push(`Evaluate against: ${evaluationDimensions.join(', ')}`);
    }

    const evidenceFocus = this.toStringArray(metadata?.evidence_focus).slice(0, 2);
    if (evidenceFocus.length > 0) {
      hints.push(`Use evidence about: ${evidenceFocus.join(', ')}`);
    }

    return this.uniqueStrings(hints);
  }

  private normalizeSolutionFields(params: {
    questionType: any;
    solutionData: any;
    solutionText: string;
    solutionExplanation: string;
  }): { solutionText: string; solutionExplanation: string } {
    const { questionType, solutionData } = params;
    let solutionText = params.solutionText || '';
    let solutionExplanation = params.solutionExplanation || '';

    if (!this.isCodingLikeType(questionType) || !solutionData || typeof solutionData !== 'object') {
      return { solutionText, solutionExplanation };
    }

    const codeCandidate = typeof solutionData.code === 'string' ? this.stripCodeFences(solutionData.code) : '';
    const solutionCandidate = typeof solutionData.solution === 'string' ? this.stripCodeFences(solutionData.solution) : '';
    const chosenCode = codeCandidate || (this.looksLikeCode(solutionCandidate) ? solutionCandidate : '');

    if (chosenCode) {
      if (!solutionExplanation && typeof solutionData.solution === 'string' && !this.looksLikeCode(solutionData.solution)) {
        solutionExplanation = solutionData.solution.trim();
      }
      solutionText = chosenCode;
    }

    return {
      solutionText,
      solutionExplanation,
    };
  }

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    this.log('info', `Formatting content for ${input.moduleType}`);

    try {
      const { content, moduleType, includeMetadata } = input;
      
      // Debug log for troubleshooting
      this.log('info', `Content formatter input:`, {
        moduleType,
        hasQuestion: !!content?.question,
        hasSolution: !!content?.solution,
        contentKeys: content ? Object.keys(content) : [],
        questionType: typeof content?.question,
        solutionType: typeof content?.solution,
      });

      // Format based on module type
      let formatted: any = {};

      switch (moduleType) {
        case 'drills':
          formatted = this.formatForDrills(content, includeMetadata);
          break;
        case 'labs':
          formatted = this.formatForLabs(content, includeMetadata);
          break;
        case 'homework':
          formatted = this.formatForHomework(content, includeMetadata);
          break;
        case 'exams':
          formatted = this.formatForExams(content, includeMetadata);
          break;
        default:
          formatted = content;
      }

      this.log('info', `Content formatted successfully`);
      
      return this.success(formatted, 0, {
        moduleType,
        formattedAt: new Date().toISOString(),
      });

    } catch (error: any) {
      this.log('error', 'Failed to format content', error);
      return this.error(error.message || 'Failed to format content');
    }
  }

  private formatForDrills(content: any, includeMetadata?: boolean): any {
    // First, try to use pre-extracted text from orchestrator (most reliable)
    let questionText = content.questionText || '';
    let solutionText = content.solutionText || '';
    let solutionExplanation = content.solutionExplanation || '';
    
    // If not available, extract from question/solution objects
    const questionData = content.question;
    const solutionData = content.solution;
    
    // Extract question text
    if (!questionText) {
      if (!questionData) {
        this.log('error', 'formatForDrills: questionData is missing', { contentKeys: Object.keys(content) });
      } else if (typeof questionData === 'string') {
        questionText = questionData;
      } else if (questionData && typeof questionData === 'object') {
        // Try multiple possible field names
        questionText = questionData.question 
          || questionData.description 
          || questionData.text
          || questionData.content
          || '';
        
        // If still empty, try to stringify the object (fallback)
        if (!questionText && Object.keys(questionData).length > 0) {
          this.log('warn', 'formatForDrills: questionData object has no recognized text field', {
            questionDataKeys: Object.keys(questionData),
            questionDataSample: JSON.stringify(questionData).substring(0, 200),
          });
          // Last resort: use the first string value found
          for (const key in questionData) {
            if (typeof questionData[key] === 'string' && questionData[key].length > 10) {
              questionText = questionData[key];
              break;
            }
          }
        }
      }
    }
    
    // Extract solution text
    if (!solutionText) {
      if (!solutionData) {
        this.log('error', 'formatForDrills: solutionData is missing', { contentKeys: Object.keys(content) });
      } else if (typeof solutionData === 'string') {
        solutionText = solutionData;
      } else if (solutionData && typeof solutionData === 'object') {
        // Try multiple possible field names
        solutionText = solutionData.solution 
          || solutionData.code 
          || solutionData.answer
          || solutionData.text
          || solutionData.content
          || '';
        if (!solutionExplanation) {
          solutionExplanation = solutionData.explanation 
            || solutionData.reasoning
            || solutionData.notes
            || '';
        }
        
        // If still empty, try to stringify the object (fallback)
        if (!solutionText && Object.keys(solutionData).length > 0) {
          this.log('warn', 'formatForDrills: solutionData object has no recognized text field', {
            solutionDataKeys: Object.keys(solutionData),
            solutionDataSample: JSON.stringify(solutionData).substring(0, 200),
          });
          // Last resort: use the first string value found
          for (const key in solutionData) {
            if (typeof solutionData[key] === 'string' && solutionData[key].length > 10) {
              solutionText = solutionData[key];
              break;
            }
          }
        }
      }
    }

    ({ solutionText, solutionExplanation } = this.normalizeSolutionFields({
      questionType: content.type || questionData?.type || content.questionType,
      solutionData,
      solutionText,
      solutionExplanation,
    }));
    
    // Log for debugging if content is still missing
    if (!questionText || !solutionText) {
      this.log('error', `Missing content in formatForDrills`, {
        questionData: typeof questionData,
        questionText: questionText ? `present (${questionText.length} chars)` : 'missing',
        solutionData: typeof solutionData,
        solutionText: solutionText ? `present (${solutionText.length} chars)` : 'missing',
        contentKeys: Object.keys(content),
        fullContent: JSON.stringify(content).substring(0, 1000),
      });
      // Throw error instead of returning empty content
      throw new Error(`Cannot format drills: missing question or solution text. Question: ${questionText ? 'present' : 'missing'}, Solution: ${solutionText ? 'present' : 'missing'}`);
    }
    
    // Extract options for multiple choice questions
    let options: string[] = [];
    if (Array.isArray(content.options) && content.options.length > 0) {
      options = this.normalizeMultipleChoiceOptions(content.options);
    } else if (questionData && typeof questionData === 'object' && Array.isArray(questionData.options)) {
      options = this.normalizeMultipleChoiceOptions(questionData.options);
    }

    return {
      concept_name: content.concept || questionData?.metadata?.key_concepts?.[0] || 'Concept',
      format: content.type || questionData?.type || content.questionType || 'coding',
      question: questionText,
      options, // Add options for multiple choice
      solution: solutionText,
      solution_explanation: solutionExplanation,
      points: content.points || 5,
      suggested_page_ref: content.reference || '',
      sources: content.sources || [],
      // Include secondary language fields if provided
      question_secondary: content.question_secondary || '',
      solution_secondary: content.solution_secondary || '',
      solution_explanation_secondary: content.solution_explanation_secondary || '',
      description_secondary: content.description_secondary || '',
      hints_secondary: content.hints_secondary || [],
      requirements_secondary: content.requirements_secondary || [],
      ...(includeMetadata && { metadata: content.metadata || questionData?.metadata || {} }),
    };
  }

  private formatForLabs(content: any, includeMetadata?: boolean): any {
    // Extract primary language content
    let descriptionText = content.questionText || '';
    let solutionText = content.solutionText || '';
    let solutionExplanation = content.solutionExplanation || '';
    
    const questionData = content.question;
    
    if (!descriptionText) {
      if (typeof questionData === 'string') {
        descriptionText = questionData;
      } else if (questionData && typeof questionData === 'object') {
        descriptionText = questionData.question || questionData.description || '';
      }
    }
    
    if (!solutionText) {
      const solutionData = content.solution;
      if (typeof solutionData === 'string') {
        solutionText = solutionData;
      } else if (solutionData && typeof solutionData === 'object') {
        solutionText = solutionData.solution || solutionData.code || '';
        if (!solutionExplanation) {
          solutionExplanation = solutionData.explanation || '';
        }
      }
    }
    ({ solutionText, solutionExplanation } = this.normalizeSolutionFields({
      questionType: content.type || content.questionType || questionData?.type,
      solutionData: content.solution,
      solutionText,
      solutionExplanation,
    }));

    // Extract title from metadata key_concepts or use question type
    const labKeyConcepts = questionData?.metadata?.key_concepts || content.metadata?.key_concepts || [];
    const labTitle = content.title ||
      (Array.isArray(labKeyConcepts) && labKeyConcepts.length > 0 ? labKeyConcepts[0] : '') ||
      questionData?.title ||
      (content.type || content.questionType || 'Lab Problem');

    // Extract options for multiple choice questions
    let options: string[] = [];
    if (Array.isArray(content.options) && content.options.length > 0) {
      options = this.normalizeMultipleChoiceOptions(content.options);
    } else if (questionData && typeof questionData === 'object' && Array.isArray(questionData.options)) {
      options = this.normalizeMultipleChoiceOptions(questionData.options);
    }
    const labRequirements = this.deriveRequirements(content, questionData);
    const labHints = this.deriveHints(content, questionData, content.solution);

    return {
      title: labTitle,
      title_secondary: content.title_secondary || '',
      problem_type: content.type || content.questionType || 'coding',
      description: descriptionText || content.description || '',
      description_secondary: content.description_secondary || content.question_secondary || '',
      options, // Add options for multiple choice
      requirements: labRequirements,
      requirements_secondary: content.requirements_secondary || [],
      hints: labHints,
      hints_secondary: content.hints_secondary || [],
      solution: solutionText || content.solution || '',
      solution_secondary: content.solution_secondary || '',
      solution_explanation: solutionExplanation || content.solution?.explanation || '',
      solution_explanation_secondary: content.solution_explanation_secondary || '',
      estimated_time: content.question?.metadata?.estimated_time || 30,
      points: content.points || 10,
      sources: content.sources || [],
      ...(includeMetadata && { metadata: content.metadata || {} }),
    };
  }

  private formatForHomework(content: any, includeMetadata?: boolean): any {
    // Extract primary language content
    let descriptionText = content.questionText || '';
    let solutionText = content.solutionText || '';
    let solutionExplanation = content.solutionExplanation || '';
    
    if (!descriptionText) {
      const questionData = content.question;
      if (typeof questionData === 'string') {
        descriptionText = questionData;
      } else if (questionData && typeof questionData === 'object') {
        descriptionText = questionData.question || questionData.description || '';
      }
    }
    
    if (!solutionText) {
      const solutionData = content.solution;
      if (typeof solutionData === 'string') {
        solutionText = solutionData;
      } else if (solutionData && typeof solutionData === 'object') {
        solutionText = solutionData.solution || solutionData.code || '';
        if (!solutionExplanation) {
          solutionExplanation = solutionData.explanation || '';
        }
      }
    }
    ({ solutionText, solutionExplanation } = this.normalizeSolutionFields({
      questionType: content.type || content.questionType || content.question?.type,
      solutionData: content.solution,
      solutionText,
      solutionExplanation,
    }));
    
    // Extract title from metadata key_concepts or use question type
    const questionData = content.question;
    const keyConcepts = questionData?.metadata?.key_concepts || [];
    const conceptTitle = keyConcepts.length > 0 
      ? keyConcepts[0] 
      : (content.type || content.questionType || 'Problem');
    
    // Extract options for multiple choice questions
    let options: string[] = [];
    if (Array.isArray(content.options) && content.options.length > 0) {
      options = this.normalizeMultipleChoiceOptions(content.options);
    } else if (questionData && typeof questionData === 'object' && Array.isArray(questionData.options)) {
      options = this.normalizeMultipleChoiceOptions(questionData.options);
    }
    const homeworkRequirements = this.deriveRequirements(content, questionData);
    const homeworkHints = this.deriveHints(content, questionData, content.solution);

    return {
      title: content.title || conceptTitle,
      title_secondary: content.title_secondary || '',
      question_type: content.type || content.questionType || 'coding',
      description: descriptionText || content.description || '',
      description_secondary: content.description_secondary || content.question_secondary || '',
      options, // Add options for multiple choice
      requirements: homeworkRequirements,
      requirements_secondary: content.requirements_secondary || [],
      hints: homeworkHints,
      hints_secondary: content.hints_secondary || [],
      solution: solutionText || content.solution || '',
      solution_secondary: content.solution_secondary || '',
      solution_explanation: solutionExplanation || content.solution?.explanation || '',
      solution_explanation_secondary: content.solution_explanation_secondary || '',
      points: content.points || 10,
      sources: content.sources || [],
      ...(includeMetadata && { metadata: content.metadata || {} }),
    };
  }

  private formatForExams(content: any, includeMetadata?: boolean): any {
    // Extract primary language content
    let questionText = content.questionText || '';
    let answerText = content.solutionText || '';
    let explanationText = content.solutionExplanation || '';
    
    if (!questionText) {
      const questionData = content.question;
      if (typeof questionData === 'string') {
        questionText = questionData;
      } else if (questionData && typeof questionData === 'object') {
        questionText = questionData.question || questionData.description || '';
      }
    }
    
    if (!answerText) {
      const solutionData = content.solution;
      if (typeof solutionData === 'string') {
        answerText = solutionData;
      } else if (solutionData && typeof solutionData === 'object') {
        answerText = solutionData.solution || solutionData.code || solutionData.answer || '';
        if (!explanationText) {
          explanationText = solutionData.explanation || '';
        }
      }
    }
    ({ solutionText: answerText, solutionExplanation: explanationText } = this.normalizeSolutionFields({
      questionType: content.type || content.questionType || content.question?.type,
      solutionData: content.solution,
      solutionText: answerText,
      solutionExplanation: explanationText,
    }));

    // Extract title from metadata key_concepts if missing
    const examKeyConcepts =
      content.question?.metadata?.key_concepts ||
      content.metadata?.key_concepts ||
      [];
    const examTitle =
      content.title ||
      (Array.isArray(examKeyConcepts) && examKeyConcepts.length > 0 ? examKeyConcepts[0] : '') ||
      (content.type || content.questionType || 'Problem');

    // Extract options from various possible locations
    let options: string[] = [];
    const questionData = content.question;
    if (Array.isArray(content.options) && content.options.length > 0) {
      options = this.normalizeMultipleChoiceOptions(content.options);
    } else if (questionData && typeof questionData === 'object') {
      if (Array.isArray(questionData.options) && questionData.options.length > 0) {
        options = this.normalizeMultipleChoiceOptions(questionData.options);
      }
    }
    
    // Log if multiple_choice but no options
    const questionType = content.type || content.questionType || questionData?.type || '';
    if ((questionType.toLowerCase() === 'multiple_choice' || questionType.toLowerCase() === 'mcq') && options.length === 0) {
      this.log('warn', 'Multiple choice question missing options', {
        questionType,
        hasContentOptions: !!content.options,
        hasQuestionOptions: !!questionData?.options,
        questionKeys: questionData ? Object.keys(questionData) : [],
      });
    }

    return {
      question: questionText || content.question || '',
      question_secondary: content.question_secondary || '',
      type: content.type || content.questionType || 'coding',
      title: examTitle,
      title_secondary: content.title_secondary || '',
      options,
      answer: answerText || content.solution || '',
      answer_secondary: content.solution_secondary || '',
      explanation: explanationText || content.solution?.explanation || '',
      explanation_secondary: content.solution_explanation_secondary || '',
      points: content.points || 10,
      chapter: content.chapter || '',
      sources: content.sources || [],
      ...(includeMetadata && { metadata: content.metadata || {} }),
    };
  }
}



