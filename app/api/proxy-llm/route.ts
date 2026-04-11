import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';

function safeParseLLMJson(raw: string) {
    const text = (raw || '').trim();
    // 1) direct parse
    try {
        return JSON.parse(text);
    } catch { /* noop */ }

    // 2) extract fenced block if present
    const fenced =
        text.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ??
        text.match(/```\s*([\s\S]*?)\s*```/i)?.[1];

    let candidate = (fenced ?? text).trim();

    // 3) Try to fix common truncation issues
    // If JSON ends abruptly, try to close it properly
    if (candidate.includes('"problems"') || candidate.includes('"drills"') || candidate.includes('"questions"')) {
        // Check if JSON appears truncated (ends with incomplete string or structure)
        const endsWithIncomplete = /[,:\[\{]\s*"[^"]*$/.test(candidate) || // incomplete string
                                   /[,:\[\{]\s*$/.test(candidate) ||       // ends with delimiter
                                   /"[^"]*$/.test(candidate);              // unclosed string
        
        if (endsWithIncomplete) {
            // Find the last complete item (ends with }, ], ", number, true, false, null)
            // Look for the last complete array item or object
            const patterns = [
                /\}\s*,\s*\{[^}]*$/,      // incomplete object in array
                /"\s*,\s*"[^"]*$/,        // incomplete string in array
                /\]\s*,\s*\[[^\]]*$/,     // incomplete array in array
            ];
            
            for (const pattern of patterns) {
                const match = candidate.match(pattern);
                if (match) {
                    candidate = candidate.slice(0, match.index! + 1); // Keep up to the comma
                    break;
                }
            }
            
            // More aggressive: find the last complete closing bracket or brace
            // and remove everything after the last complete item
            const lastGoodEnd = Math.max(
                candidate.lastIndexOf('},'),
                candidate.lastIndexOf('"],'),
                candidate.lastIndexOf('"}'),
                candidate.lastIndexOf('"]'),
            );
            
            if (lastGoodEnd > candidate.length * 0.5) { // Only if we found something in the latter half
                candidate = candidate.slice(0, lastGoodEnd + 1);
                // Remove trailing comma if present
                candidate = candidate.replace(/,\s*$/, '');
            }
        }
        
        // Count and balance brackets/braces
        const openBraces = (candidate.match(/\{/g) || []).length;
        const closeBraces = (candidate.match(/\}/g) || []).length;
        const openBrackets = (candidate.match(/\[/g) || []).length;
        const closeBrackets = (candidate.match(/\]/g) || []).length;

        // Add missing closures
        if (openBrackets > closeBrackets) {
            candidate += ']'.repeat(openBrackets - closeBrackets);
        }
        if (openBraces > closeBraces) {
            candidate += '}'.repeat(openBraces - closeBraces);
        }
    }

    // 4) attempt repair then parse
    try {
        const repaired = jsonrepair(candidate);
        return JSON.parse(repaired);
    } catch (e: any) {
        // 5) Last resort: try to extract whatever valid data we can
        // Look for the problems/drills array and try to get at least some items
        try {
            const arrayMatch = candidate.match(/"(?:problems|drills|questions)"\s*:\s*\[([\s\S]*)/);
            if (arrayMatch) {
                let arrayContent = arrayMatch[1];
                // Find complete objects within the array
                const objects: string[] = [];
                let depth = 0;
                let start = -1;
                
                for (let i = 0; i < arrayContent.length; i++) {
                    const char = arrayContent[i];
                    if (char === '{') {
                        if (depth === 0) start = i;
                        depth++;
                    } else if (char === '}') {
                        depth--;
                        if (depth === 0 && start !== -1) {
                            objects.push(arrayContent.slice(start, i + 1));
                            start = -1;
                        }
                    }
                }
                
                if (objects.length > 0) {
                    // We have at least some complete objects
                    const partialJson = `{"problems": [${objects.join(',')}]}`;
                    const repaired = jsonrepair(partialJson);
                    console.warn(`Recovered ${objects.length} items from truncated JSON`);
                    return JSON.parse(repaired);
                }
            }
        } catch { /* noop */ }
        
        // last resort: surface a helpful snippet
        const snippet = candidate.slice(0, 800);
        throw new Error(
            `Failed to parse LLM JSON after repair. ${e?.message || e}\n---\nSnippet:\n${snippet}`
        );
    }
}

function normalizeBaseURL(input?: string) {
    const raw = (input || '').trim();
    if (!raw) return '';
    return raw.replace(/\/+$/, '');
}

async function fetchGeminiModels(params: { apiKey: string; baseURL: string; apiVersion: 'v1beta' | 'v1' }) {
    const { apiKey, baseURL, apiVersion } = params;
    const url = `${baseURL}/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini listModels failed: ${res.status}${text ? ` - ${text}` : ''}`);
    }
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    return models as Array<{ name?: string; supportedGenerationMethods?: string[] }>;
}

function pickDefaultGeminiModel(models: Array<{ name?: string; supportedGenerationMethods?: string[] }>) {
    const candidates = models
        .filter((m) => typeof m?.name === 'string')
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name as string);

    const prefer = (needle: string) => candidates.find((n) => n.includes(needle));

    return (
        prefer('gemini-1.5-flash') ||
        prefer('gemini-1.5-pro') ||
        prefer('gemini-2') ||
        candidates[0] ||
        ''
    );
}

export async function POST(req: NextRequest) {
    try {
        const { apiKey, baseURL, model, messages } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: 'API Key is missing' }, { status: 400 });
        }

        // Detect if using Gemini API
        const isGemini = baseURL?.includes('generativelanguage.googleapis.com') || 
                         model?.includes('gemini');

        if (isGemini) {
            // Use Gemini API directly
            const geminiBase = normalizeBaseURL(baseURL) || 'https://generativelanguage.googleapis.com';
            // Most public Gemini model names are exposed via v1beta for generateContent.
            const apiVersion: 'v1beta' | 'v1' = 'v1beta';
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

            const doRequest = async (url: string) => {
                return await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: mergedMessages,
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 16384, // Increased for complex JSON responses
                            responseMimeType: 'application/json', // Force JSON response for Gemini
                        },
                    }),
                });
            };

            let response = await doRequest(apiUrl);

            // If the configured model doesn't exist / doesn't support generateContent, auto-pick one and retry once.
            if (!response.ok && response.status === 404) {
                const errorText = await response.text().catch(() => '');
                console.error('Gemini API Error (first try):', errorText);

                try {
                    const models = await fetchGeminiModels({ apiKey, baseURL: geminiBase, apiVersion });
                    const picked = pickDefaultGeminiModel(models);
                    if (picked) {
                        geminiModel = picked.replace(/^models\//, '');
                        apiUrl = `${geminiBase}/${apiVersion}/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
                        response = await doRequest(apiUrl);
                    }
                } catch (e) {
                    // If listModels fails, fall through to the normal error handling below.
                    console.error('Gemini listModels fallback failed:', e);
                }
            }

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.error('Gemini API Error:', errorText);
                throw new Error(`Gemini API Error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                throw new Error('No content received from Gemini');
            }

            // Try to parse JSON, but provide better error handling
            let jsonContent: any;
            try {
                jsonContent = safeParseLLMJson(content);
            } catch (parseError: any) {
                console.error('[proxy-llm] JSON parsing failed for Gemini:', {
                    contentPreview: content.substring(0, 500),
                    error: parseError.message,
                });
                // If content doesn't look like JSON at all, try to extract JSON from it
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        jsonContent = JSON.parse(jsonrepair(jsonMatch[0]));
                        console.warn('[proxy-llm] Recovered JSON from non-JSON response');
                    } catch {
                        throw new Error(`LLM did not return valid JSON. Response appears to be plain text. Please ensure the LLM is configured to return JSON format. Error: ${parseError.message}`);
                    }
                } else {
                    throw new Error(`LLM did not return valid JSON. Response appears to be plain text. Please ensure the LLM is configured to return JSON format. Error: ${parseError.message}`);
                }
            }
            
            // Extract token usage from Gemini response if available
            const usageInfo = data.usageMetadata ? {
                promptTokens: data.usageMetadata.promptTokenCount || 0,
                candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
                totalTokens: data.usageMetadata.totalTokenCount || 0,
            } : null;
            
            return NextResponse.json({
                content: jsonContent,
                ...(usageInfo && { _tokenUsage: usageInfo })
            });

        } else {
            // Use OpenAI-compatible API
            const client = new OpenAI({
                apiKey: apiKey,
                baseURL: baseURL || 'https://api.openai.com/v1',
            });

            const response = await client.chat.completions.create({
                model: model || 'gpt-4',
                messages: messages,
                response_format: { type: "json_object" },
                // gpt-5.4-mini may reject `max_tokens`; use `max_completion_tokens`.
                max_completion_tokens: 16000, // Ensure enough tokens for complex JSON responses
            });

            const content = response.choices[0].message.content;

            if (!content) {
                throw new Error('No content received from LLM');
            }

            // Try to parse JSON, but provide better error handling
            let jsonContent: any;
            try {
                jsonContent = safeParseLLMJson(content);
            } catch (parseError: any) {
                console.error('[proxy-llm] JSON parsing failed for OpenAI:', {
                    contentPreview: content.substring(0, 500),
                    error: parseError.message,
                });
                // If content doesn't look like JSON at all, try to extract JSON from it
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        jsonContent = JSON.parse(jsonrepair(jsonMatch[0]));
                        console.warn('[proxy-llm] Recovered JSON from non-JSON response');
                    } catch {
                        throw new Error(`LLM did not return valid JSON. Response appears to be plain text. Please ensure the LLM is configured to return JSON format. Error: ${parseError.message}`);
                    }
                } else {
                    throw new Error(`LLM did not return valid JSON. Response appears to be plain text. Please ensure the LLM is configured to return JSON format. Error: ${parseError.message}`);
                }
            }
            
            // Extract token usage from OpenAI response if available
            const usageInfo = response.usage ? {
                promptTokens: response.usage.prompt_tokens || 0,
                completionTokens: response.usage.completion_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
            } : null;
            
            return NextResponse.json({
                content: jsonContent,
                ...(usageInfo && { _tokenUsage: usageInfo })
            });
        }

    } catch (error: any) {
        console.error('LLM Generation Error:', error);

        // Return detailed error to help debugging
        return NextResponse.json(
            { error: error.message || 'Failed to generate content', details: error.toString() },
            { status: 500 }
        );
    }
}
