# Data Analysis (Financial Statements)

## Output Shape
- `## Data`: 表格或數據摘要（含欄位意義）。
- `## Question`: 指定比較、解讀或推論任務。
- `## Answer`: 明確結論（可含數值）。
- `## Rationale`: 依據數據說明推理路徑。

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
