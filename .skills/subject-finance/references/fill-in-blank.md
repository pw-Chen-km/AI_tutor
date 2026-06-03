# Fill in the Blank (Finance)

## Output Shape
- `## Prompt`: 句子或短段落，保留 1-2 個關鍵空格。
- `## Blanks`: 逐格列出答案格式（詞性/單位/符號）。
- `## Answer`: 提供標準答案。
- `## Rationale`: 1 句說明填答依據。

## Example

```markdown
## Given Data
- Initial investment: USD 500,000 at t=0
- Annual cash inflow: USD 140,000 at t=1..5

## Required
Compute simple payback period.

## Answer
Payback period is about 3.57 years.

## Rationale
500,000 / 140,000 = 3.57, assuming uniform year-end cash inflow.
```

## Constraints
- 所有數值需標示幣別與時間索引（例如 `USD`, `t=2025`）。
- 計算結果必須附單位或百分比。
- 不得引入題幹未給定的財務假設。
