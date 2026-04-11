# Vibe-Coding / AI Teaching Assistant Platform

## What This Project Does (TL;DR for LLMs)

**Vibe-Coding** is an EdTech web app that helps instructors **generate teaching materials** from uploaded course files (PDF, PPTX, DOCX, XLSX, etc.) using LLMs. Users upload content, pick a module (Drills, Labs, Homework, Exams, Lecture Rehearsal, Exam Evaluation), configure parameters, and the system produces structured questions, solutions, and optionally bilingual content via an **Agent Skills** pipeline (question → solution → formatter → translator). It also supports subscriptions (Stripe/PayPal), token usage, and generation history.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 16, React 19, Tailwind, Zustand)                      │
│  Sidebar → Context Panel (file upload) → Main Panel (module UI)          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  API Routes (app/api/)                                                   │
│  parse-file | generate-with-agents | lecture-rehearsal | subscription…   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent Skills (lib/llm/agent-skills/)                                    │
│  Orchestrator → question_generator → solution_generator → content_formatter│
│  → bilingual_translator (optional)                                       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM (OpenAI SDK: Gemini, OpenAI, DeepSeek, etc.)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Content generation** for Drills/Labs/Homework/Exams goes through **`/api/generate-with-agents`** (or stream variant), which uses **`lib/llm/agent-skills/orchestrator.ts`**.
- **Lecture Rehearsal** uses its own flow: **`/api/lecture-rehearsal-stream`** and **`/api/lecture-rehearsal`** for scripts; **`/api/lecture-rehearsal/export-pdf-to-pptx`** or **export-pptx-notes** for exporting.
- **File parsing** is done by **`/api/parse-file`**; parsed text is split by `[PAGE: N]` and `FILE: name` for context selection.
- **Auth**: NextAuth with credentials/OAuth; **subscriptions** and **usage** live in Prisma (`Subscription`, `UsageLog`) and are driven by **`lib/db/schema.ts`** (e.g. `PLAN_CONFIG`).

---

## Main Features & Modules

| Module | Purpose | Entry Component | API / Backend |
|--------|--------|-----------------|----------------|
| **Lecture Rehearsal** | Generate per-slide/page scripts from PPTX/PDF/DOCX, export to PPTX (with notes) or DOCX | `LectureRehearsalModule` | `lecture-rehearsal`, `lecture-rehearsal-stream`, `export-pdf-to-pptx`, `export-pptx-notes` |
| **In-Class Drills** | Short, concept-focused practice questions (by type: coding, trace, multiple_choice, etc.) | `DrillsModule` (`drills-module.tsx`) | `generate-with-agents` / `generate-with-agents-stream` |
| **Lab Practices** | Time-calibrated coding/lab tasks with requirements, hints, solutions | `LabsModule` | same |
| **Homework** | Multi-problem assignments with chapters, points, hints | `HomeworkModule` | same |
| **Exam Generator** | Timed exams with type/chapter distribution, points, optional export | `ExamsModule` | same + `evaluate-exam`, `export-exam` |
| **Exam Evaluation** | Grade student answers against model solutions (Premium) | `ExamEvaluationModule` | `evaluate-exam` |

- **Which drills UI is used:** `main-panel.tsx` imports **`DrillsModule`** from **`./modules/drills-module`** (not `drills-module-v2`). So the **active** drills UI is **`drills-module.tsx`**.
- **Question types** (e.g. multiple_choice, trace, coding, data_analysis) are defined in **`lib/llm/agent-skills/skills/question-type-specs.ts`** and referenced by the orchestrator and frontend (e.g. **`lib/subjects.ts`**, **`getDrillsTypes`**).

---

## Agent Skills (Content Generation Pipeline)

- **Location:** `lib/llm/agent-skills/`
- **Orchestrator:** `orchestrator.ts` — drives batch generation, retries, parallel batches, and calls skills in sequence per item.
- **Skills:**  
  - `question_generator` → `solution_generator` → `content_formatter` → (optional) `bilingual_translator`  
  - Plus `quality_checker`, `exam_formatter` where applicable.
- **Convention:** New modules **must** use the orchestrator and these skills; see **`AGENT_SKILLS_GUIDELINES.md`** and **`lib/llm/agent-skills/README.md`**.
- **Important:** The orchestrator sends **file blocks** (with `[PAGE: N]` and `FILE: name`) to the question generator; the generator returns **sources** (file + pages). The content formatter normalizes output for each module (`drills` / `labs` / `homework` / `exams`). Multiple-choice options are normalized in **`content-formatter.ts`** (`options` from `content.options` or `content.question.options`).

---

## Key Directories & Files (Where to Look)

| Concern | Where to Look |
|--------|----------------|
| **Module UI** | `components/modules/` — one component per module; `main-panel.tsx` switches by `activeModule`. |
| **Agent logic** | `lib/llm/agent-skills/orchestrator.ts`, `skills/*.ts` (question, solution, content-formatter, bilingual-translator). |
| **Question types & difficulty** | `lib/llm/agent-skills/skills/question-type-specs.ts`, `lib/subjects.ts`. |
| **Plans & feature flags** | `lib/db/schema.ts` — `PLAN_CONFIG` (free/plus/pro/premium), which modules/features each plan has. |
| **Auth & sessions** | `lib/auth/config.ts`, `app/api/auth/`, NextAuth. |
| **Payments & usage** | `lib/payments/` (Stripe, PayPal, usage-tracker), `app/api/subscription/`, `app/api/webhooks/`. |
| **File parsing** | `app/api/parse-file/`, `lib/parsers/`. |
| **Lecture Rehearsal export** | `app/api/lecture-rehearsal/export-pdf-to-pptx/`, `scripts/pdf2pptx.py` (PDF→PPTX with notes). |
| **State (client)** | `lib/store.ts` (Zustand) — `activeModule`, `llmConfig`, `languageConfig`, `contextFiles`, etc. |
| **DB schema** | `prisma/schema.prisma` — User, Subscription, UsageLog, GenerationHistory, etc. |

---

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Next.js 16 (App Router), React 19
- **Styling:** Tailwind CSS, Shadcn/UI-style components under `components/ui/`
- **State:** Zustand (`lib/store.ts`), persisted where needed
- **LLM:** OpenAI SDK (compatible with Gemini, DeepSeek, Anthropic, Ollama via base URL + model)
- **DB:** PostgreSQL, Prisma
- **Auth:** NextAuth
- **Payments:** Stripe, PayPal (and LINE Pay in routes)
- **Rendering:** ReactMarkdown, rehype-highlight, remark-gfm; **`MixedContent`** and **`CodeBlock`** for questions/answers so that markdown and fenced code (e.g. `` ```python ``) render correctly in all modules.

---

## How to Run

- **Install:** `npm install`
- **Dev:** `npm run dev` → [http://localhost:3000](http://localhost:3000)
- **Scripts:** `.\run.ps1` (Windows) or `./run.sh` (macOS/Linux); see `package.json` for `db:*`, `check:env`, `check:agent-compliance`, etc.
- **Env:** Use the env files and docs referenced in the repo (e.g. `ENV_SETUP.md`, `DATABASE_SETUP.md`, `STRIPE_SETUP_GUIDE.md`) for API keys, DB URL, Stripe, etc.

---

## Conventions for LLMs Working on This Codebase

1. **Do not add direct LLM calls in module components.** Use the orchestrator and existing API routes (`generate-with-agents`, stream, or lecture-rehearsal).
2. **Question/solution/formatting** flow lives in **agent-skills**. Changes to wording, structure, or question types should consider `question-type-specs.ts`, `question-generator.ts`, `solution-generator.ts`, and `content-formatter.ts`.
3. **Drills UI:** The app uses **`drills-module.tsx`**. `drills-module-v2.tsx` exists but is not referenced from `main-panel.tsx`.
4. **Displaying code/markdown in questions or answers:** Use **`MixedContent`** or **`CodeBlock`** (and where relevant **`ensureMarkdownCodeFences`** from `lib/llm/format.ts`) so that `` ```python `` and similar blocks render as code, not raw text.
5. **New modules or features** that depend on plan level should be gated via **`PLAN_CONFIG`** in `lib/db/schema.ts` and the sidebar/module availability logic already used for existing modules.
6. **Generation history** is a Premium feature; storage and retrieval go through **`/api/generation-history`** and the DB schema for `GenerationHistory`.

---

## License

MIT.
