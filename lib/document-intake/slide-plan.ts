type SlidePlanType = 'cover' | 'transition' | 'concept' | 'example' | 'summary';
type SlidePlanImportance = 'low' | 'medium' | 'high';

export type SlidePlanItem = {
  slide_number: number;
  slide_type: SlidePlanType;
  importance: SlidePlanImportance;
  target_words: number;
  must_cover: string[];
  topic_labels: string[];
};

function extractMustCover(text: string): string[] {
  return (text || '')
    .split(/\r?\n|•|·|-/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .slice(0, 8)
    .map((line) => line.slice(0, 120));
}

function extractTopicLabels(text: string): string[] {
  return Array.from(
    new Set(
      (text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 4 && line.length <= 48)
        .filter((line) => !/^\[?speaker notes\]?$/i.test(line))
        .filter((line) => /[A-Za-z&]/.test(line))
        .filter((line) => !/[.!?]$/.test(line))
        .filter((line) => !/^(output|note|page|\d+|\(.*\))$/i.test(line))
    )
  ).slice(0, 5);
}

function classifySlideType(slide: { text: string; isCover?: boolean }): SlidePlanType {
  if (slide.isCover) return 'cover';
  const text = (slide.text || '').toLowerCase();
  if (!text.trim()) return 'transition';
  if (/(agenda|outline|roadmap|today|contents|section|part\s+\d+)/i.test(text)) return 'transition';
  if (/(summary|recap|takeaway|conclusion|q&a|questions)/i.test(text)) return 'summary';
  if (/(example|case study|demo|exercise|practice|quiz|problem)/i.test(text)) return 'example';
  if (/(function\s|\bclass\s|\bdef\s|\breturn\b|=>|console\.log|SELECT\s|INSERT\s|<div|public\s+static)/i.test(text)) {
    return 'example';
  }
  if ((slide.text || '').trim().length < 80) return 'transition';
  return 'concept';
}

function getTargetWords(params: {
  slideType: SlidePlanType;
  importance: SlidePlanImportance;
  audienceLevel: string;
  targetMinutes: number;
  totalSlides: number;
}): number {
  const { slideType, importance, audienceLevel, targetMinutes, totalSlides } = params;
  const avgMinutesPerSlide = targetMinutes / Math.max(totalSlides, 1);

  let base =
    slideType === 'cover' ? 25 :
    slideType === 'transition' ? 45 :
    slideType === 'summary' ? 80 :
    slideType === 'example' ? 150 :
    180;

  if (audienceLevel === 'beginner') base += 25;
  if (importance === 'high') base += 35;
  if (importance === 'low') base -= 20;
  if (avgMinutesPerSlide < 1.5) base -= 20;
  if (avgMinutesPerSlide > 3.5) base += 25;

  return Math.max(20, Math.min(base, 260));
}

export function buildSlidePlan(params: {
  slidesFromPpt: Array<{ slide_number: number; text: string; textLen?: number; isCover?: boolean }>;
  audienceLevel: string;
  targetMinutes: number;
}): SlidePlanItem[] {
  const { slidesFromPpt, audienceLevel, targetMinutes } = params;
  const totalSlides = slidesFromPpt.filter((slide) => !slide.isCover).length;

  return slidesFromPpt
    .filter((slide) => !slide.isCover)
    .map((slide) => {
      const slideType = classifySlideType(slide);
      const textLen = slide.textLen ?? (slide.text || '').length;
      const importance: SlidePlanImportance =
        slideType === 'concept' && textLen > 180 ? 'high' :
        slideType === 'example' && textLen > 120 ? 'high' :
        slideType === 'transition' || slideType === 'cover' ? 'low' :
        'medium';

      return {
        slide_number: slide.slide_number,
        slide_type: slideType,
        importance,
        target_words: getTargetWords({
          slideType,
          importance,
          audienceLevel,
          targetMinutes,
          totalSlides,
        }),
        must_cover: extractMustCover(slide.text),
        topic_labels: extractTopicLabels(slide.text),
      };
    });
}

