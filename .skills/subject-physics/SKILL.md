---
name: subject-physics
description: Question-generation for physics, mechanics, electromagnetism, waves, thermodynamics, and modern physics. Use when material involves forces, energy, fields, motion, circuits, or physical laws with units and diagrams.
---

# Subject: Physics

## Progressive disclosure

1. **Metadata** — frontmatter.
2. **This file** — workflow.
3. **References**:
   - [calculation.md](references/calculation.md)
   - [multiple-choice.md](references/multiple-choice.md)
   - [short-answer.md](references/short-answer.md)
   - [derivation.md](references/derivation.md)
   - [conceptual.md](references/conceptual.md)
4. **Scripts** — `scripts/format-question.ts`

## Workflow

1. State SI units (or state if using cgs/other system).
2. Describe diagrams in `## Diagram Description` when needed.
3. Separate givens, assumptions, and what to solve.

## Avoid

- Missing units or direction signs for vectors
- Problems requiring constants not provided or not standard in the course
