---
name: subject-chemistry
description: Question-generation for chemistry, stoichiometry, reactions, equilibrium, thermochemistry, organic nomenclature, and lab data. Use when material involves chemical equations, moles, concentrations, or molecular structure.
---

# Subject: Chemistry

## Progressive disclosure

1. **Metadata** — frontmatter.
2. **This file** — workflow.
3. **References**:
   - [stoichiometry.md](references/stoichiometry.md)
   - [reaction.md](references/reaction.md)
   - [calculation.md](references/calculation.md)
   - [data-analysis.md](references/data-analysis.md)
   - [multiple-choice.md](references/multiple-choice.md)
4. **Scripts** — `scripts/format-question.ts`

## Workflow

1. Balance equations when reactions are central.
2. State conditions (STP, temperature, pressure) for gas problems.
3. Use markdown tables for multi-species data when helpful.

## Avoid

- Ambiguous states (s, l, g, aq) when they matter for the answer
- Reagents or mechanisms not covered in the source
