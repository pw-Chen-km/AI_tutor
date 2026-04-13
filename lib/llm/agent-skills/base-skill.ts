/**
 * Base Skill Class
 * 
 * Provides common functionality for all agent skills.
 */

import { AgentSkill, SkillInput, SkillOutput, SkillContext, SkillMetadata } from './types';

export abstract class BaseSkill implements AgentSkill {
  abstract metadata: SkillMetadata;

  /**
   * Execute the skill (must be implemented by subclasses)
   */
  abstract execute(input: SkillInput, context: SkillContext): Promise<SkillOutput>;

  /**
   * Validate input (can be overridden by subclasses)
   */
  validateInput(input: SkillInput): { valid: boolean; error?: string } {
    // Check required inputs
    for (const required of this.metadata.requiredInputs ?? []) {
      if (!(required in input) || input[required] === undefined || input[required] === null) {
        return {
          valid: false,
          error: `Missing required input: ${required}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Log skill execution (for debugging and monitoring)
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${this.metadata.name}] [${level.toUpperCase()}] ${message}`;
    
    if (level === 'error') {
      console.error(logMessage, data || '');
    } else if (level === 'warn') {
      console.warn(logMessage, data || '');
    } else {
      console.log(logMessage, data || '');
    }
  }

  /**
   * Call LLM with error handling and token tracking
   * This works both in browser and server environments
   */
  protected async callLLM(
    messages: any[],
    context: SkillContext,
    options?: { temperature?: number; maxTokens?: number; pdfFileData?: string; pdfFilename?: string }
  ): Promise<{ content: any; tokensUsed: number }> {
    try {
      // In server environment, call LLM directly
      // In browser environment, use fetch (but this shouldn't happen for agent skills)
      const { apiKey, baseURL, model } = context.llmConfig;
      
      if (!apiKey) {
        throw new Error('LLM API key is missing');
      }

      // Detect if using Gemini API
      const isGemini = baseURL?.includes('generativelanguage.googleapis.com') || 
                       model?.includes('gemini');

      let content: any;
      let tokenUsage: any = null;

      if (isGemini) {
        // Call Gemini API directly
        const geminiBase = (baseURL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
        const apiVersion = 'v1beta';
        let geminiModel = (model || '').trim() || 'gemini-1.5-flash';
        let apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        
        // Convert OpenAI format to Gemini format
        type GeminiMessage = { role: string; parts: Array<{ text: string }> };
        const geminiMessages: GeminiMessage[] = messages.map((msg: any) => ({
          role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
          parts: [{ text: msg.content }]
        }));

        // Merge system messages with user messages for Gemini
        const mergedMessages: GeminiMessage[] = [];
        for (let i = 0; i < geminiMessages.length; i++) {
          if (geminiMessages[i].role === 'user' && i > 0 && geminiMessages[i-1].role === 'user') {
            mergedMessages[mergedMessages.length - 1].parts[0].text += '\n\n' + geminiMessages[i].parts[0].text;
          } else {
            mergedMessages.push(geminiMessages[i]);
          }
        }

        // Retry logic for transient errors (503, 429, 500)
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;
        const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
        
        let response: Response | null = null;
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
              this.log('warn', `Retrying Gemini API call (attempt ${attempt + 1}/${MAX_RETRIES + 1}, waiting ${delay}ms)...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            response = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: mergedMessages,
                generationConfig: {
                  temperature: options?.temperature ?? 0.7,
                  maxOutputTokens: options?.maxTokens ?? 16384,
                  responseMimeType: 'application/json',
                },
              }),
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => '');
              // Retry on transient errors
              if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
                lastError = new Error(`Gemini API Error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
                this.log('warn', `Gemini API returned ${response.status}, will retry...`);
                continue;
              }
              throw new Error(`Gemini API Error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
            }
            
            // Success - break out of retry loop
            break;
          } catch (error: any) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
              this.log('warn', `Gemini API call failed (attempt ${attempt + 1}), will retry: ${error.message}`);
              continue;
            }
            throw error;
          }
        }
        
        if (!response || !response.ok) {
          throw lastError || new Error('Failed to get response from Gemini API');
        }

        const data = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawContent) {
          throw new Error('No content received from Gemini');
        }

        // Parse JSON
        const { jsonrepair } = await import('jsonrepair');
        let jsonContent: any;
        try {
          // Try direct parse first
          jsonContent = JSON.parse(rawContent);
        } catch {
          // Try to extract from markdown code fences
          const fenced = rawContent.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ?? rawContent.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
          const candidate = (fenced ?? rawContent).trim();
          try {
            jsonContent = JSON.parse(jsonrepair(candidate));
          } catch (parseError: any) {
            // Try to extract JSON object from text
            const jsonMatch = candidate.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                jsonContent = JSON.parse(jsonrepair(jsonMatch[0]));
              } catch (innerError: any) {
                // jsonMatch found but still can't parse - use fallback
                if (this.metadata.name === 'solution_generator' || this.metadata.name === 'question_generator') {
                  this.log('warn', `${this.metadata.name} JSON parse failed even after extraction; applying fallback`, {
                    contentPreview: candidate.substring(0, 200),
                    error: innerError.message,
                  });
                  jsonContent = this.metadata.name === 'solution_generator' 
                    ? { solution: candidate || rawContent, explanation: '', key_points: [], common_mistakes: [] }
                    : { question: candidate || rawContent, type: 'short_answer', sources: [] };
                } else {
                  throw new Error(`Failed to parse JSON: ${innerError.message}`);
                }
              }
            } else {
              if (this.metadata.name === 'solution_generator' || this.metadata.name === 'question_generator') {
                this.log('warn', `${this.metadata.name} returned non-JSON content; applying fallback`, {
                  contentPreview: candidate.substring(0, 200),
                });
                jsonContent = this.metadata.name === 'solution_generator'
                  ? { solution: candidate || rawContent, explanation: '', key_points: [], common_mistakes: [] }
                  : { question: candidate || rawContent, type: 'short_answer', sources: [] };
              } else {
                throw new Error(`Failed to parse JSON: ${parseError.message}`);
              }
            }
          }
        }

        content = jsonContent;
        
        // Extract token usage
        if (data.usageMetadata) {
          tokenUsage = {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          };
        }
      } else {
        // Call OpenAI-compatible API
        const { default: OpenAI, toFile } = await import('openai');
        const client = new OpenAI({
          apiKey: apiKey,
          baseURL: baseURL || 'https://api.openai.com/v1',
        });
        const shouldUsePdfResponsesApi =
          context.llmConfig.provider === 'openai' &&
          !!options?.pdfFileData &&
          !!options?.pdfFilename;

        let rawContent = '';

        if (shouldUsePdfResponsesApi) {
          const systemText = messages
            .filter((message: any) => message?.role === 'system' && typeof message?.content === 'string')
            .map((message: any) => message.content.trim())
            .filter(Boolean)
            .join('\n\n');
          const promptText = messages
            .filter((message: any) => message?.role !== 'system')
            .map((message: any) => {
              const role = typeof message?.role === 'string' ? message.role.toUpperCase() : 'USER';
              const contentText = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
              return `${role}:\n${contentText}`;
            })
            .join('\n\n');
          const cleanBase64 = String(options?.pdfFileData || '').replace(/^data:application\/pdf;base64,/, '');
          const uploadedFile = await client.files.create({
            file: await toFile(Buffer.from(cleanBase64, 'base64'), String(options?.pdfFilename || 'sample.pdf'), {
              type: 'application/pdf',
            }),
            purpose: 'user_data',
          });
          const response: any = await client.responses.create({
            model: model || 'gpt-4.1',
            instructions: systemText,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_file', file_id: uploadedFile.id },
                  { type: 'input_text', text: promptText },
                ],
              },
            ],
            text: {
              format: {
                type: 'json_object',
              },
            },
            max_output_tokens: options?.maxTokens || 4000,
          });
          rawContent = String(response?.output_text || '').trim();
          if (response?.usage) {
            tokenUsage = {
              promptTokens: response.usage.input_tokens || 0,
              completionTokens: response.usage.output_tokens || 0,
              totalTokens: response.usage.total_tokens || 0,
            };
          }
        } else {
          const response = await client.chat.completions.create({
            model: model || 'gpt-4',
            messages: messages,
            response_format: { type: "json_object" },
            temperature: options?.temperature,
            // gpt-5.4-mini may reject `max_tokens`; use `max_completion_tokens` instead.
            max_completion_tokens: options?.maxTokens || 16000,
          });

          rawContent = response.choices[0]?.message?.content || '';

          // Extract token usage
          if (response.usage) {
            tokenUsage = {
              promptTokens: response.usage.prompt_tokens || 0,
              completionTokens: response.usage.completion_tokens || 0,
              totalTokens: response.usage.total_tokens || 0,
            };
          }
        }

        if (!rawContent) {
          throw new Error('No content received from LLM');
        }

        // Parse JSON
        const { jsonrepair } = await import('jsonrepair');
        let jsonContent: any;
        try {
          jsonContent = JSON.parse(rawContent);
        } catch {
          // Try to extract from markdown code fences
          const fenced = rawContent.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ?? rawContent.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
          const candidate = (fenced ?? rawContent).trim();
          try {
            jsonContent = JSON.parse(jsonrepair(candidate));
          } catch (parseError: any) {
            // Try to extract JSON object from text
            const jsonMatch = candidate.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                jsonContent = JSON.parse(jsonrepair(jsonMatch[0]));
              } catch (innerError: any) {
                // jsonMatch found but still can't parse - use fallback
                if (this.metadata.name === 'solution_generator' || this.metadata.name === 'question_generator') {
                  this.log('warn', `${this.metadata.name} JSON parse failed even after extraction; applying fallback`, {
                    contentPreview: candidate.substring(0, 200),
                    error: innerError.message,
                  });
                  jsonContent = this.metadata.name === 'solution_generator'
                    ? { solution: candidate || rawContent, explanation: '', key_points: [], common_mistakes: [] }
                    : { question: candidate || rawContent, type: 'short_answer', sources: [] };
                } else {
                  throw new Error(`Failed to parse JSON: ${innerError.message}`);
                }
              }
            } else {
              if (this.metadata.name === 'solution_generator' || this.metadata.name === 'question_generator') {
                this.log('warn', `${this.metadata.name} returned non-JSON content; applying fallback`, {
                  contentPreview: candidate.substring(0, 200),
                });
                jsonContent = this.metadata.name === 'solution_generator'
                  ? { solution: candidate || rawContent, explanation: '', key_points: [], common_mistakes: [] }
                  : { question: candidate || rawContent, type: 'short_answer', sources: [] };
              } else {
                throw new Error(`Failed to parse JSON: ${parseError.message}`);
              }
            }
          }
        }

        content = jsonContent;
      }
      
      // Log the actual content received for debugging
      this.log('info', 'LLM response content', {
        contentType: typeof content,
        contentKeys: content && typeof content === 'object' ? Object.keys(content) : 'not an object',
        contentPreview: typeof content === 'string' 
          ? content.substring(0, 200) 
          : JSON.stringify(content).substring(0, 200),
      });
      
      // Validate content is not empty
      if (!content || (typeof content === 'object' && Object.keys(content).length === 0 && !Array.isArray(content))) {
        this.log('error', 'Empty content from LLM', {
          hasContent: !!content,
          contentKeys: content && typeof content === 'object' ? Object.keys(content) : [],
          content,
        });
        throw new Error('LLM returned empty or invalid content');
      }
      
      // Validate that content has expected structure for question/solution generators
      if (this.metadata.name === 'question_generator') {
        if (typeof content === 'object' && !content.question && !content.description) {
          this.log('error', 'Question generator returned invalid structure', {
            content,
            contentKeys: Object.keys(content),
          });
          throw new Error('LLM response missing required "question" or "description" field');
        }
      }
      
      if (this.metadata.name === 'solution_generator') {
        if (typeof content === 'object' && !content.solution && !content.code && !content.answer) {
          this.log('error', 'Solution generator returned invalid structure', {
            content,
            contentKeys: Object.keys(content),
          });
          throw new Error('LLM response missing required "solution", "code", or "answer" field');
        }
      }
      
      // Calculate tokens used
      const tokensUsed = tokenUsage?.totalTokens 
        ? tokenUsage.totalTokens 
        : tokenUsage?.promptTokens && tokenUsage?.candidatesTokens
        ? tokenUsage.promptTokens + tokenUsage.candidatesTokens
        : tokenUsage?.promptTokens && tokenUsage?.completionTokens
        ? tokenUsage.promptTokens + tokenUsage.completionTokens
        : Math.round((JSON.stringify(messages).length + JSON.stringify(content).length) / 4);

      return {
        content,
        tokensUsed: Math.round(tokensUsed),
      };
    } catch (error: any) {
      this.log('error', 'LLM call failed', error);
      throw error;
    }
  }

  /**
   * Create a success output
   */
  protected success(data: any, tokensUsed?: number, metadata?: Record<string, any>): SkillOutput {
    return {
      success: true,
      data,
      tokensUsed,
      metadata,
    };
  }

  /**
   * Create an error output
   */
  protected error(errorMessage: string, metadata?: Record<string, any>): SkillOutput {
    return {
      success: false,
      error: errorMessage,
      metadata,
    };
  }
}

