'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, X, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Variant {
    variantId: string;
    [key: string]: any;
}

interface VariantSelectorProps {
    itemId: string;
    originalItem: any;
    variants: Variant[];
    selectedVariantIds: string[];
    displayedVariantId?: string;
    onToggleVariant: (variantId: string) => void;
    onDisplayVariant: (variantId: string) => void;
    onGenerateSimilar: () => Promise<void>;
    onRemoveVariant: (variantId: string) => void;
    onReorderVariants: (variantIds: string[]) => void;
    isGenerating: boolean;
    getDisplayText: (item: any) => string;
    primaryLanguage: string;
}

export function VariantSelector({
    itemId,
    originalItem,
    variants,
    selectedVariantIds,
    displayedVariantId = 'original',
    onToggleVariant,
    onDisplayVariant,
    onGenerateSimilar,
    onRemoveVariant,
    onReorderVariants,
    isGenerating,
    getDisplayText,
    primaryLanguage,
}: VariantSelectorProps) {
    const [movedIndex, setMovedIndex] = useState<number | null>(null);
    
    // Original is always 'A', variants are 'B', 'C', etc.
    const getLabel = (index: number) => String.fromCharCode(65 + index);

    const allItems = [
        { ...originalItem, variantId: 'original', label: 'A' },
        ...variants.map((v, i) => ({ ...v, label: getLabel(i + 1) })),
    ];

    // Move variant up (earlier in order)
    const moveUp = (variantIndex: number) => {
        if (variantIndex <= 0 || variantIndex >= variants.length) return;
        const variantIds = variants.map((v) => v.variantId);
        const temp = variantIds[variantIndex];
        variantIds[variantIndex] = variantIds[variantIndex - 1];
        variantIds[variantIndex - 1] = temp;
        
        // Flash animation
        setMovedIndex(variantIndex - 1);
        setTimeout(() => setMovedIndex(null), 300);
        
        onReorderVariants(variantIds);
    };

    // Move variant down (later in order)
    const moveDown = (variantIndex: number) => {
        if (variantIndex < 0 || variantIndex >= variants.length - 1) return;
        const variantIds = variants.map((v) => v.variantId);
        const temp = variantIds[variantIndex];
        variantIds[variantIndex] = variantIds[variantIndex + 1];
        variantIds[variantIndex + 1] = temp;
        
        // Flash animation
        setMovedIndex(variantIndex + 1);
        setTimeout(() => setMovedIndex(null), 300);
        
        onReorderVariants(variantIds);
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Variants:</span>

                {allItems.map((item, index) => {
                    const isOriginal = index === 0;
                    const isSelected = isOriginal
                        ? selectedVariantIds.includes('original')
                        : selectedVariantIds.includes(item.variantId);
                    const isDisplayed = displayedVariantId === item.variantId;
                    const variantArrayIndex = index - 1; // Index in variants array (for non-original)

                    return (
                        <div
                            key={item.variantId}
                            className={`flex items-center gap-1 transition-all duration-300 ${
                                movedIndex === variantArrayIndex ? 'scale-110 bg-green-100 dark:bg-green-900 rounded px-1' : ''
                            }`}
                        >
                            {/* Reorder buttons (only for non-original variants) */}
                            {!isOriginal && variants.length > 1 && (
                                <div className="flex flex-col">
                                    <button
                                        className="p-0 h-3 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                        onClick={() => moveUp(variantArrayIndex)}
                                        disabled={variantArrayIndex === 0}
                                        title="Move up"
                                    >
                                        <ChevronUp className="w-3 h-3" />
                                    </button>
                                    <button
                                        className="p-0 h-3 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                        onClick={() => moveDown(variantArrayIndex)}
                                        disabled={variantArrayIndex === variants.length - 1}
                                        title="Move down"
                                    >
                                        <ChevronDown className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                            
                            <Badge
                                variant={isSelected ? 'default' : 'outline'}
                                className={`cursor-pointer transition-all ${
                                    isSelected
                                        ? 'bg-blue-600 hover:bg-blue-700'
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                                onClick={() => onToggleVariant(item.variantId)}
                                title="Toggle for export (can select multiple)"
                            >
                                {item.label}
                                {isSelected && ' ✓'}
                            </Badge>

                            {/* Display toggle button (eye icon) */}
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-6 w-6 p-0 ${isDisplayed ? 'text-green-600' : 'text-slate-400'}`}
                                onClick={() => onDisplayVariant(item.variantId)}
                                title={isDisplayed ? 'Currently displayed' : 'Click to display this variant'}
                            >
                                <Eye className="w-3 h-3" />
                            </Button>

                            {/* Remove button (not for original) */}
                            {!isOriginal && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                    onClick={() => onRemoveVariant(item.variantId)}
                                    title="Remove variant"
                                >
                                    <X className="w-3 h-3" />
                                </Button>
                            )}
                        </div>
                    );
                })}

                {/* Generate Similar button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onGenerateSimilar}
                    disabled={isGenerating}
                >
                    {isGenerating ? (
                        <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-3 h-3 mr-1" />
                            + Similar
                        </>
                    )}
                </Button>

                {/* Variant count summary */}
                {variants.length > 0 && (
                    <span className="text-xs text-slate-500 ml-2">
                        ({selectedVariantIds.length} selected for export)
                    </span>
                )}
            </div>
        </div>
    );
}

