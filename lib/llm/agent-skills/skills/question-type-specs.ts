/**
 * Question Type Specifications
 * 
 * Defines characteristics and guidelines for each question type
 */

export interface QuestionTypeSpec {
  id: string;
  label: string;
  description: string;
  structure: string;
  difficultyGuidelines: {
    easy: { timeRange: string; characteristics: string[] };
    medium: { timeRange: string; characteristics: string[] };
    hard: { timeRange: string; characteristics: string[] };
  };
  requirements: string[];
}

export const QUESTION_TYPE_SPECS: Record<string, QuestionTypeSpec> = {
  multiple_choice: {
    id: 'multiple_choice',
    label: 'Multiple Choice',
    description: 'Question with 4 options (A, B, C, D), one correct answer',
    structure: 'Question stem + 4 options',
    difficultyGuidelines: {
      easy: {
        timeRange: '5-8 minutes',
        characteristics: ['Simple recall', 'One-step reasoning', 'Clear correct answer', 'Obvious distractors']
      },
      medium: {
        timeRange: '8-12 minutes',
        characteristics: ['Multi-step reasoning', 'Application of concepts', 'Plausible distractors', 'Requires understanding']
      },
      hard: {
        timeRange: '12-15 minutes',
        characteristics: ['Complex analysis', 'Synthesis of multiple concepts', 'Subtle distinctions', 'Deep understanding required']
      }
    },
    requirements: ['One clearly correct answer', 'Plausible distractors', 'Avoid "all of the above"', 'Clear question stem']
  },
  fill_in_blank: {
    id: 'fill_in_blank',
    label: 'Fill in the Blank',
    description: 'Sentence or paragraph with blank(s) to complete',
    structure: 'Context with blank(s)',
    difficultyGuidelines: {
      easy: {
        timeRange: '3-5 minutes',
        characteristics: ['Single word/phrase', 'Direct recall', 'Clear context']
      },
      medium: {
        timeRange: '5-8 minutes',
        characteristics: ['Concept application', 'Terminology', 'Multiple blanks possible']
      },
      hard: {
        timeRange: '8-12 minutes',
        characteristics: ['Complex expressions', 'Formulas', 'Requires calculation']
      }
    },
    requirements: ['Clear context', 'Unambiguous answers', 'Appropriate blank placement', 'Single correct answer']
  },
  short_answer: {
    id: 'short_answer',
    label: 'Short Answer',
    description: 'Brief response (1-3 sentences)',
    structure: 'Question requiring concise answer',
    difficultyGuidelines: {
      easy: {
        timeRange: '5-8 minutes',
        characteristics: ['Definition', 'Simple explanation', 'Direct answer']
      },
      medium: {
        timeRange: '8-12 minutes',
        characteristics: ['Concept comparison', 'Application', 'Brief analysis']
      },
      hard: {
        timeRange: '12-15 minutes',
        characteristics: ['Analysis', 'Evaluation', 'Synthesis']
      }
    },
    requirements: ['Focused prompts', 'Measurable criteria', 'Clear expectations', 'Concise but complete']
  },
  calculation: {
    id: 'calculation',
    label: 'Calculation',
    description: 'Numerical problem requiring computation',
    structure: 'Given values + calculation steps',
    difficultyGuidelines: {
      easy: {
        timeRange: '8-12 minutes',
        characteristics: ['Single formula', 'Straightforward substitution', 'Basic operations']
      },
      medium: {
        timeRange: '12-20 minutes',
        characteristics: ['Multiple steps', 'Unit conversions', 'Intermediate calculations']
      },
      hard: {
        timeRange: '20-30 minutes',
        characteristics: ['Complex derivations', 'Multiple concepts', 'Advanced techniques']
      }
    },
    requirements: ['Clear given values', 'Step-by-step solution path', 'Realistic numbers', 'Appropriate precision']
  },
  proof: {
    id: 'proof',
    label: 'Proof',
    description: 'Mathematical or logical proof',
    structure: 'Statement to prove + logical steps',
    difficultyGuidelines: {
      easy: {
        timeRange: '15-20 minutes',
        characteristics: ['Direct proof', 'Simple cases', 'Basic techniques']
      },
      medium: {
        timeRange: '20-30 minutes',
        characteristics: ['Contradiction', 'Induction', 'Multiple steps']
      },
      hard: {
        timeRange: '30-45 minutes',
        characteristics: ['Complex theorems', 'Multiple lemmas', 'Advanced techniques']
      }
    },
    requirements: ['Clear statement', 'Logical progression', 'Appropriate rigor', 'Complete reasoning']
  },
  derivation: {
    id: 'derivation',
    label: 'Derivation',
    description: 'Step-by-step derivation of formula or theorem',
    structure: 'Starting point + derivation steps',
    difficultyGuidelines: {
      easy: {
        timeRange: '10-15 minutes',
        characteristics: ['Simple algebraic manipulation', 'Basic operations', 'Clear steps']
      },
      medium: {
        timeRange: '15-25 minutes',
        characteristics: ['Integration of concepts', 'Intermediate steps', 'Moderate complexity']
      },
      hard: {
        timeRange: '25-40 minutes',
        characteristics: ['Complex mathematical operations', 'Advanced techniques', 'Multiple approaches']
      }
    },
    requirements: ['Starting point clarity', 'Logical sequence', 'Intermediate results', 'Complete derivation']
  },
  coding: {
    id: 'coding',
    label: 'Coding',
    description: 'Programming problem requiring code solution',
    structure: 'Problem specification + code requirements',
    difficultyGuidelines: {
      easy: {
        timeRange: '10-15 minutes',
        characteristics: ['Simple function', 'Basic syntax', 'Straightforward logic']
      },
      medium: {
        timeRange: '15-30 minutes',
        characteristics: ['Multiple functions', 'Algorithms', 'Moderate complexity']
      },
      hard: {
        timeRange: '30-60 minutes',
        characteristics: ['Complex systems', 'Optimization', 'Advanced patterns']
      }
    },
    requirements: ['Clear specifications', 'Test cases', 'Appropriate language', 'Complete solution']
  },
  debugging: {
    id: 'debugging',
    label: 'Debugging',
    description: 'Identify and fix errors in code',
    structure: 'Code with errors + debugging task',
    difficultyGuidelines: {
      easy: {
        timeRange: '8-12 minutes',
        characteristics: ['Syntax errors', 'Obvious bugs', 'Simple fixes']
      },
      medium: {
        timeRange: '12-20 minutes',
        characteristics: ['Logic errors', 'Edge cases', 'Moderate complexity']
      },
      hard: {
        timeRange: '20-30 minutes',
        characteristics: ['Subtle bugs', 'Performance issues', 'Complex interactions']
      }
    },
    requirements: ['Realistic bug scenarios', 'Clear error symptoms', 'Reproducible issues', 'Appropriate difficulty']
  },
  trace: {
    id: 'trace',
    label: 'Trace / Output',
    description: 'Trace execution or predict output',
    structure: 'Code/algorithm + trace steps',
    difficultyGuidelines: {
      easy: {
        timeRange: '5-10 minutes',
        characteristics: ['Simple loops', 'Basic operations', 'Clear state changes']
      },
      medium: {
        timeRange: '10-15 minutes',
        characteristics: ['Nested structures', 'Recursion', 'Moderate complexity']
      },
      hard: {
        timeRange: '15-25 minutes',
        characteristics: ['Complex algorithms', 'State changes', 'Multiple iterations']
      }
    },
    requirements: ['Clear initial state', 'Step-by-step traceability', 'Complete execution', 'Predictable output']
  },
  design: {
    id: 'design',
    label: 'Design',
    description: 'System or algorithm design problem',
    structure: 'Requirements + design constraints',
    difficultyGuidelines: {
      easy: {
        timeRange: '15-20 minutes',
        characteristics: ['Simple design', 'Basic requirements', 'Clear structure']
      },
      medium: {
        timeRange: '20-30 minutes',
        characteristics: ['Multiple components', 'Trade-offs', 'Moderate complexity']
      },
      hard: {
        timeRange: '30-45 minutes',
        characteristics: ['Complex systems', 'Scalability', 'Advanced patterns']
      }
    },
    requirements: ['Clear requirements', 'Design constraints', 'Evaluation criteria', 'Multiple approaches possible']
  },
  data_analysis: {
    id: 'data_analysis',
    label: 'Data Analysis',
    description: 'Analyze data and draw conclusions',
    structure: 'Data + analysis questions',
    difficultyGuidelines: {
      easy: {
        timeRange: '10-15 minutes',
        characteristics: ['Simple statistics', 'Basic patterns', 'Direct analysis']
      },
      medium: {
        timeRange: '15-25 minutes',
        characteristics: ['Multiple techniques', 'Interpretation', 'Moderate complexity']
      },
      hard: {
        timeRange: '25-40 minutes',
        characteristics: ['Complex analysis', 'Modeling', 'Advanced techniques']
      }
    },
    requirements: ['Appropriate data complexity', 'Clear analysis goals', 'Interpretable results', 'Valid conclusions']
  },
  case_study: {
    id: 'case_study',
    label: 'Case Study',
    description: 'Real-world scenario analysis',
    structure: 'Scenario + analysis questions',
    difficultyGuidelines: {
      easy: {
        timeRange: '15-20 minutes',
        characteristics: ['Single concept application', 'Clear scenario', 'Direct questions']
      },
      medium: {
        timeRange: '20-30 minutes',
        characteristics: ['Multiple concepts', 'Analysis required', 'Moderate complexity']
      },
      hard: {
        timeRange: '30-45 minutes',
        characteristics: ['Complex scenarios', 'Synthesis', 'Multiple perspectives']
      }
    },
    requirements: ['Realistic scenarios', 'Clear questions', 'Multiple perspectives', 'Comprehensive analysis']
  }
};

const QUESTION_TYPE_CONTRACTS: Record<string, string[]> = {
  multiple_choice: [
    'Provide exactly four answer options.',
    'Ensure there is exactly one defensible correct answer.',
    'Make each distractor reflect a different plausible misconception.',
    'Do not allow two options to be simultaneously correct under a reasonable reading.',
    'Keep the stem self-contained so students are not guessing teacher intent.',
  ],
  fill_in_blank: [
    'Use one canonical answer unless multiple accepted answers are explicitly intended.',
    'Make the surrounding context sufficient to disambiguate the blank.',
    'Do not create blanks solvable by grammar alone without understanding.',
    'Avoid terminology blanks where multiple near-synonyms would all be reasonable.',
    'Keep the blank scope narrow enough to grade objectively.',
  ],
  short_answer: [
    'Ask for a bounded response, not an open-ended discussion.',
    'The ideal answer should be gradable using 2-4 key points.',
    'State exactly what kind of response is expected: explain, compare, justify, or identify.',
    'Avoid prompts that require students to guess the desired depth.',
    'Make the stopping point of a complete answer clear.',
  ],
  calculation: [
    'State all givens, units, and assumptions explicitly.',
    'Ensure there is one intended calculation path at this course level.',
    'Specify required precision, rounding, or answer form when relevant.',
    'Do not rely on hidden constants, implicit conversions, or unstated formulas.',
    'Make the computed quantity unambiguous.',
  ],
  proof: [
    'State the claim formally and completely.',
    'Only ask for proof techniques supported by the context or course level.',
    'Do not depend on unstated lemmas or outside theorems.',
    'Ensure there is a clear notion of what counts as a complete proof.',
    'Avoid prompts that are really derivations or explanations disguised as proofs.',
  ],
  derivation: [
    'State the starting expression and target expression explicitly.',
    'Frame the task as transformation or derivation, not open-ended proof.',
    'Provide or imply all identities, assumptions, and variable meanings needed.',
    'Make intermediate steps logically reachable at the intended level.',
    'Ensure the endpoint of the derivation is precise and checkable.',
  ],
  coding: [
    'Define the function or program contract explicitly: inputs, outputs, and invalid-case behavior.',
    'Make constraints algorithmic or behavioral, not style opinions.',
    'Include concrete examples, sample I/O, or test cases when helpful.',
    'Do not leave edge-case handling implicit.',
    'Ensure the task can be judged by correctness rather than preferred coding taste.',
  ],
  debugging: [
    'Define expected behavior before presenting faulty code.',
    'Every identified bug must violate an explicit requirement or contract.',
    'Do not treat design choices, naming, or style preferences as bugs.',
    'Keep buggy behavior objective, reproducible, and locally fixable.',
    'Limit the task to a small number of independent bugs so the grading target stays clear.',
  ],
  trace: [
    'Specify the exact input and the exact thing to trace: output, variable states, or control flow.',
    'Use deterministic code or procedures only.',
    'Avoid hidden assumptions about evaluation order or unspecified language behavior.',
    'Keep the complexity centered on one main mechanism at a time.',
    'Make the final traced result objectively checkable.',
  ],
  design: [
    'Ask for a concrete design deliverable, not just opinions.',
    'State functional requirements and non-functional constraints explicitly.',
    'Name evaluation dimensions such as scalability, maintainability, or latency.',
    'Avoid prompts where radically different answers would all seem equally valid without criteria.',
    'Require trade-off reasoning tied to the given constraints.',
  ],
  data_analysis: [
    'State the analysis goal explicitly: describe, compare, infer, predict, or detect.',
    'Provide enough data context for the requested conclusion.',
    'Distinguish clearly between observation, inference, and recommendation.',
    'Do not require unsupported causal claims unless the task explicitly teaches that.',
    'Keep the conclusion target specific enough to grade objectively.',
  ],
  case_study: [
    'Include only scenario details that matter for the decision or analysis.',
    'Ask one bounded primary judgment question with at most a small number of supporting sub-questions.',
    'State the evaluation lens explicitly, such as technical, ethical, financial, or operational.',
    'Do not require major external assumptions not present in the case.',
    'Ensure the best answer can be defended from the provided facts.',
  ],
};

const QUESTION_TYPE_FAILURE_MODES: Record<string, string[]> = {
  multiple_choice: [
    'Two options are arguably correct.',
    'Distractors are obviously wrong or irrelevant.',
    'The stem is vague enough that the answer depends on interpretation.',
  ],
  fill_in_blank: [
    'The blank has multiple equally acceptable answers.',
    'The blank can be guessed from grammar without understanding.',
    'The prompt omits context needed to know what belongs in the blank.',
  ],
  short_answer: [
    'The prompt is too broad to grade consistently.',
    'Expected depth is unclear.',
    'A correct answer could vary wildly in scope or structure.',
  ],
  calculation: [
    'Missing givens or unit assumptions.',
    'More than one reasonable formula path could produce different answers.',
    'Rounding or precision expectations are unspecified.',
  ],
  proof: [
    'The statement is informal or under-specified.',
    'A required lemma is not available from context.',
    'The task is really asking for explanation, not proof.',
  ],
  derivation: [
    'The starting point or target is missing.',
    'Necessary identities or assumptions are unstated.',
    'The task drifts into proof or explanation instead of derivation.',
  ],
  coding: [
    'Input-output behavior is under-specified.',
    'Edge-case policy is left implicit.',
    'The grading target depends on style preference rather than correctness.',
  ],
  debugging: [
    'Expected behavior is not defined before calling something a bug.',
    'Design ambiguity is mislabeled as a defect.',
    'The task mixes API redesign with bug fixing without saying so.',
  ],
  trace: [
    'The input or target state is unspecified.',
    'The code depends on ambiguous runtime behavior.',
    'The task asks for explanation when it should ask for a definite trace result.',
  ],
  design: [
    'The prompt is too open-ended to compare answers fairly.',
    'Constraints are absent or too weak to force trade-offs.',
    'There is no concrete deliverable to assess.',
  ],
  data_analysis: [
    'The question asks for inference unsupported by the data.',
    'Observation and interpretation are mixed together.',
    'The task does not define what kind of analysis is expected.',
  ],
  case_study: [
    'The scenario includes noise but lacks decision-critical facts.',
    'The question is so broad that many unrelated answers fit.',
    'The evaluation lens is missing, so judgment criteria drift.',
  ],
};

/**
 * Calculate difficulty based on module type and time limit
 * 
 * This function implements the module-difficulty-guidelines skill logic:
 * - Drills: Easy ≤ 8 min, Medium ≤ 10 min (SIMPLEST - quick reinforcement)
 * - Labs: Easy ≤ 30 min, Medium ≤ 45 min (hands-on practice)
 * - Homework: Easy ≤ 20 min, Medium ≤ 25 min (deep understanding)
 * - Exams: Easy ≤ 8 min, Medium ≤ 12 min (time-constrained)
 * 
 * IMPORTANT: Module type affects base difficulty:
 * - drills: Easy to medium (short, light weight)
 * - labs: Similar to drills but slightly longer (hands-on)
 * - homework: Harder than labs
 * - exams: Hardest (more challenging than homework)
 */
export function calculateDifficulty(moduleType: string, timeLimit?: number): 'easy' | 'medium' | 'hard' {
  if (!timeLimit) {
    console.log(`[question-type-specs] No time limit provided for ${moduleType}, defaulting to medium difficulty`);
    return 'medium';
  }

  const thresholds: Record<string, { easy: number; medium: number }> = {
    drills: { easy: 8, medium: 10 },
    labs: { easy: 30, medium: 45 },
    homework: { easy: 20, medium: 25 },
    exams: { easy: 8, medium: 12 },
  };

  const moduleThresholds = thresholds[moduleType] || thresholds.drills;

  // Calculate base difficulty from time limit
  let baseDifficulty: 'easy' | 'medium' | 'hard';
  if (timeLimit <= moduleThresholds.easy) {
    baseDifficulty = 'easy';
  } else if (timeLimit <= moduleThresholds.medium) {
    baseDifficulty = 'medium';
  } else {
    baseDifficulty = 'hard';
  }

  // Apply module-specific adjustments
  // Difficulty order from easiest to hardest: drills < labs < homework < exams
  let finalDifficulty = baseDifficulty;
  
  if (moduleType === 'drills') {
    // Drills: easy to medium only
    finalDifficulty = baseDifficulty === 'hard' ? 'medium' : baseDifficulty;
  } else if (moduleType === 'labs') {
    // Labs: similar to drills, allow medium; cap hard to medium
    finalDifficulty = baseDifficulty === 'hard' ? 'medium' : baseDifficulty;
  } else if (moduleType === 'homework') {
    // Homework: harder than labs; bump easy -> medium
    finalDifficulty = baseDifficulty === 'easy' ? 'medium' : baseDifficulty;
  } else if (moduleType === 'exams') {
    // Exams: harder than homework; bump medium -> hard, easy -> medium
    if (baseDifficulty === 'easy') {
      finalDifficulty = 'medium';
    } else if (baseDifficulty === 'medium') {
      finalDifficulty = 'hard';
    } else {
      finalDifficulty = 'hard';
    }
  }

  console.log(`[question-type-specs] Calculated difficulty for ${moduleType}: ${finalDifficulty} (timeLimit: ${timeLimit} min, base: ${baseDifficulty}, thresholds: easy≤${moduleThresholds.easy}, medium≤${moduleThresholds.medium})`);
  
  return finalDifficulty;
}

/**
 * Get question type specific guidelines
 * 
 * This function implements the question-type-guidelines skill logic,
 * providing detailed specifications for each of the 12 question types.
 */
export function getQuestionTypeGuidelines(questionType: string, difficulty: 'easy' | 'medium' | 'hard', moduleType: string, timeLimit?: number): string {
  const spec = QUESTION_TYPE_SPECS[questionType];
  if (!spec) {
    console.warn(`[question-type-specs] No specification found for question type: ${questionType}, using generic guidelines`);
    return `Generate a ${questionType} question appropriate for ${moduleType} module with ${difficulty} difficulty.`;
  }

  const difficultyInfo = spec.difficultyGuidelines[difficulty];
  const timeInfo = timeLimit ? `Target time: ${timeLimit} minutes` : difficultyInfo.timeRange;

  const moduleFocus = {
    drills: 'quick reinforcement during lectures - keep solutions SIMPLE and QUICK',
    labs: 'hands-on practice and experimentation - moderate complexity',
    homework: 'deep understanding and independent work - can be more complex',
    exams: 'time-constrained assessment - more challenging than homework',
  }[moduleType] || 'educational assessment';

  const wordLimitNote = {
    drills: 'Target question length: 40-120 words. Keep it short and focused.',
    labs: 'Target question length: 60-160 words. Moderate length, no long narratives.',
    homework: 'Target question length: 60-150 words. Be concise and direct—avoid long narratives, excessive backstory, or verbose setup. State the problem clearly in as few words as possible.',
    exams: 'Target question length: 150-260 words. Most challenging but still concise.',
  }[moduleType];

  const moduleComplexityNote = moduleType === 'drills' 
    ? '\n⚠️ CRITICAL FOR DRILLS: Solutions must be SIMPLE and QUICK. Avoid complex multi-step solutions. Focus on basic understanding.'
    : moduleType === 'labs'
    ? '\nNote: Labs allow moderate complexity for hands-on practice.'
    : moduleType === 'homework'
    ? '\nNote: Homework can include deeper analysis and multi-step solutions.'
    : '\nNote: Exams should be harder than homework while still time-constrained.';

  const guidelines = `
QUESTION TYPE: ${spec.label}
Description: ${spec.description}
Structure: ${spec.structure}
Difficulty Level: ${difficulty.toUpperCase()}
${timeInfo}

Characteristics for ${difficulty} difficulty:
${difficultyInfo.characteristics.map(c => `- ${c}`).join('\n')}

Requirements:
${spec.requirements.map(r => `- ${r}`).join('\n')}

Module Context: ${moduleType}
- Adjust complexity to match ${moduleType} expectations
- Ensure question is completable within ${timeLimit || 'appropriate'} minutes
- ${wordLimitNote}
- Focus on ${moduleFocus}${moduleComplexityNote}`;

  console.log(`[question-type-specs] Generated guidelines for ${questionType} (${difficulty}, ${moduleType}, ${timeLimit || 'N/A'} min)`);
  
  return guidelines;
}

export function getQuestionTypePromptAddendum(questionType: string): string {
  const contractRules = QUESTION_TYPE_CONTRACTS[questionType] || [
    'Make the task objective, complete, and gradeable.',
    'Do not rely on hidden assumptions.',
    'Keep the expected answer aligned with the stated task.',
  ];
  const failureModes = QUESTION_TYPE_FAILURE_MODES[questionType] || [
    'The task is under-specified.',
    'The grading target depends on interpretation rather than the prompt.',
  ];

  return `
TYPE-SPECIFIC CONTRACT RULES:
${contractRules.map((rule) => `- ${rule}`).join('\n')}

TYPE-SPECIFIC FAILURE MODES TO AVOID:
${failureModes.map((mode) => `- ${mode}`).join('\n')}`;
}
