import type { LLMConfig } from '@/lib/store';
import type { DocumentIntakeLLMConfig } from '@/lib/document-intake/types';

const PROVIDER_DEFAULTS: Record<LLMConfig['provider'], { baseURL: string; model: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5.5' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  anthropic: { baseURL: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
  custom: { baseURL: 'http://localhost:11434/v1', model: 'llama3' },
};

const ENV_KEYS_BY_PROVIDER: Record<LLMConfig['provider'], string[]> = {
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  custom: ['CUSTOM_LLM_API_KEY'],
};

function readFirstEnv(keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function normalizeProvider(value?: string): LLMConfig['provider'] {
  const provider = String(value || 'openai').toLowerCase();
  if (provider === 'gemini' || provider === 'deepseek' || provider === 'anthropic' || provider === 'custom') {
    return provider;
  }
  return 'openai';
}

export class PlatformLLMConfigError extends Error {
  constructor() {
    super('Platform AI service is not configured. Please contact an administrator.');
    this.name = 'PlatformLLMConfigError';
  }
}

export function getPlatformLLMConfig(): LLMConfig | null {
  const provider = normalizeProvider(process.env.PLATFORM_LLM_PROVIDER);
  const defaults = PROVIDER_DEFAULTS[provider];
  const apiKey = readFirstEnv(['PLATFORM_LLM_API_KEY', ...ENV_KEYS_BY_PROVIDER[provider]]);

  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    apiKeys: {
      openai: provider === 'openai' ? apiKey : '',
      gemini: provider === 'gemini' ? apiKey : '',
      anthropic: provider === 'anthropic' ? apiKey : '',
      deepseek: provider === 'deepseek' ? apiKey : '',
      custom: provider === 'custom' ? apiKey : '',
    },
    baseURL: process.env.PLATFORM_LLM_BASE_URL?.trim() || defaults.baseURL,
    model: process.env.PLATFORM_LLM_MODEL?.trim() || defaults.model,
    providerModels: { [provider]: process.env.PLATFORM_LLM_MODEL?.trim() || defaults.model },
  };
}

export function getRequiredPlatformLLMConfig(): LLMConfig {
  const config = getPlatformLLMConfig();
  if (!config) throw new PlatformLLMConfigError();
  return config;
}

export function getPlatformDocumentIntakeConfig(): DocumentIntakeLLMConfig | undefined {
  const config = getPlatformLLMConfig();
  if (!config) return undefined;
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
  };
}

