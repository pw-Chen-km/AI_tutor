# Translation

## Output Shape
- `## Source Text`: 給定待翻譯句段。
- `## Target Language`: 指定目標語言與語體。
- `## Answer`: 提供譯文。
- `## Rationale`: 說明關鍵詞語處理。

## Example

```markdown
## Source Text
> The committee postponed the vote until Friday.

## Target Language
Traditional Chinese (formal)

## Answer
委員會將表決延後至週五。

## Rationale
`postponed` 對應「延後」，保留正式行政語氣。
```

## Constraints
- 文字題型優先保留語境，可使用引用段落。
- 答案評估以語意準確與語體一致為主。
