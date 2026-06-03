# Reading Comprehension

## Output Shape
- `## Passage`: 提供短文（可含引用）。
- `## Question`: 聚焦主旨、細節或推論其一。
- `## Answer`: 明確作答。
- `## Rationale`: 以文內證據支持答案。

## Example

```markdown
## Passage
> The town opened a night bus line, and late-shift workers reported shorter commutes within two months.

## Question
What is the most direct effect described in the passage?

## Answer
Late-shift workers had shorter commute times.

## Rationale
The sentence explicitly states improved commute duration.
```

## Constraints
- 文字題型優先保留語境，可使用引用段落。
- 答案評估以語意準確與語體一致為主。
