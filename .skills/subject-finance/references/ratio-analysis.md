# Ratio Analysis

## Output Shape
- `## Given Data`: 指定期間與財報數值。
- `## Required`: 點名要計算與解讀的比率。
- `## Answer`: 給出比率值與一句解讀。
- `## Rationale`: 說明分子分母與比較基準。

## Example

```markdown
## Given Data
- Revenue: USD 1,250,000 at t=2025
- Net income: USD 162,500 at t=2025

## Required
Calculate net profit margin and interpret in one sentence.

## Answer
Net profit margin = 13.0%.

## Rationale
162,500 / 1,250,000 = 0.13, meaning each USD 1 of revenue yields USD 0.13 profit in 2025.
```

## Constraints
- 所有數值需標示幣別與時間索引（例如 `USD`, `t=2025`）。
- 計算結果必須附單位或百分比。
- 不得引入題幹未給定的財務假設。
