# Sectioning Rules

## Inputs

Use the normalized intake structure:

- `fileName`, `fileType`, `strategy`, `metadata`
- `pages[]` with `pageNumber`, `text`, `textLen`, `notes`, and `features`
- optional `topic_labels`, `must_cover`, `slide_type_hint`, or previous slide plan data

## Build The Outline

Create an ordered outline with three levels:

1. `chapter`: a broad lecture unit, file-level chapter, or major topic block.
2. `section`: a teachable subtopic within one chapter.
3. `page_ref`: exact page/slide numbers supporting the section.

## Chapter Detection

Prefer explicit signals in this order:

1. Filename or selected chapter name, e.g. `chapter-03.pdf`, `Lecture 5 - Recursion.pptx`.
2. Page/slide headings containing `Chapter`, `Unit`, `Lecture`, `Module`, `Part`, `Week`, or numbered major headings.
3. Repeated title patterns across slides, e.g. a large title slide followed by detail slides.
4. Topic shift detected from page titles and `topic_labels`.
5. Fallback: one uploaded file equals one chapter.

## Section Detection

Create a new section when one of these changes:

- A page/slide heading introduces a new subtopic.
- `topic_labels` change substantially.
- Speaker notes introduce a new teaching objective.
- A visual/table/code example starts a new applied block.
- A transition or divider slide separates two content clusters.

Do not create sections from:

- Cover slides.
- Agenda/roadmap slides.
- Pure transition slides.
- Repeated footer, page number, course title, or branding text.
- Empty or nearly empty pages unless speaker notes contain substantive content.

## Transition Handling

Classify pages before planning:

- `cover`: opening title page; usually skip for questions.
- `agenda`: overview/list of topics; use only to infer outline.
- `transition`: divider between sections; attach to nearest following section but do not use as a standalone question source.
- `content`: definition, explanation, principle, or conceptual slide.
- `example`: worked example, code, data, case, demo, or practice prompt.
- `summary`: recap, takeaway, checklist, or review slide.
- `appendix`: backup/detail slide; use only if selected or if main material is insufficient.

## Fallbacks

If no headings are reliable:

- Group PPTX slides by local topic continuity, usually 2-5 slides per section.
- Group PDF pages by heading boundaries when available, otherwise 2-4 pages per section.
- Keep page ranges contiguous unless explicitly creating cross-chapter integration.

If a file is very short:

- One file can be one chapter.
- One page/slide can be one section if it has a clear learning objective.
