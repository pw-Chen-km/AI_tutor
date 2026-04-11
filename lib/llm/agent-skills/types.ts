/**
 * Agent Skills System - Type Definitions
 * 
 * This file defines the core types for the agent skills system.
 * All skills must implement the AgentSkill interface.
 */

export interface SkillInput {
  [key: string]: any;
}

export interface SkillOutput {
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
  metadata?: Record<string, any>;
}

export interface SkillMetadata {
  name: string;
  description: string;
  category: 'content_generation' | 'content_enhancement' | 'validation' | 'specialized' | 'orchestration';
  version: string;
  estimatedTokens: number;
  dependencies?: string[]; // other skills this skill depends on
  requiredInputs: string[];
  optionalInputs?: string[];
}

export interface AgentSkill {
  metadata: SkillMetadata;
  
  /**
   * Execute the skill with given input
   * @param input - Input parameters for the skill
   * @param context - Additional context (LLM config, language settings, etc.)
   * @returns Promise resolving to skill output
   */
  execute(input: SkillInput, context: SkillContext): Promise<SkillOutput>;
  
  /**
   * Validate input before execution
   * @param input - Input to validate
   * @returns True if valid, error message if invalid
   */
  validateInput(input: SkillInput): { valid: boolean; error?: string };
}

export interface SkillContext {
  llmConfig: {
    apiKey: string;
    baseURL: string;
    model: string;
    provider: string;
  };
  languageConfig: {
    primaryLanguage: string;
    secondaryLanguage: string;
  };
  subject?: string;
  additionalParams?: Record<string, any>;
}

export interface TaskPlan {
  taskId: string;
  userRequest: string;
  skills: Array<{
    skillName: string;
    input: SkillInput;
    dependsOn?: string[]; // array of previous step IDs
    stepId: string;
  }>;
  estimatedTotalTokens: number;
  parallelizable: boolean;
}

export interface ExecutionResult {
  success: boolean;
  results: Map<string, SkillOutput>;
  totalTokensUsed: number;
  executionTimeMs: number;
  errors?: Array<{ skillName: string; error: string }>;
}



