/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useMemo, useState, useEffect } from 'react';
import JSZip from 'jszip';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Copy, Check, Loader2, Edit2, Eye, Languages } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

type LectureResult = {
    title?: string;
    source_file?: string;
    script_markdown: string;
    script_markdown_secondary?: string;
    web_sources?: Array<{ term: string; title: string; url: string; extract: string; provider?: string }>;
    slides?: Array<{
        slide_number: number;
        slide_title: string;
        script_markdown: string;
        script_markdown_secondary?: string;
        slide_text?: string;
    }>;
};

type EditableSlide = {
    slide_number: number;
    slide_title: string;
    script_markdown: string;
    script_markdown_secondary: string;
    includeSecondary: boolean;
    isEditing: boolean;
};

function safeString(x: any) {
    return typeof x === 'string' ? x : '';
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function formatDateYYYYMMDD(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

export function LectureRehearsalModule() {
    const {
        contextFiles,
        llmConfig,
        languageConfig,
        includeWebResources,
        generatedContent,
        setGeneratedContent,
    } = useStore();

    const primaryLanguage = languageConfig?.primaryLanguage || 'English';
    const secondaryLanguage = languageConfig?.secondaryLanguage || 'none';

    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [audienceLevel, setAudienceLevel] = useState<'beginner' | 'intermediate'>('beginner');
    const [targetMinutes, setTargetMinutes] = useState<number>(45);
    const [format, setFormat] = useState<'docx' | 'pptx'>('docx');
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [exportTarget, setExportTarget] = useState<'all' | number>(0);

    // Editable state for scripts
    const [editableSlides, setEditableSlides] = useState<EditableSlide[]>([]);
    const [singleScriptPrimary, setSingleScriptPrimary] = useState('');
    const [singleScriptSecondary, setSingleScriptSecondary] = useState('');
    const [singleIncludeSecondary, setSingleIncludeSecondary] = useState(true);
    const [singleIsEditing, setSingleIsEditing] = useState(false);

    const lectureResults = ((generatedContent as any).lecture_rehearsal || []) as LectureResult[];
    const [selectedLectureIndex, setSelectedLectureIndex] = useState(0);
    const lecture = lectureResults[selectedLectureIndex] as LectureResult | undefined;

    // Initialize editable state when lecture changes
    useEffect(() => {
        if (lecture) {
            if (Array.isArray(lecture.slides) && lecture.slides.length > 0) {
                setEditableSlides(lecture.slides.map(s => ({
                    slide_number: s.slide_number,
                    slide_title: s.slide_title || '',
                    script_markdown: s.script_markdown || '',
                    script_markdown_secondary: s.script_markdown_secondary || '',
                    includeSecondary: true,
                    isEditing: false,
                })));
            } else {
                setSingleScriptPrimary(lecture.script_markdown || '');
                setSingleScriptSecondary(lecture.script_markdown_secondary || '');
                setSingleIncludeSecondary(true);
                setSingleIsEditing(false);
            }
        }
    }, [lecture]);

    useEffect(() => {
        if (selectedLectureIndex >= lectureResults.length && lectureResults.length > 0) {
            setSelectedLectureIndex(0);
        }
    }, [lectureResults, selectedLectureIndex]);

    const context = useMemo(() => {
        return (contextFiles || []).map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');
    }, [contextFiles]);

    const pptxContextFiles = useMemo(() => {
        return (contextFiles || []).filter((f: any) => typeof f?.name === 'string' && f.name.toLowerCase().endsWith('.pptx'));
    }, [contextFiles]);
    const pptxFiles = useMemo(() => {
        return (pptxContextFiles || [])
            .map((f: any) => ({
                name: f?.name || 'pptx',
                base64: f?.rawBase64 || '',
            }))
            .filter((f: any) => typeof f.base64 === 'string' && f.base64.length > 0);
    }, [pptxContextFiles]);
    const pptxBase64 = (pptxContextFiles[0] as any)?.rawBase64 || '';
    const pptxFileContexts = useMemo(() => {
        return (pptxContextFiles || []).map((f: any) => ({
            name: f?.name || 'pptx',
            context: `FILE: ${f?.name || 'pptx'}\n${f?.content || ''}`,
        }));
    }, [pptxContextFiles]);
    const pdfContextFiles = useMemo(() => {
        return (contextFiles || []).filter((f: any) => typeof f?.name === 'string' && f.name.toLowerCase().endsWith('.pdf'));
    }, [contextFiles]);
    const pdfFiles = useMemo(() => {
        return (pdfContextFiles || [])
            .map((f: any) => ({
                name: f?.name || 'pdf',
                base64: f?.rawBase64 || '',
                context: `FILE: ${f?.name || 'pdf'}\n${f?.content || ''}`,
            }))
            .filter((f: any) => typeof f.base64 === 'string' && f.base64.length > 0);
    }, [pdfContextFiles]);

    const handleGenerate = async () => {
        if ((contextFiles || []).length === 0) {
            alert('Please upload at least one file.');
            return;
        }
        if (!llmConfig.apiKey) {
            alert('Please configure your API key in LLM Settings.');
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: 100, message: 'Starting...' });
        
        try {
            // Get current provider's API key, or use the deprecated apiKey field
            const currentApiKey = llmConfig.apiKeys?.[llmConfig.provider] || llmConfig.apiKey || '';
            
            const res = await fetch('/api/lecture-rehearsal-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: currentApiKey,
                    baseURL: llmConfig.baseURL,
                    model: llmConfig.model,
                    provider: llmConfig.provider,
                    // Send all available API keys for parallel processing with multiple LLMs
                    apiKeys: llmConfig.apiKeys,
                    // Per-provider model names (used when building LLM pool)
                    providerModels: llmConfig.providerModels ?? undefined,
                    primaryLanguage,
                    secondaryLanguage,
                    includeWebResources,
                    audienceLevel,
                    targetMinutes,
                    context,
                    pptxBase64,
                    pptxFiles,
                    pptxFileContexts,
                    pdfFiles,
                }),
            });
            
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(text || `Lecture rehearsal failed (${res.status})`);
            }
            
            // Read SSE stream
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            
            if (!reader) {
                throw new Error('Failed to get response stream');
            }
            
            let buffer = '';
            let finalData: LectureResult | null = null;
            let streamError: string | null = null;
            
            const processLine = (line: string) => {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'progress') {
                            setProgress({
                                current: data.current || 0,
                                total: data.total || 100,
                                message: data.message || 'Processing...',
                            });
                        } else if (data.type === 'complete') {
                            finalData = data.data;
                        } else if (data.type === 'error') {
                            // Store the error to be thrown after stream processing
                            streamError = data.message || 'Unknown error';
                        }
                    } catch (e: any) {
                        // Check if it's an API error message in the raw text
                        const rawText = line.slice(6).trim();
                        if (rawText && (rawText.includes('503') || rawText.includes('overloaded') || rawText.includes('UNAVAILABLE'))) {
                            streamError = 'Gemini API is overloaded. Please wait a moment and try again.';
                        } else if (rawText && rawText.includes('error')) {
                            // Try to extract error message from raw text
                            const errorMatch = rawText.match(/"message"\s*:\s*"([^"]+)"/);
                            if (errorMatch) {
                                streamError = errorMatch[1];
                            }
                        }
                        // Only log non-JSON parse errors (ignore empty lines)
                        if (rawText) {
                            console.error('Failed to parse SSE data:', e, 'Line:', rawText.substring(0, 200));
                        }
                    }
                }
            };
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    processLine(line);
                }
            }
            
            // Process any remaining data in buffer after stream ends
            if (buffer.trim()) {
                processLine(buffer);
            }
            
            // Check if an error occurred during stream processing
            if (streamError) {
                throw new Error(streamError);
            }
            
            const results = (finalData as any)?.results;
            if (Array.isArray(results) && results.length > 0) {
                // Validate each result has required fields
                const validResults = results.filter((r: any) => 
                    r && typeof r === 'object' && 
                    (typeof r.script_markdown === 'string' || Array.isArray(r.slides))
                );
                if (validResults.length > 0) {
                    setGeneratedContent('lecture_rehearsal', validResults);
                    setProgress(null);
                    return;
                }
            }
            
            // Handle single result case (not wrapped in results array)
            if (finalData && typeof finalData === 'object') {
                // Check if it has script_markdown OR slides array (either is valid)
                const hasScript = typeof (finalData as any).script_markdown === 'string' && (finalData as any).script_markdown.trim();
                const hasSlides = Array.isArray((finalData as any).slides) && (finalData as any).slides.length > 0;
                
                if (hasScript || hasSlides) {
                    // If no script_markdown but has slides, create a default script_markdown
                    if (!hasScript && hasSlides) {
                        (finalData as any).script_markdown = '';
                    }
                    setGeneratedContent('lecture_rehearsal', [finalData]);
                    setProgress(null);
                    return;
                }
            }
            
            // Log the actual data for debugging with more detail
            console.error('Invalid lecture result data:', JSON.stringify(finalData, null, 2));
            
            // Provide a more helpful error message
            if (!finalData) {
                throw new Error('No data received from the server. The API may have failed silently.');
            }
            const dataPreview = JSON.stringify(finalData)?.slice(0, 300) || 'null';
            throw new Error(`Invalid lecture result: missing script_markdown or slides. Data received: ${dataPreview}`);
        } catch (e: any) {
            console.error('Lecture rehearsal error:', e);
            alert(`Lecture rehearsal error: ${e?.message || 'Unknown error'}`);
            setProgress(null);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        let text = '';
        if (editableSlides.length > 0) {
            text = editableSlides.map(s => {
                let slideText = `## Slide ${s.slide_number}${s.slide_title ? `: ${s.slide_title}` : ''}\n\n${s.script_markdown}`;
                if (secondaryLanguage !== 'none' && s.includeSecondary && s.script_markdown_secondary.trim()) {
                    slideText += `\n\n---\n\n${s.script_markdown_secondary}`;
                }
                return slideText;
            }).join('\n\n---\n\n');
        } else {
            text = singleScriptPrimary;
            if (secondaryLanguage !== 'none' && singleIncludeSecondary && singleScriptSecondary.trim()) {
                text += `\n\n---\n\n${singleScriptSecondary}`;
            }
        }
        if (!text.trim()) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    // Update slide content
    const updateSlide = (index: number, field: keyof EditableSlide, value: any) => {
        setEditableSlides(prev => prev.map((s, i) => 
            i === index ? { ...s, [field]: value } : s
        ));
    };

    const requestExportOne = async (lectureItem: LectureResult, lang: 'primary' | 'secondary') => {
        const dateSuffix = formatDateYYYYMMDD(new Date());
        const baseName = (lectureItem?.source_file || lectureItem?.title || 'Lecture-Rehearsal').replace(/[\\/:*?"<>|]+/g, '-').trim();
        const filenameBase = `${baseName}_${dateSuffix}`;
        const languageLabel = lang === 'primary' ? primaryLanguage : secondaryLanguage;
        const filename = `${filenameBase}-${languageLabel}.${format}`;

        const buildFromSlides = (which: 'primary' | 'secondary') => {
            if (editableSlides.length === 0) return '';
            const lines: string[] = [];
            for (const s of editableSlides.slice().sort((a, b) => a.slide_number - b.slide_number)) {
                // Skip secondary if not included for this slide
                if (which === 'secondary' && !s.includeSecondary) continue;
                
                lines.push(`## Slide ${s.slide_number}${s.slide_title ? `: ${s.slide_title}` : ''}`);
                lines.push('');
                const body = which === 'secondary' ? s.script_markdown_secondary : s.script_markdown;
                lines.push(body || '');
                lines.push('');
                lines.push('---');
                lines.push('');
            }
            return lines.join('\n');
        };

        const primaryText = editableSlides.length > 0 ? buildFromSlides('primary') : singleScriptPrimary;
        const secondaryText = editableSlides.length > 0 ? buildFromSlides('secondary') : singleScriptSecondary;

        const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                exportKind: 'lecture',
                format,
                filename,
                title: lectureItem?.title || 'Lecture Rehearsal',
                language: lang,
                primaryLanguage,
                secondaryLanguage,
                includeSolutions: false,
                includeExplanations: false,
                moduleId: 'lecture_rehearsal', // Explicitly set module ID for generation history
                items: [
                    {
                        number: 1,
                        title: lectureItem?.title || 'Lecture Rehearsal',
                        type: 'lecture',
                        points: 0,
                        sources: [],
                        primary: { question: primaryText },
                        secondary: { question: secondaryText },
                    },
                ],
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export failed (${res.status})`);
        }
        const blob = await res.blob();
        return { blob, filename };
    };

    const exportPptxWithNotes = async (lectureItem: LectureResult, lectureIndex: number, returnBlob = false) => {
        const dateSuffix = formatDateYYYYMMDD(new Date());
        const baseName = (lectureItem?.source_file || lectureItem?.title || 'Lecture-Rehearsal').replace(/[\\/:*?"<>|]+/g, '-').trim();
        const filename = `${baseName}_${dateSuffix}.pptx`;

        const sourceName = lectureItem?.source_file || '';
        const pptxForLecture =
            pptxFiles[lectureIndex] ||
            pptxFiles.find((f) => f.name === sourceName) ||
            (pptxBase64 ? { name: sourceName || 'pptx', base64: pptxBase64 } : null);
        const slidesForLecture = Array.isArray(lectureItem?.slides) && lectureItem.slides.length > 0
            ? lectureItem.slides
            : editableSlides;
        if (!pptxForLecture?.base64 || slidesForLecture.length === 0) {
            throw new Error('PPTX context file or per-slide scripts are missing.');
        }
        
        const includeSecondaryByNumber = new Map(
            editableSlides.map((es) => [es.slide_number, es.includeSecondary])
        );
        const notes = slidesForLecture.map((s: any) => {
            const primary = (s.script_markdown || '').trim();
            const secondary = (secondaryLanguage !== 'none') ? (s.script_markdown_secondary || '').trim() : '';
            const includeThisSecondary =
                (includeSecondaryByNumber.get(s.slide_number) ?? s.includeSecondary ?? true) !== false &&
                secondaryLanguage !== 'none' &&
                !!secondary;
            // Cover slide (1): do not add "script"; just copy extracted content.
            const note_text =
                Number(s.slide_number) === 1
                    ? primary
                    : includeThisSecondary
                        ? `PRIMARY (${primaryLanguage})\n${primary}\n\nSECONDARY (${secondaryLanguage})\n${secondary}`
                        : primary;
            return { slide_number: s.slide_number, note_text };
        });

        const res = await fetch('/api/lecture-rehearsal/export-pptx-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, pptxBase64: pptxForLecture.base64, notes }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export notes failed (${res.status})`);
        }
        const blob = await res.blob();
        if (returnBlob) {
            return { blob, filename };
        }
        downloadBlob(blob, filename);
    };

    const exportPdfToPptxWithNotes = async (lectureItem: LectureResult, returnBlob = false) => {
        const dateSuffix = formatDateYYYYMMDD(new Date());
        const baseName = (lectureItem?.source_file || lectureItem?.title || 'Lecture-Rehearsal').replace(/[\\/:*?"<>|]+/g, '-').trim();
        const filename = `${baseName}_${dateSuffix}.pptx`;
        const slidesForLecture = Array.isArray(lectureItem?.slides) && lectureItem.slides.length > 0
            ? lectureItem.slides
            : editableSlides;
        if (slidesForLecture.length === 0) {
            throw new Error('PDF slides are missing.');
        }

        const sourceFileName = lectureItem?.source_file || '';
        const pdfFile = (contextFiles || []).find((f: any) => 
            f?.name === sourceFileName && f?.name?.toLowerCase().endsWith('.pdf')
        );
        const pdfBase64 = pdfFile?.rawBase64 || '';

        const includeSecondaryByNumber = new Map(
            editableSlides.map((es) => [es.slide_number, es.includeSecondary])
        );
        const slides = slidesForLecture.map((s: any) => {
            const primary = (s.script_markdown || '').trim();
            const secondary = (secondaryLanguage !== 'none') ? (s.script_markdown_secondary || '').trim() : '';
            const includeThisSecondary =
                (includeSecondaryByNumber.get(s.slide_number) ?? s.includeSecondary ?? true) !== false &&
                secondaryLanguage !== 'none' &&
                !!secondary;
            const note_text =
                includeThisSecondary
                    ? `PRIMARY (${primaryLanguage})\n${primary}\n\nSECONDARY (${secondaryLanguage})\n${secondary}`
                    : primary;
            return {
                slide_number: s.slide_number,
                slide_title: s.slide_title || `Page ${s.slide_number}`,
                slide_text: s.slide_text || '',
                note_text,
            };
        });

        const res = await fetch('/api/lecture-rehearsal/export-pdf-to-pptx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, slides, pdfBase64 }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export notes failed (${res.status})`);
        }
        const blob = await res.blob();
        if (returnBlob) {
            return { blob, filename };
        }
        downloadBlob(blob, filename);
    };

    // Check if any slide has secondary language enabled
    const hasAnySecondaryEnabled = editableSlides.length > 0 
        ? editableSlides.some(s => s.includeSecondary && s.script_markdown_secondary.trim())
        : (singleIncludeSecondary && singleScriptSecondary.trim());

    const handleExport = async () => {
        const hasContent = editableSlides.length > 0 
            ? editableSlides.some(s => s.script_markdown.trim())
            : singleScriptPrimary.trim();
            
        if (!hasContent) {
            alert('Please generate a script first.');
            return;
        }
        setExporting(true);
        try {
            const targets = exportTarget === 'all' ? lectureResults : lecture ? [lecture] : [];

            // If PPTX was uploaded, write slide-by-slide scripts into speaker notes.
            if (format === 'pptx') {
                if (targets.length === 0) throw new Error('Please select a lecture to export.');
                if (exportTarget === 'all') {
                    const zip = new JSZip();
                    for (let i = 0; i < targets.length; i++) {
                        const item = targets[i];
                        const isPdf = (item?.source_file || '').toLowerCase().endsWith('.pdf');
                        const result = isPdf
                            ? await exportPdfToPptxWithNotes(item, true)
                            : await exportPptxWithNotes(item, i, true);
                        if (result) {
                            zip.file(result.filename, result.blob);
                        }
                    }
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    const dateSuffix = formatDateYYYYMMDD(new Date());
                    downloadBlob(zipBlob, `Lecture-Rehearsal_${dateSuffix}.zip`);
                    return;
                }
                const isPdf = (lecture?.source_file || '').toLowerCase().endsWith('.pdf');
                if (isPdf) {
                    await exportPdfToPptxWithNotes(lecture as LectureResult);
                    return;
                }
                await exportPptxWithNotes(lecture as LectureResult, selectedLectureIndex);
                return;
            }

            // Export both languages when secondary is enabled. Otherwise export primary only.
            if (secondaryLanguage !== 'none' && hasAnySecondaryEnabled) {
                const zip = new JSZip();
                    for (const item of targets) {
                        const a = await requestExportOne(item, 'primary');
                    zip.file(a.filename, a.blob);
                    const b = await requestExportOne(item, 'secondary');
                    zip.file(b.filename, b.blob);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const dateSuffix = formatDateYYYYMMDD(new Date());
                downloadBlob(zipBlob, `Lecture-Rehearsal_${dateSuffix}.zip`);
            } else {
                if (targets.length === 0) throw new Error('Please select a lecture to export.');
                if (exportTarget === 'all') {
                    const zip = new JSZip();
                    for (const item of targets) {
                        const a = await requestExportOne(item, 'primary');
                        zip.file(a.filename, a.blob);
                    }
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    const dateSuffix = formatDateYYYYMMDD(new Date());
                    downloadBlob(zipBlob, `Lecture-Rehearsal_${dateSuffix}.zip`);
                } else {
                    const a = await requestExportOne(lecture as LectureResult, 'primary');
                    downloadBlob(a.blob, a.filename);
                }
            }
        } catch (e: any) {
            console.error('Lecture export error:', e);
            alert(`Export error: ${e?.message || 'Unknown error'}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                    Lecture Rehearsal
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Turn your uploaded materials into a beginner-friendly lecture script (optional: enrich with web sources).
                </p>
            </div>

            <Card className="bg-gradient-to-br from-indigo-50 to-sky-50 dark:from-indigo-950/20 dark:to-sky-950/20 border-indigo-200 dark:border-indigo-800">
                <CardHeader>
                    <CardTitle>Lecture Configuration</CardTitle>
                    <CardDescription>
                        Tune audience level, pacing, and optional web enrichment
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Audience level</Label>
                            <select
                                value={audienceLevel}
                                onChange={(e) => setAudienceLevel((e.target.value as any) || 'beginner')}
                                className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                            >
                                <option value="beginner">Beginner</option>
                                <option value="intermediate">Intermediate</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="target-mins">Target minutes</Label>
                            <Input
                                id="target-mins"
                                type="number"
                                min={10}
                                max={180}
                                step={5}
                                inputMode="numeric"
                                value={targetMinutes}
                                onChange={(e) => setTargetMinutes(Math.max(10, Math.min(180, Number(e.target.value) || 45)))}
                            />
                        </div>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        Web enrichment is controlled by <strong>Include Web Search</strong> in the Context Manager (current: {includeWebResources ? 'ON' : 'OFF'})
                    </div>

                    <Button
                        onClick={handleGenerate}
                        disabled={loading || (contextFiles || []).length === 0}
                        size="lg"
                        className="w-full"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                                Generating Lecture Script...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 w-4 h-4" />
                                Generate Lecture Rehearsal Script
                            </>
                        )}
                    </Button>
                    
                    {/* Progress Bar */}
                    {progress && (
                        <div className="space-y-2 mt-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-600 dark:text-slate-400">{progress.message}</span>
                                <span className="text-slate-500 dark:text-slate-500 font-medium">
                                    {progress.current} / {progress.total}
                                </span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
                                <div
                                    className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}
                    
                    {(contextFiles || []).length === 0 && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                            ⚠️ Please upload course materials first
                        </p>
                    )}
                </CardContent>
            </Card>

                    {lectureResults.length > 0 && (
                        <div className="mt-4">
                            <Label>File</Label>
                            <select
                                value={exportTarget}
                                onChange={(e) => {
                                    const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
                                    setExportTarget(v);
                                    if (v !== 'all') {
                                        setSelectedLectureIndex(Number(v) || 0);
                                    }
                                }}
                                className="mt-2 flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                            >
                                {lectureResults.map((r, idx) => (
                                    <option key={`${r.source_file || 'pptx'}-${idx}`} value={idx}>
                                        {`File ${idx + 1}`} {r.source_file ? `(${r.source_file})` : ''}
                                    </option>
                                ))}
                                <option value="all">All files</option>
                            </select>
                        </div>
                    )}
                    
                    {(editableSlides.length > 0 || singleScriptPrimary) && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                            Script
                        </h3>
                        <div className="flex items-center gap-2">
                            <select
                                value={format}
                                onChange={(e) => setFormat(e.target.value as any)}
                                className="flex h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                            >
                                <option value="docx">DOCX</option>
                                <option value="pptx">PPTX</option>
                            </select>
                            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Export'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleCopy}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                <span className="ml-2">{copied ? 'Copied' : 'Copy'}</span>
                            </Button>
                        </div>
                    </div>

                    {editableSlides.length > 0 ? (
                        <div className="space-y-3">
                            {editableSlides
                                .slice()
                                .sort((a, b) => a.slide_number - b.slide_number)
                                .map((s, idx) => (
                                    <Card key={`slide-${s.slide_number}-${idx}`} className="bg-white/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700">
                                        <CardHeader className="pb-3">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-base">
                                                    Slide {s.slide_number}{s.slide_title ? `: ${s.slide_title}` : ''}
                                                </CardTitle>
                                                <div className="flex items-center gap-2">
                                                    {/* Toggle Edit/Preview */}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => updateSlide(idx, 'isEditing', !s.isEditing)}
                                                        className="h-8 px-2"
                                                    >
                                                        {s.isEditing ? (
                                                            <><Eye className="w-4 h-4 mr-1" /> Preview</>
                                                        ) : (
                                                            <><Edit2 className="w-4 h-4 mr-1" /> Edit</>
                                                        )}
                                                    </Button>
                                                    {/* Toggle Include Secondary */}
                                                    {secondaryLanguage !== 'none' && s.script_markdown_secondary.trim() && (
                                                        <Button
                                                            variant={s.includeSecondary ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => updateSlide(idx, 'includeSecondary', !s.includeSecondary)}
                                                            className="h-8 px-2"
                                                            title={s.includeSecondary ? "Secondary language will be exported" : "Secondary language will NOT be exported"}
                                                        >
                                                            <Languages className="w-4 h-4 mr-1" />
                                                            {secondaryLanguage}
                                                            {s.includeSecondary ? ' ✓' : ''}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <CardDescription>
                                                {s.isEditing ? 'Edit mode - modify the script below' : 'Preview mode - click Edit to modify'}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {/* Primary Language */}
                                            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                {primaryLanguage}
                                            </div>
                                            {s.isEditing ? (
                                                <Textarea
                                                    value={s.script_markdown}
                                                    onChange={(e) => updateSlide(idx, 'script_markdown', e.target.value)}
                                                    className="min-h-[150px] font-mono text-sm bg-white/70 dark:bg-slate-900/40"
                                                    placeholder="Enter script for this slide..."
                                                />
                                            ) : (
                                                <div className="prose prose-sm dark:prose-invert max-w-none bg-white/70 dark:bg-slate-900/40 p-3 rounded-md border border-slate-200 dark:border-slate-700">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                        {s.script_markdown || ''}
                                                    </ReactMarkdown>
                                                </div>
                                            )}

                                            {/* Secondary Language */}
                                            {secondaryLanguage !== 'none' && (s.script_markdown_secondary.trim() || s.isEditing) && (
                                                <>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                            {secondaryLanguage}
                                                        </span>
                                                        {!s.includeSecondary && (
                                                            <span className="text-xs text-amber-600 dark:text-amber-400">
                                                                (will not be exported)
                                                            </span>
                                                        )}
                                                    </div>
                                                    {s.isEditing ? (
                                                        <Textarea
                                                            value={s.script_markdown_secondary}
                                                            onChange={(e) => updateSlide(idx, 'script_markdown_secondary', e.target.value)}
                                                            className={`min-h-[150px] font-mono text-sm bg-white/70 dark:bg-slate-900/40 ${!s.includeSecondary ? 'opacity-50' : ''}`}
                                                            placeholder="Enter secondary language script..."
                                                        />
                                                    ) : (
                                                        <div className={`prose prose-sm dark:prose-invert max-w-none bg-white/70 dark:bg-slate-900/40 p-3 rounded-md border border-slate-200 dark:border-slate-700 ${!s.includeSecondary ? 'opacity-50' : ''}`}>
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                                {s.script_markdown_secondary || ''}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                        </div>
                    ) : (
                        /* Single script mode (non-slide) */
                        <Card className="bg-white/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">Full Script</CardTitle>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setSingleIsEditing(!singleIsEditing)}
                                            className="h-8 px-2"
                                        >
                                            {singleIsEditing ? (
                                                <><Eye className="w-4 h-4 mr-1" /> Preview</>
                                            ) : (
                                                <><Edit2 className="w-4 h-4 mr-1" /> Edit</>
                                            )}
                                        </Button>
                                        {secondaryLanguage !== 'none' && singleScriptSecondary.trim() && (
                                            <Button
                                                variant={singleIncludeSecondary ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setSingleIncludeSecondary(!singleIncludeSecondary)}
                                                className="h-8 px-2"
                                                title={singleIncludeSecondary ? "Secondary language will be exported" : "Secondary language will NOT be exported"}
                                            >
                                                <Languages className="w-4 h-4 mr-1" />
                                                {secondaryLanguage}
                                                {singleIncludeSecondary ? ' ✓' : ''}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* Primary */}
                                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {primaryLanguage}
                                </div>
                                {singleIsEditing ? (
                                    <Textarea
                                        value={singleScriptPrimary}
                                        onChange={(e) => setSingleScriptPrimary(e.target.value)}
                                        className="min-h-[200px] font-mono text-sm bg-white/70 dark:bg-slate-900/40"
                                        placeholder="Enter script..."
                                    />
                                ) : (
                                    <div className="prose prose-sm dark:prose-invert max-w-none bg-white/70 dark:bg-slate-900/40 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                            {singleScriptPrimary}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {/* Secondary */}
                                {secondaryLanguage !== 'none' && (singleScriptSecondary.trim() || singleIsEditing) && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                {secondaryLanguage}
                                            </span>
                                            {!singleIncludeSecondary && (
                                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                                    (will not be exported)
                                                </span>
                                                )}
                                        </div>
                                        {singleIsEditing ? (
                                            <Textarea
                                                value={singleScriptSecondary}
                                                onChange={(e) => setSingleScriptSecondary(e.target.value)}
                                                className={`min-h-[200px] font-mono text-sm bg-white/70 dark:bg-slate-900/40 ${!singleIncludeSecondary ? 'opacity-50' : ''}`}
                                                placeholder="Enter secondary language script..."
                                            />
                                        ) : (
                                            <div className={`prose prose-sm dark:prose-invert max-w-none bg-white/70 dark:bg-slate-900/40 p-4 rounded-lg border border-slate-200 dark:border-slate-700 ${!singleIncludeSecondary ? 'opacity-50' : ''}`}>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                                    {singleScriptSecondary || ''}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}


                    {(lecture?.web_sources ?? []).length > 0 && (
                        <Card className="bg-white/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Sources (Web)</CardTitle>
                                <CardDescription>
                                    Web sources referenced in this lecture (from authorized sites only)
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {(lecture?.web_sources ?? []).map((s, idx) => (
                                    <div key={`${s.url}-${idx}`} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 bg-white/50 dark:bg-slate-950/20">
                                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                            {safeString(s.term)}{s.provider ? <span className="ml-2 text-xs font-normal text-slate-500">({s.provider})</span> : null}
                                        </div>
                                        <div className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                                            {safeString(s.title)}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1 break-all">
                                            {safeString(s.url)}
                                        </div>
                                        {(s.extract || '').trim().length > 0 && (
                                            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                                                {safeString(s.extract)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
