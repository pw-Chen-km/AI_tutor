# Exam Export Module 考試卷輸出模組

## Overview 概述

This module provides formal examination paper generation in Word (.docx) format, suitable for university-level exams. It converts generated questions into professionally formatted exam papers with:

- Centered institution header
- Course and exam type information
- Student information fields (ID, Name, Class)
- Instructions box
- Section organization with page breaks
- Question formatting by type (MCQ, Short Answer, Programming, etc.)

## Architecture 架構

```
lib/exam-export/
├── types.ts           # Type definitions (HeaderLayout, ExamContent, etc.)
├── styles.ts          # Style constants (fonts, spacing, borders)
├── exporter.ts        # Main export function
├── default-layout.ts  # Default header layouts
├── index.ts           # Module exports
└── README.md          # This file
```

## Usage 使用方式

### 1. Direct API Call

```typescript
import { exportExamDocx, getHeaderLayout, ExamContent } from '@/lib/exam-export';

const examContent: ExamContent = {
  metadata: {
    course: 'Introduction to Python',
    institution: 'International University',
    examType: 'Final Examination',
    durationMinutes: 120,
    totalMarks: 100,
  },
  instructions: [
    'Answer ALL questions.',
    'Write clearly and legibly.',
  ],
  sections: [
    {
      id: 'A',
      title: 'Section A: Multiple Choice',
      marks: 30,
      pageBreakBefore: false,
      questions: [
        {
          number: 1,
          marks: 3,
          type: 'mcq',
          stem: 'Which is a valid Python variable?',
          choices: [
            { key: 'A', text: '123var' },
            { key: 'B', text: 'my_var' },
            { key: 'C', text: 'my-var' },
            { key: 'D', text: 'my var' },
          ],
        },
      ],
    },
  ],
};

const buffer = await exportExamDocx({
  headerLayout: getHeaderLayout('default'),
  examContent,
  format: 'docx',
});
```

### 2. Via API Endpoint

```bash
POST /api/export-exam
Content-Type: application/json

{
  "mode": "convert",
  "items": [...],
  "course": "Introduction to Python",
  "institution": "International University",
  "examType": "Final Examination",
  "durationMinutes": 120
}
```

### 3. Via Export Panel UI

1. Generate questions in any module (Drills, Labs, Homework, Exams)
2. Select questions to export
3. Choose "📄 Formal Exam Paper (.docx)" in Format dropdown
4. Fill in exam settings (Course, Institution, Type, Duration)
5. Click "Export Selected"

## Question Types 題目類型

| Type | Description | Fields |
|------|-------------|--------|
| `mcq` | Multiple Choice | stem, choices (A-D) |
| `short` | Short Answer | prompt, answerLines |
| `programming` / `coding` | Code Writing | prompt, constraints, codeAreaLines |
| `truefalse` | True/False | statement |
| `debugging` | Bug Fixing | prompt, buggyCode, codeAreaLines |

## Header Layouts 表頭佈局

### Default Layout
- Institution (centered, bold, 16pt)
- Course (centered, bold, 14pt)
- Exam Type (centered, 12pt)
- Duration & Total Marks
- Divider line
- Student fields: ID, Name, Class

### Minimal Layout
- Institution (centered, bold, 16pt)
- Course + Exam Type (combined)
- Student fields: Name, ID

## Agent Skill Integration

The module includes an `ExamFormatterSkill` that can be used via the agent orchestrator:

```typescript
import { skillRegistry } from '@/lib/llm/agent-skills';

const skill = skillRegistry.getSkill('Exam Formatter');
const result = await skill.execute({
  action: 'convert',
  items: [...],
  options: {
    course: 'Python Programming',
    institution: 'University',
    examType: 'Final Exam',
    durationMinutes: 120,
  },
});
```

## Styling 樣式

The module uses professional academic styling:
- Page: A4, 2.5cm margins
- Font: Times New Roman (text), Consolas (code)
- Sections: Page breaks, bold titles
- Questions: Numbered, marks indicated
- Code areas: Bordered boxes with monospace font



