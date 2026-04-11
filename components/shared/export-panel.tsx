/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useMemo, useState, useRef } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { saveTemplateToIdb, getTemplateFromIdb } from '@/lib/export/template-store';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';

export type ExportFormat = 'exam_docx' | 'exam_pdf' | 'exam_pptx';
export type ExportLanguageMode = 'primary' | 'secondary' | 'both_separate_zip';

export interface ExportSource {
    file: string;
    pages: string;
}

export interface ExportItem {
    number: number;
    title: string;
    type: string;
    points: number;
    sources: ExportSource[];
    primary: {
        question: string;
        solution?: string;
        explanation?: string;
    };
    secondary?: {
        question?: string;
        solution?: string;
        explanation?: string;
    };
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

export interface VariantInfo {
    itemId: string;
    variants: any[];
    selectedVariantIds: string[];
}

export function ExportPanel(props: {
    title: string;
    moduleId: 'drills' | 'labs' | 'homework' | 'exams';
    items: ExportItem[];
    selectedNumbers: number[];
    // Optional: variant info for combination export
    variantInfo?: Record<string, VariantInfo>;
    onAutoGenerateVariants?: (itemIds: string[], count: number) => Promise<void>;
}) {
    const { languageConfig, exportTemplates: rawExportTemplates, setExportTemplates, examExportSettings, setInstitutionLogo } = useStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const primaryLanguage = languageConfig?.primaryLanguage || 'English';
    const secondaryLanguage = languageConfig?.secondaryLanguage || 'none';
    
    // Defensive check: ensure exportTemplates is always an array
    const exportTemplates = Array.isArray(rawExportTemplates) ? rawExportTemplates : [];

    const selectedItems = useMemo(() => {
        const set = new Set(props.selectedNumbers);
        return props.items.filter((i) => set.has(i.number));
    }, [props.items, props.selectedNumbers]);
    
    // Calculate variant counts for each selected item
    const variantCounts = useMemo(() => {
        if (!props.variantInfo) return {};
        const counts: Record<string, number> = {};
        selectedItems.forEach((item) => {
            const itemId = `${props.moduleId.slice(0, -1)}-${item.number}`;
            const info = props.variantInfo?.[itemId];
            // Count only SELECTED variants (not all generated variants)
            const selectedIds = info?.selectedVariantIds || ['original'];
            counts[itemId] = selectedIds.length;
        });
        return counts;
    }, [selectedItems, props.variantInfo, props.moduleId]);
    
    // Find items that have variants (count > 1, i.e., more than just original)
    const itemsWithVariants = useMemo(() => {
        return Object.entries(variantCounts).filter(([, count]) => count > 1);
    }, [variantCounts]);
    
    const hasVariants = itemsWithVariants.length > 0;
    
    // Max count among items that HAVE variants (ignore items with only original)
    const maxVariantCount = useMemo(() => {
        if (itemsWithVariants.length === 0) return 1;
        return Math.max(...itemsWithVariants.map(([, count]) => count));
    }, [itemsWithVariants]);
    
    // Check if items with variants have uneven counts
    // Items with count=1 (only original) are ignored - they don't need to match
    const variantCountsUneven = useMemo(() => {
        if (itemsWithVariants.length <= 1) return false;
        const counts = itemsWithVariants.map(([, count]) => count);
        return counts.some(c => c !== maxVariantCount);
    }, [itemsWithVariants, maxVariantCount]);
    
    // Get items that need more variants
    const itemsNeedingMore = useMemo(() => {
        if (!variantCountsUneven) return [];
        return itemsWithVariants
            .filter(([, count]) => count < maxVariantCount)
            .map(([itemId, count]) => ({ itemId, count, needed: maxVariantCount - count }));
    }, [itemsWithVariants, maxVariantCount, variantCountsUneven]);

    const [format, setFormat] = useState<ExportFormat>('exam_docx');
    const [includeSolutions, setIncludeSolutions] = useState(true);
    const [languageMode, setLanguageMode] = useState<ExportLanguageMode>('primary');
    const [exporting, setExporting] = useState(false);
    const [useVariantCombinations, setUseVariantCombinations] = useState(false);
    const [showVariantWarning, setShowVariantWarning] = useState(false);
    
    // Exam format configuration
    const [examConfig, setExamConfig] = useState({
        course: '',
        institution: '',
        examType: 'Final Examination',
        durationMinutes: 120,
    });
    const [examTypeDropdown, setExamTypeDropdown] = useState('Final Examination');
    const logoInputRef = useRef<HTMLInputElement>(null);
    // All formats are now exam formats
    const isExamFormat = true;
    
    // Use logo from global store (persistent across modules)
    const institutionLogoBase64 = examExportSettings.institutionLogoBase64;
    const institutionLogoName = examExportSettings.institutionLogoName;
    
    // Handle logo upload
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        console.log('[Upload] File selected:', file.name, 'Size:', file.size, 'bytes');
        
        const reader = new FileReader();
        reader.onload = () => {
            const fullDataUrl = reader.result as string;
            console.log('[Upload] DataURL length:', fullDataUrl.length);
            console.log('[Upload] DataURL prefix:', fullDataUrl.substring(0, 50));
            
            // Remove data:image/...;base64, prefix
            const commaIndex = fullDataUrl.indexOf(',');
            const base64 = commaIndex !== -1 ? fullDataUrl.substring(commaIndex + 1) : fullDataUrl;
            
            console.log('[Upload] Base64 length:', base64.length);
            console.log('[Upload] Base64 first 50:', base64.substring(0, 50));
            
            setInstitutionLogo(base64, file.name);
            console.log('[Upload] ✓ Logo stored in GLOBAL store (persistent across modules)');
        };
        reader.onerror = (error) => {
            console.error('[Upload] ✗ FileReader error:', error);
        };
        reader.readAsDataURL(file);
    };

    const canUseSecondary = secondaryLanguage !== 'none';

    const buildFilenameBase = () => {
        const safeTitle = (props.title || 'export').replace(/[\\/:*?"<>|]+/g, '-').trim();
        const safeMod = props.moduleId;
        return `${safeTitle}-${safeMod}-${new Date().toISOString().slice(0, 10)}`;
    };

    const requestOne = async (lang: 'primary' | 'secondary', withSolutions: boolean = true) => {
        const filenameBase = buildFilenameBase();
        const languageLabel = lang === 'primary' ? primaryLanguage : secondaryLanguage;
        const suffix = withSolutions ? 'with-solutions' : 'questions-only';
        
        // Handle formal exam format separately
        if (isExamFormat) {
            return requestExamFormat(lang, withSolutions);
        }
        
        const filename = `${filenameBase}-${languageLabel}-${suffix}.${format}`;

        // Get templates from IndexedDB
        let templateDocxBase64: string | undefined;
        let templatePptxBase64: string | undefined;

        if (format === 'docx') {
            const t = exportTemplates.find((x) => x.type === 'docx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) templateDocxBase64 = Buffer.from(buffer).toString('base64');
            }
        } else if (format === 'pptx') {
            const t = exportTemplates.find((x) => x.type === 'pptx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) templatePptxBase64 = Buffer.from(buffer).toString('base64');
            }
        }

        const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                format,
                filename,
                title: props.title,
                language: lang,
                primaryLanguage,
                secondaryLanguage,
                includeSolutions: withSolutions,
                includeExplanations: withSolutions, 
                items: selectedItems,
                templateDocxBase64,
                templatePptxBase64,
                moduleId: props.moduleId, // Pass module ID for generation history
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export failed (${res.status})`);
        }

        const blob = await res.blob();
        return { blob, filename };
    };
    
    // Request formal exam format export
    const requestExamFormat = async (lang: 'primary' | 'secondary', withSolutions: boolean = true) => {
        const languageLabel = lang === 'primary' ? primaryLanguage : secondaryLanguage;
        const suffix = withSolutions ? 'with-answers' : 'exam-paper';
        const filenameBase = buildFilenameBase();

        // Determine file extension based on format
        const extMap: Record<ExportFormat, string> = {
            'exam_docx': 'docx',
            'exam_pdf': 'pdf',
            'exam_pptx': 'pptx',
        };
        const ext = extMap[format];
        const filename = `${filenameBase}-${languageLabel}-${suffix}.${ext}`;
        
        // Convert ExportItems to LegacyExportItem format for the API
        const legacyItems = selectedItems.map(item => ({
            number: item.number,
            title: item.title,
            type: item.type,
            points: item.points,
            question: lang === 'primary' ? item.primary.question : (item.secondary?.question || item.primary.question),
            solution: withSolutions 
                ? (lang === 'primary' ? item.primary.solution : (item.secondary?.solution || item.primary.solution))
                : undefined,
            explanation: withSolutions 
                ? (lang === 'primary' ? item.primary.explanation : (item.secondary?.explanation || item.primary.explanation))
                : undefined,
            sources: item.sources,
        }));
        
        console.log('[Export] Logo status:', {
            hasLogo: !!institutionLogoBase64,
            logoLength: institutionLogoBase64?.length || 0,
            logoPrefix: institutionLogoBase64?.substring(0, 30)
        });
        
        // Load templates from IndexedDB
        let templatePptxBase64: string | undefined;
        let templateDocxBase64: string | undefined;
        if (ext === 'pptx') {
            const t = exportTemplates.find((x) => x.type === 'pptx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) {
                    templatePptxBase64 = Buffer.from(buffer).toString('base64');
                    console.log('[Export] PPTX template loaded from IndexedDB:', t.name, 'base64 length:', templatePptxBase64.length);
                }
            }
        } else if (ext === 'docx') {
            const t = exportTemplates.find((x) => x.type === 'docx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) templateDocxBase64 = Buffer.from(buffer).toString('base64');
            }
        }
        
        const res = await fetch('/api/export-exam', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'convert',
                format: ext, // 'docx', 'pdf', or 'pptx'
                items: legacyItems,
                course: examConfig.course || props.title,
                institution: examConfig.institution || 'University',
                examType: examConfig.examType || 'Examination',
                durationMinutes: examConfig.durationMinutes || 120,
                includeSolutions: withSolutions,
                // Logo for header (if uploaded)
                institutionLogoBase64: institutionLogoBase64 || undefined,
                // Templates (if uploaded)
                templatePptxBase64,
                templateDocxBase64,
            }),
        });
        
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export failed (${res.status})`);
        }
        
        const blob = await res.blob();
        return { blob, filename };
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const ext = file.name.split('.').pop()?.toLowerCase();
        const type = ext === 'docx' ? 'docx' : ext === 'pptx' ? 'pptx' : null;
        if (!type) {
            alert('Please upload a .docx or .pptx file.');
            return;
        }

        const buffer = await file.arrayBuffer();
        const id = `${type}-template-${Date.now()}`;
        await saveTemplateToIdb(id, buffer);

        const newTpl = { id, name: file.name, type };
        const filtered = exportTemplates.filter((t) => t.type !== type);
        setExportTemplates([...filtered, newTpl]);
    };

    const removeTemplate = async (id: string) => {
        // Optionally delete from IndexedDB
        setExportTemplates(exportTemplates.filter((t) => t.id !== id));
    };

    // Build items for a specific variant combination
    // variantIndex=0 means "A" (all originals)
    // variantIndex=1 means "B" (first selected variant for each item)
    // etc.
    const buildItemsForVariant = (variantIndex: number): ExportItem[] => {
        console.log(`[buildItemsForVariant] Building for variantIndex=${variantIndex}`);
        
        return selectedItems.map((item) => {
            const itemId = `${props.moduleId.slice(0, -1)}-${item.number}`;
            const info = props.variantInfo?.[itemId];
            
            console.log(`[buildItemsForVariant] Item ${itemId}:`, {
                hasInfo: !!info,
                variantsCount: info?.variants?.length || 0,
                selectedIds: info?.selectedVariantIds || ['original'],
            });
            
            // variantIndex=0 always returns original (version A)
            if (!info || variantIndex === 0) {
                return item;
            }
            
            // Get ordered variants based on selected IDs (excluding 'original')
            const variants = info.variants || [];
            const selectedIds = info.selectedVariantIds || ['original'];
            
            // Build ordered list: filter out 'original', then find matching variant objects
            const orderedVariants = selectedIds
                .filter(id => id !== 'original')
                .map(id => variants.find((v: any) => v.variantId === id))
                .filter(Boolean);
            
            console.log(`[buildItemsForVariant] Item ${itemId} orderedVariants count: ${orderedVariants.length}`);
            
            // variantIndex starts at 1 for variants (B, C, D...)
            // So orderedVariants[0] is for variantIndex=1, etc.
            if (variantIndex - 1 >= orderedVariants.length) {
                // Not enough variants for this item, fallback to original
                console.log(`[buildItemsForVariant] Item ${itemId}: fallback to original (not enough variants)`);
                return item;
            }
            
            const variant = orderedVariants[variantIndex - 1];
            if (!variant) return item;
            
            console.log(`[buildItemsForVariant] Item ${itemId}: using variant`, variant.variantId);
            
            // Build ExportItem from variant
            return {
                ...item,
                title: variant.concept_name || variant.title || item.title,
                primary: {
                    question: variant.question || '',
                    solution: variant.solution || '',
                    explanation: variant.solution_explanation || '',
                },
                secondary: {
                    question: variant.question_secondary || '',
                    solution: variant.solution_secondary || '',
                    explanation: variant.solution_explanation_secondary || '',
                },
            };
        });
    };

    const handleExport = async () => {
        if (selectedItems.length === 0) {
            alert('Please select at least one problem to export.');
            return;
        }
        
        // Check for uneven variant counts
        if (useVariantCombinations && hasVariants && variantCountsUneven) {
            setShowVariantWarning(true);
            return;
        }
        
        setExporting(true);
        try {
            const lang: 'primary' | 'secondary' = languageMode === 'secondary' ? 'secondary' : 'primary';
            
            if (languageMode === 'secondary' && !canUseSecondary) {
                alert('Secondary language is disabled.');
                return;
            }
            
            // If using variant combinations, generate multiple exports
            if (useVariantCombinations && hasVariants && maxVariantCount > 1) {
                console.log('[Export] Exporting variant combinations:', {
                    useVariantCombinations,
                    hasVariants,
                    maxVariantCount,
                    variantCounts,
                });
                
                const zip = new JSZip();
                
                for (let i = 0; i < maxVariantCount; i++) {
                    const variantItems = buildItemsForVariant(i);
                    const variantLabel = String.fromCharCode(65 + i); // A, B, C, ...
                    
                    console.log(`[Export] Creating version ${variantLabel} with ${variantItems.length} items`);
                    
                    // Export questions only
                    const questionsOnly = await requestOneWithItems(lang, false, variantItems, `_v${variantLabel}`);
                    zip.file(questionsOnly.filename, questionsOnly.blob);
                    console.log(`[Export] Added ${questionsOnly.filename}`);
                    
                    // Export with solutions if enabled
                    if (includeSolutions) {
                        const withSolutions = await requestOneWithItems(lang, true, variantItems, `_v${variantLabel}`);
                        zip.file(withSolutions.filename, withSolutions.blob);
                        console.log(`[Export] Added ${withSolutions.filename}`);
                    }
                }
                
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                console.log('[Export] Generated ZIP with variant combinations');
                downloadBlob(zipBlob, `${buildFilenameBase()}_variants.zip`);
            } else {
                // Standard export (no variants)
                if (includeSolutions) {
                    const zip = new JSZip();
                    
                    // Export questions only
                    const questionsOnly = await requestOne(lang, false);
                    zip.file(questionsOnly.filename, questionsOnly.blob);
                    
                    // Export with solutions
                    const withSolutions = await requestOne(lang, true);
                    zip.file(withSolutions.filename, withSolutions.blob);
                    
                    // If both languages, also add secondary language files
                    if (languageMode === 'both_separate_zip' && canUseSecondary) {
                        const questionsOnlySec = await requestOne('secondary', false);
                        zip.file(questionsOnlySec.filename, questionsOnlySec.blob);
                        const withSolutionsSec = await requestOne('secondary', true);
                        zip.file(withSolutionsSec.filename, withSolutionsSec.blob);
                    }
                    
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    downloadBlob(zipBlob, `${buildFilenameBase()}.zip`);
                } else {
                    // Just export questions only (single file)
                    const { blob, filename } = await requestOne(lang, false);
                    
                    if (languageMode === 'both_separate_zip' && canUseSecondary) {
                        const zip = new JSZip();
                        zip.file(filename, blob);
                        const sec = await requestOne('secondary', false);
                        zip.file(sec.filename, sec.blob);
                        const zipBlob = await zip.generateAsync({ type: 'blob' });
                        downloadBlob(zipBlob, `${buildFilenameBase()}.zip`);
                    } else {
                        downloadBlob(blob, filename);
                    }
                }
            }
        } catch (e: any) {
            console.error('Export error:', e);
            alert(`Export error: ${e?.message || 'Unknown error'}`);
        } finally {
            setExporting(false);
        }
    };
    
    // Request with custom items (for variant export)
    const requestOneWithItems = async (lang: 'primary' | 'secondary', withSolutions: boolean, items: ExportItem[], suffix: string = '') => {
        const filenameBase = buildFilenameBase();
        const languageLabel = lang === 'primary' ? primaryLanguage : secondaryLanguage;
        const solutionSuffix = withSolutions ? 'with-solutions' : 'questions-only';
        const filename = `${filenameBase}${suffix}-${languageLabel}-${solutionSuffix}.${format}`;

        // Get templates from IndexedDB
        let templateDocxBase64: string | undefined;
        let templatePptxBase64: string | undefined;

        if (format === 'docx') {
            const t = exportTemplates.find((x) => x.type === 'docx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) templateDocxBase64 = Buffer.from(buffer).toString('base64');
            }
        } else if (format === 'pptx') {
            const t = exportTemplates.find((x) => x.type === 'pptx');
            if (t) {
                const buffer = await getTemplateFromIdb(t.id);
                if (buffer) templatePptxBase64 = Buffer.from(buffer).toString('base64');
            }
        }

        const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                format,
                filename,
                title: props.title,
                language: lang,
                primaryLanguage,
                secondaryLanguage,
                includeSolutions: withSolutions,
                includeExplanations: withSolutions, 
                items,
                templateDocxBase64,
                templatePptxBase64,
                moduleId: props.moduleId, // Pass module ID for generation history
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Export failed (${res.status})`);
        }

        const blob = await res.blob();
        return { blob, filename };
    };
    
    const handleConfirmUnevenExport = () => {
        setShowVariantWarning(false);
        // Continue with export using first variant for items with fewer variants
        setExporting(true);
        handleExportAfterWarning();
    };
    
    const handleExportAfterWarning = async () => {
        try {
            const lang: 'primary' | 'secondary' = languageMode === 'secondary' ? 'secondary' : 'primary';
            const zip = new JSZip();
            
            for (let i = 0; i < maxVariantCount; i++) {
                const variantItems = buildItemsForVariant(i);
                const variantLabel = String.fromCharCode(65 + i);
                
                const questionsOnly = await requestOneWithItems(lang, false, variantItems, `_v${variantLabel}`);
                zip.file(questionsOnly.filename, questionsOnly.blob);
                
                if (includeSolutions) {
                    const withSolutions = await requestOneWithItems(lang, true, variantItems, `_v${variantLabel}`);
                    zip.file(withSolutions.filename, withSolutions.blob);
                }
            }
            
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, `${buildFilenameBase()}_variants.zip`);
        } catch (e: any) {
            console.error('Export error:', e);
            alert(`Export error: ${e?.message || 'Unknown error'}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="mt-4 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-slate-600 dark:text-slate-300">
                    Selected: <strong>{selectedItems.length}</strong>
                </div>
                <Button 
                    onClick={handleExport} 
                    disabled={exporting || selectedItems.length === 0 || (useVariantCombinations && variantCountsUneven)}
                    className="transition-all duration-200 cursor-pointer disabled:cursor-not-allowed"
                >
                    {exporting ? 'Exporting…' : (useVariantCombinations && variantCountsUneven) ? 'Fix variant counts first' : 'Export Selected'}
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Format</div>
                    <select
                        className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                        value={format}
                        onChange={(e) => setFormat(e.target.value as ExportFormat)}
                    >
                        <option value="exam_docx">Word (.docx)</option>
                        <option value="exam_pdf">PDF (.pdf)</option>
                        <option value="exam_pptx">PPT (.pptx)</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Content</div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={includeSolutions}
                            onChange={(e) => setIncludeSolutions(e.target.checked)}
                        />
                        Include solutions (with explanations)
                    </label>
                    <p className="text-xs text-slate-500">
                        {includeSolutions 
                            ? 'Will export: Questions file + Questions with Solutions file'
                            : 'Will export: Questions only'}
                    </p>
                </div>

                <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Language</div>
                    <select
                        className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                        value={languageMode}
                        onChange={(e) => setLanguageMode(e.target.value as ExportLanguageMode)}
                    >
                        <option value="primary">{primaryLanguage} only</option>
                        <option value="secondary" disabled={!canUseSecondary}>
                            {secondaryLanguage === 'none' ? 'Secondary disabled' : `${secondaryLanguage} only`}
                        </option>
                        <option value="both_separate_zip" disabled={!canUseSecondary}>
                            {secondaryLanguage === 'none' ? 'Secondary disabled' : 'Both languages (separate files, zip)'}
                        </option>
                    </select>
                </div>
            </div>

            {/* Exam Format Configuration */}
            {isExamFormat && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-500 uppercase mb-2">📄 Exam Paper Settings</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500">Course Name</label>
                            <input
                                type="text"
                                className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                                value={examConfig.course}
                                onChange={(e) => setExamConfig({ ...examConfig, course: e.target.value })}
                                placeholder={props.title || 'Introduction to Programming'}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500">Institution</label>
                            {!institutionLogoBase64 ? (
                                <>
                                    <input
                                        type="text"
                                        className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                                        value={examConfig.institution}
                                        onChange={(e) => setExamConfig({ ...examConfig, institution: e.target.value })}
                                        placeholder="International University"
                                    />
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] text-slate-400">or</span>
                                        <button
                                            type="button"
                                            className="text-[10px] text-blue-600 hover:underline flex items-center gap-1 transition-colors duration-200 cursor-pointer"
                                            onClick={() => logoInputRef.current?.click()}
                                        >
                                            <Upload size={10} /> Upload Logo
                                        </button>
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif"
                                            className="hidden"
                                            onChange={handleLogoUpload}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-800">
                                    <CheckCircle2 size={14} className="text-green-500" />
                                    <span className="text-xs text-slate-600 dark:text-slate-400 flex-1 truncate">{institutionLogoName}</span>
                                    <button
                                        type="button"
                                        className="text-[10px] text-red-500 hover:underline transition-colors duration-200 cursor-pointer"
                                        onClick={() => { setInstitutionLogo(null, null); }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500">Exam Type</label>
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                                    value={examTypeDropdown}
                                    onChange={(e) => {
                                        setExamTypeDropdown(e.target.value);
                                        if (e.target.value !== '__custom__') {
                                            setExamConfig({ ...examConfig, examType: e.target.value });
                                        }
                                    }}
                                >
                                    <option value="Final Examination">Final Examination</option>
                                    <option value="Midterm Examination">Midterm Examination</option>
                                    <option value="Quiz">Quiz</option>
                                    <option value="Practice Exam">Practice Exam</option>
                                    <option value="Lab Exam">Lab Exam</option>
                                    <option value="__custom__">Other (custom)...</option>
                                </select>
                            </div>
                            {examTypeDropdown === '__custom__' && (
                                <input
                                    type="text"
                                    className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                                    value={examConfig.examType}
                                    onChange={(e) => setExamConfig({ ...examConfig, examType: e.target.value })}
                                    placeholder="Enter custom exam type..."
                                />
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-500">Duration (minutes)</label>
                            <input
                                type="number"
                                className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                                value={examConfig.durationMinutes}
                                onChange={(e) => setExamConfig({ ...examConfig, durationMinutes: parseInt(e.target.value) || 120 })}
                                min={15}
                                max={300}
                            />
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                        * Formal exam paper includes: header with student info, instructions box, page breaks between sections, and professional formatting.
                    </p>
                </div>
            )}

            {/* Variant Combinations Section */}
            {hasVariants && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={useVariantCombinations}
                                onChange={(e) => setUseVariantCombinations(e.target.checked)}
                            />
                            <span className="font-medium">Export variant combinations</span>
                        </label>
                        {useVariantCombinations && !variantCountsUneven && (
                            <span className="text-xs text-green-600 dark:text-green-400">
                                ✓ Will generate {maxVariantCount} version(s): {Array.from({ length: maxVariantCount }, (_, i) => String.fromCharCode(65 + i)).join(', ')}
                            </span>
                        )}
                    </div>
                    {useVariantCombinations && variantCountsUneven && (
                        <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
                                ❌ Cannot export: Variant counts do not match!
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                                Questions with variants must have the same count. Either add more variants or reduce selections:
                            </p>
                            <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                                {itemsWithVariants.map(([itemId, count]) => {
                                    const needsMore = count < maxVariantCount;
                                    return (
                                        <li key={itemId} className={needsMore ? 'font-bold' : ''}>
                                            {itemId}: {count} variant(s) 
                                            {needsMore && ` → Need ${maxVariantCount - count} more, OR reduce others to ${count}`}
                                            {!needsMore && ' ✓ (max)'}
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 italic">
                                Note: Questions with only the original (no variants) are not affected.
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                                💡 Use "+ Similar" to add variants, or uncheck ✓ badges to reduce count.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Variant Warning Modal */}
            {showVariantWarning && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md mx-4 shadow-xl">
                        <h3 className="text-lg font-semibold mb-3">Uneven Variant Counts</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Some questions have fewer variants than others:
                        </p>
                        <ul className="text-xs text-slate-500 mb-4 space-y-1">
                            {Object.entries(variantCounts).map(([itemId, count]) => (
                                <li key={itemId}>
                                    {itemId}: {count} variant(s) {count < maxVariantCount ? '⚠️' : '✓'}
                                </li>
                            ))}
                        </ul>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Questions with fewer variants will use their original version for missing slots.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setShowVariantWarning(false)} className="transition-colors duration-200 cursor-pointer">
                                Cancel
                            </Button>
                            <Button onClick={handleConfirmUnevenExport} className="transition-colors duration-200 cursor-pointer">
                                Continue Anyway
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Template Section */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        Export Templates (Optional)
                    </div>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 text-xs gap-1 transition-colors duration-200 cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Upload className="w-3 h-3" />
                        Upload Template
                    </Button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".docx,.pptx"
                        onChange={handleFileUpload}
                    />
                </div>
                
                <div className="flex gap-2 flex-wrap">
                    {exportTemplates.length === 0 && (
                        <div className="text-xs text-slate-400 italic">No templates uploaded. Using default styles.</div>
                    )}
                    {exportTemplates.map((tpl) => (
                        <div key={tpl.id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                            <span className="text-xs font-medium">{tpl.type.toUpperCase()}: {tpl.name}</span>
                            <button 
                                onClick={() => removeTemplate(tpl.id)}
                                className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
                {exportTemplates.some(t => t.type === 'pptx') && (
                    <p className="text-[10px] text-slate-500 mt-1">
                        * PPTX template: Content will be overlaid on the background of the first slide.
                    </p>
                )}
            </div>
        </div>
    );
}


