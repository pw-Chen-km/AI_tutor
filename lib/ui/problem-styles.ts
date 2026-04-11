// Shared styles for problem cards across all modules
// Update this file to change the appearance of all problem cards

export const problemCardStyles = {
    // Card header gradients by module
    headerGradients: {
        drills: 'from-blue-500/10 to-purple-500/10 dark:from-blue-500/20 dark:to-purple-500/20',
        labs: 'from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20',
        homework: 'from-slate-100 to-slate-50 dark:from-slate-800/50 dark:to-slate-900/50',
        exams: 'from-orange-500/10 to-yellow-500/10 dark:from-orange-500/20 dark:to-yellow-500/20',
    },

    // Type badge styles
    typeBadge: {
        base: 'px-2 py-1 text-xs font-semibold rounded',
        default: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
        coding: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        debugging: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        trace: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
        multiple_choice: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        short_answer: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
        fill_in_blank: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    },

    // Chapter badge style
    chapterBadge: 'px-2 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded',

    // Content block styles
    contentBlocks: {
        primary: {
            container: 'border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/10 rounded-r-lg p-4 mb-4',
            header: 'text-blue-700 dark:text-blue-300',
        },
        secondary: {
            container: 'border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/10 rounded-r-lg p-4 mb-4',
            header: 'text-purple-700 dark:text-purple-300',
        },
        solution: {
            container: 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3',
            header: 'text-green-700 dark:text-green-300',
        },
        explanation: {
            container: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3',
            header: 'text-blue-700 dark:text-blue-300',
        },
    },

    // Button styles
    buttons: {
        copy: 'variant-ghost size-sm',
        regenerate: 'variant-ghost size-sm',
    },
};

// Helper to get type badge color based on question type
export function getTypeBadgeClass(type: string): string {
    const normalizedType = (type || '').toLowerCase().replace(/\s+/g, '_');
    const styles = problemCardStyles.typeBadge;
    
    if (normalizedType.includes('coding')) return `${styles.base} ${styles.coding}`;
    if (normalizedType.includes('debug')) return `${styles.base} ${styles.debugging}`;
    if (normalizedType.includes('trace')) return `${styles.base} ${styles.trace}`;
    if (normalizedType.includes('multiple') || normalizedType.includes('choice')) return `${styles.base} ${styles.multiple_choice}`;
    if (normalizedType.includes('short')) return `${styles.base} ${styles.short_answer}`;
    if (normalizedType.includes('fill')) return `${styles.base} ${styles.fill_in_blank}`;
    
    return `${styles.base} ${styles.default}`;
}

// Format type display text
export function formatTypeDisplay(type: string): string {
    return (type || '').replace(/_/g, ' ').toUpperCase();
}

// Format sources for display
export function formatSources(sources: Array<{ file: string; pages?: string }>): string {
    if (!sources || sources.length === 0) return '';
    return sources.map(s => `${s.file}${s.pages ? ` (${s.pages})` : ''}`).join(', ');
}




