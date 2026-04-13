/**
 * In-Class Drills Module (v2 - Agent Skills)
 * 
 * This is an example of how to use the agent skills system.
 * Copy this pattern for new modules.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Copy, Check, Loader2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { QuestionTypeMix } from '@/components/shared/question-type-mix';
import { ExportPanel, type ExportItem } from '@/components/shared/export-panel';
import { CodeBlock } from '@/components/shared/code-block';
import { MixedContent } from '@/components/shared/mixed-content';
import { defaultWeights, getDrillsTypes, getSubjectConfig, weightsToCounts } from '@/lib/subjects';
import { ensureMarkdownCodeFences, wrapSolutionAsCodeIfCoding } from '@/lib/llm/format';

// Helper function to check if a problem type is coding-related
function isCodingType(format: string | undefined): boolean {
  const normalized = String(format || '').toLowerCase();
  return normalized.includes('coding') || 
         normalized.includes('debugging') || 
         normalized.includes('trace') ||
         normalized === 'code';
}

export function DrillsModuleV2() {
  const {
    contextFiles,
    llmConfig,
    languageConfig,
    subject,
    generatedContent,
    setGeneratedContent,
    customQuestionTypes,
    includeWebResources,
  } = useStore();

  const [loading, setLoading] = useState(false);
  const [numberOfQuestions, setNumberOfQuestions] = useState<number>(5);
  const [minutesPerProblem, setMinutesPerProblem] = useState<number>(8);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});
  const [showSecondarySolution, setShowSecondarySolution] = useState<Record<number, boolean>>({});

  const primaryLanguage = languageConfig.primaryLanguage;
  const secondaryLanguage = languageConfig.secondaryLanguage;
  const subjectConfig = getSubjectConfig(subject);
  const drillsTypes = useMemo(() => getDrillsTypes(subject, customQuestionTypes?.drills), [subject, customQuestionTypes?.drills]);
  
  const [typeWeights, setTypeWeights] = useState(defaultWeights(drillsTypes));
  const typeCounts = useMemo(() => weightsToCounts(numberOfQuestions, typeWeights), [numberOfQuestions, typeWeights]);

  const drills = Array.isArray(generatedContent.drills) ? generatedContent.drills : [];
  const safeDrills = drills.filter((d) => d && typeof d === 'object');

  // Auto-select all when generated
  useEffect(() => {
    if (safeDrills.length > 0 && selectedNumbers.length === 0) {
      setSelectedNumbers(safeDrills.map((d: any, i: number) => d?.number ?? i + 1));
    }
  }, [safeDrills]);

  /**
   * Generate drills using agent skills orchestrator
   */
  const handleGenerate = async () => {
    if (contextFiles.length === 0) {
      alert('Please upload at least one file to generate drills.');
      return;
    }

    if (!llmConfig.apiKey) {
      alert('Please configure your LLM API key in settings.');
      return;
    }

    setLoading(true);
    try {
      const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

      // Call the new agent-based API
      const response = await fetch('/api/generate-with-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleType: 'drills',
          numberOfItems: numberOfQuestions,
          context,
          taskParams: {
            minutesPerProblem,
            subject,
            typeCounts,
            availableFiles: contextFiles.map((f) => f.name),
          },
          llmConfig,
          languageConfig,
          subject,
          includeWebResources,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      console.log('[drills-module-v2] API Response:', {
        success: data.success,
        resultsCount: data.results?.length || 0,
        firstResult: data.results?.[0] ? {
          keys: Object.keys(data.results[0]),
          question: data.results[0].question?.substring(0, 100) || 'EMPTY',
          solution: data.results[0].solution?.substring(0, 100) || 'EMPTY',
          full: JSON.stringify(data.results[0]).substring(0, 500),
        } : 'NO RESULTS',
      });
      
      if (!data.success || !Array.isArray(data.results)) {
        console.error('[drills-module-v2] Invalid response:', data);
        throw new Error('Invalid response from server');
      }

      // Add numbering
      const numberedResults = data.results.map((item: any, index: number) => {
        console.log(`[drills-module-v2] Processing result ${index + 1}:`, {
          keys: Object.keys(item),
          question: item.question?.substring(0, 50) || 'MISSING',
          solution: item.solution?.substring(0, 50) || 'MISSING',
        });
        return {
          ...item,
          number: index + 1,
        };
      });

      console.log('[drills-module-v2] Setting generated content:', {
        count: numberedResults.length,
        firstItem: numberedResults[0] ? {
          number: numberedResults[0].number,
          question: numberedResults[0].question?.substring(0, 50) || 'EMPTY',
          solution: numberedResults[0].solution?.substring(0, 50) || 'EMPTY',
        } : 'NONE',
      });

      setGeneratedContent('drills', numberedResults);
      console.log(`✅ Generated ${numberedResults.length} drills using agent skills`);

    } catch (error: any) {
      console.error('Generation error:', error);
      alert(`Failed to generate drills: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Regenerate a single drill using agent skills
   */
  const handleRegenerate = async (index: number) => {
    if (contextFiles.length === 0) return;
    if (!llmConfig.apiKey) return;
    
    const target = drills?.[index];
    if (!target) return;

    setRegenerating((s) => ({ ...s, [index]: true }));
    try {
      const context = contextFiles.map((f) => `FILE: ${f.name}\n${f.content}`).join('\n\n---\n\n');

      const response = await fetch('/api/generate-with-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleType: 'drills',
          action: 'regenerate',
          originalItem: target,
          context,
          taskParams: {
            minutesPerProblem,
            subject,
          },
          llmConfig,
          languageConfig,
          subject,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
        throw new Error('Invalid regenerate response');
      }

      const newDrill = data.results[0];
      const next = [...drills];
      next[index] = { ...newDrill, number: target.number };
      setGeneratedContent('drills', next);

      console.log(`✅ Regenerated drill ${index + 1} using agent skills`);

    } catch (error: any) {
      console.error('Regenerate error:', error);
      alert(`Failed to regenerate: ${error.message}`);
    } finally {
      setRegenerating((s) => ({ ...s, [index]: false }));
    }
  };

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  // Export items
  const exportItems: ExportItem[] = safeDrills
    .filter((d: any) => selectedNumbers.includes(d?.number ?? 0))
    .map((d: any) => ({
      number: d?.number ?? 0,
      title: d?.concept_name || 'Drill',
      type: d?.format || 'coding',
      points: d?.points ?? 5,
      sources: d?.sources || [],
      primary: {
        question: d?.question || '',
        solution: d?.solution || '',
        explanation: d?.solution_explanation || '',
      },
      secondary: {
        question: d?.question_secondary || '',
        solution: d?.solution_secondary || '',
        explanation: d?.solution_explanation_secondary || '',
      },
    }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          In-Class Drills Generator (Agent Skills v2)
        </h2>
        <p className="text-slate-600 dark:text-slate-400">
          Powered by modular agent skills system 🤖
        </p>
      </div>

      {/* Generation Controls */}
      <Card className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle>Generate Drills</CardTitle>
          <CardDescription>
            Using agent skills orchestrator for efficient, modular generation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="drills-count">Number of Questions</Label>
              <Input
                id="drills-count"
                type="number"
                min={1}
                max={50}
                value={numberOfQuestions}
                onChange={(e) => setNumberOfQuestions(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drills-minutes">Minutes per Problem</Label>
              <Input
                id="drills-minutes"
                type="number"
                min={1}
                max={180}
                value={minutesPerProblem}
                onChange={(e) => setMinutesPerProblem(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="mb-4">
            <QuestionTypeMix
              title="Question Type Mix"
              subjectLabel={subjectConfig.label}
              types={drillsTypes}
              total={numberOfQuestions}
              weights={typeWeights}
              counts={typeCounts}
              onChange={setTypeWeights}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={loading || contextFiles.length === 0}
            className="w-full sm:w-auto"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                Generating with Agent Skills...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 w-4 h-4" />
                Generate with Agent Skills 🤖
              </>
            )}
          </Button>
          {contextFiles.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
              ⚠️ Please upload course materials first
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {safeDrills && safeDrills.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-foreground">
              Generated Drills ({safeDrills.length})
            </h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedNumbers.length === safeDrills.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedNumbers(safeDrills.map((d: any, i: number) => (d?.number ?? i + 1)));
                    } else {
                      setSelectedNumbers([]);
                    }
                  }}
                />
                Select all
              </label>
            </div>
          </div>

          <ExportPanel
            title="In-Class Drills"
            moduleId="drills"
            items={exportItems}
            selectedNumbers={selectedNumbers}
          />

          {safeDrills.map((drill: any, index: number) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedNumbers.includes(drill?.number ?? index + 1)}
                        onChange={(e) => {
                          const num = drill?.number ?? index + 1;
                          setSelectedNumbers((prev) =>
                            e.target.checked ? Array.from(new Set([...prev, num])) : prev.filter((x) => x !== num)
                          );
                        }}
                      />
                      <CardTitle className="text-lg">
                        Problem {drill?.number ?? index + 1}{drill?.concept_name ? `: ${drill.concept_name}` : ''}
                      </CardTitle>
                      {drill?.format && (
                        <span className="ml-2 px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full">
                          {String(drill.format).replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </span>
                      )}
                    </div>
                    <CardDescription className="mt-1">
                      Worth {drill?.points ?? 5} points
                    </CardDescription>
                    <p className="text-xs text-muted-foreground mt-1">
                      Estimated time: ~{minutesPerProblem} min
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        const text = `# Problem ${drill?.number ?? index + 1}\n\n## Question\n${drill?.question || ''}\n\n## Solution\n${drill?.solution || ''}`;
                        handleCopy(text, index);
                      }}
                    >
                      {copiedIndex === index ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={loading || regenerating[index]}
                      onClick={() => handleRegenerate(index)}
                    >
                      {regenerating[index] ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {/* Primary language block */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-foreground">
                    {primaryLanguage} Block
                  </h4>
                  <div className="bg-muted/30 p-4 rounded-xl border">
                    {/* Only trace format uses CodeBlock for question */}
                    {/* All other types use MixedContent to properly render markdown and code blocks */}
                    {drill?.format === 'trace' ? (
                      <CodeBlock code={drill?.question || ''} />
                    ) : (
                      <MixedContent content={drill?.question || ''} />
                    )}
                  </div>

                  {/* Multiple Choice Options */}
                  {drill?.format === 'multiple_choice' && drill?.options && drill.options.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {drill.options.map((opt: string, optIdx: number) => (
                        <div key={optIdx} className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border">
                          <span className="font-bold text-primary min-w-[24px]">
                            {String.fromCharCode(65 + optIdx)}.
                          </span>
                          <span className="text-foreground">{opt}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSolution({ ...showSolution, [index]: !showSolution[index] })}
                  >
                    {showSolution[index] ? 'Hide' : 'Show'} Solution
                  </Button>
                  {showSolution[index] && (
                    <div className="mt-2 space-y-3">
                      <div className={isCodingType(drill?.format) ? '' : 'prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200'}>
                        {isCodingType(drill?.format) ? (
                          <CodeBlock code={drill?.solution || ''} />
                        ) : (
                          <div className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                              {ensureMarkdownCodeFences(drill?.solution || '')}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      {drill?.solution_explanation && drill.solution_explanation.trim().length > 0 && (
                        <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                            {ensureMarkdownCodeFences(drill.solution_explanation)}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Secondary language block */}
                {secondaryLanguage !== 'none' && (
                  <div className="space-y-4 pt-4 border-t">
                    <h4 className="font-semibold text-sm text-foreground">
                      {secondaryLanguage} Block
                    </h4>
                    {drill?.question_secondary && drill.question_secondary.trim().length > 0 && (
                      <div className="bg-muted/30 p-4 rounded-xl border">
                        {/* Only trace format uses CodeBlock for question */}
                        {/* All other types use MixedContent to properly render markdown and code blocks */}
                        {drill?.format === 'trace' ? (
                          <CodeBlock code={drill?.question_secondary || ''} />
                        ) : (
                          <MixedContent content={drill?.question_secondary || ''} />
                        )}
                      </div>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setShowSecondarySolution({
                          ...showSecondarySolution,
                          [index]: !showSecondarySolution[index],
                        })
                      }
                    >
                      {showSecondarySolution[index] ? 'Hide' : 'Show'} Solution ({secondaryLanguage})
                    </Button>
                    {showSecondarySolution[index] && drill?.solution_secondary && drill.solution_secondary.trim().length > 0 && (
                      <div className="mt-2 space-y-3">
                        <div className="max-w-none">
                          {isCodingType(drill?.format) ? (
                            <CodeBlock code={drill.solution_secondary} />
                          ) : (
                            <div className="prose prose-sm dark:prose-invert bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                                {ensureMarkdownCodeFences(drill.solution_secondary)}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                        {drill?.solution_explanation_secondary && drill.solution_explanation_secondary.trim().length > 0 && (
                          <div className="prose prose-sm dark:prose-invert max-w-none bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                              {ensureMarkdownCodeFences(drill.solution_explanation_secondary)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}



