'use client';

import { QuestionTypeConfig } from '@/lib/subjects';

export function QuestionTypeMix(props: {
    title: string;
    subjectLabel?: string;
    types: QuestionTypeConfig[];
    total: number;
    weights: Record<string, number>;
    counts: Record<string, number>;
    onChange: (nextWeights: Record<string, number>) => void;
    description?: string;
}) {
    const { title, subjectLabel, types, total, weights, counts, onChange, description } = props;

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium">
                {title}
                {subjectLabel ? ` (${subjectLabel})` : ''}
            </h4>
            <p className="text-xs text-slate-500">
                {description ||
                    `Use sliders to adjust the proportion. Counts on the right are the exact number per type (sum = ${total}).`}
            </p>
            <div className="space-y-3">
                {types.map((t) => {
                    const count = counts[t.id] ?? 0;
                    // If count is 0, force weight to 0 to ensure slider is at leftmost position
                    const effectiveWeight = count === 0 ? 0 : (weights[t.id] ?? 0);
                    return (
                        <div key={t.id} className="grid grid-cols-[140px_1fr_48px] items-center gap-3">
                            <div className="text-sm text-slate-700 dark:text-slate-300">{t.label}</div>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={effectiveWeight}
                                onChange={(e) => onChange({ ...weights, [t.id]: Number(e.target.value) || 0 })}
                            />
                            <div className="text-xs text-slate-500 text-right">{count}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


