/**
 * Agent Skills Orchestrator
 * 
 * Coordinates execution of multiple skills to complete complex tasks.
 */

import { skillRegistry } from './registry';
import { SkillContext, TaskPlan, ExecutionResult, SkillOutput, SkillInput } from './types';
import { convertPptxBase64ToPdfBase64, extractPdfSelectedPagesBase64 } from '@/lib/document-utils/direct-pdf';

export interface OrchestrationRequest {
  moduleType: 'drills' | 'labs' | 'homework' | 'exams' | 'lecture_rehearsal';
  numberOfItems: number;
  context: string;
  taskParams: Record<string, any>;
  llmContext: SkillContext;
  /** Called after each item (e.g. for progress bar). (current, total, message) */
  onProgress?: (current: number, total: number, message: string) => void;
}

type PlannedSourceItem = {
  itemNumber: number;
  questionType: string;
  file: string;
  pages: string;
  sources?: Array<{ file: string; pages: string }>;
  scopeKind?: string;
  chapterIds?: string[];
  sectionIds?: string[];
  topicLabels: string[];
  integrationGoal?: string;
  rationale: string;
};

type PreprocessedSourceDocument = {
  fileName: string;
  outline?: any;
  outlineSource?: string;
  pages: any[];
};

function inferChapterNumberFromText(...values: string[]) {
  const text = values.filter(Boolean).join(' ');
  const patterns = [
    /\bch(?:apter)?\.?\s*(\d{1,3})\b/i,
    /\bweek\s*(\d{1,3})\b/i,
    /\blecture\s*(\d{1,3})\b/i,
    /\bunit\s*(\d{1,3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

export class AgentOrchestrator {
  private static instance: AgentOrchestrator;

  private constructor() {}

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  /**
   * Generate questions using agent skills
   */
  async generateQuestions(request: OrchestrationRequest): Promise<{ results: any[]; totalTokensUsed: number }> {
    const { moduleType, numberOfItems, context, taskParams, llmContext, onProgress } = request;
    const results: any[] = [];
    let totalTokensUsed = 0;
    const maxRetries = 2; // Increased to allow more retries for robustness

    console.log(`🤖 Orchestrator: Generating ${numberOfItems} items for ${moduleType}`);

    // Parse context into separate file blocks for random selection
    const parsedFileBlocks = this.parseFileBlocks(context);
    const fileBlocks = this.filterFileBlocksBySelection(parsedFileBlocks, taskParams);
    console.log(`[Orchestrator] Parsed ${parsedFileBlocks.length} file blocks from context; using ${fileBlocks.length} after selection filter`);
    fileBlocks.forEach((fb, i) => {
      console.log(`  - File ${i + 1}: ${fb.fileName} (${fb.pages.length} pages, ${fb.content.length} chars)`);
    });

    // Calculate points distribution for homework/exams (total = 100)
    const pointsPerItem = this.calculatePointsDistribution(moduleType, numberOfItems, taskParams);
    console.log(`[Orchestrator] Points distribution: ${JSON.stringify(pointsPerItem)}`);
    const directPdfCache = new Map<string, Promise<{ pdfBase64: string; filename: string } | null>>();
    const preferSingleSource = this.shouldPreferSingleSourcePdfFlow(moduleType, taskParams, llmContext);
    const sourcePlan = await this.buildSourcePlan({
      moduleType,
      numberOfItems,
      taskParams,
      llmContext,
      pointsPerItem,
    });

    // Parallel generation with concurrency control
    // Use smaller batch size to avoid overwhelming Gemini API (503 errors)
    const PARALLEL_BATCH_SIZE = 2; // Generate 2 items in parallel at a time (reduced from 3)
    const BATCH_DELAY_MS = 1000; // Add delay between batches to avoid API overload
    const RETRY_DELAY_MS = 3000; // Delay before retry when API fails
    const batches: number[][] = [];
    
    // Create batches of items to generate
    for (let i = 0; i < numberOfItems; i += PARALLEL_BATCH_SIZE) {
      batches.push(
        Array.from({ length: Math.min(PARALLEL_BATCH_SIZE, numberOfItems - i) }, (_, j) => i + j)
      );
    }
    
    console.log(`[Orchestrator] Processing ${batches.length} batches (batch size: ${PARALLEL_BATCH_SIZE}, delay: ${BATCH_DELAY_MS}ms)`);
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchStartItem = batch[0] + 1;
      const batchEndItem = batch[batch.length - 1] + 1;
      
      // Add delay between batches (except for the first batch)
      if (batchIdx > 0) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
      
      onProgress?.(batch[0], numberOfItems, `Generating items ${batchStartItem}-${batchEndItem}/${numberOfItems}...`);
      console.log(`  📝 Batch ${batchIdx + 1}/${batches.length}: Generating items ${batchStartItem}-${batchEndItem}...`);
      
      // Generate all items in this batch in parallel
      const batchPromises = batch.map(async (i) => {
        const itemNum = i + 1;
        
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 0) {
              // Add exponential backoff delay before retry (especially for 503 errors)
              const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
              console.log(`    🔄 Retry ${attempt}/${maxRetries} for item ${itemNum} (waiting ${delay}ms)...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Select random file blocks/pages for this item (may include multiple files)
            const plannedSource = sourcePlan[itemNum - 1] || null;
            const selectedContext = plannedSource
              ? this.selectPlannedFileContent(fileBlocks, plannedSource, context)
              : this.selectRandomFileContent(fileBlocks, itemNum, context, {
                  preferSingleSource,
                  moduleType,
                });

            // Log content info but don't fail on short content (PDF parsing may have failed)
            console.log(`[Orchestrator] Item ${itemNum}: Selected content length: ${selectedContext.content?.length || 0} chars`);

            const { item, tokensUsed } = await this.generateSingleItem({
              moduleType,
              context: selectedContext.content,
              taskParams: {
                ...taskParams,
                points: pointsPerItem[i],
                sources: selectedContext.sources,
                selectedFile: selectedContext.sources.length === 1 ? selectedContext.sources[0].file : undefined,
                selectedPages: selectedContext.sources.length === 1 ? selectedContext.sources[0].pages : undefined,
                sourcePlanItem: plannedSource,
                directPdfCache,
              },
              llmContext,
              itemNumber: itemNum,
            });

            // Override points with calculated value
            if (item && (moduleType === 'homework' || moduleType === 'exams')) {
              item.points = pointsPerItem[i];
            }

            return { item, tokensUsed, index: i };
          } catch (error: any) {
            lastError = error;
            console.error(`    ❌ Failed to generate item ${itemNum} (attempt ${attempt + 1}/${maxRetries + 1}):`, error?.message || error);
          }
        }
        
        console.error(`    ❌ Skipping item ${itemNum} after ${maxRetries + 1} attempts:`, lastError?.message);
        return { item: null, tokensUsed: 0, index: i };
      });
      
      // Wait for all items in this batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Collect results in order
      for (const result of batchResults) {
        if (result.item) {
          results.push(result.item);
          totalTokensUsed += result.tokensUsed;
        }
      }
    }

    onProgress?.(numberOfItems, numberOfItems, `Done. Generated ${results.length}/${numberOfItems} items.`);
    console.log(`✅ Orchestrator: Generated ${results.length}/${numberOfItems} items successfully, total tokens: ${totalTokensUsed}`);
    return { results, totalTokensUsed };
  }

  private shouldPreferSingleSourcePdfFlow(
    moduleType: string,
    taskParams: Record<string, any>,
    llmContext: SkillContext
  ): boolean {
    const provider = String(llmContext?.llmConfig?.provider || '').toLowerCase();
    if (provider !== 'openai') {
      return false;
    }

    if (!['drills', 'labs', 'homework', 'exams'].includes(moduleType)) {
      return false;
    }

    const sourceDocuments = Array.isArray(taskParams?.sourceDocuments) ? taskParams.sourceDocuments : [];
    return sourceDocuments.some((doc: any) => {
      const type = String(doc?.type || doc?.name || '').toLowerCase();
      return type.endsWith('pdf') || type.endsWith('pptx');
    });
  }

  private resolveQuestionTypeForItem(itemNumber: number, taskParams: Record<string, any>): string {
    const typeCounts = taskParams.typeCounts || {};
    const questionTypes = Object.keys(typeCounts).filter(type => typeCounts[type] > 0);

    let selectedQuestionType = taskParams.questionType || taskParams.problemType || 'coding';
    if (questionTypes.length > 0) {
      let cumulative = 0;
      for (const type of questionTypes) {
        cumulative += typeCounts[type];
        if (itemNumber <= cumulative) {
          selectedQuestionType = type;
          break;
        }
      }
    }

    return selectedQuestionType;
  }

  private getSelectedFileNames(taskParams: Record<string, any>): string[] {
    const selected = Array.isArray(taskParams?.selectedChapters)
      ? taskParams.selectedChapters.filter((value: any) => typeof value === 'string' && value.trim())
      : [];
    return [...new Set(selected.map((value: string) => value.trim().toLowerCase()))];
  }

  private filterFileBlocksBySelection(
    fileBlocks: Array<{ fileName: string; content: string; pages: number[] }>,
    taskParams: Record<string, any>
  ): Array<{ fileName: string; content: string; pages: number[] }> {
    const selectedFiles = this.getSelectedFileNames(taskParams);
    if (selectedFiles.length === 0) {
      return fileBlocks;
    }

    const filtered = fileBlocks.filter((block) => selectedFiles.includes(block.fileName.toLowerCase()));
    return filtered.length > 0 ? filtered : fileBlocks;
  }

  private buildPlanningQuestionPlan(params: {
    moduleType: string;
    numberOfItems: number;
    taskParams: Record<string, any>;
    pointsPerItem: number[];
  }) {
    const { moduleType, numberOfItems, taskParams, pointsPerItem } = params;
    const totalItems = Math.max(numberOfItems, 1);

    return Array.from({ length: numberOfItems }, (_, index) => {
      const itemNumber = index + 1;
      const questionType = this.resolveQuestionTypeForItem(itemNumber, taskParams);
      const pointValue = Number(pointsPerItem[index]) || 0;
      const relativePosition = itemNumber / totalItems;

      let targetDifficulty = 'medium';
      if (moduleType === 'homework') {
        targetDifficulty = relativePosition <= 0.34 ? 'easy' : relativePosition >= 0.75 ? 'hard' : 'medium';
      } else if (moduleType === 'exams') {
        const averagePoints = pointsPerItem.length > 0
          ? pointsPerItem.reduce((sum, value) => sum + value, 0) / pointsPerItem.length
          : pointValue;
        targetDifficulty = pointValue > averagePoints ? 'hard' : pointValue < averagePoints ? 'easy' : 'medium';
      } else if (moduleType === 'drills') {
        targetDifficulty = 'easy';
      }

      const sourceGoal =
        moduleType === 'homework'
          ? relativePosition <= 0.34
            ? 'Use a focused section as warm-up, while preserving the assignment goal of bridging two chapters across the set.'
            : relativePosition >= 0.75
            ? 'Use a two-chapter bridge that requires transfer, comparison, or dependency between chapters.'
            : 'Use a two-chapter bridge with moderate integration across related ideas.'
          : moduleType === 'exams'
          ? 'Use three-plus-chapter concept fusion while keeping one primary skill target clear under time pressure.'
          : moduleType === 'labs'
          ? 'Use multiple related sections inside one chapter for hands-on practice.'
          : 'Use exactly one section for a quick, focused in-class item.';

      return {
        item_number: itemNumber,
        question_type: questionType,
        target_difficulty: targetDifficulty,
        target_points: pointValue || undefined,
        source_goal: sourceGoal,
      };
    });
  }

  private detectCodeLikeText(text: string): boolean {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /(def |class |return |if |elif |else:|for |while |function |const |let |var |=>|public |private |try:|except )/i.test(raw);
  }

  private buildSourcePlanningConstraint(sourcePlanItem?: PlannedSourceItem | null): string {
    if (!sourcePlanItem) {
      return '';
    }

    const topicText = sourcePlanItem.topicLabels.length > 0
      ? sourcePlanItem.topicLabels.join(', ')
      : 'the planned local concept(s)';
    const sourceRefs = Array.isArray(sourcePlanItem.sources) && sourcePlanItem.sources.length > 0
      ? sourcePlanItem.sources.map((source) => `${source.file} pages ${source.pages}`).join('; ')
      : `${sourcePlanItem.file} pages ${sourcePlanItem.pages}`;

    return `SOURCE PLAN:
- Use ${sourceRefs} as the main source scope for this item.
- Scope kind: ${sourcePlanItem.scopeKind || 'local_source'}.
- Chapter IDs: ${(sourcePlanItem.chapterIds || []).join(', ') || 'not specified'}.
- Section IDs: ${(sourcePlanItem.sectionIds || []).join(', ') || 'not specified'}.
- Focus on these concept labels: ${topicText}.
- Integration goal: ${sourcePlanItem.integrationGoal || 'Keep the item aligned to the planned source evidence.'}
- Planner rationale: ${sourcePlanItem.rationale}.
- Keep the question anchored to this planned source scope rather than the whole course.`;
  }

  private buildSolutionContract(params: {
    questionData: any;
    questionType: string;
    moduleType: string;
    taskParams: Record<string, any>;
    sourcePlanItem?: PlannedSourceItem | null;
  }): string {
    const { questionData, questionType, moduleType, taskParams, sourcePlanItem } = params;
    const metadata = questionData?.metadata && typeof questionData.metadata === 'object'
      ? questionData.metadata
      : {};

    const sourceSummary = Array.isArray(taskParams?.sources) && taskParams.sources.length > 0
      ? taskParams.sources.map((source: any) => `${source.file}${source.pages ? ` pages ${source.pages}` : ''}`).join('; ')
      : taskParams?.selectedFile
      ? `${taskParams.selectedFile}${taskParams.selectedPages ? ` pages ${taskParams.selectedPages}` : ''}`
      : sourcePlanItem
      ? `${sourcePlanItem.file} pages ${sourcePlanItem.pages}`
      : 'Use the provided local source evidence only.';
    const plan = sourcePlanItem || taskParams?.sourcePlanItem || null;

    const lines = [
      'TEACHER CONTRACT:',
      `- Module type: ${moduleType}`,
      `- Question type: ${questionType}`,
      `- Source scope: ${sourceSummary}`,
    ];
    if (plan?.scopeKind) {
      lines.push(`- Scope kind: ${plan.scopeKind}`);
    }
    if (Array.isArray(plan?.chapterIds) && plan.chapterIds.length > 0) {
      lines.push(`- Chapter IDs: ${plan.chapterIds.join(', ')}`);
    }
    if (Array.isArray(plan?.sectionIds) && plan.sectionIds.length > 0) {
      lines.push(`- Section IDs: ${plan.sectionIds.join(', ')}`);
    }
    if (typeof plan?.integrationGoal === 'string' && plan.integrationGoal.trim()) {
      lines.push(`- Integration goal: ${plan.integrationGoal.trim()}`);
    }

    if (typeof questionData?.title === 'string' && questionData.title.trim()) {
      lines.push(`- Question title: ${questionData.title.trim()}`);
    }

    if (Array.isArray(metadata?.requirements) && metadata.requirements.length > 0) {
      lines.push(`- Requirements: ${metadata.requirements.join(' | ')}`);
    }

    if (Array.isArray(metadata?.expected_behavior) && metadata.expected_behavior.length > 0) {
      lines.push(`- Expected behavior: ${metadata.expected_behavior.join(' | ')}`);
    }

    if (metadata?.function_contract && typeof metadata.function_contract === 'object') {
      const contractBits: string[] = [];
      const inputs = Array.isArray(metadata.function_contract.inputs)
        ? metadata.function_contract.inputs.filter((value: any) => typeof value === 'string' && value.trim())
        : [];
      if (inputs.length > 0) contractBits.push(`inputs=${inputs.join(', ')}`);
      if (typeof metadata.function_contract.output === 'string' && metadata.function_contract.output.trim()) {
        contractBits.push(`output=${metadata.function_contract.output.trim()}`);
      }
      if (typeof metadata.function_contract.invalid_input_behavior === 'string' && metadata.function_contract.invalid_input_behavior.trim()) {
        contractBits.push(`invalid_input_behavior=${metadata.function_contract.invalid_input_behavior.trim()}`);
      }
      if (contractBits.length > 0) {
        lines.push(`- Function contract: ${contractBits.join('; ')}`);
      }
    }

    if (Array.isArray(metadata?.examples) && metadata.examples.length > 0) {
      lines.push(`- Examples: ${metadata.examples.join(' | ')}`);
    }

    if (Array.isArray(metadata?.grading_focus) && metadata.grading_focus.length > 0) {
      lines.push(`- Grading focus: ${metadata.grading_focus.join(' | ')}`);
    }

    if (moduleType === 'labs') {
      lines.push('- Preserve the lab deliverable and acceptance requirements. Do not simplify the task into a vague discussion answer.');
    }
    if (moduleType === 'drills') {
      lines.push('- Keep the solution concise, but still satisfy every stated requirement.');
    }
    if (questionType === 'debugging') {
      lines.push('- Only fix objective contract violations. Do not rewrite the code for style preference or API redesign.');
    }
    if (questionType === 'coding') {
      lines.push('- Return an actual code solution that satisfies the stated contract, not prose or pseudocode.');
    }

    return lines.join('\n');
  }

  private buildPlannedCandidate(params: {
    fileName: string;
    pages: Array<any>;
    startIndex: number;
    endIndex: number;
  }) {
    const { fileName, pages, startIndex, endIndex } = params;
    const selectedPages = pages.slice(startIndex, endIndex + 1);
    const firstPage = Number(selectedPages[0]?.page_number) || 1;
    const lastPage = Number(selectedPages[selectedPages.length - 1]?.page_number) || firstPage;
    const pageRange = firstPage === lastPage ? String(firstPage) : `${firstPage}-${lastPage}`;
    const topicLabels = [...new Set(
      selectedPages.flatMap((page: any) => [
        ...(Array.isArray(page?.topic_labels) ? page.topic_labels : []),
        ...(Array.isArray(page?.must_cover) ? page.must_cover.slice(0, 2) : []),
      ].filter((value: any) => typeof value === 'string' && value.trim()))
    )].slice(0, 6);
    const chapterIds = [...new Set(
      selectedPages
        .map((page: any) => String(page?.chapter_id || '').trim())
        .filter(Boolean)
    )];
    const sectionIds = [...new Set(
      selectedPages
        .map((page: any) => String(page?.section_id || '').trim())
        .filter(Boolean)
    )];
    const combinedText = selectedPages
      .map((page: any) => typeof page?.text === 'string' ? page.text : '')
      .join('\n')
      .trim();
    const textLength = selectedPages.reduce((sum: number, page: any) => sum + (Number(page?.text_len) || 0), 0);
    const visualScore = selectedPages.reduce((sum: number, page: any) => {
      const features = page?.features || {};
      return sum
        + (Number(features?.imageCount) || 0)
        + (Number(features?.tableCount) || 0) * 2
        + (Number(features?.chartHintCount) || 0) * 2
        + (Number(features?.equationHintCount) || 0);
    }, 0);

    return {
      file: fileName,
      pages: pageRange,
      topicLabels,
      chapterIds,
      sectionIds,
      combinedText,
      textLength,
      span: selectedPages.length,
      pageStart: firstPage,
      pageEnd: lastPage,
      isCodeLike: this.detectCodeLikeText(combinedText),
      visualScore,
    };
  }

  private buildPlannerDocuments(usableDocs: PreprocessedSourceDocument[]) {
    return usableDocs.map((doc) => ({
      file: doc.fileName,
      outline: doc.outline || undefined,
      outline_source: doc.outlineSource || undefined,
      pages: doc.pages.map((page: any) => {
        const features = page?.features || {};
        const preview = typeof page?.text === 'string'
          ? page.text.replace(/\s+/g, ' ').trim().slice(0, 180)
          : '';

        return {
          page_number: Number(page?.page_number) || 0,
          chapter_id: typeof page?.chapter_id === 'string' ? page.chapter_id : undefined,
          section_id: typeof page?.section_id === 'string' ? page.section_id : undefined,
          section_title: typeof page?.section_title === 'string' ? page.section_title : undefined,
          slide_type_hint: typeof page?.slide_type_hint === 'string' ? page.slide_type_hint : undefined,
          text_len: Number(page?.text_len) || 0,
          topic_labels: Array.isArray(page?.topic_labels) ? page.topic_labels : [],
          must_cover: Array.isArray(page?.must_cover) ? page.must_cover : [],
          has_code_like: this.detectCodeLikeText(page?.text || ''),
          visual_hints: {
            image_count: Number(features?.imageCount) || 0,
            table_count: Number(features?.tableCount) || 0,
            chart_count: Number(features?.chartHintCount) || 0,
            equation_count: Number(features?.equationHintCount) || 0,
          },
          preview,
        };
      }),
    }));
  }

  private applyOutlineToPages(pages: any[], outline: any) {
    const sectionByPage = new Map<number, any>();
    const chapters = Array.isArray(outline?.chapters) ? outline.chapters : [];

    for (const chapter of chapters) {
      const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
      for (const section of sections) {
        const refs = Array.isArray(section?.page_refs) ? section.page_refs : this.parseScopePages(String(section?.page_range || ''));
        for (const ref of refs) {
          const pageNumber = Number(ref) || 0;
          if (pageNumber > 0) {
            sectionByPage.set(pageNumber, { chapter, section });
          }
        }
      }
    }

    return pages.map((page: any) => {
      const match = sectionByPage.get(Number(page?.page_number) || 0);
      if (!match) return page;
      return {
        ...page,
        chapter_id: String(match.chapter?.chapter_id || page?.chapter_id || ''),
        section_id: String(match.section?.section_id || page?.section_id || ''),
        section_title: String(match.section?.title || page?.section_title || ''),
      };
    });
  }

  private buildFallbackGlobalOutline(documents: PreprocessedSourceDocument[]) {
    const sorted = [...documents]
      .map((doc, index) => {
        const firstChapter = Array.isArray(doc.outline?.chapters) ? doc.outline.chapters[0] : null;
        const inferredNumber = inferChapterNumberFromText(doc.fileName, firstChapter?.title || '');
        return { doc, index, inferredNumber };
      })
      .sort((a, b) => {
        if (a.inferredNumber && b.inferredNumber) return a.inferredNumber - b.inferredNumber;
        if (a.inferredNumber) return -1;
        if (b.inferredNumber) return 1;
        return a.index - b.index;
      });

    const chapters = sorted.map(({ doc }, index) => {
      const firstChapter = Array.isArray(doc.outline?.chapters) ? doc.outline.chapters[0] : null;
      const globalChapterId = `course-ch${index + 1}`;
      const sections = (Array.isArray(firstChapter?.sections) ? firstChapter.sections : []).map((section: any, sectionIndex: number) => ({
        ...section,
        section_id: `${globalChapterId}-s${sectionIndex + 1}`,
        source_file: doc.fileName,
        local_section_id: section?.section_id,
      }));
      return {
        chapter_id: globalChapterId,
        title: firstChapter?.title || doc.fileName.replace(/\.[^.]+$/, ''),
        order: index + 1,
        source_files: [doc.fileName],
        source_chapters: [{ file: doc.fileName, local_chapter_id: firstChapter?.chapter_id || 'ch1' }],
        order_confidence: inferChapterNumberFromText(doc.fileName, firstChapter?.title || '') ? 'medium' : 'low',
        order_basis: inferChapterNumberFromText(doc.fileName, firstChapter?.title || '') ? ['filename/title chapter number'] : ['upload order fallback'],
        sections,
      };
    });

    return {
      course_outline: { chapters },
      file_chapter_map: chapters.flatMap((chapter: any) =>
        chapter.source_chapters.map((source: any) => ({
          file: source.file,
          local_chapter_id: source.local_chapter_id,
          global_chapter_id: chapter.chapter_id,
        }))
      ),
      section_map: chapters.flatMap((chapter: any) =>
        (chapter.sections || []).map((section: any) => ({
          file: section.source_file,
          local_section_id: section.local_section_id,
          global_chapter_id: chapter.chapter_id,
          global_section_id: section.section_id,
        }))
      ),
    };
  }

  private applyGlobalOutline(documents: PreprocessedSourceDocument[], mergeData: any): PreprocessedSourceDocument[] {
    const courseOutline = mergeData?.course_outline || null;
    const chapterMap = new Map<string, string>();
    const sectionMap = new Map<string, { globalChapterId: string; globalSectionId: string; title?: string }>();
    const courseChapters = Array.isArray(courseOutline?.chapters) ? courseOutline.chapters : [];

    for (const chapter of courseChapters) {
      const globalChapterId = String(chapter?.chapter_id || '');
      if (!globalChapterId) continue;

      for (const source of Array.isArray(chapter?.source_chapters) ? chapter.source_chapters : []) {
        const file = String(source?.file || '').toLowerCase();
        const localChapterId = String(source?.local_chapter_id || '');
        if (file && localChapterId) {
          chapterMap.set(`${file}::${localChapterId}`, globalChapterId);
        }
      }

      for (const fileName of Array.isArray(chapter?.source_files) ? chapter.source_files : []) {
        const file = String(fileName || '').toLowerCase();
        if (file) {
          chapterMap.set(`${file}::ch1`, globalChapterId);
        }
      }

      for (const section of Array.isArray(chapter?.sections) ? chapter.sections : []) {
        const file = String(section?.source_file || '').toLowerCase();
        const localSectionId = String(section?.local_section_id || '');
        const globalSectionId = String(section?.section_id || '');
        if (file && localSectionId && globalSectionId) {
          sectionMap.set(`${file}::${localSectionId}`, {
            globalChapterId,
            globalSectionId,
            title: typeof section?.title === 'string' ? section.title : undefined,
          });
        }
      }
    }

    for (const item of Array.isArray(mergeData?.file_chapter_map) ? mergeData.file_chapter_map : []) {
      const file = String(item?.file || '').toLowerCase();
      const localChapterId = String(item?.local_chapter_id || '');
      const globalChapterId = String(item?.global_chapter_id || '');
      if (file && localChapterId && globalChapterId) {
        chapterMap.set(`${file}::${localChapterId}`, globalChapterId);
      }
    }

    for (const item of Array.isArray(mergeData?.section_map) ? mergeData.section_map : []) {
      const file = String(item?.file || '').toLowerCase();
      const localSectionId = String(item?.local_section_id || '');
      const globalChapterId = String(item?.global_chapter_id || '');
      const globalSectionId = String(item?.global_section_id || '');
      if (file && localSectionId && globalChapterId && globalSectionId) {
        sectionMap.set(`${file}::${localSectionId}`, {
          globalChapterId,
          globalSectionId,
        });
      }
    }

    return documents.map((doc) => {
      const fileKey = doc.fileName.toLowerCase();
      const pages = doc.pages.map((page: any) => {
        const localChapterId = String(page?.chapter_id || '');
        const localSectionId = String(page?.section_id || '');
        const sectionMapping = sectionMap.get(`${fileKey}::${localSectionId}`);
        const globalChapterId =
          sectionMapping?.globalChapterId ||
          chapterMap.get(`${fileKey}::${localChapterId}`) ||
          localChapterId;
        const globalSectionId = sectionMapping?.globalSectionId || localSectionId;

        return {
          ...page,
          local_chapter_id: localChapterId || undefined,
          local_section_id: localSectionId || undefined,
          chapter_id: globalChapterId,
          section_id: globalSectionId,
          section_title: sectionMapping?.title || page?.section_title,
        };
      });

      const docChapters = courseChapters
        .map((chapter: any) => {
          const sections = (Array.isArray(chapter?.sections) ? chapter.sections : [])
            .filter((section: any) => String(section?.source_file || '').toLowerCase() === fileKey);
          const sourceFiles = Array.isArray(chapter?.source_files) ? chapter.source_files.map((file: any) => String(file).toLowerCase()) : [];
          if (sections.length === 0 && !sourceFiles.includes(fileKey)) return null;
          return {
            ...chapter,
            sections,
          };
        })
        .filter(Boolean);

      return {
        ...doc,
        outline: docChapters.length > 0 ? { chapters: docChapters } : doc.outline,
        outlineSource: 'global_course_outline',
        pages,
      };
    });
  }

  private async normalizeGlobalCourseOutline(documents: PreprocessedSourceDocument[], llmContext: SkillContext): Promise<PreprocessedSourceDocument[]> {
    if (documents.length <= 1) return documents;

    const merger = skillRegistry.getSkill('global_outline_merger');
    let mergeData: any = null;
    if (merger && llmContext?.llmConfig?.apiKey) {
      try {
        const result = await merger.execute({
          documents: documents.map((doc, index) => ({
            fileName: doc.fileName,
            uploadedIndex: index + 1,
            outline: doc.outline,
            outlineSource: doc.outlineSource,
            pages: doc.pages,
          })),
          courseTitle: llmContext?.subject || '',
        }, llmContext);
        if (result.success && result.data?.course_outline?.chapters) {
          mergeData = result.data;
        } else if (result.error) {
          console.warn(`[Orchestrator] Global outline merge skipped: ${result.error}`);
        }
      } catch (error: any) {
        console.warn(`[Orchestrator] Global outline merge threw: ${error?.message || error}`);
      }
    }

    return this.applyGlobalOutline(documents, mergeData || this.buildFallbackGlobalOutline(documents));
  }

  private parseScopePages(scopePages: string): number[] {
    if (!scopePages || typeof scopePages !== 'string') return [];

    const values = new Set<number>();
    for (const part of scopePages.split(',').map((item) => item.trim()).filter(Boolean)) {
      if (part.includes('-')) {
        const [startText, endText] = part.split('-').map((item) => item.trim());
        const start = Number.parseInt(startText, 10);
        const end = Number.parseInt(endText, 10);
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
          for (let page = start; page <= end; page++) values.add(page);
        }
      } else {
        const page = Number.parseInt(part, 10);
        if (Number.isFinite(page) && page > 0) values.add(page);
      }
    }

    return [...values].sort((a, b) => a - b);
  }

  private collectMetadataForSources(
    usableDocs: PreprocessedSourceDocument[],
    sources: Array<{ file: string; pages: string }>
  ) {
    const topicLabels = new Set<string>();
    const chapterIds = new Set<string>();
    const sectionIds = new Set<string>();

    for (const source of sources) {
      const doc = usableDocs.find((item) => item.fileName.toLowerCase() === source.file.toLowerCase());
      if (!doc) continue;

      const pageSet = new Set(this.parseScopePages(source.pages));
      for (const page of doc.pages) {
        const pageNumber = Number(page?.page_number) || 0;
        if (!pageSet.has(pageNumber)) continue;

        const chapterId = String(page?.chapter_id || '').trim();
        const sectionId = String(page?.section_id || '').trim();
        if (chapterId) chapterIds.add(chapterId);
        if (sectionId) sectionIds.add(sectionId);
        if (Array.isArray(page?.topic_labels)) {
          page.topic_labels
            .filter((label: any) => typeof label === 'string' && label.trim())
            .slice(0, 6)
            .forEach((label: string) => topicLabels.add(label.trim()));
        }
      }
    }

    return {
      topicLabels: [...topicLabels].slice(0, 6),
      chapterIds: [...chapterIds].slice(0, 8),
      sectionIds: [...sectionIds].slice(0, 12),
    };
  }

  private normalizePlannerScopes(params: {
    plannerData: any;
    usableDocs: PreprocessedSourceDocument[];
    taskParams: Record<string, any>;
    numberOfItems: number;
  }): Map<number, PlannedSourceItem> {
    const { plannerData, usableDocs, taskParams, numberOfItems } = params;
    const scopes = Array.isArray(plannerData?.scopes)
      ? plannerData.scopes
      : Array.isArray(plannerData)
      ? plannerData
      : [];

    const byItem = new Map<number, PlannedSourceItem>();
    for (const scope of scopes) {
      const itemNumber = Number(scope?.item_number);
      if (!Number.isFinite(itemNumber) || itemNumber < 1 || itemNumber > numberOfItems) {
        continue;
      }

      const rawSources = Array.isArray(scope?.sources) && scope.sources.length > 0
        ? scope.sources
        : [{ file: scope?.file, pages: scope?.pages }];
      const normalizedSources: Array<{ file: string; pages: string }> = [];
      for (const rawSource of rawSources) {
        const file = String(rawSource?.file || '').trim();
        const pages = String(rawSource?.pages || '').trim();
        if (!file || !pages) continue;

        const matchedDoc = usableDocs.find((doc) => doc.fileName.toLowerCase() === file.toLowerCase());
        if (!matchedDoc) continue;

        const requestedPages = this.parseScopePages(pages);
        const availablePages = new Set(matchedDoc.pages.map((page: any) => Number(page?.page_number) || 0));
        if (requestedPages.length === 0 || !requestedPages.every((page) => availablePages.has(page))) continue;

        normalizedSources.push({ file: matchedDoc.fileName, pages });
      }

      const firstSource = normalizedSources[0];
      if (!firstSource) {
        continue;
      }

      const sourceMetadata = this.collectMetadataForSources(usableDocs, normalizedSources);
      const topicLabels = sourceMetadata.topicLabels.length > 0
        ? sourceMetadata.topicLabels
        : Array.isArray(scope?.topic_focus)
        ? scope.topic_focus.filter((value: any) => typeof value === 'string' && value.trim()).slice(0, 6)
        : [];
      const chapterIds = sourceMetadata.chapterIds;
      const sectionIds = sourceMetadata.sectionIds;

      byItem.set(itemNumber, {
        itemNumber,
        questionType: this.resolveQuestionTypeForItem(itemNumber, taskParams),
        file: firstSource.file,
        pages: firstSource.pages,
        sources: normalizedSources,
        scopeKind: typeof scope?.scope_kind === 'string' ? scope.scope_kind : undefined,
        chapterIds,
        sectionIds,
        topicLabels,
        integrationGoal: typeof scope?.integration_goal === 'string' ? scope.integration_goal.trim() : undefined,
        rationale: typeof scope?.rationale === 'string' && scope.rationale.trim()
          ? scope.rationale.trim()
          : 'Selected by planner from compact page metadata.',
      });
    }

    return byItem;
  }

  private scorePlannedCandidate(params: {
    candidate: ReturnType<AgentOrchestrator['buildPlannedCandidate']>;
    moduleType: string;
    questionType: string;
    fileUsage: Map<string, number>;
    usedTopicCounts: Map<string, number>;
    usedPageKeys: Set<string>;
  }) {
    const { candidate, moduleType, questionType, fileUsage, usedTopicCounts, usedPageKeys } = params;
    let score = 0;

    if (candidate.textLength > 120) score += 3;
    if (candidate.textLength > 400) score += 2;
    if (candidate.topicLabels.length > 0) score += candidate.topicLabels.length;

    if (moduleType === 'drills') {
      score += candidate.span === 1 ? 4 : Math.max(0, 3 - candidate.span);
    } else if (moduleType === 'labs') {
      score += candidate.span >= 2 ? 4 : 1;
      score += candidate.span <= 4 ? 2 : 0;
    } else if (moduleType === 'homework') {
      score += candidate.span >= 2 ? 3 : 1;
      score += candidate.span <= 4 ? 3 : 0;
      score += candidate.topicLabels.length > 1 ? 2 : 0;
    } else if (moduleType === 'exams') {
      score += candidate.span <= 2 ? 5 : Math.max(0, 3 - candidate.span);
      score += candidate.topicLabels.length > 0 && candidate.topicLabels.length <= 3 ? 2 : 0;
    }

    if (['coding', 'debugging', 'trace'].includes(questionType) && candidate.isCodeLike) {
      score += 6;
    }
    if (['design', 'data_analysis', 'case_study'].includes(questionType)) {
      score += candidate.visualScore > 0 ? 5 : 0;
      score += candidate.topicLabels.length > 1 ? 2 : 0;
    }
    if (['multiple_choice', 'short_answer', 'fill_in_blank'].includes(questionType)) {
      score += candidate.topicLabels.length > 0 ? 3 : 1;
    }

    const fileReusePenalty = moduleType === 'exams' ? 3 : moduleType === 'homework' ? 1.5 : 2;
    score -= (fileUsage.get(candidate.file) || 0) * fileReusePenalty;
    score -= candidate.topicLabels.reduce((sum, label) => sum + ((usedTopicCounts.get(label) || 0) * 1.5), 0);
    if (usedPageKeys.has(`${candidate.file}:${candidate.pages}`)) {
      score -= moduleType === 'exams' ? 10 : 8;
    }

    return score;
  }

  private async buildSourcePlan(params: {
    moduleType: string;
    numberOfItems: number;
    taskParams: Record<string, any>;
    llmContext: SkillContext;
    pointsPerItem: number[];
  }): Promise<Array<PlannedSourceItem | null>> {
    const { moduleType, numberOfItems, taskParams, llmContext, pointsPerItem } = params;
    if (!['drills', 'labs', 'homework', 'exams'].includes(moduleType)) {
      return Array(numberOfItems).fill(null);
    }

    const sourceDocuments = Array.isArray(taskParams?.sourceDocuments) ? taskParams.sourceDocuments : [];
    const selectedFiles = this.getSelectedFileNames(taskParams);
    const supportedDocs = sourceDocuments.filter((doc: any) => {
      const type = String(doc?.type || doc?.name || '').toLowerCase();
      const docName = String(doc?.name || '').trim().toLowerCase();
      const matchesSelection = selectedFiles.length === 0 || selectedFiles.includes(docName);
      const hasRawBase64 = typeof doc?.rawBase64 === 'string' && doc.rawBase64.trim();
      const hasReusableIntake = doc?.intake && Array.isArray(doc.intake.pages) && doc.intake.pages.length > 0;
      return matchesSelection && (hasRawBase64 || hasReusableIntake) && (type.endsWith('pdf') || type.endsWith('pptx'));
    });

    if (supportedDocs.length === 0) {
      return Array(numberOfItems).fill(null);
    }

    const documentPreprocessor = skillRegistry.getSkill('document_preprocessor');
    if (!documentPreprocessor) {
      return Array(numberOfItems).fill(null);
    }

    const timeLimit = taskParams.minutesPerProblem || taskParams.minutesPerQuestion || taskParams.estimatedTime;
    const preprocessedDocs: Array<PreprocessedSourceDocument | null> = await Promise.all(supportedDocs.map(async (doc: any) => {
      const result = await documentPreprocessor.execute({
        fileName: doc.name,
        fileType: doc.type,
        fileBase64: doc.rawBase64,
        intake: doc.intake || null,
        targetMinutes: Number(timeLimit) || (moduleType === 'drills' ? 8 : 30),
      }, llmContext);

      if (!result.success || !result.data) {
        console.warn(`[Orchestrator] Source planning skipped for ${doc.name}: ${result.error || 'unknown error'}`);
        return null;
      }

      const outlineRefiner = skillRegistry.getSkill('outline_refiner');
      let outline = result.data.outline || null;
      let outlineSource = result.data.outline_source || 'heuristic';
      if (outlineRefiner && llmContext?.llmConfig?.apiKey && Array.isArray(result.data.pages) && result.data.pages.length > 0) {
        try {
          const refined = await outlineRefiner.execute({
            fileName: doc.name,
            fileType: doc.type,
            pages: result.data.pages,
            roughOutline: result.data.rough_outline || result.data.outline,
          }, llmContext);
          if (refined.success && refined.data?.chapters) {
            outline = refined.data;
            outlineSource = 'llm_refined';
          } else if (refined.error) {
            console.warn(`[Orchestrator] Outline refinement skipped for ${doc.name}: ${refined.error}`);
          }
        } catch (error: any) {
          console.warn(`[Orchestrator] Outline refinement threw for ${doc.name}: ${error?.message || error}`);
        }
      }

      const pagesWithRefinedOutline = outline
        ? this.applyOutlineToPages(result.data.pages, outline)
        : result.data.pages;

      return {
        fileName: doc.name,
        outline,
        outlineSource,
        pages: Array.isArray(pagesWithRefinedOutline)
          ? pagesWithRefinedOutline.filter((page: any) => {
              const features = page?.features || {};
              const hasVisualSignal =
                (Number(features?.imageCount) || 0) > 0 ||
                (Number(features?.tableCount) || 0) > 0 ||
                (Number(features?.chartHintCount) || 0) > 0 ||
                (Number(features?.equationHintCount) || 0) > 0;
              return Boolean(page?.has_extractable_text) || hasVisualSignal;
            })
          : [],
      };
    }));

    let usableDocs = preprocessedDocs.filter((doc): doc is PreprocessedSourceDocument => Boolean(doc && doc.pages.length > 0));
    if (usableDocs.length === 0) {
      return Array(numberOfItems).fill(null);
    }
    usableDocs = await this.normalizeGlobalCourseOutline(usableDocs, llmContext);

    const preferredSpan =
      moduleType === 'drills'
        ? 1
        : moduleType === 'labs'
        ? Math.max(2, Math.min(4, Math.round((Number(timeLimit) || 30) / 15)))
        : moduleType === 'homework'
        ? Math.max(2, Math.min(4, Math.round((Number(timeLimit) || 20) / 12)))
        : Math.max(1, Math.min(2, Math.round((Number(timeLimit) || 15) / 12)));
    const candidateStep =
      moduleType === 'drills' || moduleType === 'exams'
        ? 1
        : Math.max(1, preferredSpan - 1);
    const candidates = usableDocs.flatMap((doc) => {
      if (moduleType === 'drills') {
        return doc.pages.map((_: any, index: number) => this.buildPlannedCandidate({
          fileName: doc.fileName,
          pages: doc.pages,
          startIndex: index,
          endIndex: index,
        }));
      }

      const docCandidates: Array<ReturnType<AgentOrchestrator['buildPlannedCandidate']>> = [];
      for (let startIndex = 0; startIndex < doc.pages.length; startIndex += candidateStep) {
        const endIndex = Math.min(doc.pages.length - 1, startIndex + preferredSpan - 1);
        docCandidates.push(this.buildPlannedCandidate({
          fileName: doc.fileName,
          pages: doc.pages,
          startIndex,
          endIndex,
        }));
        if (endIndex >= doc.pages.length - 1) {
          break;
        }
      }
      return docCandidates;
    }).filter((candidate) => candidate.textLength > 0 || candidate.visualScore > 0);

    if (candidates.length === 0) {
      return Array(numberOfItems).fill(null);
    }

    const fileUsage = new Map<string, number>();
    const usedTopicCounts = new Map<string, number>();
    const usedPageKeys = new Set<string>();
    const plan: Array<PlannedSourceItem | null> = [];

    for (let itemNumber = 1; itemNumber <= numberOfItems; itemNumber++) {
      const questionType = this.resolveQuestionTypeForItem(itemNumber, taskParams);
      const ranked = [...candidates].sort((a, b) => {
        return this.scorePlannedCandidate({
          candidate: b,
          moduleType,
          questionType,
          fileUsage,
          usedTopicCounts,
          usedPageKeys,
        }) - this.scorePlannedCandidate({
          candidate: a,
          moduleType,
          questionType,
          fileUsage,
          usedTopicCounts,
          usedPageKeys,
        });
      });

      const winner = ranked[0];
      if (!winner) {
        plan.push(null);
        continue;
      }

      fileUsage.set(winner.file, (fileUsage.get(winner.file) || 0) + 1);
      usedPageKeys.add(`${winner.file}:${winner.pages}`);
      winner.topicLabels.forEach((label: string) => {
        usedTopicCounts.set(label, (usedTopicCounts.get(label) || 0) + 1);
      });

      const rationalePieces = [
        winner.topicLabels.length > 0
          ? `covers ${winner.topicLabels.slice(0, 3).join(', ')}`
          : 'covers a focused local concept',
        moduleType === 'labs'
          ? `uses a ${winner.span}-page lab scope`
          : moduleType === 'homework'
          ? `uses a ${winner.span}-page homework scope for assignment-style work`
          : moduleType === 'exams'
          ? `uses a ${winner.span}-page exam scope focused on one primary skill`
          : 'uses a single focused page for a short drill',
      ];
      if (['coding', 'debugging', 'trace'].includes(questionType) && winner.isCodeLike) {
        rationalePieces.push('contains code-like source material');
      }
      if (['design', 'data_analysis', 'case_study'].includes(questionType) && winner.visualScore > 0) {
        rationalePieces.push('has visual/table/chart signals');
      }

      plan.push({
        itemNumber,
        questionType,
        file: winner.file,
        pages: winner.pages,
        sources: [{ file: winner.file, pages: winner.pages }],
        scopeKind:
          moduleType === 'labs'
            ? 'same_chapter_multi_section'
            : moduleType === 'homework'
            ? 'two_chapter_bridge'
            : moduleType === 'exams'
            ? 'three_plus_chapter_fusion'
            : 'single_section',
        chapterIds: winner.chapterIds,
        sectionIds: winner.sectionIds,
        topicLabels: winner.topicLabels,
        integrationGoal:
          moduleType === 'homework'
            ? 'Bridge related concepts across the selected chapter scope.'
            : moduleType === 'exams'
            ? 'Fuse concepts across the selected chapter scope under exam constraints.'
            : moduleType === 'labs'
            ? 'Use multiple related sections in one hands-on workflow.'
            : 'Check one focused section objective.',
        rationale: rationalePieces.join('; '),
      });
    }

    const sourcePlanner = skillRegistry.getSkill('source_planner');
    if (sourcePlanner) {
      const plannerDocuments = this.buildPlannerDocuments(usableDocs);
      const questionPlan = this.buildPlanningQuestionPlan({
        moduleType,
        numberOfItems,
        taskParams,
        pointsPerItem,
      });

      try {
        const plannerResult = await sourcePlanner.execute({
          moduleType,
          numberOfItems,
          targetMinutes: Number(timeLimit) || (moduleType === 'drills' ? 8 : 30),
          questionPlan,
          documents: plannerDocuments,
          planningGoals:
            moduleType === 'homework'
              ? 'Plan two-chapter bridges: balance coverage, type distribution, gradual difficulty progression, and explicit cross-chapter transfer.'
              : moduleType === 'exams'
              ? 'Plan three-plus-chapter concept fusion: each item should require integrating concepts from at least three chapters when available while preserving one primary skill target.'
              : moduleType === 'labs'
              ? 'Choose same-chapter multi-section scopes with actionable practice requirements.'
              : 'Choose exactly one section for each fast in-class question.',
          selectedChapters: selectedFiles,
        }, llmContext);

        if (plannerResult.success && plannerResult.data) {
          const plannerByItem = this.normalizePlannerScopes({
            plannerData: plannerResult.data,
            usableDocs,
            taskParams,
            numberOfItems,
          });

          if (plannerByItem.size > 0) {
            const mergedPlan = plan.map((fallbackItem, index) => plannerByItem.get(index + 1) || fallbackItem);
            console.log('[Orchestrator] Built LLM-enhanced source plan:', mergedPlan);
            return mergedPlan;
          }
        } else {
          console.warn('[Orchestrator] source_planner failed, falling back to heuristic plan:', plannerResult.error);
        }
      } catch (error: any) {
        console.warn('[Orchestrator] source_planner threw, falling back to heuristic plan:', error?.message || error);
      }
    }

    console.log('[Orchestrator] Built heuristic source plan:', plan);
    return plan;
  }

  /**
   * Parse context into separate file blocks
   */
  private parseFileBlocks(context: string): Array<{ fileName: string; content: string; pages: number[] }> {
    const fileBlocks: Array<{ fileName: string; content: string; pages: number[] }> = [];
    
    console.log(`[Orchestrator] parseFileBlocks: Context length = ${context.length}`);
    console.log(`[Orchestrator] parseFileBlocks: Context preview (first 500 chars):`, context.substring(0, 500));
    
    // Check if context contains PAGE markers at all
    const totalPageMarkers = (context.match(/\[PAGE:\s*\d+\]/gi) || []).length;
    console.log(`[Orchestrator] parseFileBlocks: Found ${totalPageMarkers} [PAGE: X] markers in total context`);
    
    // Split by FILE: markers
    const parts = context.split(/(?=FILE:\s*)/);
    console.log(`[Orchestrator] parseFileBlocks: Split into ${parts.length} parts`);
    
    for (const part of parts) {
      if (!part.trim()) continue;
      
      const fileMatch = part.match(/^FILE:\s*([^\n]+)/);
      if (fileMatch) {
        const fileName = fileMatch[1].trim();
        const content = part;
        
        // Extract page numbers from this file's content
        const pageMatches = content.match(/\[PAGE:\s*(\d+)\]/gi) || [];
        const pages = pageMatches.map(m => {
          const num = m.match(/\d+/);
          return num ? parseInt(num[0], 10) : 0;
        }).filter(p => p > 0);
        
        console.log(`[Orchestrator] parseFileBlocks: File "${fileName}" has ${pages.length} pages: ${pages.slice(0, 10).join(', ')}${pages.length > 10 ? '...' : ''}`);
        
        fileBlocks.push({ fileName, content, pages: [...new Set(pages)].sort((a, b) => a - b) });
      } else if (fileBlocks.length === 0 && part.trim()) {
        // Content without FILE: marker - treat as single block
        const pageMatches = part.match(/\[PAGE:\s*(\d+)\]/gi) || [];
        const pages = pageMatches.map(m => {
          const num = m.match(/\d+/);
          return num ? parseInt(num[0], 10) : 0;
        }).filter(p => p > 0);
        
        console.log(`[Orchestrator] parseFileBlocks: Unknown file block has ${pages.length} pages`);
        
        fileBlocks.push({ fileName: 'Unknown', content: part, pages });
      }
    }
    
    console.log(`[Orchestrator] parseFileBlocks: Total ${fileBlocks.length} file blocks parsed`);
    return fileBlocks;
  }

  /**
   * Extract only selected page content based on [PAGE: X] markers.
   * Keeps the FILE: header (if present) for context clarity.
   */
  private extractContentByPages(content: string, selectedPages?: string): string {
    if (!content || !selectedPages) {
      console.log(`[extractContentByPages] No filtering: content=${!!content}, selectedPages=${selectedPages}`);
      return content;
    }

    const pageSet = new Set<number>();
    const parts = selectedPages
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
          for (let i = start; i <= end; i++) pageSet.add(i);
        }
      } else {
        const num = parseInt(part, 10);
        if (Number.isFinite(num) && num > 0) pageSet.add(num);
      }
    }

    console.log(`[extractContentByPages] Parsed page set: ${[...pageSet].join(', ')}`);

    if (pageSet.size === 0) {
      console.log(`[extractContentByPages] Empty page set, returning original content`);
      return content;
    }

    const matches = [...content.matchAll(/\[PAGE:\s*(\d+)\]/gi)];
    console.log(`[extractContentByPages] Found ${matches.length} [PAGE: X] markers in content`);
    
    if (matches.length === 0) {
      console.log(`[extractContentByPages] No [PAGE: X] markers found, returning original content`);
      return content;
    }

    const firstMatchIdx = matches[0]?.index ?? 0;
    const header = content.slice(0, firstMatchIdx).trim();
    const selectedChunks: string[] = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const pageNum = parseInt(match[1], 10);
      const startIdx = match.index ?? 0;
      const endIdx = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
      if (pageSet.has(pageNum)) {
        const chunk = content.slice(startIdx, endIdx).trim();
        console.log(`[extractContentByPages] Including page ${pageNum}: ${chunk.length} chars`);
        selectedChunks.push(chunk);
      }
    }

    if (selectedChunks.length === 0) {
      console.warn(`[extractContentByPages] No chunks matched pages ${[...pageSet].join(', ')}! This may cause content mismatch.`);
      // Return a minimal marker instead of full content to force retry
      return `[EMPTY_CONTENT: No content found for pages ${selectedPages}]`;
    }

    const headerPrefix = header ? `${header}\n` : '';
    const result = `${headerPrefix}${selectedChunks.join('\n\n')}`.trim();
    console.log(`[extractContentByPages] Final result: ${result.length} chars (from ${content.length} original)`);
    return result;
  }

  /**
   * Extract simple English keywords from context for validation.
   */
  private extractContextKeywords(text: string, maxKeywords = 10): string[] {
    if (!text) return [];
    
    // Extended stopwords including metadata-related words
    const stopwords = new Set([
      'the','and','for','with','from','this','that','your','you','are','was','were','will','shall','could','would',
      'into','onto','over','under','about','between','within','without','these','those','their','there','where','when',
      'what','which','who','whom','why','how','also','only','other','than','then','such','more','most','some','many',
      'each','every','any','all','can','may','might','must','should','not','but','if','else','while','when','after',
      'before','during','because','since','as','at','by','of','in','on','to','is','it','be','or','an','a',
      // Exclude metadata/file-related words
      'page','pages','file','files','pdf','pptx','ppt','docx','doc','txt','slide','slides','chapter',
      'final','ch1-final','ch2-final','ch3-final','ch4-final','lecture','content','source','sources',
    ]);
    
    const words = (text.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) || []).map((w) => w.toLowerCase());
    const counts = new Map<string, number>();
    for (const w of words) {
      if (stopwords.has(w)) continue;
      // Also skip words that look like filenames
      if (w.includes('-final') || w.includes('.pdf') || w.includes('.pptx')) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([w]) => w);
  }

  private questionMatchesContext(questionData: any, keywords: string[]): boolean {
    // If no meaningful keywords were extracted, skip validation (PDF content might be missing)
    if (!keywords.length) {
      console.warn('[Orchestrator] No meaningful keywords extracted from context - skipping validation (PDF content may be missing)');
      return true; // Allow generation to continue
    }
    
    const text = [
      questionData?.title,
      questionData?.question,
      questionData?.description,
      ...(Array.isArray(questionData?.metadata?.key_concepts) ? questionData.metadata.key_concepts : []),
    ]
      .filter((x) => typeof x === 'string')
      .join(' ')
      .toLowerCase();
    
    // Count how many keywords match
    const matchedKeywords = keywords.filter((k) => text.includes(k));
    const matchRatio = matchedKeywords.length / keywords.length;
    
    console.log(`[Orchestrator] Question-context match: ${matchedKeywords.length}/${keywords.length} keywords (${(matchRatio * 100).toFixed(1)}%)`);
    console.log(`[Orchestrator] Top context keywords: ${keywords.slice(0, 5).join(', ')}`);
    console.log(`[Orchestrator] Matched keywords: ${matchedKeywords.join(', ') || 'NONE'}`);
    console.log(`[Orchestrator] Question title: "${questionData?.title || 'N/A'}"`);
    console.log(`[Orchestrator] Question key_concepts: ${JSON.stringify(questionData?.metadata?.key_concepts || [])}`);
    
    // If we have keywords, require at least 1 match
    // But if context keywords are few (<3), be more lenient
    const isValid = matchedKeywords.length >= 1 || keywords.length < 3;
    
    if (!isValid) {
      console.warn(`[Orchestrator] VALIDATION WARNING: Question may not match context well`);
      console.warn(`[Orchestrator] Expected keywords from context: ${keywords.join(', ')}`);
      console.warn(`[Orchestrator] Question content: ${text.substring(0, 300)}`);
    }
    
    return isValid;
  }

  /**
   * Select random file content for a question
   */
  private selectRandomFileContent(
    fileBlocks: Array<{ fileName: string; content: string; pages: number[] }>,
    itemNumber: number,
    fullContext: string,
    options?: { preferSingleSource?: boolean; moduleType?: string }
  ): { content: string; sources: Array<{ file: string; pages: string }> } {
    if (fileBlocks.length === 0) {
      return { content: fullContext, sources: [{ file: 'Unknown', pages: 'N/A' }] };
    }

    // Select 1-3 files randomly (bounded by available files)
    const maxFiles = Math.min(3, fileBlocks.length);
    const fileCount = options?.preferSingleSource
      ? 1
      : Math.max(1, Math.floor(Math.random() * maxFiles) + 1);
    const shuffled = [...fileBlocks].sort(() => Math.random() - 0.5);
    const selectedFiles = shuffled.slice(0, fileCount);

    const sources: Array<{ file: string; pages: string }> = [];
    const contents: string[] = [];

    for (const selectedFile of selectedFiles) {
      // Select random pages from this file
      let selectedPages = 'N/A';
      let pageNumbers = selectedFile.pages || [];
    
      // Fallback: try to extract pages from content if missing
      if (pageNumbers.length === 0 && selectedFile.content) {
        const pageMatches = selectedFile.content.match(/\[PAGE:\s*(\d+)\]/gi) || [];
        pageNumbers = pageMatches
          .map((m) => {
            const num = m.match(/\d+/);
            return num ? parseInt(num[0], 10) : 0;
          })
          .filter((p) => p > 0);
        
        if (pageNumbers.length > 0) {
          pageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
          console.log(`[Orchestrator] Fallback extracted ${pageNumbers.length} pages from content for "${selectedFile.fileName}"`);
        }
      }
      
      if (pageNumbers.length > 0) {
        const maxPagesForModule =
          options?.moduleType === 'drills'
            ? 2
            : options?.moduleType === 'labs'
            ? 4
            : options?.moduleType === 'homework'
            ? 4
            : options?.moduleType === 'exams'
            ? 2
            : 5;
        // Randomly select a module-appropriate number of consecutive pages
        const numPagesToSelect = Math.min(
          pageNumbers.length,
          Math.max(1, Math.floor(Math.random() * maxPagesForModule) + 1)
        );
        
        // Random start position
        const startIdx = Math.floor(Math.random() * Math.max(1, pageNumbers.length - numPagesToSelect + 1));
        const selectedPageNumbers = pageNumbers.slice(startIdx, startIdx + numPagesToSelect);
        
        if (selectedPageNumbers.length === 1) {
          selectedPages = String(selectedPageNumbers[0]);
        } else if (selectedPageNumbers.length > 1) {
          selectedPages = `${selectedPageNumbers[0]}-${selectedPageNumbers[selectedPageNumbers.length - 1]}`;
        }
      } else {
        // Last-resort fallback: at least show page 1 if we can't detect markers
        selectedPages = '1';
        console.warn(`[Orchestrator] No [PAGE] markers found for "${selectedFile.fileName}". Falling back to page 1.`);
      }
      
      console.log(`[Orchestrator] Item ${itemNumber}: Selected file "${selectedFile.fileName}", pages: ${selectedPages}`);
      
      const filteredContent = this.extractContentByPages(selectedFile.content, selectedPages);
      
      // Check if content filtering actually produced meaningful content
      // Remove [PAGE: X] markers and FILE: headers to check actual content length
      const actualContent = filteredContent
        .replace(/\[PAGE:\s*\d+\]/gi, '')
        .replace(/FILE:\s*[^\n]+/gi, '')
        .replace(/---/g, '')
        .trim();
      
      if (filteredContent.includes('[EMPTY_CONTENT:') || actualContent.length < 20) {
        console.warn(`[Orchestrator] Content filtering failed for "${selectedFile.fileName}" pages ${selectedPages} (actual content: ${actualContent.length} chars), using full file content instead`);
        // Use full file content instead of filtered content when filtering fails
        contents.push(selectedFile.content);
        sources.push({ file: selectedFile.fileName, pages: selectedPages });
      } else {
        console.log(`[Orchestrator] Filtered content for "${selectedFile.fileName}" (pages ${selectedPages}): ${filteredContent.length} chars (actual: ${actualContent.length} chars)`);
        console.log(`[Orchestrator] Filtered content preview: ${actualContent.substring(0, 200)}...`);
        contents.push(filteredContent);
        sources.push({ file: selectedFile.fileName, pages: selectedPages });
      }
    }

    // If no content was collected, use full context as fallback
    if (contents.length === 0) {
      console.warn(`[Orchestrator] No content extracted for item ${itemNumber}, using full context as fallback`);
      const randomFile = selectedFiles[0] || fileBlocks[0];
      if (randomFile) {
        return {
          content: randomFile.content,
          sources: [{ file: randomFile.fileName, pages: 'all' }],
        };
      }
      return {
        content: fullContext,
        sources: [{ file: 'Unknown', pages: 'N/A' }],
      };
    }

    return {
      content: contents.join('\n\n---\n\n'),
      sources,
    };
  }

  private selectPlannedFileContent(
    fileBlocks: Array<{ fileName: string; content: string; pages: number[] }>,
    plannedSource: PlannedSourceItem,
    fullContext: string
  ): { content: string; sources: Array<{ file: string; pages: string }> } {
    const plannedSources = Array.isArray(plannedSource.sources) && plannedSource.sources.length > 0
      ? plannedSource.sources
      : [{ file: plannedSource.file, pages: plannedSource.pages }];
    const contents: string[] = [];
    const sources: Array<{ file: string; pages: string }> = [];

    for (const source of plannedSources) {
      const matchedBlock = fileBlocks.find((block) => block.fileName.toLowerCase() === source.file.toLowerCase());
      if (!matchedBlock) {
        console.warn(`[Orchestrator] Planned source file not found in parsed context: ${source.file}.`);
        continue;
      }

      const filteredContent = this.extractContentByPages(matchedBlock.content, source.pages);
      const actualContent = filteredContent
        .replace(/\[PAGE:\s*\d+\]/gi, '')
        .replace(/FILE:\s*[^\n]+/gi, '')
        .replace(/---/g, '')
        .trim();

      if (filteredContent.includes('[EMPTY_CONTENT:') || actualContent.length < 20) {
        console.warn(`[Orchestrator] Planned source extraction was too small for ${source.file} pages ${source.pages}. Using the full file block instead.`);
        contents.push(matchedBlock.content);
      } else {
        contents.push(filteredContent);
      }
      sources.push({ file: source.file, pages: source.pages });
    }

    if (contents.length === 0) {
      return {
        content: fullContext,
        sources: plannedSources,
      };
    }

    return {
      content: contents.join('\n\n---\n\n'),
      sources,
    };
  }

  /**
   * Calculate points distribution for homework/exams
   * Respects taskParams.totalScore if provided (for exams), otherwise defaults to 100
   */
  private calculatePointsDistribution(moduleType: string, numberOfItems: number, taskParams: Record<string, any>): number[] {
    // Use taskParams.totalScore if provided (for exams/homework), otherwise default to 100
    const totalPoints = Number(taskParams?.totalScore) > 0 ? Number(taskParams.totalScore) : 100;
    
    // For drills and labs, use fixed points
    if (moduleType === 'drills') {
      return Array(numberOfItems).fill(5);
    }
    if (moduleType === 'labs') {
      return Array(numberOfItems).fill(10);
    }
    
    // For homework and exams, distribute 100 points based on difficulty
    const difficulty = taskParams.difficulty || 'medium';
    const typeCounts = taskParams.typeCounts || {};
    
    // Base distribution: equal points for each question
    const basePoints = Math.floor(totalPoints / numberOfItems);
    const remainder = totalPoints - (basePoints * numberOfItems);
    
    const points: number[] = [];
    
    // If we have type counts, distribute based on complexity
    const typeWeights: Record<string, number> = {
      'multiple_choice': 0.8,
      'fill_in_blank': 0.9,
      'true_false': 0.7,
      'short_answer': 1.0,
      'coding': 1.5,
      'trace': 1.2,
      'debug': 1.3,
      'design': 1.8,
      'analysis': 1.4,
    };
    
    // Calculate weighted points
    const questionTypes = Object.keys(typeCounts).filter(t => typeCounts[t] > 0);
    let currentIndex = 0;
    let totalWeight = 0;
    const itemWeights: number[] = [];
    
    for (const type of questionTypes) {
      const count = typeCounts[type];
      const weight = typeWeights[type.toLowerCase()] || 1.0;
      for (let i = 0; i < count; i++) {
        itemWeights.push(weight);
        totalWeight += weight;
      }
    }
    
    // Fill remaining items with default weight
    while (itemWeights.length < numberOfItems) {
      itemWeights.push(1.0);
      totalWeight += 1.0;
    }
    
    // Calculate points based on weights
    let assignedPoints = 0;
    for (let i = 0; i < numberOfItems; i++) {
      const weight = itemWeights[i] || 1.0;
      let itemPoints = Math.round((weight / totalWeight) * totalPoints);
      
      // Ensure minimum 5 points per question
      itemPoints = Math.max(5, itemPoints);
      
      points.push(itemPoints);
      assignedPoints += itemPoints;
    }
    
    // Adjust to ensure total is exactly 100
    const diff = totalPoints - assignedPoints;
    if (diff !== 0) {
      // Add/subtract from the last few questions
      const adjustment = diff > 0 ? 1 : -1;
      for (let i = 0; i < Math.abs(diff); i++) {
        const idx = numberOfItems - 1 - (i % numberOfItems);
        points[idx] = Math.max(5, points[idx] + adjustment);
      }
    }
    
    return points;
  }

  private sanitizeMultipleChoiceOption(option: any): string {
    let text = String(option ?? '').trim();
    if (!text) return '';

    text = text
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^[A-Da-d][\)\.\:\-]\s*/g, '')
      .replace(/^Option\s+[A-Da-d][\)\.\:\-]\s*/i, '')
      .trim();

    return text;
  }

  private normalizeMultipleChoiceAnswer(value: any, options: string[]): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const letterMatch = raw.match(/\b([A-D])\b/i);
    if (letterMatch?.[1]) {
      return letterMatch[1].toUpperCase();
    }

    const cleaned = this.sanitizeMultipleChoiceOption(raw);
    const optionIndex = options.findIndex(option => option === cleaned);
    return optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : '';
  }

  private buildMultipleChoicePrompt(questionData: any): string {
    const questionText = typeof questionData?.question === 'string' ? questionData.question : '';
    const options = Array.isArray(questionData?.options)
      ? questionData.options.map((option: any, index: number) => `${String.fromCharCode(65 + index)}. ${this.sanitizeMultipleChoiceOption(option)}`)
      : [];

    return `${questionText}\n\nOptions:\n${options.join('\n')}`;
  }

  private buildMultipleChoiceSolutionData(questionData: any): { solution: string; explanation: string; key_points: string[]; common_mistakes: string[] } | null {
    const options = Array.isArray(questionData?.options)
      ? questionData.options.map((option: any) => this.sanitizeMultipleChoiceOption(option)).filter(Boolean)
      : [];

    if (options.length !== 4) {
      return null;
    }

    const answerFromMetadata = questionData?.metadata?.answer_check?.correct_answer;
    const correctAnswer = this.normalizeMultipleChoiceAnswer(
      questionData?.correct_answer || answerFromMetadata,
      options
    );

    if (!correctAnswer) {
      return null;
    }

    const correctIndex = correctAnswer.charCodeAt(0) - 65;
    const correctOptionText = this.sanitizeMultipleChoiceOption(
      questionData?.correct_option_text || options[correctIndex] || ''
    );

    if (!correctOptionText) {
      return null;
    }

    const explanation =
      typeof questionData?.explanation === 'string'
        ? questionData.explanation.trim()
        : '';

    const distractorFocus = Array.isArray(questionData?.metadata?.answer_check?.distractor_focus)
      ? questionData.metadata.answer_check.distractor_focus.filter((item: any) => typeof item === 'string')
      : [];

    return {
      solution: `${correctAnswer}. ${correctOptionText}`,
      explanation,
      key_points: Array.isArray(questionData?.metadata?.key_concepts)
        ? questionData.metadata.key_concepts.filter((item: any) => typeof item === 'string')
        : [],
      common_mistakes: distractorFocus,
    };
  }

  private async buildDirectPdfAttachment(params: {
    taskParams: Record<string, any>;
    llmContext: SkillContext;
  }): Promise<{ pdfFileData: string; pdfFilename: string } | null> {
    const { taskParams, llmContext } = params;
    const provider = String(llmContext?.llmConfig?.provider || '').toLowerCase();
    if (provider !== 'openai') {
      return null;
    }

    const selectedFile = typeof taskParams?.selectedFile === 'string' ? taskParams.selectedFile : '';
    const selectedPages = typeof taskParams?.selectedPages === 'string' ? taskParams.selectedPages : '';
    const sourceDocuments = Array.isArray(taskParams?.sourceDocuments) ? taskParams.sourceDocuments : [];
    const directPdfCache = taskParams?.directPdfCache instanceof Map ? taskParams.directPdfCache : new Map();

    if (!selectedFile || sourceDocuments.length === 0) {
      return null;
    }

    const sourceDocument = sourceDocuments.find((doc: any) => {
      const name = typeof doc?.name === 'string' ? doc.name : '';
      return name.toLowerCase() === selectedFile.toLowerCase();
    });

    if (!sourceDocument?.rawBase64) {
      return null;
    }

    const fileType = String(
      sourceDocument?.type ||
      selectedFile.split('.').pop() ||
      ''
    ).toLowerCase();

    let pdfSource: { pdfBase64: string; filename: string } | null = null;

    if (fileType === 'pdf') {
      pdfSource = {
        pdfBase64: sourceDocument.rawBase64,
        filename: selectedFile,
      };
    } else if (fileType === 'pptx') {
      const cacheKey = selectedFile.toLowerCase();
      if (!directPdfCache.has(cacheKey)) {
        directPdfCache.set(
          cacheKey,
          convertPptxBase64ToPdfBase64({
            pptxBase64: sourceDocument.rawBase64,
            filename: selectedFile,
          }).catch((error: any) => {
            console.warn(`[Orchestrator] PPTX to PDF conversion failed for ${selectedFile}:`, error?.message || error);
            return null;
          })
        );
      }
      pdfSource = await directPdfCache.get(cacheKey);
    }

    if (!pdfSource?.pdfBase64) {
      return null;
    }

    const sampledPdf = await extractPdfSelectedPagesBase64({
      pdfBase64: pdfSource.pdfBase64,
      filename: pdfSource.filename,
      selectedPages,
    }).catch((error: any) => {
      console.warn(`[Orchestrator] Failed to extract sampled PDF pages for ${selectedFile}:`, error?.message || error);
      return null;
    });

    if (sampledPdf?.pdfBase64) {
      return {
        pdfFileData: sampledPdf.pdfBase64,
        pdfFilename: sampledPdf.filename,
      };
    }

    return {
      pdfFileData: pdfSource.pdfBase64,
      pdfFilename: pdfSource.filename,
    };
  }

  /**
   * Generate a single item using the skills pipeline
   */
  private async generateSingleItem(params: {
    moduleType: string;
    context: string;
    taskParams: Record<string, any>;
    llmContext: SkillContext;
    itemNumber: number;
  }): Promise<{ item: any; tokensUsed: number }> {
    const { moduleType, context, taskParams, llmContext, itemNumber } = params;

    // Build enhanced context with web sources if available
    let enhancedContext = context;
    const webSources = llmContext.additionalParams?.webSources;
    if (webSources && Array.isArray(webSources) && webSources.length > 0) {
      const webSourcesText = webSources.map((source: any) => {
        return `[WEB SOURCE: ${source.title || source.url || 'Unknown'}]\n${source.content || source.text || ''}\nURL: ${source.url || 'N/A'}`;
      }).join('\n\n---\n\n');
      enhancedContext = `${context}\n\n---\n\nADDITIONAL WEB RESOURCES:\n${webSourcesText}`;
      console.log(`[Orchestrator] Added ${webSources.length} web sources to context`);
    }

    // Step 1: Generate question
    const questionSkill = skillRegistry.getSkill('question_generator');
    if (!questionSkill) {
      throw new Error('question_generator skill not found');
    }

    // Determine question type based on typeCounts if available
    const selectedQuestionType = this.resolveQuestionTypeForItem(itemNumber, taskParams);

    // Normalize time limit parameter (different modules use different names)
    const timeLimit = taskParams.minutesPerProblem 
      || taskParams.minutesPerQuestion  // exams module uses this
      || taskParams.estimatedTime;

    const filteredContext = this.extractContentByPages(enhancedContext, taskParams.selectedPages);
    const directPdfAttachment = await this.buildDirectPdfAttachment({
      taskParams,
      llmContext,
    });
    const planningConstraint = this.buildSourcePlanningConstraint(taskParams.sourcePlanItem);
    const questionInput: SkillInput = {
      context: filteredContext,
      taskType: moduleType,
      questionType: selectedQuestionType,
      difficulty: taskParams.difficulty,
      timeLimit: timeLimit,
      points: taskParams.points || (moduleType === 'drills' ? 5 : 10),
      constraints: [taskParams.constraints, planningConstraint].filter(Boolean).join('\n'),
      availableFiles: taskParams.availableFiles || [], // Pass available files for source tracking
      // Pass pre-selected file and pages for source tracking
      selectedFile: taskParams.selectedFile,
      selectedPages: taskParams.selectedPages,
      selectedSources: taskParams.sources,
      pdfFileData: directPdfAttachment?.pdfFileData,
      pdfFilename: directPdfAttachment?.pdfFilename,
    } as SkillInput;

    console.log(`[Orchestrator] Question input parameters:`, {
      questionType: selectedQuestionType,
      difficulty: questionInput.difficulty,
      timeLimit: timeLimit,
      moduleType: moduleType,
      points: questionInput.points,
      pdfAttachment: directPdfAttachment?.pdfFilename || null,
    });

    console.log(`[Orchestrator] Generating item ${itemNumber} with question type: ${selectedQuestionType}`);
    console.log(`[Orchestrator] Context length: ${enhancedContext.length} chars`);

    const questionResult = await questionSkill.execute(questionInput, llmContext);
    if (!questionResult.success) {
      throw new Error(`Question generation failed: ${questionResult.error}`);
    }
    let totalTokensUsed = questionResult.tokensUsed || 0;

    const contextKeywords = this.extractContextKeywords(questionInput.context || '');
    if (!this.questionMatchesContext(questionResult.data, contextKeywords)) {
      // Log warning but don't reject - context matching can be unreliable with complex/non-English content
      console.warn('[Orchestrator] Question may not perfectly match context keywords (continuing anyway):', {
        keywords: contextKeywords.slice(0, 5),
        title: questionResult.data?.title,
        keyConcepts: questionResult.data?.metadata?.key_concepts,
      });
      // Don't throw - allow generation to continue
      // The question was generated from the context so it should still be relevant
    }

    const questionData = questionResult.data;
    const normalizedQuestionType = String(questionData?.type || questionInput.questionType || '').toLowerCase();

    // Step 2: Generate solution
    const solutionSkill = skillRegistry.getSkill('solution_generator');
    if (!solutionSkill) {
      throw new Error('solution_generator skill not found');
    }

    let solutionResult: SkillOutput;
    if (normalizedQuestionType === 'multiple_choice' || normalizedQuestionType === 'mcq') {
      const deterministicSolution = this.buildMultipleChoiceSolutionData(questionData);
      if (!deterministicSolution) {
        throw new Error('Multiple choice question is missing a valid answer key or clean options');
      }

      const solutionContract = this.buildSolutionContract({
        questionData,
        questionType: questionInput.questionType,
        moduleType,
        taskParams,
        sourcePlanItem: taskParams.sourcePlanItem,
      });

      if (!deterministicSolution.explanation) {
        const solutionInput: SkillInput = {
          question: this.buildMultipleChoicePrompt(questionData),
          questionType: 'multiple_choice',
          context: `${filteredContext}\n\n${planningConstraint ? `${planningConstraint}\n\n` : ''}taskType: ${moduleType}`,
          detailLevel: moduleType === 'exams' ? 'concise' : moduleType === 'drills' ? 'concise' : 'comprehensive',
          hints: {
            correct_answer: questionData?.correct_answer,
            correct_option_text: questionData?.correct_option_text,
            teacher_contract: solutionContract,
            question_metadata: questionData?.metadata || {},
          },
          pdfFileData: directPdfAttachment?.pdfFileData,
          pdfFilename: directPdfAttachment?.pdfFilename,
        };

        const explanationResult = await solutionSkill.execute(solutionInput, llmContext);
        if (!explanationResult.success) {
          throw new Error(`Solution generation failed: ${explanationResult.error}`);
        }
        totalTokensUsed += explanationResult.tokensUsed || 0;

        const explanationData = explanationResult.data || {};
        deterministicSolution.explanation =
          typeof explanationData?.explanation === 'string'
            ? explanationData.explanation
            : deterministicSolution.explanation;
      }

      solutionResult = {
        success: true,
        data: deterministicSolution,
        tokensUsed: 0,
      };
    } else {
      // Extract question text for solution generator
      const questionForSolution = typeof questionResult.data === 'string'
        ? questionResult.data
        : questionResult.data?.question || questionResult.data?.description || JSON.stringify(questionResult.data);
      
      console.log('[Orchestrator] Question for solution generator:', {
        questionLength: questionForSolution.length,
        questionPreview: questionForSolution.substring(0, 100),
      });

      const solutionContract = this.buildSolutionContract({
        questionData,
        questionType: questionInput.questionType,
        moduleType,
        taskParams,
        sourcePlanItem: taskParams.sourcePlanItem,
      });
      
      const solutionInput: SkillInput = {
        question: questionForSolution,
        questionType: questionInput.questionType,
        context: `${filteredContext}\n\n${planningConstraint ? `${planningConstraint}\n\n` : ''}taskType: ${moduleType}`,
        detailLevel: moduleType === 'exams' ? 'concise' : moduleType === 'drills' ? 'concise' : 'comprehensive',
        hints: {
          teacher_contract: solutionContract,
          question_metadata: questionData?.metadata || {},
          question_title: questionData?.title || '',
          sources: taskParams.sources || [],
        },
        pdfFileData: directPdfAttachment?.pdfFileData,
        pdfFilename: directPdfAttachment?.pdfFilename,
      };

      solutionResult = await solutionSkill.execute(solutionInput, llmContext);
      if (!solutionResult.success) {
        throw new Error(`Solution generation failed: ${solutionResult.error}`);
      }
      totalTokensUsed += solutionResult.tokensUsed || 0;
    }

    // Extract question and solution data BEFORE translation
    // Extract question text - questionResult.data should be { question: "...", type: "...", sources: [...], ... }
    // Ensure questionText is always a string
    const rawQuestionText = questionData?.question || questionData?.description || '';
    const questionText = typeof rawQuestionText === 'string' 
      ? rawQuestionText 
      : typeof questionData === 'string' 
        ? questionData 
        : typeof rawQuestionText === 'object' 
          ? JSON.stringify(rawQuestionText) 
          : String(rawQuestionText || '');
    
    // Extract sources from question data
    let questionSources: Array<{ file: string; pages?: string }> = [];
    
    // Get pre-selected file and pages from taskParams (set by generateQuestions)
    const preSelectedFile = taskParams.selectedFile;
    const preSelectedPages = taskParams.selectedPages;
    const preSelectedSources = Array.isArray(taskParams.sources) ? taskParams.sources : [];
    
    // Get available files from taskParams
    const availableFiles = taskParams.availableFiles || [];
    
    // If we have pre-selected sources, use them as the primary sources
    if (preSelectedSources.length > 0) {
      questionSources = preSelectedSources
        .map((s: any) => ({
          file: s.file,
          pages: s.pages,
        }))
        .filter((s: any) => s.file);
      console.log(`[Orchestrator] Using pre-selected sources: ${JSON.stringify(questionSources)}`);
    } else if (preSelectedFile) {
      questionSources = [{
        file: preSelectedFile,
        pages: preSelectedPages || undefined,
      }];
      console.log(`[Orchestrator] Using pre-selected source: ${preSelectedFile} (pages: ${preSelectedPages || 'N/A'})`);
    } else {
      // Fallback: Extract sources from LLM response
      if (questionData && typeof questionData === 'object' && Array.isArray(questionData.sources)) {
        questionSources = questionData.sources.map((s: any) => {
          const file = typeof s?.file === 'string' ? s.file : (typeof s === 'string' ? s : 'Unknown');
          let pages = typeof s?.pages === 'string' && s.pages !== 'N/A' && s.pages.trim() !== '' 
            ? s.pages 
            : undefined;
          return { file, pages };
        });
      } else if (questionData && typeof questionData === 'object' && questionData.source) {
        const file = typeof questionData.source === 'string' ? questionData.source : 'Unknown';
        const pages = questionData.pages && questionData.pages !== 'N/A' 
          ? questionData.pages 
          : undefined;
        questionSources = [{ file, pages }];
      }
      
      // Validate sources - ensure files are in availableFiles
      if (questionSources.length > 0 && availableFiles.length > 0) {
        const validSources = questionSources.filter(s => 
          availableFiles.some((f: string) => 
            f.toLowerCase() === s.file.toLowerCase() || 
            s.file.toLowerCase().includes(f.toLowerCase()) || 
            f.toLowerCase().includes(s.file.toLowerCase())
          )
        );
        if (validSources.length > 0) {
          questionSources = validSources;
        }
      }
      
      // If still no valid sources, randomly select from available files
      if (questionSources.length === 0 && availableFiles.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableFiles.length);
        questionSources = [{
          file: availableFiles[randomIndex],
          pages: undefined,
        }];
        console.log(`[Orchestrator] Randomly selected file: ${availableFiles[randomIndex]}`);
      }
    }
    
    console.log(`[Orchestrator] Final questionSources: ${JSON.stringify(questionSources)}`);

    
    // Extract solution data - solutionResult.data should be { solution: "...", explanation: "...", ... }
    const solutionData = solutionResult.data;
    // Ensure solutionText is always a string
    const rawSolutionText = solutionData?.solution || solutionData?.code || '';
    let solutionText = typeof rawSolutionText === 'string'
      ? rawSolutionText
      : typeof solutionData === 'string'
        ? solutionData
        : typeof rawSolutionText === 'object'
          ? JSON.stringify(rawSolutionText)
          : String(rawSolutionText || '');
    const solutionExplanation =
      typeof solutionData?.explanation === 'string'
        ? solutionData.explanation
        : Array.isArray(solutionData?.explanation)
        ? solutionData.explanation.filter((x: any) => typeof x === 'string').join('\n')
        : solutionData?.explanation
        ? JSON.stringify(solutionData.explanation)
        : '';
    if (!solutionText.trim() && solutionExplanation.trim()) {
      solutionText = solutionExplanation;
    }

    // Step 3: Translate if secondary language is enabled
    let translatedQuestionText = '';
    let translatedSolutionText = '';
    let translatedSolutionExplanation = '';

    const secondaryLang = (llmContext.languageConfig?.secondaryLanguage || 'none').toString().trim();
    if (secondaryLang.toLowerCase() !== 'none') {
      const translatorSkill = skillRegistry.getSkill('bilingual_translator');
      if (translatorSkill) {
        const translate = async (text: string | any, retries = 2): Promise<{ translated: string; tokens: number }> => {
          // Ensure text is a string
          const textStr = typeof text === 'string' ? text : (text ? String(text) : '');
          if (!textStr || textStr.trim().length === 0) {
            console.log('[Orchestrator] Translation skipped: empty input text');
            return { translated: '', tokens: 0 };
          }
          console.log(`[Orchestrator] Starting translation to ${secondaryLang}, text length: ${textStr.length}`);

          
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              if (attempt > 0) {
                console.log(`[Orchestrator] Retrying translation (attempt ${attempt + 1}/${retries + 1})...`);
              }
              
              const res = await translatorSkill.execute({
                content: textStr,
                targetLanguage: secondaryLang,
                preserveFormatting: true,
                sourceLanguage: llmContext.languageConfig?.primaryLanguage,
              }, llmContext);
              
              totalTokensUsed += res.tokensUsed || 0;
              
              if (!res.success) {
                if (attempt < retries) {
                  console.warn(`[Orchestrator] Translation failed (attempt ${attempt + 1}), retrying...`, res.error);
                  continue;
                }
                console.warn('[Orchestrator] Translation failed after retries:', res.error);
                return { translated: '', tokens: res.tokensUsed || 0 };
              }
              
              const d = res.data;
              const out = typeof d === 'string' 
                ? d 
                : (d?.translated ?? d?.question ?? d?.solution ?? d?.answer ?? '');
              
              if (typeof out === 'string' && out.trim().length > 0) {
                return { translated: out, tokens: res.tokensUsed || 0 };
              } else if (attempt < retries) {
                console.warn(`[Orchestrator] Translation returned empty result (attempt ${attempt + 1}), retrying...`);
                continue;
              } else {
                console.warn('[Orchestrator] Translation returned empty result after retries');
                return { translated: '', tokens: res.tokensUsed || 0 };
              }
            } catch (e: any) {
              if (attempt < retries) {
                console.warn(`[Orchestrator] Translation error (attempt ${attempt + 1}), retrying...`, e?.message || e);
                continue;
              }
              console.warn('[Orchestrator] Translation error after retries:', e?.message || e);
              return { translated: '', tokens: 0 };
            }
          }
          
          return { translated: '', tokens: 0 };
        };

        console.log(`[Orchestrator] Translating question (${questionText.length} chars) to ${secondaryLang}...`);
        const q = await translate(questionText);
        translatedQuestionText = q.translated;
        console.log(`[Orchestrator] Question translation result: ${translatedQuestionText ? `${translatedQuestionText.length} chars` : 'EMPTY'}`);

        console.log(`[Orchestrator] Translating solution (${solutionText.length} chars) to ${secondaryLang}...`);
        const s = await translate(solutionText);
        translatedSolutionText = s.translated;
        console.log(`[Orchestrator] Solution translation result: ${translatedSolutionText ? `${translatedSolutionText.length} chars` : 'EMPTY'}`);

        if (solutionExplanation && typeof solutionExplanation === 'string' && solutionExplanation.trim().length > 0) {
          console.log(`[Orchestrator] Translating explanation (${solutionExplanation.length} chars) to ${secondaryLang}...`);
          const ex = await translate(solutionExplanation);
          translatedSolutionExplanation = ex.translated;
          console.log(`[Orchestrator] Explanation translation result: ${translatedSolutionExplanation ? `${translatedSolutionExplanation.length} chars` : 'EMPTY'}`);
        }
      } else {
        console.log(`[Orchestrator] No bilingual_translator skill found!`);
      }
    } else {
      console.log(`[Orchestrator] Secondary language is '${secondaryLang}', skipping translation`);
    }

    // Step 4: Format for module
    const formatterSkill = skillRegistry.getSkill('content_formatter');
    if (!formatterSkill) {
      throw new Error('content_formatter skill not found');
    }

    // Debug: log data structures BEFORE processing
    console.log('[Orchestrator] RAW Question result:', JSON.stringify(questionResult, null, 2).substring(0, 500));
    console.log('[Orchestrator] RAW Solution result:', JSON.stringify(solutionResult, null, 2).substring(0, 500));
    
    console.log('[Orchestrator] Extracted question:', {
      questionText: questionText.substring(0, 100),
      questionTextLength: questionText.length,
      questionDataType: typeof questionData,
      questionDataKeys: questionData ? Object.keys(questionData) : [],
    });
    console.log('[Orchestrator] Extracted solution:', {
      solutionText: solutionText.substring(0, 100),
      solutionTextLength: solutionText.length,
      solutionDataType: typeof solutionData,
      solutionDataKeys: solutionData ? Object.keys(solutionData) : [],
    });

    // If we don't have question or solution text, log error and throw
    if (!questionText || questionText.trim().length === 0) {
      console.error('[Orchestrator] ERROR: No question text extracted!', {
        questionResult,
        questionData,
      });
      throw new Error('Failed to extract question text from LLM response');
    }
    
    if (!solutionText || solutionText.trim().length === 0) {
      console.error('[Orchestrator] ERROR: No solution text extracted!', {
        solutionResult,
        solutionData,
      });
      throw new Error('Failed to extract solution text from LLM response');
    }

    // Ensure sources always have valid pages when we have pre-selected file
    let finalSources = questionSources.length > 0 ? questionSources : (taskParams.sources || []);
    
    // If we have pre-selected file/pages, ensure they are in the sources
    if (preSelectedFile) {
      // Check if the pre-selected file is already in sources with valid pages
      const hasPreSelectedFile = finalSources.some(
        (s: any) => s.file === preSelectedFile && s.pages && s.pages !== 'N/A'
      );
      
      if (!hasPreSelectedFile) {
        // Force the pre-selected file with its pages
        finalSources = [{
          file: preSelectedFile,
          pages: preSelectedPages || 'N/A',
        }];
        console.log(`[Orchestrator] Forcing pre-selected source: ${preSelectedFile} (pages: ${preSelectedPages || 'N/A'})`);
      }
    }
    
    // If we have pre-selected sources array, ensure they are preserved
    if (preSelectedSources.length > 0) {
      finalSources = preSelectedSources
        .map((s: any) => ({ file: s.file, pages: s.pages }))
        .filter((s: any) => s.file);
    }
    
    const formatInput: SkillInput = {
      content: {
        // Pass the full objects so formatter can extract metadata
        question: questionData,
        solution: solutionData,
        // Also pass extracted text as fallback
        questionText,
        solutionText,
        solutionExplanation,
        type: questionInput.questionType,
        points: questionInput.points,
        number: itemNumber,
        // Use the final sources with proper pages
        sources: finalSources,
        // Add secondary language fields
        question_secondary: translatedQuestionText,
        solution_secondary: translatedSolutionText,
        solution_explanation_secondary: translatedSolutionExplanation,
        description_secondary: translatedQuestionText,
        hints_secondary: [],
        requirements_secondary: [],
      },
      moduleType,
      includeMetadata: true,
    };

    const formatResult = await formatterSkill.execute(formatInput, llmContext);
    if (!formatResult.success) {
      console.error('[Orchestrator] Formatting failed:', formatResult.error);
      throw new Error(`Formatting failed: ${formatResult.error}`);
    }
    totalTokensUsed += formatResult.tokensUsed || 0;

    console.log('[Orchestrator] Final formatted item:', {
      keys: Object.keys(formatResult.data || {}),
      question: formatResult.data?.question?.substring(0, 100) || 'MISSING',
      solution: formatResult.data?.solution?.substring(0, 100) || 'MISSING',
      full: JSON.stringify(formatResult.data).substring(0, 500),
    });

    return { item: formatResult.data, tokensUsed: totalTokensUsed };
  }

  /**
   * Regenerate a single item
   */
  async regenerateItem(params: {
    moduleType: string;
    originalItem: any;
    context: string;
    taskParams: Record<string, any>;
    llmContext: SkillContext;
  }): Promise<{ item: any; tokensUsed: number }> {
    const { moduleType, originalItem, context, taskParams, llmContext } = params;

    console.log(`🔄 Orchestrator: Regenerating item...`);
    console.log(`[Orchestrator] Regenerate taskParams:`, {
      selectedFile: taskParams.selectedFile,
      selectedPages: taskParams.selectedPages,
    });

    const resolvedQuestionType =
      taskParams.questionType ||
      originalItem.format ||
      originalItem.problem_type ||
      originalItem.question_type ||
      originalItem.type ||
      'coding';

    // Use the same pipeline but with original item as context
    const { item, tokensUsed } = await this.generateSingleItem({
      moduleType,
      context: `${context}\n\nOriginal item (improve upon this):\n${JSON.stringify(originalItem)}`,
      taskParams: {
        ...taskParams,
        questionType: resolvedQuestionType,
        points: originalItem.points,
        // Pass through selectedFile and selectedPages for custom source regeneration
        selectedFile: taskParams.selectedFile,
        selectedPages: taskParams.selectedPages,
      },
      llmContext,
      itemNumber: originalItem.number || 1,
    });

    // Force sources if custom source was specified
    if (taskParams.selectedFile) {
      item.sources = [{
        file: taskParams.selectedFile,
        pages: taskParams.selectedPages || 'N/A',
      }];
      console.log(`[Orchestrator] Forced sources to: ${JSON.stringify(item.sources)}`);
    }

    // Preserve certain fields from original
    const preservedSources = taskParams.selectedFile
      ? [{
          file: taskParams.selectedFile,
          pages: taskParams.selectedPages || 'N/A',
        }]
      : item.sources || originalItem.sources || [];

    return {
      item: {
        ...item,
        number: originalItem.number,
        problem_number: originalItem.problem_number ?? item.problem_number,
        sources: preservedSources,
      },
      tokensUsed,
    };
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    return {
      availableSkills: skillRegistry.getAllSkillNames(),
      skillCount: skillRegistry.getAllSkillNames().length,
      skills: skillRegistry.listAllSkills(),
    };
  }
}

// Export singleton instance
export const orchestrator = AgentOrchestrator.getInstance();



