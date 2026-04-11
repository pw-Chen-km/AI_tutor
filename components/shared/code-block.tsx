'use client';

import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import sql from 'highlight.js/lib/languages/sql';

// Register languages
hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('sql', sql);

function guessLanguage(code: string): string {
    if (/\bdef\b|\bimport\b|\bfrom\b|input\(|print\(/.test(code)) return 'python';
    if (/\bconsole\.log\b|\bconst\b|\blet\b|\bfunction\b|=>/.test(code)) return 'javascript';
    if (/\bSystem\.out\.println\b|\bpublic\s+static\b/.test(code)) return 'java';
    if (/#include\s*</.test(code) || /\bstd::\b/.test(code)) return 'cpp';
    if (/\bSELECT\b|\bFROM\b|\bWHERE\b/i.test(code)) return 'sql';
    return 'python'; // default to python for coding problems
}

function extractPureCode(raw: string): string {
    // Normalize line endings
    let content = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Split into lines
    const lines = content.split('\n');
    const outputLines: string[] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip lines that are code fence markers (```, ```python, etc.)
        if (trimmed.startsWith('```')) {
            continue;
        }
        
        // Keep all other lines (including empty lines for proper spacing)
        outputLines.push(line);
    }
    
    // Join and clean up excessive blank lines
    content = outputLines.join('\n');
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // Trim leading/trailing whitespace
    return content.trim();
}

interface CodeBlockProps {
    code: string;
    className?: string;
}

export function CodeBlock({ code, className = '' }: CodeBlockProps) {
    const codeRef = useRef<HTMLElement>(null);
    
    // Extract pure code (remove all ``` markers)
    const pureCode = extractPureCode(code);
    const language = guessLanguage(pureCode);
    
    useEffect(() => {
        if (codeRef.current && pureCode) {
            // Reset and re-highlight
            codeRef.current.removeAttribute('data-highlighted');
            codeRef.current.className = `language-${language}`;
            codeRef.current.textContent = pureCode;
            hljs.highlightElement(codeRef.current);
        }
    }, [pureCode, language]);
    
    if (!pureCode) {
        return null;
    }
    
    return (
        <pre className={`bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed ${className}`}>
            <code ref={codeRef} className={`language-${language}`}>
                {pureCode}
            </code>
        </pre>
    );
}



