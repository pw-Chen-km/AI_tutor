---
name: question-scope-planner
description: Plan question-generation source scopes from PDF/PPT/PPTX/document intake. Use when generating in-class drills, lab practice, homework, exams, or when deciding how to split uploaded teaching materials into sections, chapters, page ranges, and concept spans for educational question generation.
---

# Question Scope Planner

## Overview

Use this skill before generating questions from uploaded course materials. The goal is to choose the right source scope for each module: drills use one section, labs use multiple sections in one chapter, homework spans two chapters, and exams integrate concepts across three or more chapters.

## Core Workflow

1. Build a document outline from intake data: pages/slides, headings, titles, speaker notes, `topic_labels`, `features`, and filename order.
2. Segment the outline into sections and chapters. Read [sectioning-rules.md](references/sectioning-rules.md) when the uploaded material lacks explicit chapter headings or has ambiguous slide structure.
3. Select source scopes by module:
   - `drills`: single section only.
   - `labs`: multiple related sections inside the same chapter.
   - `homework`: two chapters, with progression from local recall to small integration.
   - `exams`: three or more chapters, with concept fusion across chapters.
4. Return a strict source plan using [scope-schema.md](references/scope-schema.md).
5. Pass the source plan to the question generator as a contract. The question generator may vary wording and question type, but must not broaden the selected scope.

## Scope Rules

### In-Class Drill

Use exactly one section. Prefer one page/slide cluster that has a single learning objective. Do not combine definitions from one section with examples from another.

### Lab Practice

Use two to four related sections from the same chapter. Choose sections that support a hands-on deliverable, debugging task, implementation task, data analysis, or design exercise.

### Homework

Use exactly two chapters when enough material exists. Early questions may use one local section, but the set should include at least one item that connects concepts from both chapters.

### Exam Generator

Use three or more chapters when enough material exists. Each question should fuse concepts across chapters, not merely sample isolated pages. Prefer primary-skill questions that require students to combine ideas under time pressure.

## Planning Principles

- Prefer semantic coherence over equal page counts.
- Skip cover, agenda, transition, acknowledgements, and purely administrative pages unless they contain examinable concepts.
- Keep raw page ranges stable and auditable: every planned scope must cite file and page/slide numbers.
- If intake contains speaker notes, treat them as teaching intent; use them to label sections, but do not invent unsupported concepts.
- If materials are too short for the requested span, degrade gracefully and explain the fallback in `rationale`.

## Runtime Integration Notes

For this project, this skill maps directly onto `document-intake`, `document_preprocessor`, and `source_planner`.

- Add chapter/section metadata before source planning when possible.
- Change `source_planner` module rules so `exams` prefer cross-chapter concept fusion instead of 1-2 page local scopes.
- Include `scope_kind`, `chapter_ids`, `section_ids`, and `integration_goal` in planned source items.
