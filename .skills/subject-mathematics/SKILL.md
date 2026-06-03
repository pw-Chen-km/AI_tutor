---
name: subject-mathematics
description: Question-generation for mathematics, algebra, geometry, calculus, statistics, and discrete math. Use when material involves numeric calculation, equations, functions, limits, probability, formal proofs, derivations of formulas, or symbolic reasoning. Do not use for natural-language grammar, foreign-language learning, rhetoric, reading passages, or lessons about words like expression/cause/structure unless the material contains actual mathematical notation or quantitative reasoning.
---

# Subject: Mathematics

## Progressive disclosure

1. **Metadata** — frontmatter (router catalog).
2. **This file** — after routing.
3. **References**:
   - [calculation.md](references/calculation.md)
   - [derivation.md](references/derivation.md)
   - [fill-in-blank.md](references/fill-in-blank.md)
   - [proof.md](references/proof.md)
   - [short-answer.md](references/short-answer.md)
   - [multiple-choice.md](references/multiple-choice.md)
4. **Scripts** — `scripts/format-question.ts` (LaTeX-friendly plain text, no code fences).

## Workflow

1. State every symbol and domain assumption (e.g., real numbers, positive integers).
2. One objective per item: compute, prove, or choose.
3. For proofs, name the theorem or technique expected from the source.

## Avoid

- `coding` / `debugging` unless the course explicitly teaches programming math
- Ambiguous rounding or missing units when applied problems include them
- Trick questions that require facts not in the source
