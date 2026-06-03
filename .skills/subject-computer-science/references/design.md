# Design Questions (API / Architecture)

## Output Shape
- `## Prompt`: 描述需求與限制。
- `## Required`: 指定需輸出的設計要素。
- `## Answer`: 給出方案摘要。
- `## Rationale`: 說明主要取捨。

## Example

```markdown
## Prompt
Design a notification module for assignment deadlines.

## Required
Include data model, trigger timing, and retry rule.

## Answer
Use a schedule table, a queue worker, and exponential backoff for failures.

## Rationale
This separates state, scheduling, and delivery reliability.
```

## Constraints
- 程式碼範例需可執行，不使用偽碼。
- 輸入/輸出契約與範例結果必須一致。
- 至少覆蓋一個邊界條件。
