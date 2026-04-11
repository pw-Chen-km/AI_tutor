# Agent Skills System Guidelines

## 🎯 Purpose

This document defines the mandatory architecture for ALL new modules in this project. The Agent Skills system provides:

- ✅ **Modularity**: Each skill focuses on a single, testable task
- ✅ **Token Efficiency**: Skills are called only when needed, avoiding monolithic prompts
- ✅ **Reusability**: Skills can be composed in different workflows
- ✅ **Maintainability**: Changes to one skill don't affect others
- ✅ **Testability**: Each skill can be tested independently

---

## 🚫 MANDATORY RULES

### Rule 1: NO Direct LLM Calls in Modules

**❌ FORBIDDEN:**
```typescript
// components/modules/my-new-module.tsx
const response = await fetch('/api/proxy-llm', {
  method: 'POST',
  body: JSON.stringify({ messages: [...] })
});
```

**✅ REQUIRED:**
```typescript
// components/modules/my-new-module.tsx
import { orchestrator } from '@/lib/llm/agent-skills';

const results = await orchestrator.generateQuestions({
  moduleType: 'my_module',
  numberOfItems: 5,
  context,
  taskParams: { ... },
  llmContext: { llmConfig, languageConfig, ... }
});
```

### Rule 2: NO Monolithic Prompts

**❌ FORBIDDEN:**
```typescript
const prompt = `Generate 10 questions with solutions, hints, explanations, 
and translate everything to Chinese, and check quality...`;
// (This wastes tokens and is hard to debug)
```

**✅ REQUIRED:**
Break into separate skills:
1. `question_generator` - Generate question only
2. `solution_generator` - Generate solution only
3. `bilingual_translator` - Translate only
4. `quality_checker` - Validate only

### Rule 3: ALL New Modules Must Use Orchestrator

Every new module must:
1. Import `orchestrator` from `@/lib/llm/agent-skills`
2. Call `orchestrator.generateQuestions()` or `orchestrator.regenerateItem()`
3. NOT call `/api/proxy-llm` directly
4. NOT use `buildPrompt()` or `buildRegeneratePrompt()` directly (deprecated)

---

## 📦 Creating a New Module

### Step 1: Identify Required Skills

Before creating a new module, identify which skills you need:

- Question generation? → `question_generator`
- Solution generation? → `solution_generator`
- Translation? → `bilingual_translator`
- Quality check? → `quality_checker`
- Custom formatting? → `content_formatter`

### Step 2: Create New Skills (If Needed)

If existing skills don't meet your needs, create a new skill:

```typescript
// lib/llm/agent-skills/skills/my-new-skill.ts
import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class MyNewSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'my_new_skill',
    description: 'Clear description of what this skill does',
    category: 'content_generation', // or content_enhancement, validation, specialized
    version: '1.0.0',
    estimatedTokens: 500,
    requiredInputs: ['param1', 'param2'],
    optionalInputs: ['param3'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    try {
      // Your skill logic here
      const messages = [{ role: 'system', content: '...' }];
      const { content, tokensUsed } = await this.callLLM(messages, context);
      
      return this.success(content, tokensUsed);
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
```

### Step 3: Register Your Skill

Add to `lib/llm/agent-skills/registry.ts`:

```typescript
import { MyNewSkill } from './skills/my-new-skill';

private registerDefaultSkills(): void {
  // ... existing skills ...
  this.register(new MyNewSkill());
}
```

### Step 4: Use in Module

```typescript
// components/modules/my-new-module.tsx
import { orchestrator } from '@/lib/llm/agent-skills';

const handleGenerate = async () => {
  const results = await orchestrator.generateQuestions({
    moduleType: 'my_module',
    numberOfItems: 10,
    context: contextFiles.map(f => f.content).join('\n'),
    taskParams: {
      questionType: 'coding',
      difficulty: 'medium',
      // ... other params
    },
    llmContext: {
      llmConfig,
      languageConfig,
      subject,
    },
  });
  
  setGeneratedContent('my_module', results);
};
```

---

## 🔍 Automated Compliance Checking

### Pre-commit Hook

Run the compliance checker before every commit:

```bash
npm run check:agent-compliance
```

### What It Checks

1. ✅ No direct `/api/proxy-llm` calls in module files
2. ✅ No direct `buildPrompt()` usage in modules
3. ✅ Imports `orchestrator` from `@/lib/llm/agent-skills`
4. ✅ All new skills are registered in registry
5. ✅ All skills extend `BaseSkill`

### CI/CD Integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: Check Agent Skills Compliance
  run: npm run check:agent-compliance
```

---

## 📊 Benefits Tracking

### Token Usage Reduction

Before agent skills:
```
Average tokens per question: ~1500 tokens
(Large prompt with all instructions)
```

After agent skills:
```
question_generator: ~500 tokens
solution_generator: ~800 tokens
bilingual_translator: ~400 tokens
---
Total: ~1700 tokens (but modular and reusable)
```

### Reusability

One skill can be used across multiple modules:
- `question_generator` → Used in drills, labs, homework, exams
- `bilingual_translator` → Used in ALL modules
- `quality_checker` → Can be enabled/disabled per module

---

## ⚠️ Migration Notes

### Deprecation Timeline

- **Phase 1 (Current)**: New modules MUST use agent skills
- **Phase 2 (Next sprint)**: Existing modules will be refactored
- **Phase 3 (Future)**: Old system (`buildPrompt`, direct LLM calls) will be removed

### Legacy Code

Existing modules using old approach are marked with `// TODO: Migrate to agent skills`

---

## 🆘 Getting Help

If you're unsure how to implement something with agent skills:

1. Check existing skills in `lib/llm/agent-skills/skills/`
2. Review the orchestrator implementation
3. Ask in team chat with `#agent-skills` tag
4. Read the `orchestrator.ts` code for examples

---

## 📝 Checklist for New Features

Before submitting a PR for a new module:

- [ ] Does NOT call `/api/proxy-llm` directly
- [ ] Does NOT use `buildPrompt()` or `buildRegeneratePrompt()`
- [ ] DOES import and use `orchestrator`
- [ ] DOES register any new skills in registry
- [ ] DOES pass `npm run check:agent-compliance`
- [ ] DOES include tests for new skills (if any)
- [ ] DOES update this guideline if introducing new patterns

---

## 🎓 Example: Converting Old Code to Agent Skills

### Before (OLD - Don't do this):

```typescript
const prompt = buildPrompt({
  context,
  taskType: 'drills',
  additionalParams: { difficulty: 'hard' }
});

const response = await fetch('/api/proxy-llm', {
  method: 'POST',
  body: JSON.stringify({ messages: prompt })
});
```

### After (NEW - Do this):

```typescript
const results = await orchestrator.generateQuestions({
  moduleType: 'drills',
  numberOfItems: 5,
  context,
  taskParams: { difficulty: 'hard' },
  llmContext: { llmConfig, languageConfig, subject }
});
```

**Benefits:**
- ✅ Cleaner code (fewer lines)
- ✅ Better error handling (built into skills)
- ✅ Token tracking (automatic)
- ✅ Logging (automatic)
- ✅ Reusable across modules

---

## 🔐 Enforcement

This is a **mandatory** architectural guideline. PRs violating these rules will be **rejected** with the following message:

> ⚠️ This PR violates the Agent Skills Guidelines. Please refactor to use the orchestrator system. See AGENT_SKILLS_GUIDELINES.md for details.

**Last Updated:** 2025-01-03
**Version:** 1.0.0



