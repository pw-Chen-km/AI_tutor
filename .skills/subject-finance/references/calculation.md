# Financial Calculations (NPV, IRR, ratios, TVM)

## Output Shape
- `## Given Data`: 列出已知量（含幣別與時間索引）。
- `## Required`: 明確要求計算目標。
- `## Answer`: 提供最終數值與單位。
- `## Rationale`: 簡述核心公式或步驟。

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
