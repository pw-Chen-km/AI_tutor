# Multiple Choice (Finance)

## Output Shape
- `## Question`: 單一明確題幹，聚焦一個概念。
- `## Options`: 4 個選項（A-D），語法平行且長度接近。
- `## Answer`: 僅標示一個正確選項。
- `## Rationale`: 1-2 句指出判斷依據。

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
