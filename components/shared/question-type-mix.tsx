'use client';

import { Input } from '@/components/ui/input';
import { QuestionTypeConfig } from '@/lib/subjects';

export function QuestionTypeMix(props: {
    title: string;
    subjectLabel?: string;
    types: QuestionTypeConfig[];
    total: number;
    counts: Record<string, number>;
    onChange: (nextCounts: Record<string, number>) => void;
    description?: string;
}) {
    const { title, subjectLabel, types, total, counts, onChange, description } = props;
    const assigned = types.reduce((sum, t) => sum + Math.max(0, Number(counts[t.id]) || 0), 0);
    const remaining = Math.max(0, total - assigned);

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium">
                {title}
                {subjectLabel ? ` (${subjectLabel})` : ''}
            </h4>
            <p className="text-xs text-slate-500">
                {description ||
                    `Directly assign question counts per type. Total must be ${total}.`}
            </p>
            <p className="text-xs text-slate-500">
                Assigned: {assigned} / {total} · Remaining: {remaining}
            </p>
            <div className="space-y-3">
                {types.map((t) => {
                    const current = Math.max(0, Number(counts[t.id]) || 0);
                    const otherAssigned = assigned - current;
                    const maxAllowed = Math.max(0, total - otherAssigned);
                    return (
                        <div key={t.id} className="grid grid-cols-[140px_120px] items-center gap-3">
                            <div className="text-sm text-slate-700 dark:text-slate-300">{t.label}</div>
                            <Input
                                type="number"
                                min={0}
                                max={maxAllowed}
                                step={1}
                                inputMode="numeric"
                                value={current}
                                onChange={(e) => {
                                    const raw = Number(e.target.value);
                                    const next = Number.isFinite(raw) ? Math.floor(raw) : 0;
                                    const clamped = Math.max(0, Math.min(maxAllowed, next));
                                    onChange({ ...counts, [t.id]: clamped });
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


