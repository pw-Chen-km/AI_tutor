import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';

// Fetch available models from different providers
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider, apiKey, baseURL } = await request.json();

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    let models: { value: string; label: string }[] = [];

    switch (provider) {
      case 'openai':
        models = await fetchOpenAIModels(apiKey, baseURL);
        break;
      case 'gemini':
        models = await fetchGeminiModels(apiKey);
        break;
      case 'anthropic':
        // Anthropic doesn't have a public models list API
        // Return curated list based on their documentation
        models = getAnthropicModels();
        break;
      case 'deepseek':
        models = await fetchDeepSeekModels(apiKey, baseURL);
        break;
      case 'custom':
        models = await fetchOllamaModels(baseURL);
        break;
      default:
        return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }

    return NextResponse.json({ models });
  } catch (error: any) {
    console.error('[LLM Models API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch models' },
      { status: 500 }
    );
  }
}

// OpenAI Models API
async function fetchOpenAIModels(apiKey?: string, baseURL?: string): Promise<{ value: string; label: string }[]> {
  if (!apiKey) {
    return getOpenAIFallbackModels();
  }

  try {
    const url = `${baseURL || 'https://api.openai.com/v1'}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.warn('[OpenAI] Failed to fetch models, using fallback');
      return getOpenAIFallbackModels();
    }

    const data = await response.json();
    
    // Filter and sort chat models
    const chatModels = data.data
      .filter((model: any) => {
        const id = model.id.toLowerCase();
        // Include GPT models and O1 models, exclude embedding, tts, whisper, dall-e
        return (id.includes('gpt') || id.includes('o1') || id.includes('o3')) &&
               !id.includes('instruct') &&
               !id.includes('embedding') &&
               !id.includes('realtime');
      })
      .map((model: any) => ({
        value: model.id,
        label: formatModelName(model.id, 'openai'),
      }))
      .sort((a: any, b: any) => {
        // Prioritize newer models
        const priority = ['gpt-4o', 'o3', 'o1', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5'];
        const aIndex = priority.findIndex(p => a.value.includes(p));
        const bIndex = priority.findIndex(p => b.value.includes(p));
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.value.localeCompare(b.value);
      });

    return chatModels.length > 0 ? chatModels : getOpenAIFallbackModels();
  } catch (error) {
    console.error('[OpenAI] Error fetching models:', error);
    return getOpenAIFallbackModels();
  }
}

function getOpenAIFallbackModels(): { value: string; label: string }[] {
  return [
    { value: 'gpt-4o', label: 'GPT-4o (Latest)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { value: 'o1-preview', label: 'O1 Preview (Reasoning)' },
    { value: 'o1-mini', label: 'O1 Mini (Reasoning)' },
  ];
}

// Google Gemini Models API
async function fetchGeminiModels(apiKey?: string): Promise<{ value: string; label: string }[]> {
  if (!apiKey) {
    return getGeminiFallbackModels();
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!response.ok) {
      console.warn('[Gemini] Failed to fetch models, using fallback');
      return getGeminiFallbackModels();
    }

    const data = await response.json();
    
    const chatModels = data.models
      .filter((model: any) => {
        // Filter for generative models that support chat
        return model.supportedGenerationMethods?.includes('generateContent') &&
               model.name.includes('gemini');
      })
      .map((model: any) => {
        const modelId = model.name.replace('models/', '');
        return {
          value: modelId,
          label: model.displayName || formatModelName(modelId, 'gemini'),
        };
      })
      .sort((a: any, b: any) => {
        // Prioritize newer versions
        const priority = ['2.0', '1.5-pro', '1.5-flash', '1.0'];
        const aIndex = priority.findIndex(p => a.value.includes(p));
        const bIndex = priority.findIndex(p => b.value.includes(p));
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.value.localeCompare(b.value);
      });

    return chatModels.length > 0 ? chatModels : getGeminiFallbackModels();
  } catch (error) {
    console.error('[Gemini] Error fetching models:', error);
    return getGeminiFallbackModels();
  }
}

function getGeminiFallbackModels(): { value: string; label: string }[] {
  return [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
    { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro' },
  ];
}

// Anthropic - No public models API, use curated list
function getAnthropicModels(): { value: string; label: string }[] {
  // Based on Anthropic's official documentation
  // https://docs.anthropic.com/en/docs/about-claude/models
  return [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Latest)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Fast)' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Most Capable)' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ];
}

// DeepSeek Models
async function fetchDeepSeekModels(apiKey?: string, baseURL?: string): Promise<{ value: string; label: string }[]> {
  if (!apiKey) {
    return getDeepSeekFallbackModels();
  }

  try {
    const url = `${baseURL || 'https://api.deepseek.com/v1'}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.warn('[DeepSeek] Failed to fetch models, using fallback');
      return getDeepSeekFallbackModels();
    }

    const data = await response.json();
    
    const models = data.data
      .map((model: any) => ({
        value: model.id,
        label: formatModelName(model.id, 'deepseek'),
      }))
      .sort((a: any, b: any) => a.value.localeCompare(b.value));

    return models.length > 0 ? models : getDeepSeekFallbackModels();
  } catch (error) {
    console.error('[DeepSeek] Error fetching models:', error);
    return getDeepSeekFallbackModels();
  }
}

function getDeepSeekFallbackModels(): { value: string; label: string }[] {
  return [
    { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder' },
  ];
}

// Ollama Models (for custom/local)
async function fetchOllamaModels(baseURL?: string): Promise<{ value: string; label: string }[]> {
  const ollamaUrl = baseURL?.replace('/v1', '') || 'http://localhost:11434';
  
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      console.warn('[Ollama] Failed to fetch models, using fallback');
      return getOllamaFallbackModels();
    }

    const data = await response.json();
    
    const models = (data.models || []).map((model: any) => ({
      value: model.name,
      label: model.name,
    }));

    return models.length > 0 ? models : getOllamaFallbackModels();
  } catch (error) {
    console.error('[Ollama] Error fetching models (is Ollama running?):', error);
    return getOllamaFallbackModels();
  }
}

function getOllamaFallbackModels(): { value: string; label: string }[] {
  return [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'llama3.1', label: 'Llama 3.1' },
    { value: 'llama3', label: 'Llama 3' },
    { value: 'llama2', label: 'Llama 2' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'codellama', label: 'Code Llama' },
    { value: 'phi3', label: 'Phi-3' },
    { value: 'gemma2', label: 'Gemma 2' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
  ];
}

// Helper to format model names nicely
function formatModelName(modelId: string, provider: string): string {
  // Basic formatting - capitalize and clean up
  let name = modelId
    .replace(/-/g, ' ')
    .replace(/\./g, '.')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Provider-specific formatting
  if (provider === 'openai') {
    if (modelId.includes('gpt-4o-mini')) return 'GPT-4o Mini';
    if (modelId.includes('gpt-4o')) return `GPT-4o (${modelId.replace('gpt-4o-', '')})`;
    if (modelId.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
    if (modelId.includes('gpt-4')) return `GPT-4 (${modelId.replace('gpt-4-', '')})`;
    if (modelId.includes('gpt-3.5')) return 'GPT-3.5 Turbo';
    if (modelId.includes('o1')) return modelId.toUpperCase().replace('-', ' ');
  }

  if (provider === 'deepseek') {
    if (modelId === 'deepseek-chat') return 'DeepSeek Chat (V3)';
    if (modelId === 'deepseek-reasoner') return 'DeepSeek Reasoner (R1)';
    if (modelId === 'deepseek-coder') return 'DeepSeek Coder';
  }

  return name;
}
