/**
 * Exam Formatter Agent Skill
 * 考試卷格式化 Agent Skill
 * 
 * This skill handles:
 * 1. Converting generated questions to formal exam format
 * 2. Generating exam-specific content (instructions, sections)
 * 3. Formatting content for Word/PDF export
 */

import { BaseSkill } from '../base-skill';
import { AgentSkill, SkillInput, SkillOutput, SkillMetadata } from '../types';
import { ExamContent, ExamSection, Question, LegacyExportItem, ConvertToExamOptions } from '@/lib/exam-export/types';

// Skill metadata
export const EXAM_FORMATTER_METADATA: SkillMetadata = {
  id: 'exam_formatter',
  name: 'Exam Formatter',
  description: 'Formats questions into formal exam paper structure with sections, instructions, and proper formatting',
  version: '1.0.0',
  author: 'AI Teaching Assistant',
  capabilities: [
    'format_exam_content',
    'generate_instructions',
    'organize_sections',
    'calculate_marks',
    'convert_legacy_items',
  ],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', description: 'Legacy export items to convert' },
      options: { type: 'object', description: 'Conversion options (course, institution, etc.)' },
      action: { type: 'string', enum: ['convert', 'generate_instructions', 'organize_sections'] },
    },
    required: ['action'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      examContent: { type: 'object', description: 'Formatted exam content' },
      success: { type: 'boolean' },
      error: { type: 'string' },
    },
  },
};

export interface ExamFormatterInput extends SkillInput {
  action: 'convert' | 'generate_instructions' | 'organize_sections' | 'format_for_export';
  items?: LegacyExportItem[];
  options?: ConvertToExamOptions;
  examContent?: Partial<ExamContent>;
  exportFormat?: 'docx' | 'pdf';
}

export interface ExamFormatterOutput extends SkillOutput {
  examContent?: ExamContent;
  instructions?: string[];
  sections?: ExamSection[];
}

export class ExamFormatterSkill extends BaseSkill implements AgentSkill {
  metadata = EXAM_FORMATTER_METADATA;

  async execute(input: ExamFormatterInput): Promise<ExamFormatterOutput> {
    try {
      switch (input.action) {
        case 'convert':
          return this.convertLegacyItems(input);
        case 'generate_instructions':
          return this.generateInstructions(input);
        case 'organize_sections':
          return this.organizeSections(input);
        case 'format_for_export':
          return this.formatForExport(input);
        default:
          return this.error(`Unknown action: ${input.action}`);
      }
    } catch (err: any) {
      return this.error(err.message || 'Unknown error in ExamFormatterSkill');
    }
  }

  /**
   * Convert legacy export items to formal exam content
   */
  private async convertLegacyItems(input: ExamFormatterInput): Promise<ExamFormatterOutput> {
    const { items, options } = input;
    
    if (!items || items.length === 0) {
      return this.error('No items provided for conversion');
    }
    
    if (!options) {
      return this.error('Options required for conversion (course, institution, etc.)');
    }
    
    const totalMarks = items.reduce((sum, it) => sum + (it.points || 0), 0);
    
    // Group questions by type for sections
    const mcqItems = items.filter(it => 
      it.type?.toLowerCase() === 'mcq' || 
      it.type?.toLowerCase() === 'multiple_choice' ||
      it.choices
    );
    const codingItems = items.filter(it => 
      it.type?.toLowerCase().includes('coding') || 
      it.type?.toLowerCase().includes('programming') ||
      it.type?.toLowerCase().includes('debugging')
    );
    const otherItems = items.filter(it => 
      !mcqItems.includes(it) && !codingItems.includes(it)
    );
    
    const sections: ExamSection[] = [];
    let questionNum = 1;
    
    // MCQ Section
    if (mcqItems.length > 0) {
      const mcqMarks = mcqItems.reduce((sum, it) => sum + (it.points || 0), 0);
      sections.push({
        id: 'A',
        title: 'Section A: Multiple Choice Questions',
        marks: mcqMarks,
        pageBreakBefore: false,
        questions: mcqItems.map(it => this.convertToMCQ(it, questionNum++)),
      });
    }
    
    // Short Answer Section
    if (otherItems.length > 0) {
      const otherMarks = otherItems.reduce((sum, it) => sum + (it.points || 0), 0);
      sections.push({
        id: sections.length === 0 ? 'A' : 'B',
        title: `Section ${sections.length === 0 ? 'A' : 'B'}: Short Answer Questions`,
        marks: otherMarks,
        pageBreakBefore: sections.length > 0,
        questions: otherItems.map(it => this.convertToShort(it, questionNum++)),
      });
    }
    
    // Programming Section
    if (codingItems.length > 0) {
      const codingMarks = codingItems.reduce((sum, it) => sum + (it.points || 0), 0);
      const sectionId = String.fromCharCode(65 + sections.length); // A, B, C...
      sections.push({
        id: sectionId,
        title: `Section ${sectionId}: Programming Questions`,
        marks: codingMarks,
        pageBreakBefore: sections.length > 0,
        questions: codingItems.map(it => this.convertToProgramming(it, questionNum++)),
      });
    }
    
    const examContent: ExamContent = {
      metadata: {
        course: options.course,
        institution: options.institution,
        examType: options.examType,
        durationMinutes: options.durationMinutes,
        totalMarks,
      },
      instructions: options.instructions || this.getDefaultInstructions(),
      sections,
    };
    
    return this.success({ examContent });
  }

  /**
   * Generate appropriate instructions based on exam type
   */
  private async generateInstructions(input: ExamFormatterInput): Promise<ExamFormatterOutput> {
    const { examContent } = input;
    const examType = examContent?.metadata?.examType?.toLowerCase() || 'exam';
    
    let instructions: string[];
    
    if (examType.includes('final')) {
      instructions = [
        'This is a closed-book examination.',
        'Answer ALL questions.',
        'Write clearly and legibly in the space provided.',
        'Show all your work for partial credit.',
        'No electronic devices (calculators, phones, etc.) are permitted.',
        'You may not leave the examination room during the first 30 minutes or the last 15 minutes.',
      ];
    } else if (examType.includes('midterm') || examType.includes('mid-term')) {
      instructions = [
        'Answer ALL questions.',
        'Write clearly in the space provided.',
        'Show your work for partial credit.',
        'No electronic devices are permitted unless specified.',
        'Budget your time wisely.',
      ];
    } else if (examType.includes('quiz')) {
      instructions = [
        'Answer all questions.',
        'Write your answers clearly.',
        'This is a timed assessment.',
      ];
    } else {
      instructions = this.getDefaultInstructions();
    }
    
    return this.success({ instructions });
  }

  /**
   * Organize questions into logical sections
   */
  private async organizeSections(input: ExamFormatterInput): Promise<ExamFormatterOutput> {
    const { examContent } = input;
    
    if (!examContent?.sections) {
      return this.error('No sections provided to organize');
    }
    
    // Sort sections by type priority: MCQ first, then short answer, then programming
    const typePriority: Record<string, number> = {
      'mcq': 1,
      'multiple_choice': 1,
      'truefalse': 2,
      'short': 3,
      'essay': 4,
      'programming': 5,
      'coding': 5,
      'debugging': 6,
    };
    
    const sortedSections = [...examContent.sections].sort((a, b) => {
      const aType = a.questions[0]?.type?.toLowerCase() || 'short';
      const bType = b.questions[0]?.type?.toLowerCase() || 'short';
      return (typePriority[aType] || 99) - (typePriority[bType] || 99);
    });
    
    // Reassign section IDs and pageBreaks
    const organizedSections = sortedSections.map((section, idx) => ({
      ...section,
      id: String.fromCharCode(65 + idx), // A, B, C...
      pageBreakBefore: idx > 0,
    }));
    
    // Renumber all questions sequentially
    let questionNum = 1;
    for (const section of organizedSections) {
      for (const question of section.questions) {
        question.number = questionNum++;
      }
    }
    
    return this.success({ sections: organizedSections });
  }

  /**
   * Format content for specific export format
   */
  private async formatForExport(input: ExamFormatterInput): Promise<ExamFormatterOutput> {
    const { examContent, exportFormat } = input;
    
    if (!examContent) {
      return this.error('No exam content provided for formatting');
    }
    
    // For now, return the content as-is
    // Future: could add format-specific transformations
    return this.success({ examContent: examContent as ExamContent });
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getDefaultInstructions(): string[] {
    return [
      'Answer ALL questions.',
      'Write clearly and legibly.',
      'Show all your work for partial credit.',
      'No electronic devices are permitted.',
    ];
  }

  private convertToMCQ(item: LegacyExportItem, number: number): Question {
    return {
      number,
      marks: item.points || 3,
      type: 'mcq',
      stem: item.question,
      choices: item.choices || [
        { key: 'A', text: 'Option A' },
        { key: 'B', text: 'Option B' },
        { key: 'C', text: 'Option C' },
        { key: 'D', text: 'Option D' },
      ],
    };
  }

  private convertToShort(item: LegacyExportItem, number: number): Question {
    const marks = item.points || 6;
    return {
      number,
      marks,
      type: 'short',
      prompt: item.question,
      answerLines: Math.max(4, Math.min(10, Math.ceil(marks / 2))),
    };
  }

  private convertToProgramming(item: LegacyExportItem, number: number): Question {
    const marks = item.points || 15;
    return {
      number,
      marks,
      type: 'programming',
      prompt: item.question,
      constraints: [],
      codeAreaLines: Math.max(12, Math.min(25, Math.ceil(marks * 1.2))),
    };
  }
}

// Export singleton instance
export const examFormatterSkill = new ExamFormatterSkill();



