# Scope Schema

## Source Plan Output

Return JSON only:

```json
{
  "outline": {
    "chapters": [
      {
        "chapter_id": "ch1",
        "title": "string",
        "file": "lecture1.pptx",
        "page_range": "1-12",
        "sections": [
          {
            "section_id": "ch1-s1",
            "title": "string",
            "page_range": "2-4",
            "page_refs": [2, 3, 4],
            "topic_labels": ["string"],
            "section_role": "content"
          }
        ]
      }
    ]
  },
  "scopes": [
    {
      "item_number": 1,
      "question_type": "multiple_choice",
      "scope_kind": "single_section",
      "file": "lecture1.pptx",
      "pages": "2-4",
      "sources": [
        {
          "file": "lecture1.pptx",
          "pages": "2-4"
        }
      ],
      "chapter_ids": ["ch1"],
      "section_ids": ["ch1-s1"],
      "topic_focus": ["string"],
      "integration_goal": "string",
      "rationale": "string"
    }
  ],
  "coverage_summary": "string"
}
```

## Scope Kind By Module

Use these exact values:

- `drills` → `single_section`
- `labs` → `same_chapter_multi_section`
- `homework` → `two_chapter_bridge`
- `exams` → `three_plus_chapter_fusion`

## Validation Rules

- Every `file` must exist in the provided intake documents.
- Every `pages` value must refer to existing page/slide numbers.
- `sources` is optional for single-file scopes and required for cross-file scopes.
- When `sources` is present, each source must have an existing `file` and valid `pages`.
- Every `chapter_id` and `section_id` must exist in `outline`.
- `drills` scopes must contain exactly one `section_id`.
- `labs` scopes must contain two or more `section_ids` and exactly one `chapter_id`.
- `homework` scopes should use exactly two `chapter_ids` when enough material exists.
- `exams` scopes should use three or more `chapter_ids` when enough material exists.
- If not enough chapters exist, use the broadest valid fallback and explain it in `rationale`.

## Question Generator Contract

When a source plan is attached to a question request:

- Treat `scope_kind`, `chapter_ids`, `section_ids`, `pages`, and `topic_focus` as binding.
- Do not broaden the question beyond the selected scope.
- For `three_plus_chapter_fusion`, require the student to combine concepts from all cited chapters.
- For `two_chapter_bridge`, include at least one relationship, comparison, transfer, or dependency between the two chapters.
- For `same_chapter_multi_section`, produce a hands-on task that uses multiple sections in one coherent workflow.
- For `single_section`, ask one focused check for understanding.
