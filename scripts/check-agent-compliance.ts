#!/usr/bin/env ts-node

/**
 * Agent Skills Compliance Checker
 * 
 * This script ensures that all modules follow the agent skills architecture.
 * Run this before committing or in CI/CD pipeline.
 * 
 * Usage: npm run check:agent-compliance
 */

import * as fs from 'fs';
import * as path from 'path';

interface ComplianceIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

const issues: ComplianceIssue[] = [];

// Rules
const RULES = {
  NO_DIRECT_LLM_CALLS: {
    pattern: /fetch\(['"]\/api\/proxy-llm['"]/,
    message: 'Direct LLM API calls are forbidden. Use orchestrator instead.',
    severity: 'error' as const,
  },
  NO_BUILD_PROMPT: {
    pattern: /buildPrompt\(|buildRegeneratePrompt\(/,
    message: 'buildPrompt() is deprecated. Use orchestrator.generateQuestions() instead.',
    severity: 'error' as const,
  },
  MUST_IMPORT_ORCHESTRATOR: {
    pattern: /from ['"]@\/lib\/llm\/agent-skills['"]/,
    message: 'Modules should import orchestrator from agent-skills',
    severity: 'warning' as const,
    required: true,
  },
};

function checkFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let hasOrchestratorImport = false;
  let hasDirectLLMCall = false;
  let hasBuildPrompt = false;

  lines.forEach((line, index) => {
    // Check for orchestrator import
    if (RULES.MUST_IMPORT_ORCHESTRATOR.pattern.test(line)) {
      hasOrchestratorImport = true;
    }

    // Check for direct LLM calls
    if (RULES.NO_DIRECT_LLM_CALLS.pattern.test(line)) {
      hasDirectLLMCall = true;
      issues.push({
        file: filePath,
        line: index + 1,
        severity: RULES.NO_DIRECT_LLM_CALLS.severity,
        rule: 'NO_DIRECT_LLM_CALLS',
        message: RULES.NO_DIRECT_LLM_CALLS.message,
      });
    }

    // Check for buildPrompt usage
    if (RULES.NO_BUILD_PROMPT.pattern.test(line)) {
      hasBuildPrompt = true;
      issues.push({
        file: filePath,
        line: index + 1,
        severity: RULES.NO_BUILD_PROMPT.severity,
        rule: 'NO_BUILD_PROMPT',
        message: RULES.NO_BUILD_PROMPT.message,
      });
    }
  });

  // If file has LLM calls but no orchestrator import, warn
  if ((hasDirectLLMCall || hasBuildPrompt) && !hasOrchestratorImport) {
    issues.push({
      file: filePath,
      line: 1,
      severity: 'error',
      rule: 'MUST_IMPORT_ORCHESTRATOR',
      message: 'File makes LLM calls but does not import orchestrator',
    });
  }
}

function checkSkillsRegistry(): void {
  const registryPath = path.join(process.cwd(), 'lib', 'llm', 'agent-skills', 'registry.ts');
  const skillsDir = path.join(process.cwd(), 'lib', 'llm', 'agent-skills', 'skills');

  if (!fs.existsSync(registryPath)) {
    issues.push({
      file: 'lib/llm/agent-skills/registry.ts',
      line: 0,
      severity: 'error',
      rule: 'REGISTRY_MISSING',
      message: 'Skills registry file is missing!',
    });
    return;
  }

  if (!fs.existsSync(skillsDir)) {
    return; // Skills directory doesn't exist yet
  }

  const registryContent = fs.readFileSync(registryPath, 'utf-8');
  const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.ts'));

  skillFiles.forEach(skillFile => {
    const skillName = skillFile.replace('.ts', '');
    const className = skillName
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'Skill';

    // Check if skill is imported
    if (!registryContent.includes(`from './skills/${skillName}'`)) {
      issues.push({
        file: 'lib/llm/agent-skills/registry.ts',
        line: 0,
        severity: 'warning',
        rule: 'SKILL_NOT_IMPORTED',
        message: `Skill '${skillName}' exists but is not imported in registry`,
      });
    }

    // Check if skill is registered
    if (!registryContent.includes(`new ${className}()`)) {
      issues.push({
        file: 'lib/llm/agent-skills/registry.ts',
        line: 0,
        severity: 'warning',
        rule: 'SKILL_NOT_REGISTERED',
        message: `Skill '${className}' is imported but not registered`,
      });
    }
  });
}

function scanModules(): void {
  const modulesDir = path.join(process.cwd(), 'components', 'modules');
  
  if (!fs.existsSync(modulesDir)) {
    console.log('⚠️  Modules directory not found, skipping module check');
    return;
  }

  const moduleFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith('.tsx'));

  moduleFiles.forEach(file => {
    const filePath = path.join(modulesDir, file);
    checkFile(filePath);
  });
}

function printReport(): void {
  console.log('\n🔍 Agent Skills Compliance Check\n');
  console.log('='.repeat(60));

  if (issues.length === 0) {
    console.log('✅ All checks passed! No compliance issues found.\n');
    return;
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`\n❌ Found ${errors.length} error(s):\n`);
    errors.forEach(issue => {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Rule: ${issue.rule}`);
      console.log(`  Message: ${issue.message}\n`);
    });
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  Found ${warnings.length} warning(s):\n`);
    warnings.forEach(issue => {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Rule: ${issue.rule}`);
      console.log(`  Message: ${issue.message}\n`);
    });
  }

  console.log('='.repeat(60));
  console.log(`\n📊 Summary: ${errors.length} errors, ${warnings.length} warnings`);
  console.log('\n📖 See AGENT_SKILLS_GUIDELINES.md for details\n');

  if (errors.length > 0) {
    process.exit(1);
  }
}

// Main execution
try {
  console.log('Starting compliance check...\n');
  
  scanModules();
  checkSkillsRegistry();
  
  printReport();
} catch (error) {
  console.error('❌ Compliance check failed:', error);
  process.exit(1);
}



