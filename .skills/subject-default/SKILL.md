---
name: subject-default
description: Fallback question-generation when material is interdisciplinary or does not match a specific subject skill (CS, language, finance, mathematics, physics, chemistry, biology, history, geography, civics). Use for general academic slides, mixed topics, or unclear domain.
---

# Subject: Default (Generic)

## Progressive disclosure

1. **Metadata** — frontmatter.
2. **This file** — general workflow.
3. **References**:
   - [calculation.md](references/calculation.md)
   - [design.md](references/design.md)
   - [overview.md](references/overview.md)
   - [proof.md](references/proof.md)
   - [question-types.md](references/question-types.md)
   - [examples.md](references/examples.md)
4. **Scripts** — `scripts/format-question.ts`

## Workflow

1. Prefer `multiple_choice`, `short_answer`, `fill_in_blank`.
2. Keep drills single-objective.
3. Tie every question to explicit source wording.

## When to pick another skill instead

If source clearly fits a dedicated subject skill, the router should **not** select default.
