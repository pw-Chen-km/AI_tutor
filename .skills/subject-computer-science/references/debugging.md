# Debugging Questions

## Output Shape
- `## Task`: 說明要修正的行為。
- `## Expected Behavior`: 列出應滿足契約。
- `## Code`: 提供含錯誤的最小片段。
- `## Answer`: 說明修正點與原因。

## Example

````markdown
## Task
Fix `is_sorted(nums)` so it returns `True` only for non-decreasing arrays.

## Expected Behavior
- `[]` -> `True`
- `[1,2,2]` -> `True`
- `[2,1]` -> `False`

## Code
```python
def is_sorted(nums):
    for i in range(len(nums)-1):
        if nums[i] > nums[i+1]:
            return True
    return False
```

## Answer
Replace `return True` inside the `if` block with `return False`.
````

## Constraints
- 程式碼範例需可執行，不使用偽碼。
- 輸入/輸出契約與範例結果必須一致。
- 至少覆蓋一個邊界條件。
