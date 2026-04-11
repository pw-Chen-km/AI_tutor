/**
 * Exam Export Module - Type Definitions
 * 考試卷輸出模組 - 類型定義
 */

// ============================================
// Header Layout Types (表頭佈局類型)
// ============================================

export interface HeaderLayoutStyle {
  fontSize: number;
  bold: boolean;
  underline: boolean;
  italic?: boolean;
}

export interface HeaderItem {
  id: string;
  type: 'text' | 'field' | 'divider';
  row: number;
  col: number;
  colSpan: number;
  align: 'left' | 'center' | 'right';
  // For text type
  value?: string;
  // For field type
  label?: string;
  placeholder?: string;
  bindKey?: string;
  // Style
  style: HeaderLayoutStyle;
}

export interface HeaderGridConfig {
  cols: number;
  rowGapPx: number;
  colGapPx: number;
  baseRowHeightPx: number;
}

export interface HeaderLayout {
  page: {
    size: 'A4' | 'Letter';
    marginCm: number;
    fontFamily: string;
  };
  header: {
    grid: HeaderGridConfig;
    items: HeaderItem[];
  };
}

// ============================================
// Exam Content Types (考試內容類型)
// ============================================

export interface MCQChoice {
  key: string;
  text: string;
}

export interface BaseQuestion {
  number: number;
  marks: number;
  type: 'mcq' | 'short' | 'programming' | 'truefalse' | 'coding' | 'debugging';
  title?: string;
  originalType?: string;
  sources?: { file: string; pages: string }[];
}

export interface MCQQuestion extends BaseQuestion {
  type: 'mcq';
  stem: string;
  choices: MCQChoice[];
}

export interface ShortQuestion extends BaseQuestion {
  type: 'short';
  prompt: string;
  answerLines: number;
}

export interface ProgrammingQuestion extends BaseQuestion {
  type: 'programming' | 'coding';
  prompt: string;
  constraints?: string[];
  codeAreaLines: number;
}

export interface TrueFalseQuestion extends BaseQuestion {
  type: 'truefalse';
  statement: string;
}

export interface DebuggingQuestion extends BaseQuestion {
  type: 'debugging';
  prompt: string;
  buggyCode: string;
  codeAreaLines: number;
}

export type Question = MCQQuestion | ShortQuestion | ProgrammingQuestion | TrueFalseQuestion | DebuggingQuestion;

export interface ExamSection {
  id: string;
  title: string;
  marks: number;
  pageBreakBefore: boolean;
  questions: Question[];
}

export interface ExamMetadata {
  course: string;
  institution: string;
  examType: string;
  durationMinutes: number;
  totalMarks: number;
  date?: string;
  semester?: string;
}

export interface ExamContent {
  metadata: ExamMetadata;
  instructions: string[];
  sections: ExamSection[];
}

// ============================================
// Export Configuration (導出配置)
// ============================================

export interface StudentInfo {
  student_id?: string;
  name?: string;
  class?: string;
  [key: string]: string | undefined;
}

export interface ExamExportConfig {
  headerLayout: HeaderLayout;
  examContent: ExamContent;
  studentInfo?: StudentInfo;
  includeAnswerKey?: boolean;
  format: 'docx' | 'pdf' | 'pptx';
  // Include solutions in output
  includeSolutions?: boolean;
  // Institution logo (base64 encoded PNG/JPG)
  institutionLogoBase64?: string;
  // User-uploaded PPTX template (base64 encoded)
  templatePptxBase64?: string;
}

// ============================================
// Conversion from existing module format
// ============================================

export interface LegacyExportItem {
  number: number;
  title: string;
  type: string;
  points: number;
  question: string;
  solution?: string;
  explanation?: string;
  sources?: { file: string; pages: string }[];
  choices?: MCQChoice[];
}

export interface ConvertToExamOptions {
  course: string;
  institution: string;
  examType: string;
  durationMinutes: number;
  instructions?: string[];
  sectionTitle?: string;
}

