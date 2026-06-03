# Trace (Generic)

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
