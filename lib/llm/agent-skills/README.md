# Agent Skills System

## 📖 Overview

The Agent Skills System is a modular architecture for LLM-based content generation. Instead of using monolithic prompts, we break down complex tasks into small, reusable "skills" that can be orchestrated together.

## 🎯 Why Agent Skills?

### Before (Monolithic Approach)
```
Single LLM call with huge prompt:
"Generate 10 questions WITH solutions WITH translations WITH quality checks..."
→ ~3000 tokens per call
→ Hard to debug
→ Not reusable
→ Inflexible
```

### After (Agent Skills Approach)
```
Orchestrator chains skills:
1. question_generator (500 tokens)
2. solution_generator (800 tokens)
3. bilingual_translator (400 tokens)
4. quality_checker (300 tokens)
→ Total: ~2000 tokens
→ Each skill is testable
→ Highly reusable
→ Easy to modify
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Orchestrator                     │
│  (Plans and executes skill sequences)               │
└────────────────┬────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │   Skill Registry │
        │  (All available  │
        │     skills)      │
        └────────┬─────────┘
                 │
     ┌───────────┼───────────┐
     │           │           │
┌────▼────┐ ┌───▼────┐ ┌───▼────┐
│Question │ │Solution│ │Bilingual│
│Generator│ │Generator│ │Translator│
└─────────┘ └────────┘ └─────────┘
```

## 📁 Directory Structure

```
lib/llm/agent-skills/
├── types.ts                    # Type definitions
├── base-skill.ts               # Base class for all skills
├── registry.ts                 # Central skill registry
├── orchestrator.ts             # Skill orchestration logic
├── index.ts                    # Main exports
├── skills/                     # Individual skills
│   ├── question-generator.ts
│   ├── solution-generator.ts
│   ├── bilingual-translator.ts
│   ├── quality-checker.ts
│   └── content-formatter.ts
└── README.md                   # This file
```

## 🚀 Quick Start

### 1. Using the Orchestrator (Recommended)

```typescript
import { orchestrator } from '@/lib/llm/agent-skills';

const results = await orchestrator.generateQuestions({
  moduleType: 'drills',
  numberOfItems: 5,
  context: 'Your course content here...',
  taskParams: {
    difficulty: 'medium',
    minutesPerProblem: 10,
  },
  llmContext: {
    llmConfig,
    languageConfig,
    subject,
  },
});
```

### 2. Using Individual Skills

```typescript
import { skillRegistry } from '@/lib/llm/agent-skills';

const questionSkill = skillRegistry.getSkill('question_generator');
const result = await questionSkill.execute({
  context: 'Course content...',
  taskType: 'drills',
  questionType: 'coding',
}, llmContext);
```

## 🔧 Creating a New Skill

### Step 1: Create the Skill Class

```typescript
// lib/llm/agent-skills/skills/my-new-skill.ts
import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class MyNewSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'my_new_skill',
    description: 'What this skill does',
    category: 'content_generation',
    version: '1.0.0',
    estimatedTokens: 500,
    requiredInputs: ['input1', 'input2'],
    optionalInputs: ['input3'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    // Validate inputs
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    try {
      // Build prompt
      const messages = [
        { role: 'system', content: 'System prompt...' },
        { role: 'user', content: `User input: ${input.input1}` }
      ];

      // Call LLM (built-in error handling & token tracking)
      const { content, tokensUsed } = await this.callLLM(messages, context);

      // Return success
      return this.success(content, tokensUsed);
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
```

### Step 2: Register the Skill

```typescript
// lib/llm/agent-skills/registry.ts
import { MyNewSkill } from './skills/my-new-skill';

private registerDefaultSkills(): void {
  // ... existing skills ...
  this.register(new MyNewSkill());
}
```

### Step 3: Use the Skill

```typescript
const mySkill = skillRegistry.getSkill('my_new_skill');
const result = await mySkill.execute({ input1: 'test' }, context);
```

## 📊 Available Skills

| Skill Name | Category | Description | Est. Tokens |
|------------|----------|-------------|-------------|
| `question_generator` | Content Generation | Generate a single question | 600 |
| `solution_generator` | Content Generation | Generate solution & explanation | 800 |
| `bilingual_translator` | Content Enhancement | Translate to secondary language | 400 |
| `quality_checker` | Validation | Check content quality | 300 |
| `content_formatter` | Content Enhancement | Format for specific modules | 200 |
| `document_preprocessor` | Specialized | Parse PDF/PPTX into page map, windows, and heuristic hints | 0 |

## 🎭 Skill Categories

- **Content Generation**: Create new content (questions, solutions, etc.)
- **Content Enhancement**: Improve or transform existing content
- **Validation**: Check quality, correctness, compliance
- **Specialized**: Domain-specific tasks (code evaluation, web search)
- **Orchestration**: Meta-skills that plan and coordinate others

## 📝 Best Practices

### DO ✅
- Keep skills focused on ONE task
- Use TypeScript for type safety
- Validate inputs before processing
- Return structured SkillOutput
- Log important steps
- Handle errors gracefully

### DON'T ❌
- Create God skills that do everything
- Skip input validation
- Return raw LLM output without parsing
- Ignore errors
- Hard-code configuration values

## 🧪 Testing Skills

```typescript
import { MyNewSkill } from './skills/my-new-skill';

test('MyNewSkill should generate output', async () => {
  const skill = new MyNewSkill();
  const result = await skill.execute(
    { input1: 'test' },
    mockContext
  );
  
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
});
```

## 🔍 Debugging

Enable logging:
```typescript
const skill = skillRegistry.getSkill('question_generator');
// Logs are automatically written to console
// Look for: [timestamp] [skill_name] [level] message
```

View orchestrator stats:
```typescript
const stats = orchestrator.getStats();
console.log(stats);
// Shows all available skills and their metadata
```

## 📈 Performance Monitoring

Each skill tracks:
- Tokens used
- Execution time
- Success/failure rate

Access via metadata:
```typescript
const result = await skill.execute(input, context);
console.log(result.tokensUsed); // Token count
console.log(result.metadata);   // Additional info
```

## 🔄 Migration from Old System

Old way:
```typescript
const prompt = buildPrompt({ context, taskType: 'drills' });
const response = await fetch('/api/proxy-llm', { ... });
```

New way:
```typescript
const results = await orchestrator.generateQuestions({ ... });
```

See `AGENT_SKILLS_GUIDELINES.md` for full migration guide.

## 📚 Further Reading

- `AGENT_SKILLS_GUIDELINES.md` - Mandatory usage guidelines
- `scripts/check-agent-compliance.ts` - Compliance checker
- `components/modules/drills-module-v2.tsx` - Example implementation

## 🆘 Getting Help

1. Check existing skills for examples
2. Read the base class implementation
3. Review orchestrator logic
4. Ask in team chat with `#agent-skills` tag

---

**Last Updated:** 2025-01-03
**Version:** 1.0.0



