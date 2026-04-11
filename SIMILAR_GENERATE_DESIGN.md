# Similar Generate & Combination Export 功能設計

## 📋 功能概述

允許用戶為每道題目生成「類似題」（難度相同、結構相似，但情境/數值/變數不同），並在導出時選擇不同版本組合，產生多份試卷/作業。

---

## 🗂️ 數據結構設計

### 題目變體 (Variant)
```typescript
interface QuestionVariant {
  variantId: string;      // 唯一 ID (e.g., "v1", "v2")
  label: string;          // 顯示標籤 (e.g., "A", "B", "C")
  isOriginal: boolean;    // 是否為原始題目
  generatedAt: Date;      // 生成時間
  // ... 其餘題目屬性與原題相同
}
```

### 題目結構 (Question)
```typescript
interface Question {
  id: string;                    // 題目 ID
  number: number;                // 題號
  variants: QuestionVariant[];   // 變體列表 (第一個為原始題)
  selectedVariantIds: string[];  // 導出時選中的變體 IDs
  // ... 其餘屬性
}
```

---

## 🎨 UI 設計

### 1. 題目卡片上的按鈕
```
[🔄 Regenerate] [✨ Similar] [📋 Copy]
```

- **Similar** 按鈕：生成類似題，添加為新變體
- 當有多個變體時，顯示變體選擇器：
  ```
  Variants: [A ✓] [B ✓] [C]  (點擊切換選中狀態)
  ```

### 2. 變體預覽
- 點擊變體標籤可預覽該變體內容
- 選中的變體會在導出時包含

### 3. 導出面板
```
┌─────────────────────────────────────────┐
│ Export Settings                          │
├─────────────────────────────────────────┤
│ Selected Questions:                      │
│  □ Q1: [A ✓] [B ✓]  → 2 versions        │
│  ☑ Q2: [A ✓]        → 1 version         │
│  ☑ Q3: [A ✓] [B ✓] [C ✓] → 3 versions  │
├─────────────────────────────────────────┤
│ Export Mode:                             │
│  ○ Single File (use first selected)     │
│  ● Combinations (generate all combos)   │
│                                          │
│ Total combinations: 2 × 1 × 3 = 6 files │
├─────────────────────────────────────────┤
│ [Export DOCX] [Export PDF] [Export PPTX]│
└─────────────────────────────────────────┘
```

---

## 📦 導出邏輯

### 單檔模式 (Single File)
- 每題使用第一個選中的變體
- 輸出 1 個檔案

### 順序配對模式 (Sequential Pairing)
- **不是所有組合**，而是按順序配對
- 用戶可以 **drag and drop** 調整每題的變體順序
- 根據最大變體數量生成對應數量的檔案

**範例：**
```
Q1: [A]      (1 variant)
Q2: [B, C, D] (3 variants, user reordered)
Q3: [E]      (1 variant)
Q4: [F, G, H] (3 variants)

生成 3 份檔案：
1. A-B-E-F
2. A-C-E-G
3. A-D-E-H
```

- 如果某題變體數量 < 最大數量，使用該題的第一個變體填充
- 導出前會提示用戶確認是否需要補齊變體數量

### 變體數量對齊
- 導出時檢查所有題目的變體數量
- 如果數量不一致，提示用戶：
  - "Question 1 has 1 variant, Question 2 has 3 variants. Generate more similar questions for Q1?"
  - 選項：[Auto-generate] [Use first variant to fill] [Cancel]

### ZIP 打包
- 當生成 > 1 個檔案時，自動打包為 ZIP
- 包含所有配對的檔案

---

## 🔧 實現步驟

### Phase 1: Store 更新
1. 修改 `generatedContent` 結構支持變體
2. 添加 `addVariant`, `removeVariant`, `toggleVariantSelection` actions

### Phase 2: Similar Generate API
1. 創建 `/api/similar-generate` endpoint
2. Prompt 設計：保持難度、結構，改變情境/數值

### Phase 3: UI 更新
1. 在題目卡片添加 Similar 按鈕
2. 添加變體選擇器組件
3. 更新 ExportPanel 支持組合導出

### Phase 4: Export 更新
1. 修改 `/api/export` 支持多變體
2. 實現組合生成邏輯
3. ZIP 打包功能

---

## 🎯 Prompt 設計 (Similar Generate)

```
You are generating a SIMILAR variant of the following question.

ORIGINAL QUESTION:
{original_question}

REQUIREMENTS:
1. Keep the SAME difficulty level
2. Keep the SAME structure and format
3. Keep the SAME concepts being tested
4. CHANGE:
   - Variable names and identifiers
   - Numeric values and constants
   - Scenario/context description
   - Example data
5. The new question should be different enough that students cannot simply copy the original solution

Generate a new question that tests the same skills but uses different specifics.
```

---

## 📊 範例

### 原始題 (Variant A)
```
Create a class `Rectangle` with width and height...
r1 = Rectangle(10, 5)
```

### 類似題 (Variant B)
```
Create a class `Circle` with radius...
c1 = Circle(7)
```

### 類似題 (Variant C)
```
Create a class `Triangle` with base and height...
t1 = Triangle(8, 6)
```

### 導出組合
- 選擇 Q1: A, B; Q2: A; Q3: A, C
- 產生 4 個檔案：
  1. Q1A-Q2A-Q3A
  2. Q1A-Q2A-Q3C
  3. Q1B-Q2A-Q3A
  4. Q1B-Q2A-Q3C

