# Question Type Skills 實施說明

## 概述

本文件說明如何確保新創建的 question-type-guidelines 和 module-difficulty-guidelines skills 在所有四個模組（in-class drills, lab practices, homework, exam generator）中正確使用。

## Skills 架構

### 1. Cursor Skills（參考文檔）
- **`.cursor/skills/question-type-guidelines/`**: 定義 12 種問題類型的詳細規格
- **`.cursor/skills/module-difficulty-guidelines/`**: 定義 4 個模組的難易度校準規則

### 2. TypeScript Skills（實際實現）
- **`lib/llm/agent-skills/skills/question-type-specs.ts`**: 
  - `QUESTION_TYPE_SPECS`: 12 種問題類型的完整規格
  - `calculateDifficulty()`: 根據模組類型和時間限制計算難易度
  - `getQuestionTypeGuidelines()`: 生成問題類型特定的指導原則

## 實施流程

### 步驟 1: 前端模組調用 API

所有四個模組都通過 `/api/generate-with-agents` API 生成題目：

```typescript
// 所有模組都使用相同的 API 調用模式
const response = await fetch('/api/generate-with-agents', {
  method: 'POST',
  body: JSON.stringify({
    moduleType: 'drills' | 'labs' | 'homework' | 'exams',
    numberOfItems: number,
    context: string,
    taskParams: {
      minutesPerProblem: number,  // drills, labs, homework 使用
      minutesPerQuestion: number, // exams 使用
      typeCounts: Record<string, number>,
      // ... 其他參數
    },
    llmConfig: {...},
    languageConfig: {...},
  }),
});
```

### 步驟 2: API Route 處理

`app/api/generate-with-agents/route.ts` 接收請求並：
1. 驗證參數
2. 可選地執行 web search
3. 構建 `skillContext`
4. 調用 `orchestrator.generateQuestions()`

### 步驟 3: Orchestrator 協調

`lib/llm/agent-skills/orchestrator.ts` 的 `generateSingleItem()` 方法：

1. **標準化時間參數**：
   ```typescript
   const timeLimit = taskParams.minutesPerProblem 
     || taskParams.minutesPerQuestion  // exams 模組
     || taskParams.estimatedTime;
   ```

2. **調用 question-generator skill**：
   ```typescript
   const questionInput: SkillInput = {
     context: enhancedContext,
     taskType: moduleType,
     questionType: selectedQuestionType,
     difficulty: taskParams.difficulty || 'medium',
     timeLimit: timeLimit,  // 傳遞給 skill
     points: taskParams.points || (moduleType === 'drills' ? 5 : 10),
     constraints: taskParams.constraints,
   };
   ```

### 步驟 4: Question Generator Skill 使用 Skills

`lib/llm/agent-skills/skills/question-generator.ts` 的 `execute()` 方法：

1. **計算難易度**（使用 module-difficulty-guidelines）：
   ```typescript
   const difficulty = providedDifficulty || calculateDifficulty(taskType, timeLimit);
   ```
   - `calculateDifficulty()` 根據模組類型和時間限制自動計算：
     - Drills: Easy ≤ 8 min, Medium ≤ 10 min
     - Labs: Easy ≤ 30 min, Medium ≤ 45 min
     - Homework: Easy ≤ 20 min, Medium ≤ 25 min
     - Exams: Easy ≤ 8 min, Medium ≤ 12 min

2. **獲取問題類型指導原則**（使用 question-type-guidelines）：
   ```typescript
   const questionTypeGuidelines = getQuestionTypeGuidelines(
     questionType, 
     difficulty, 
     taskType, 
     timeLimit
   );
   ```
   - 返回包含問題類型特定規格、難易度特徵、要求等的詳細指導原則

3. **構建 LLM Prompt**：
   - 將 `questionTypeGuidelines` 包含在 system prompt 中
   - 確保 LLM 根據問題類型和模組類型生成適當難易度的題目

## 驗證清單

### ✅ 已完成的實施

1. **Orchestrator**：
   - ✅ 正確處理 `minutesPerProblem` 和 `minutesPerQuestion`
   - ✅ 將 `timeLimit` 傳遞給 question-generator skill
   - ✅ 添加了日誌記錄參數

2. **Question Generator Skill**：
   - ✅ 導入並使用 `calculateDifficulty()` 和 `getQuestionTypeGuidelines()`
   - ✅ 自動計算難易度（如果未提供）
   - ✅ 在 prompt 中包含問題類型特定的指導原則
   - ✅ 添加了日誌記錄

3. **Question Type Specs**：
   - ✅ 定義了所有 12 種問題類型的完整規格
   - ✅ 實現了模組特定的難易度計算
   - ✅ 實現了問題類型特定的指導原則生成
   - ✅ 添加了詳細的日誌記錄

4. **所有模組前端**：
   - ✅ Drills: 使用 `minutesPerProblem`
   - ✅ Labs: 使用 `minutesPerProblem`
   - ✅ Homework: 使用 `minutesPerProblem`
   - ✅ Exams: 使用 `minutesPerQuestion`（已處理）

## 使用示例

### 示例 1: In-Class Drills
```typescript
// 前端調用
taskParams: {
  minutesPerProblem: 8,  // 會計算為 "easy" 難易度
  typeCounts: { coding: 5, multiple_choice: 3 }
}

// Orchestrator 處理
timeLimit = 8
difficulty = calculateDifficulty('drills', 8) // 返回 'easy'

// Question Generator 使用
questionTypeGuidelines = getQuestionTypeGuidelines('coding', 'easy', 'drills', 8)
// 返回包含 coding 問題的 easy 難易度特徵和要求的詳細指導原則
```

### 示例 2: Lab Practices
```typescript
// 前端調用
taskParams: {
  minutesPerProblem: 45,  // 會計算為 "medium" 難易度
  typeCounts: { coding: 3, design: 2 }
}

// Orchestrator 處理
timeLimit = 45
difficulty = calculateDifficulty('labs', 45) // 返回 'medium'

// Question Generator 使用
questionTypeGuidelines = getQuestionTypeGuidelines('design', 'medium', 'labs', 45)
// 返回包含 design 問題的 medium 難易度特徵和要求的詳細指導原則
```

### 示例 3: Exam Generator
```typescript
// 前端調用
taskParams: {
  minutesPerQuestion: 12,  // 會計算為 "medium" 難易度
  typeCounts: { multiple_choice: 10, short_answer: 5 }
}

// Orchestrator 處理
timeLimit = taskParams.minutesPerQuestion // 12
difficulty = calculateDifficulty('exams', 12) // 返回 'medium'

// Question Generator 使用
questionTypeGuidelines = getQuestionTypeGuidelines('multiple_choice', 'medium', 'exams', 12)
// 返回包含 multiple_choice 問題的 medium 難易度特徵和要求的詳細指導原則
```

## 日誌記錄

系統現在會在以下位置記錄 skills 的使用：

1. **Orchestrator**：
   ```
   [Orchestrator] Question input parameters: { questionType, difficulty, timeLimit, moduleType, points }
   ```

2. **Question Generator**：
   ```
   [question-generator] Using question type guidelines for {questionType} ({difficulty} difficulty, {timeLimit} min)
   ```

3. **Question Type Specs**：
   ```
   [question-type-specs] Calculated difficulty for {moduleType}: {difficulty} (timeLimit: {timeLimit} min, thresholds: ...)
   [question-type-specs] Generated guidelines for {questionType} ({difficulty}, {moduleType}, {timeLimit} min)
   ```

## 測試建議

1. **測試不同模組**：
   - 在每個模組中生成題目
   - 檢查 terminal 日誌確認 skills 被調用
   - 驗證生成的題目符合預期的難易度

2. **測試不同時間限制**：
   - 測試每個模組的 easy/medium/hard 閾值
   - 驗證難易度計算正確

3. **測試不同問題類型**：
   - 測試所有 12 種問題類型
   - 驗證每種類型都有適當的指導原則

4. **檢查第二語言**：
   - 確保第二語言翻譯正確生成
   - 驗證所有模組都正確顯示 secondary 欄位

## 總結

所有四個模組現在都：
1. ✅ 正確傳遞時間參數（`minutesPerProblem` 或 `minutesPerQuestion`）
2. ✅ 通過 orchestrator 調用 question-generator skill
3. ✅ 自動使用 `calculateDifficulty()` 計算難易度
4. ✅ 自動使用 `getQuestionTypeGuidelines()` 獲取問題類型特定的指導原則
5. ✅ 在 LLM prompt 中包含詳細的指導原則，確保生成符合規格的題目

新的 skills 已經完全整合到所有模組的生成流程中。
