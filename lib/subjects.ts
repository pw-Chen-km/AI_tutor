export type SubjectId =
  | 'customized'
  | 'computer_science'
  | 'mathematics'
  | 'statistics'
  | 'data_science'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'electrical_engineering'
  | 'mechanical_engineering'
  | 'civil_engineering'
  | 'economics'
  | 'finance'
  | 'accounting'
  | 'business_management'
  | 'psychology'
  | 'sociology'
  | 'political_science'
  | 'philosophy'
  | 'history'
  | 'english_literature';

export type QuestionTypeId =
  | 'multiple_choice'
  | 'fill_in_blank'
  | 'short_answer'
  | 'calculation'
  | 'proof'
  | 'derivation'
  | 'coding'
  | 'debugging'
  | 'trace'
  | 'design'
  | 'data_analysis'
  | 'case_study';

export type QuestionTypeConfig = {
  id: QuestionTypeId;
  label: string;
  defaultWeight: number; // 0..100 (not necessarily summing to 100)
};

export type SubjectConfig = {
  id: SubjectId;
  label: string;
  homeworkTypes: QuestionTypeConfig[];
  examTypes: QuestionTypeConfig[];
  drillsTypes?: QuestionTypeConfig[];
  labTypes?: QuestionTypeConfig[];
};

// All available question types for reference
export const ALL_QUESTION_TYPES: QuestionTypeConfig[] = [
  { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
  { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
  { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
  { id: 'calculation', label: 'Calculation', defaultWeight: 15 },
  { id: 'proof', label: 'Proof', defaultWeight: 10 },
  { id: 'derivation', label: 'Derivation', defaultWeight: 10 },
  { id: 'coding', label: 'Coding', defaultWeight: 20 },
  { id: 'debugging', label: 'Debugging', defaultWeight: 10 },
  { id: 'trace', label: 'Trace / Output', defaultWeight: 10 },
  { id: 'design', label: 'Design', defaultWeight: 10 },
  { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 10 },
  { id: 'case_study', label: 'Case Study', defaultWeight: 15 },
];

export const SUBJECTS: SubjectConfig[] = [
  // Customized option - allows user to select any question types
  {
    id: 'customized',
    label: 'Customized',
    drillsTypes: ALL_QUESTION_TYPES,
    labTypes: ALL_QUESTION_TYPES,
    homeworkTypes: ALL_QUESTION_TYPES,
    examTypes: ALL_QUESTION_TYPES,
  },
  {
    id: 'computer_science',
    label: 'Computer Science',
    drillsTypes: [
      { id: 'coding', label: 'Coding', defaultWeight: 35 },
      { id: 'debugging', label: 'Debugging', defaultWeight: 20 },
      { id: 'trace', label: 'Trace / Output', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 5 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
    ],
    labTypes: [
      { id: 'coding', label: 'Coding', defaultWeight: 40 },
      { id: 'debugging', label: 'Debugging', defaultWeight: 15 },
      { id: 'design', label: 'Design', defaultWeight: 15 },
      { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 10 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
    ],
    homeworkTypes: [
      { id: 'coding', label: 'Coding', defaultWeight: 35 },
      { id: 'debugging', label: 'Debugging', defaultWeight: 15 },
      { id: 'trace', label: 'Trace / Output', defaultWeight: 15 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
      { id: 'design', label: 'Design', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
      { id: 'coding', label: 'Coding', defaultWeight: 25 },
      { id: 'debugging', label: 'Debugging', defaultWeight: 10 },
      { id: 'trace', label: 'Trace / Output', defaultWeight: 5 },
    ],
  },
  {
    id: 'mathematics',
    label: 'Mathematics',
    drillsTypes: [
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 20 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'derivation', label: 'Derivation', defaultWeight: 15 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
    ],
    labTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 40 },
      { id: 'derivation', label: 'Derivation', defaultWeight: 20 },
      { id: 'proof', label: 'Proof', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
    ],
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'derivation', label: 'Derivation', defaultWeight: 15 },
      { id: 'proof', label: 'Proof', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 15 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 30 },
      { id: 'proof', label: 'Proof', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
    ],
  },
  {
    id: 'statistics',
    label: 'Statistics',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 25 },
      { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 25 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 25 },
      { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
    ],
  },
  {
    id: 'data_science',
    label: 'Data Science',
    homeworkTypes: [
      { id: 'coding', label: 'Coding', defaultWeight: 30 },
      { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 30 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 15 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
      { id: 'coding', label: 'Coding', defaultWeight: 25 },
      { id: 'data_analysis', label: 'Data Analysis', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 10 },
    ],
  },
  {
    id: 'physics',
    label: 'Physics',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 45 },
      { id: 'derivation', label: 'Derivation', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 40 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'derivation', label: 'Derivation', defaultWeight: 15 },
    ],
  },
  {
    id: 'chemistry',
    label: 'Chemistry',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 25 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 10 },
    ],
  },
  {
    id: 'biology',
    label: 'Biology',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 30 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 15 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 30 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 40 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 15 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 25 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
    ],
  },
  {
    id: 'electrical_engineering',
    label: 'Electrical Engineering',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 30 },
      { id: 'design', label: 'Design', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'coding', label: 'Coding', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 30 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'design', label: 'Design', defaultWeight: 15 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
  },
  {
    id: 'mechanical_engineering',
    label: 'Mechanical Engineering',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'design', label: 'Design', defaultWeight: 25 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'design', label: 'Design', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
    ],
  },
  {
    id: 'civil_engineering',
    label: 'Civil Engineering',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'design', label: 'Design', defaultWeight: 25 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 30 },
      { id: 'design', label: 'Design', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 15 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 10 },
    ],
  },
  {
    id: 'economics',
    label: 'Economics',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 25 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 25 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 15 },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    homeworkTypes: [
      { id: 'calculation', label: 'Calculation', defaultWeight: 40 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 20 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 20 },
      { id: 'calculation', label: 'Calculation', defaultWeight: 25 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 20 },
    ],
  },
  {
    id: 'business_management',
    label: 'Business Management',
    homeworkTypes: [
      { id: 'case_study', label: 'Case Study', defaultWeight: 40 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 30 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 30 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
  },
  {
    id: 'psychology',
    label: 'Psychology',
    homeworkTypes: [
      { id: 'case_study', label: 'Case Study', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 30 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 25 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 40 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 30 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
    ],
  },
  {
    id: 'sociology',
    label: 'Sociology',
    homeworkTypes: [
      { id: 'case_study', label: 'Case Study', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 35 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 35 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
  },
  {
    id: 'political_science',
    label: 'Political Science',
    homeworkTypes: [
      { id: 'case_study', label: 'Case Study', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 35 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 35 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
  },
  {
    id: 'philosophy',
    label: 'Philosophy',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 40 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 15 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 45 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
    ],
  },
  {
    id: 'history',
    label: 'History',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 40 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 30 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 20 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 35 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 10 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 35 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 20 },
    ],
  },
  {
    id: 'english_literature',
    label: 'English Literature',
    homeworkTypes: [
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 45 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 35 },
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 15 },
      { id: 'fill_in_blank', label: 'Fill in the Blank', defaultWeight: 5 },
    ],
    examTypes: [
      { id: 'multiple_choice', label: 'Multiple Choice', defaultWeight: 30 },
      { id: 'short_answer', label: 'Short Answer', defaultWeight: 45 },
      { id: 'case_study', label: 'Case Study', defaultWeight: 25 },
    ],
  },
];

export const SUBJECT_BY_ID: Record<SubjectId, SubjectConfig> = SUBJECTS.reduce((acc, s) => {
  acc[s.id] = s;
  return acc;
}, {} as Record<SubjectId, SubjectConfig>);

export function getSubjectConfig(subjectId: string | undefined) {
  const id = (subjectId || 'computer_science') as SubjectId;
  return SUBJECT_BY_ID[id] || SUBJECT_BY_ID.computer_science;
}

export function getDrillsTypes(subjectId: string | undefined, customTypes?: string[]) {
  const s = getSubjectConfig(subjectId);
  const types = s.drillsTypes && s.drillsTypes.length > 0 ? s.drillsTypes : s.homeworkTypes;

  // If customized subject and custom types provided, filter to selected types
  if (subjectId === 'customized' && customTypes && customTypes.length > 0) {
    return ALL_QUESTION_TYPES.filter(t => customTypes.includes(t.id));
  }

  return types;
}

export function getLabTypes(subjectId: string | undefined, customTypes?: string[]) {
  const s = getSubjectConfig(subjectId);
  const types = s.labTypes && s.labTypes.length > 0 ? s.labTypes : s.homeworkTypes;

  // If customized subject and custom types provided, filter to selected types
  if (subjectId === 'customized' && customTypes && customTypes.length > 0) {
    return ALL_QUESTION_TYPES.filter(t => customTypes.includes(t.id));
  }

  return types;
}

export function getHomeworkTypes(subjectId: string | undefined, customTypes?: string[]) {
  const s = getSubjectConfig(subjectId);

  // If customized subject and custom types provided, filter to selected types
  if (subjectId === 'customized' && customTypes && customTypes.length > 0) {
    return ALL_QUESTION_TYPES.filter(t => customTypes.includes(t.id));
  }

  return s.homeworkTypes;
}

export function getExamTypes(subjectId: string | undefined, customTypes?: string[]) {
  const s = getSubjectConfig(subjectId);

  // If customized subject and custom types provided, filter to selected types
  if (subjectId === 'customized' && customTypes && customTypes.length > 0) {
    return ALL_QUESTION_TYPES.filter(t => customTypes.includes(t.id));
  }

  return s.examTypes;
}

export function defaultWeights(types: QuestionTypeConfig[]) {
  const w: Record<string, number> = {};
  for (const t of types) w[t.id] = t.defaultWeight;
  return w;
}

export function weightsToCounts(total: number, weights: Record<string, number>) {
  const keys = Object.keys(weights);
  const raw = keys.map((k) => ({ k, w: Math.max(0, Number(weights[k]) || 0) }));
  const sum = raw.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return {};
  if (sum <= 0) {
    // Even split if all zeros
    const base = Math.floor(total / keys.length);
    const rem = total - base * keys.length;
    const out: Record<string, number> = {};
    keys.forEach((k, i) => (out[k] = base + (i < rem ? 1 : 0)));
    return out;
  }

  // Largest remainder method
  const exact = raw.map((x) => ({ k: x.k, exact: (x.w / sum) * total }));
  const floors = exact.map((x) => ({ k: x.k, c: Math.floor(x.exact), r: x.exact - Math.floor(x.exact) }));
  let used = floors.reduce((s, x) => s + x.c, 0);
  let remaining = total - used;
  floors.sort((a, b) => b.r - a.r);
  for (let i = 0; i < floors.length && remaining > 0; i++) {
    floors[i].c += 1;
    remaining -= 1;
  }
  const out: Record<string, number> = {};
  floors.forEach((x) => (out[x.k] = x.c));
  return out;
}


