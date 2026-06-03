# Grammar Correction

## Output Shape
- `## Sentence`: 提供待修正文句。
- `## Task`: 指定錯誤類型。
- `## Answer`: 給出修正句。
- `## Rationale`: 1-2 句說明規則。

## Example

```markdown
## Sentence
She go to school every day.

## Task
Correct the subject-verb agreement error.

## Answer
She goes to school every day.

## Rationale
Third-person singular in simple present takes `-es`.
```

## Constraints
- 文字題型優先保留語境，可使用引用段落。
- 答案評估以語意準確與語體一致為主。
