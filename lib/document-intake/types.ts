export type DocumentIntakeIntent =
  | 'read_for_question_generation'
  | 'read_for_script_generation'
  | 'evaluate_student_answer'
  | 'visual_analysis'
  | 'edit_document'
  | 'generic';

export type DocumentPage = {
  pageNumber: number;
  text: string;
  textLen: number;
  features?: Record<string, any>;
  notes?: string;
};

export type DocumentIntakeResult = {
  fileName: string;
  fileType: string;
  intent: DocumentIntakeIntent;
  strategy: string;
  content: string;
  pages: DocumentPage[];
  warnings: string[];
  metadata: Record<string, any>;
};

export type DocumentIntakeInput = {
  fileName: string;
  buffer: Buffer;
  intent?: DocumentIntakeIntent;
};

