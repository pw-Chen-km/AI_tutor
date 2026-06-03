# Case Study (Finance)

## Output Shape
- `## Scenario`: 3-6 行情境資料。
- `## Question`: 1 個分析問題。
- `## Expected Points`: 3-5 個判斷重點。
- `## Answer`: 結論 + 依據。

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
