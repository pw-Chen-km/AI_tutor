'use client';

import { useStore } from '@/lib/store';
import { DrillsModule } from './modules/drills-module';
import { LabsModule } from './modules/labs-module';
import { HomeworkModule } from './modules/homework-module';
import { ExamsModule } from './modules/exams-module';
import { LectureRehearsalModule } from './modules/lecture-rehearsal-module';
import { ExamEvaluationModule } from './modules/exam-evaluation-module';

export function MainPanel() {
    const { activeModule } = useStore();

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-background/50">
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto p-8">
                    {activeModule === 'drills' && <DrillsModule />}
                    {activeModule === 'labs' && <LabsModule />}
                    {activeModule === 'homework' && <HomeworkModule />}
                    {activeModule === 'exams' && <ExamsModule />}
                    {activeModule === 'lecture_rehearsal' && <LectureRehearsalModule />}
                    {activeModule === 'exam_evaluation' && <ExamEvaluationModule />}
                </div>
            </div>
        </div>
    );
}
