# Cloze (Fill-in from Passage)

## Output Shape
- `## Passage`: 含 3-5 個空格的短文。
- `## Word Bank`: 候選詞（可含干擾項）。
- `## Answer`: 逐格答案。
- `## Rationale`: 指出語意或文法依據。

## Example

```markdown
## Passage
> Scientific reports must be _____, concise, and evidence-based.

## Word Bank
accurate / accidental / decorative

## Answer
accurate

## Rationale
Only `accurate` fits the academic writing context.
```

## Constraints
- 文字題型優先保留語境，可使用引用段落。
- 答案評估以語意準確與語體一致為主。
