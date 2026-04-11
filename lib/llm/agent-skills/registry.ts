/**
 * Agent Skills Registry
 * 
 * Central registry for all available agent skills.
 * Import and register all skills here.
 */

import { AgentSkill } from './types';
import { QuestionGeneratorSkill } from './skills/question-generator';
import { SolutionGeneratorSkill } from './skills/solution-generator';
import { BilingualTranslatorSkill } from './skills/bilingual-translator';
import { QualityCheckerSkill } from './skills/quality-checker';
import { ContentFormatterSkill } from './skills/content-formatter';
import { ExamFormatterSkill } from './skills/exam-formatter';
import { DocumentPreprocessorSkill } from './skills/document-preprocessor';
import { SourcePlannerSkill } from './skills/source-planner';

export class SkillRegistry {
  private static instance: SkillRegistry;
  private skills: Map<string, AgentSkill>;

  private constructor() {
    this.skills = new Map();
    this.registerDefaultSkills();
  }

  public static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  /**
   * Register all default skills
   */
  private registerDefaultSkills(): void {
    this.register(new QuestionGeneratorSkill());
    this.register(new SolutionGeneratorSkill());
    this.register(new BilingualTranslatorSkill());
    this.register(new QualityCheckerSkill());
    this.register(new ContentFormatterSkill());
    this.register(new ExamFormatterSkill());
    this.register(new DocumentPreprocessorSkill());
    this.register(new SourcePlannerSkill());
  }

  /**
   * Register a new skill
   */
  public register(skill: AgentSkill): void {
    if (this.skills.has(skill.metadata.name)) {
      console.warn(`Skill ${skill.metadata.name} is already registered. Overwriting.`);
    }
    this.skills.set(skill.metadata.name, skill);
    console.log(`✓ Registered skill: ${skill.metadata.name} (v${skill.metadata.version})`);
  }

  /**
   * Get a skill by name
   */
  public getSkill(name: string): AgentSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all skills in a category
   */
  public getSkillsByCategory(category: string): AgentSkill[] {
    return Array.from(this.skills.values()).filter(
      skill => skill.metadata.category === category
    );
  }

  /**
   * Get all registered skill names
   */
  public getAllSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Get skill metadata
   */
  public getSkillMetadata(name: string) {
    const skill = this.skills.get(name);
    return skill ? skill.metadata : null;
  }

  /**
   * Check if a skill exists
   */
  public hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skills with their metadata
   */
  public listAllSkills() {
    return Array.from(this.skills.values()).map(skill => ({
      name: skill.metadata.name,
      category: skill.metadata.category,
      description: skill.metadata.description,
      estimatedTokens: skill.metadata.estimatedTokens,
      version: skill.metadata.version,
    }));
  }
}

// Export singleton instance
export const skillRegistry = SkillRegistry.getInstance();
