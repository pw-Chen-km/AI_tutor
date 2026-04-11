/**
 * Bilingual Translator Skill
 * 
 * Translates content to a secondary language.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class BilingualTranslatorSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'bilingual_translator',
    description: 'Translate educational content to secondary language',
    category: 'content_enhancement',
    version: '1.0.0',
    estimatedTokens: 400,
    requiredInputs: ['content', 'targetLanguage'],
    optionalInputs: ['sourceLanguage', 'preserveFormatting', 'technicalTerms'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    // Skip if target language is 'none'
    if (input.targetLanguage.toLowerCase() === 'none') {
      return this.success({ translated: '' }, 0, { skipped: true });
    }

    this.log('info', `Translating to ${input.targetLanguage}`);

    try {
      const { content, targetLanguage, sourceLanguage, preserveFormatting, technicalTerms } = input;

      const messages = [
        {
          role: 'system',
          content: `You are an expert translator specializing in educational content.

Task: Translate the following educational content while preserving technical accuracy.

Source language: ${sourceLanguage || context.languageConfig.primaryLanguage}
Target language: ${targetLanguage}

Requirements:
- Maintain technical terminology accuracy
- Preserve code blocks and formatting ${preserveFormatting ? '(critical)' : ''}
- Keep mathematical notation unchanged
- Adapt idioms and expressions appropriately
${technicalTerms ? `\n- Technical terms to preserve: ${JSON.stringify(technicalTerms)}` : ''}

⚠️ CRITICAL: You MUST output ONLY valid JSON. No markdown, no code fences, no explanations, no additional text.
Output ONLY this JSON structure:
{
  "translated": "string (the translated content)",
  "notes": "string (optional translation notes)"
}`
        },
        {
          role: 'user',
          content: `Content to translate:\n\n${typeof content === 'string' ? content : JSON.stringify(content, null, 2)}\n\nReturn ONLY valid JSON: {"translated": "the translated text", "notes": "optional"}. No other text.`
        }
      ];

      const { content: result, tokensUsed } = await this.callLLM(messages, context);

      this.log('info', `Translation completed`);
      
      return this.success(result, tokensUsed, {
        sourceLanguage: sourceLanguage || context.languageConfig.primaryLanguage,
        targetLanguage,
      });

    } catch (error: any) {
      this.log('error', 'Failed to translate', error);
      return this.error(error.message || 'Failed to translate');
    }
  }
}



