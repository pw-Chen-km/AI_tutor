---
name: subject-finance
description: Question-generation for finance, accounting, corporate finance, investments, valuation (NPV/IRR/DCF), financial statement analysis, and economics-quant topics. Use when material includes cash flows, ratios, markets, or business cases with numbers.
---

# Subject: Finance & Accounting

## Progressive disclosure

1. **Metadata** — frontmatter (router catalog).
2. **This file** — after routing.
3. **References**:
   - [calculation.md](references/calculation.md)
   - [case-study.md](references/case-study.md)
   - [data-analysis.md](references/data-analysis.md)
   - [ratio-analysis.md](references/ratio-analysis.md)
4. **Scripts** — `scripts/format-question.ts` (tables, currency, no code fences).

## Workflow

1. State every number with currency and time index.
2. Separate scenario / givens / assumptions / required.
3. For tables, use markdown tables in `## Given Data`.

## Avoid

- Code-style formatting for formulas
- Hidden assumptions not taught in source
