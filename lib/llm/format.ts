function looksLikeCodeLine(line: string) {
    const s = line.trim();
    if (!s) return false;
    if (/^[-*]\s+/.test(s)) return false;

    // Treat indented comment lines as code (avoid markdown headings like "# Title")
    if (/^\s+/.test(line) && /^#\s*\S/.test(s)) return true;
    if (/^\s+/.test(line) && /^\/\/\s*\S/.test(s)) return true;
    if (/^\s+/.test(line) && /^\/\*\*?/.test(s)) return true;

    // common code starters / tokens
    if (/^(def|class|import|from|for|while|if|elif|else|return|try|except|with)\b/.test(s)) return true;
    if (/^(const|let|var|function|export|import)\b/.test(s)) return true;
    if (/^(public|private|protected)\b/.test(s)) return true;
    if (/^#include\b/.test(s)) return true;
    if (/console\.log\(|System\.out\.println\(|printf\(|scanf\(/.test(s)) return true;
    if (/[{};]\s*$/.test(s)) return true;
    if (/^[\w$]+\s*=\s*.+/.test(s)) return true;
    if (/->\s*\w+/.test(s)) return true;
    return false;
}

function guessLanguage(lines: string[]) {
    const text = lines.join('\n');
    if (/\bdef\b|\bimport\b|\bfrom\b|input\(|print\(/.test(text)) return 'python';
    if (/\bconsole\.log\b|\bconst\b|\blet\b|\bfunction\b|=>/.test(text)) return 'javascript';
    if (/\bSystem\.out\.println\b|\bpublic\s+static\b/.test(text)) return 'java';
    if (/#include\s*</.test(text) || /\bstd::\b/.test(text)) return 'cpp';
    if (/\bSELECT\b|\bFROM\b|\bWHERE\b/i.test(text)) return 'sql';
    return 'text';
}

/**
 * Ensures code-like lines are displayed as Markdown fenced code blocks.
 * If the text already contains fences, returns it unchanged.
 */
export function ensureMarkdownCodeFences(text: string | undefined | null) {
    const raw = (text ?? '').toString();
    if (!raw.trim()) return raw;

    // If there are fences but no language tags, try to add a best-guess language.
    if (raw.includes('```')) {
        // IMPORTANT: only add language tags to OPENING fences.
        // Closing fences must remain exactly ``` (no language), otherwise markdown parsing breaks and you may see stray ```text.
        const lines = raw.split('\n');
        const out: string[] = [];
        let inFence = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(/^```[\t ]*([A-Za-z0-9_-]+)?[\t ]*$/);
            if (!m) {
                out.push(line);
                continue;
            }

            const lang = (m[1] || '').trim();
            if (!inFence) {
                // Opening fence
                if (lang) {
                    out.push(`\`\`\`${lang}`);
                } else {
                    // Look ahead a bit to guess language from upcoming code lines
                    const sample: string[] = [];
                    for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
                        if (/^```/.test(lines[j])) break;
                        if (lines[j].trim()) sample.push(lines[j]);
                    }
                    const guessed = sample.length > 0 ? guessLanguage(sample) : 'text';
                    out.push(`\`\`\`${guessed}`);
                }
                inFence = true;
            } else {
                // Closing fence: ALWAYS normalize to ```
                out.push('```');
                inFence = false;
            }
        }

        return out.join('\n');
    }

    const lines = raw.split('\n');
    const blocks: Array<{ start: number; end: number }> = [];

    let i = 0;
    while (i < lines.length) {
        if (!looksLikeCodeLine(lines[i])) {
            i++;
            continue;
        }
        const start = i;
        let end = i;
        i++;
        while (i < lines.length && looksLikeCodeLine(lines[i])) {
            end = i;
            i++;
        }
        const len = end - start + 1;
        // allow 1-line blocks only if it's strongly code-like (avoid wrapping prose)
        const strongOneLiner = len === 1 && /^(import|from|def|class|return|print|console\.log|SELECT|INSERT|UPDATE|DELETE)\b/.test(lines[start].trim());
        if (len >= 2 || strongOneLiner) blocks.push({ start, end });
    }

    if (blocks.length === 0) return raw;

    const lang = guessLanguage(lines);
    const out: string[] = [];
    let cursor = 0;
    for (const b of blocks) {
        // flush non-code
        while (cursor < b.start) out.push(lines[cursor++]);
        // wrap code
        out.push(`\`\`\`${lang}`);
        for (let j = b.start; j <= b.end; j++) out.push(lines[j]);
        out.push('```');
        cursor = b.end + 1;
    }
    while (cursor < lines.length) out.push(lines[cursor++]);

    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Wraps the entire solution in a SINGLE code fence if the problem type is coding-related.
 * This MERGES all code blocks into one unified block.
 */
export function wrapSolutionAsCodeIfCoding(
    solution: string | undefined | null,
    problemType: string | undefined | null
): string {
    const raw = (solution ?? '').toString();
    if (!raw.trim()) return raw;

    // Check if problem type is coding-related
    const normalizedType = String(problemType || '').toLowerCase();
    const isCodingType = normalizedType.includes('coding') || 
                         normalizedType.includes('debugging') || 
                         normalizedType.includes('trace') ||
                         normalizedType === 'code';

    if (!isCodingType) {
        // Not a coding type, use normal processing
        return ensureMarkdownCodeFences(raw);
    }

    // ===== MERGE ALL CODE INTO ONE SINGLE BLOCK =====
    // Process line by line to remove ALL ``` markers
    
    // Normalize line endings
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const outputLines: string[] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip lines that start with ``` (code fence markers)
        // This includes: ```, ```python, ```py, ```javascript, etc.
        if (trimmed.startsWith('```')) {
            continue; // Skip this line entirely
        }
        
        // Keep all other lines
        outputLines.push(line);
    }
    
    // Join and clean up
    let content = outputLines.join('\n');
    
    // Clean up excessive blank lines (more than 2 in a row)
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // Trim leading/trailing whitespace but preserve internal structure
    content = content.trim();
    
    if (!content) {
        return raw; // If nothing left, return original
    }
    
    // Guess language
    const lang = guessLanguage(content.split('\n'));
    
    // Return ONE unified code block
    return '```' + lang + '\n' + content + '\n```';
}


