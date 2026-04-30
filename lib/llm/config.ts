import type { LLMConfig } from '@/lib/store';

export function getActiveApiKey(config: Partial<LLMConfig> | undefined | null): string {
    if (!config) return '';
    const provider = config.provider || 'openai';
    return config.apiKeys?.[provider] || config.apiKey || '';
}

export function getActiveLLMConfig(config: Partial<LLMConfig> | undefined | null): LLMConfig {
    const provider = config?.provider || 'openai';
    return {
        ...config,
        provider,
        apiKey: getActiveApiKey(config),
        apiKeys: {
            openai: '',
            gemini: '',
            anthropic: '',
            deepseek: '',
            custom: '',
            ...config?.apiKeys,
        },
        baseURL: config?.baseURL || 'https://api.openai.com/v1',
        providerModels: config?.providerModels || {},
        model: config?.providerModels?.[provider] || config?.model || 'gpt-5.5',
    };
}
