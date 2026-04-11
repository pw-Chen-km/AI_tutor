/**
 * Quality Checker Skill
 * 
 * Validates question and solution quality.
 */

import { BaseSkill } from '../base-skill';
import { SkillInput, SkillOutput, SkillContext, SkillMetadata } from '../types';

export class QualityCheckerSkill extends BaseSkill {
  metadata: SkillMetadata = {
    name: 'quality_checker',
    description: 'Validate content quality and provide improvement suggestions',
    category: 'validation',
    version: '1.0.0',
    estimatedTokens: 300,
    requiredInputs: ['content', 'contentType'],
    optionalInputs: ['criteria', 'targetAudience'],
  };

  async execute(input: SkillInput, context: SkillContext): Promise<SkillOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.error(validation.error!);
    }

    this.log('info', `Checking quality of ${input.contentType}`);

    try {
      const { content, contentType, criteria, targetAudience } = input;

      const messages = [
        {
          role: 'system',
          content: `You are an expert educational content reviewer.

Task: Review the following ${contentType} for quality issues.

Quality criteria:
1. Clarity - Is it easy to understand?
2. Accuracy - Is it technically correct?
3. Completeness - Does it cover all necessary points?
4. Appropriateness - Is it suitable for ${targetAudience || 'the target audience'}?
5. Formatting - Is it well-structured?
${criteria ? `\nAdditional criteria: ${criteria}` : ''}

Output VALID JSON only:
{
  "overallScore": number (1-10),
  "issues": [
    {
      "severity": "critical|warning|minor",
      "category": "string",
      "description": "string",
      "suggestion": "string"
    }
  ],
  "passed": boolean,
  "summary": "string"
}`
        },
        {
          role: 'user',
          content: `Content to review:\n\n${JSON.stringify(content, null, 2)}`
        }
      ];

      const { content: result, tokensUsed } = await this.callLLM(messages, context, { temperature: 0.3 });

      this.log('info', `Quality check completed`);
      
      return this.success(result, tokensUsed, {
        contentType,
      });

    } catch (error: any) {
      this.log('error', 'Failed to check quality', error);
      return this.error(error.message || 'Failed to check quality');
    }
  }
}



