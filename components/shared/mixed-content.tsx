'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
    return 'python';
}

interface ContentPart {
    type: 'text' | 'code';
    content: string;
    language?: string;
}

// Check if a line looks like code - be CONSERVATIVE to avoid false positives
function looksLikeCode(line: string): boolean {
    const s = line.trim();
    if (!s) return false;
    
    // NEVER treat markdown formatting as code
    if (/^\*\*/.test(s) || /^\*[^*]/.test(s)) return false; // Bold/italic
    if (/^#{1,6}\s/.test(s)) return false; // Headers
    if (/^[-+]\s/.test(s)) return false; // List items
    if (/^\d+\.\s/.test(s)) return false; // Numbered list items
    if (/^>/.test(s)) return false; // Block quotes
    if (/^[A-Z].*:\s*$/.test(s)) return false; // Labels like "Requirements:", "Hints:"
    if (/^[A-Z][a-z]+(\s+[A-Z]?[a-z]+)*:\s*$/.test(s)) return false; // Multi-word labels
    
    // Only detect STRONG code patterns - things that can ONLY be code
    // Python/JS keywords at start of line (must have proper syntax following)
    if (/^(def|class)\s+\w+/.test(s)) return true; // def foo, class Bar
    if (/^(import|from)\s+\w+/.test(s)) return true; // import x, from y
    if (/^(for|while)\s+\w+\s+in\s+/.test(s)) return true; // for x in y
    if (/^if\s+.+:$/.test(s)) return true; // if condition:
    if (/^elif\s+.+:$/.test(s)) return true; // elif condition:
    if (/^else\s*:$/.test(s)) return true; // else:
    if (/^try\s*:$/.test(s)) return true; // try:
    if (/^except\b/.test(s)) return true; // except:
    if (/^finally\s*:$/.test(s)) return true; // finally:
    if (/^with\s+.+\s+as\s+/.test(s)) return true; // with x as y:
    if (/^return\s+/.test(s)) return true; // return value
    
    // JavaScript/TypeScript
    if (/^(const|let|var)\s+\w+\s*=/.test(s)) return true; // const x =
    if (/^function\s+\w+\s*\(/.test(s)) return true; // function foo(
    if (/^(export|async)\s+(default\s+)?(function|class|const)/.test(s)) return true;
    
    // Java/C++
    if (/^(public|private|protected)\s+(static\s+)?(void|int|String|boolean)/.test(s)) return true;
    if (/^#include\s*</.test(s)) return true;
    
    // Very specific code patterns
    if (/^\s{4,}return\s+/.test(line)) return true; // deeply indented return
    if (/^\s{4,}(self|this)\./.test(line)) return true; // deeply indented self. or this.
    if (/console\.log\(|System\.out\.println\(|printf\(/.test(s)) return true;
    
    // Assignment with function call (but not prose)
    if (/^[a-z_][a-z0-9_]*\s*=\s*[A-Z][a-zA-Z0-9_]+\s*\([^)]*\)\s*$/.test(s)) return true;
    
    // Lines ending with specific code patterns
    if (/\)\s*:\s*$/.test(s)) return true; // ends with ):
    if (/^\s{4,}[a-z_]/.test(line) && /\(.*\)/.test(s)) return true; // deeply indented function call
    
    return false;
}

function parseContent(raw: string): ContentPart[] {
    const parts: ContentPart[] = [];
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    let inExplicitCodeBlock = false;
    let currentCodeLines: string[] = [];
    let currentTextLines: string[] = [];
    let codeLanguage = '';
    
    // First pass: check if there are explicit ``` markers
    const hasExplicitFences = lines.some(l => l.trim().startsWith('```'));
    
    if (hasExplicitFences) {
        // Parse with explicit fence markers
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('```')) {
                if (!inExplicitCodeBlock) {
                    // Starting a code block
                    if (currentTextLines.length > 0) {
                        const text = currentTextLines.join('\n').trim();
                        if (text) {
                            parts.push({ type: 'text', content: text });
                        }
                        currentTextLines = [];
                    }
                    codeLanguage = trimmed.slice(3).trim() || '';
                    inExplicitCodeBlock = true;
                } else {
                    // Ending a code block
                    if (currentCodeLines.length > 0) {
                        const code = currentCodeLines.join('\n');
                        const lang = codeLanguage || guessLanguage(code);
                        parts.push({ type: 'code', content: code, language: lang });
                    }
                    currentCodeLines = [];
                    codeLanguage = '';
                    inExplicitCodeBlock = false;
                }
            } else if (inExplicitCodeBlock) {
                currentCodeLines.push(line);
            } else {
                currentTextLines.push(line);
            }
        }
        
        // Flush remaining
        if (currentCodeLines.length > 0) {
            const code = currentCodeLines.join('\n');
            parts.push({ type: 'code', content: code, language: codeLanguage || guessLanguage(code) });
        }
        if (currentTextLines.length > 0) {
            const text = currentTextLines.join('\n').trim();
            if (text) parts.push({ type: 'text', content: text });
        }
    } else {
        // No explicit fences - use heuristic detection
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            
            if (looksLikeCode(line)) {
                // Flush text first
                if (currentTextLines.length > 0) {
                    const text = currentTextLines.join('\n').trim();
                    if (text) parts.push({ type: 'text', content: text });
                    currentTextLines = [];
                }
                
                // Collect consecutive code lines, including short text lines between code
                while (i < lines.length) {
                    const currentLine = lines[i];
                    const trimmedLine = currentLine.trim();
                    
                    if (looksLikeCode(currentLine) || trimmedLine === '') {
                        currentCodeLines.push(currentLine);
                        i++;
                    } else {
                        // Check if this is a short label/comment followed by more code
                        // Look ahead to see if there's code coming
                        let hasMoreCode = false;
                        let codeLineCount = 0;
                        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                            if (looksLikeCode(lines[j])) {
                                hasMoreCode = true;
                                codeLineCount++;
                            }
                        }
                        
                        // If there's substantial code following, include this line as a comment
                        // This handles cases like "Demo", "測試", "Example:", "Output" etc.
                        const isShortLabel = trimmedLine.length <= 50 && 
                            (trimmedLine.length <= 20 || 
                             trimmedLine.endsWith(':') || 
                             trimmedLine.endsWith('：') ||
                             /^[A-Za-z\u4e00-\u9fff\s]+$/.test(trimmedLine)); // Only letters/Chinese/spaces
                        
                        if (hasMoreCode && codeLineCount >= 1 && isShortLabel) {
                            // Treat as a code comment/label
                            currentCodeLines.push(`# ${trimmedLine}`);
                            i++;
                        } else {
                            break;
                        }
                    }
                }
                
                // Trim trailing empty lines from code
                while (currentCodeLines.length > 0 && currentCodeLines[currentCodeLines.length - 1].trim() === '') {
                    currentCodeLines.pop();
                }
                
                if (currentCodeLines.length > 0) {
                    const code = currentCodeLines.join('\n');
                    parts.push({ type: 'code', content: code, language: guessLanguage(code) });
                }
                currentCodeLines = [];
            } else {
                currentTextLines.push(line);
                i++;
            }
        }
        
        // Flush remaining text
        if (currentTextLines.length > 0) {
            const text = currentTextLines.join('\n').trim();
            if (text) parts.push({ type: 'text', content: text });
        }
    }
    
    // Merge adjacent code blocks
    const mergedParts: ContentPart[] = [];
    for (const part of parts) {
        if (part.type === 'code' && mergedParts.length > 0 && mergedParts[mergedParts.length - 1].type === 'code') {
            // Merge with previous code block
            const prev = mergedParts[mergedParts.length - 1];
            prev.content = prev.content + '\n\n' + part.content;
        } else {
            mergedParts.push(part);
        }
    }
    
    return mergedParts;
}

function CodeSegment({ code, language }: { code: string; language: string }) {
    const codeRef = useRef<HTMLElement>(null);
    
    useEffect(() => {
        if (codeRef.current && code) {
            codeRef.current.removeAttribute('data-highlighted');
            codeRef.current.className = `language-${language}`;
            codeRef.current.textContent = code;
            hljs.highlightElement(codeRef.current);
        }
    }, [code, language]);
    
    return (
        <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed my-2">
            <code ref={codeRef} className={`language-${language}`}>
                {code}
            </code>
        </pre>
    );
}

interface MixedContentProps {
    content: string;
    className?: string;
}

export function MixedContent({ content, className = '' }: MixedContentProps) {
    if (!content?.trim()) return null;
    
    const parts = parseContent(content);
    
    return (
        <div className={className}>
            {parts.map((part, idx) => (
                part.type === 'code' ? (
                    <CodeSegment key={idx} code={part.content} language={part.language || 'python'} />
                ) : (
                    <div key={idx} className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                            components={{
                                // Customize code block rendering
                                code({ node, className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    const isInline = !match;
                                    return isInline ? (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    ) : (
                                        <CodeSegment code={String(children).replace(/\n$/, '')} language={match[1]} />
                                    );
                                },
                            }}
                        >
                            {part.content}
                        </ReactMarkdown>
                    </div>
                )
            ))}
        </div>
    );
}

