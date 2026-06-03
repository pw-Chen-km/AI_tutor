---
name: subject-language
description: Question-generation for natural-language learning and language arts: grammar, vocabulary, reading comprehension, translation, composition, literature, ESL/EFL, and foreign-language courses such as French, Spanish, Chinese, Japanese, or English. Use for grammar lessons about conjonctions, prepositions/prépositions, propositions subordonnées, verb moods (indicatif/subjonctif), syntax, passages, literary texts, and communication skills. Do not use for programming, math calculation/proof, or finance.
---

# Subject: Language Studies

## Progressive disclosure

1. **Metadata** — frontmatter above (always in router catalog).
2. **This file** — after subject is selected.
3. **References** (load by question type):
   - [cloze.md](references/cloze.md)
   - [reading-comprehension.md](references/reading-comprehension.md)
   - [translation.md](references/translation.md)
   - [grammar-correction.md](references/grammar-correction.md)
   - [multiple-choice.md](references/multiple-choice.md)
4. **Scripts** — `scripts/format-question.ts` (block quotes, no code fences).

## Workflow

1. Quote passages faithfully from source (`## Passage` with `>` quotes).
2. One comprehension or grammar target per item.
3. MCQ: stem + separate `options` array.

## Avoid

- `coding` / `debugging` / `trace` types
- Code fences around literary text
