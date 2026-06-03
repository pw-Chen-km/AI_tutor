---
name: subject-computer-science
description: Question-generation for computer science, programming, algorithms, data structures, software engineering, debugging, and systems courses. Use when source material includes code, APIs, complexity, OOP, or implementation tasks.
---

# Subject: Computer Science

## Progressive disclosure (how the generator uses this skill)

1. **Metadata (always)** — YAML `name` + `description` above; router reads all `subject-*` skills before generating.
2. **This file (after routing)** — workflow and type preferences below.
3. **References (on demand)** — load only the files needed for the requested question type:
   - [coding.md](references/coding.md) — implementation tasks
   - [debugging.md](references/debugging.md) — fix faulty code
   - [trace.md](references/trace.md) — execution prediction
   - [multiple-choice.md](references/multiple-choice.md) — MCQ stems & distractors
   - [design.md](references/design.md) — API / architecture labs
4. **Scripts (runtime)** — `scripts/format-question.ts` normalizes markdown sections; never ask the LLM to invent formatting.

## Workflow

1. Confirm source is CS-related (code, algorithms, systems).
2. Pick question type aligned with module time and `typeCounts`.
3. Read the matching reference file for structure + examples.
4. Generate JSON; runtime runs `format-question.ts`.

## Avoid

- Cloze / passage / essay formats
- Style-only "bugs" in debugging items
- Code fences for non-code prose
