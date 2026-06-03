# Trace / Execution Prediction Questions

## Output Shape
- `## Code`: 給定可執行程式片段。
- `## Question`: 要求最終輸出或關鍵變數。
- `## Answer`: 列出執行結果。
- `## Rationale`: 依執行順序簡述追蹤。

## Example

````markdown
## Code
```python
x = 1
for i in range(3):
    x = x * 2
print(x)
```

## Question
What is the printed value?

## Answer
8

## Rationale
`x` doubles three times: 1 -> 2 -> 4 -> 8.
````

## Constraints
- 程式碼範例需可執行，不使用偽碼。
- 輸入/輸出契約與範例結果必須一致。
- 至少覆蓋一個邊界條件。
