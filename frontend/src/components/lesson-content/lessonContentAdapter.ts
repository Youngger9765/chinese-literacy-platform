/**
 * lessonContentAdapter.ts — the ONLY place that touches the legacy `Story` shape to
 * produce a zod `Lesson` for the Phase-2 renderer. Dev/QA harness (Gap G0-B): until the
 * backend serves a real `lesson_content` block payload, this best-effort assembles a
 * Lesson from the fields a Story already carries (content / paragraphs / images / tables
 * / multipleChoice / fillInBlank). Because the feature flag is OFF by default, this only
 * ever runs in QA/tests.
 *
 * Contract: `storyToLesson(story)` returns `{ lesson, gaps }`. `lesson` is null when the
 * assembled object fails `LessonSchema.safeParse` (fail-loud, never a half-valid Lesson);
 * `gaps[]` honestly records every legacy field the adapter could not faithfully map
 * (null-answer MCQ, missing grid, missing lesson_code, etc.) — gaps are NOT faked into
 * passes.
 *
 * Key normalizations:
 *   - letter → index for MCQ / fill-in-blank choice answers (Gap G3): 'A'→0, 'B'→1…
 *   - LessonTable (legacy rows+section) → schema TableBlock fast path (rowSections +
 *     sectionLabelCol). Merged `grid` cannot be reconstructed from Story (Gap G2) → gap.
 */
import {
  LessonSchema,
  type Lesson,
} from '../../schema/lessonContent';
import type { Story, MultipleChoiceItem, LessonTable } from '../../types';
import { letterToIndex } from './lessonGrading';

interface AdapterResult {
  lesson: Lesson | null;
  gaps: string[];
}

/** Resolve the passage paragraphs a Story exposes (paragraphs preferred, then content). */
function resolveParagraphs(story: Story): string[] {
  if (Array.isArray(story.paragraphs) && story.paragraphs.length > 0) return story.paragraphs;
  if (Array.isArray(story.content) && story.content.length > 0) return story.content;
  return [];
}

/** legacy LessonTable → schema TableBlock (fast path: rows + section column). */
function toLessonTableBlock(
  table: LessonTable,
  id: string,
): Record<string, unknown> {
  const hasSection = !!table.section_label_col && table.rows.some((r) => r.section);
  const block: Record<string, unknown> = {
    id,
    type: 'table',
    label: table.title ?? null,
    title: table.title ?? null,
    headers: table.headers ?? [],
    rows: table.rows.map((r) => r.cells),
    notes: table.notes ?? [],
  };
  if (hasSection) {
    block.sectionLabelCol = table.section_label_col;
    block.rowSections = table.rows.map((r) => r.section ?? '');
  }
  return block;
}

/**
 * storyToLesson — best-effort legacy Story → zod Lesson (dev/QA harness only).
 * Returns null lesson (+ recorded gaps) whenever the result would not satisfy the
 * frozen contract, so the flag-guarded pages fall safely back to the legacy path.
 */
export function storyToLesson(story: Story | null | undefined): AdapterResult {
  const gaps: string[] = [];
  if (!story) return { lesson: null, gaps: ['no story provided'] };

  const lessonCode = story.lesson_code || story.id;
  if (!story.lesson_code) {
    gaps.push('G1: story.lesson_code missing — figure images may not resolve');
  }

  const paragraphs = resolveParagraphs(story);
  if (paragraphs.length === 0) {
    gaps.push('G0: story has no content/paragraphs — cannot build a lesson body');
    return { lesson: null, gaps };
  }

  const blocks: Record<string, unknown>[] = [];
  const paragraphIds: string[] = [];

  // Paragraph blocks (skip empties to satisfy z.string().min(1)).
  paragraphs.forEach((text, i) => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    const id = `p${i + 1}`;
    paragraphIds.push(id);
    blocks.push({ id, type: 'paragraph', text: trimmed });
  });

  if (paragraphIds.length === 0) {
    gaps.push('G0: all paragraphs empty after trim');
    return { lesson: null, gaps };
  }

  const firstParaId = paragraphIds[0];

  // Figure blocks from images (schema figure has no lessonCode; resolved at render).
  (story.images ?? []).forEach((img, i) => {
    blocks.push({
      id: `fig-${i + 1}`,
      type: 'figure',
      label: img.figure_label ?? null,
      caption: img.caption ?? null,
      asset: img.filename ?? null,
    });
  });

  // Table blocks (Gap G2: merged grid not reconstructable from Story rows).
  (story.tables ?? []).forEach((table, i) => {
    blocks.push(toLessonTableBlock(table, `table-${i + 1}`));
    if (table.section_label_col) {
      gaps.push(`G2: table ${table.id} merged-grid not reconstructable from Story (fast-path only)`);
    }
  });

  // Reading-comprehension MCQs → exercise blocks. Legacy answer is a LETTER or null.
  (story.multipleChoice ?? []).forEach((mcq: MultipleChoiceItem, i) => {
    const id = `ex-mcq-${i + 1}`;
    const idx = mcq.answer != null ? letterToIndex(mcq.answer) : null;
    if (idx == null) {
      // G3: null-answer MCQ — must emit needsReview or violate the answer invariant.
      gaps.push(`G3: MCQ #${i + 1} has no verifiable answer (answer=${JSON.stringify(mcq.answer)})`);
      blocks.push({
        id,
        type: 'exercise',
        question: {
          kind: 'multiple_choice',
          question: mcq.question,
          options: mcq.options,
          explanation: mcq.explanation ?? null,
        },
        answerSpace: 'choice',
        answer: 0,
        grader: 'manual',
        needsReview: true,
        anchors: [{ blockId: firstParaId }],
      });
      return;
    }
    blocks.push({
      id,
      type: 'exercise',
      question: {
        kind: 'multiple_choice',
        question: mcq.question,
        options: mcq.options,
        explanation: mcq.explanation ?? null,
      },
      answerSpace: 'choice',
      answer: idx,
      grader: 'exact',
      anchors: [{ blockId: firstParaId }],
    });
  });

  // Fill-in-blank (語詞應用): legacy each item is sentence + letter answer over vocabBank.
  const vocabBank = story.vocabBank;
  (story.fillInBlank ?? []).forEach((item, i) => {
    const id = `ex-fib-${i + 1}`;
    const idx = letterToIndex(item.answer);
    const options = vocabBank ? Object.keys(vocabBank).sort().map((k) => vocabBank[k]) : [];
    if (idx == null || options.length < 2) {
      gaps.push(`G3: fill-in-blank #${i + 1} not verifiable (answer=${JSON.stringify(item.answer)}, options=${options.length})`);
      return;
    }
    blocks.push({
      id,
      type: 'exercise',
      question: {
        kind: 'fill_in_blank',
        sentence: item.sentence,
        vocabBank: vocabBank ?? null,
      },
      answerSpace: 'choice',
      answer: idx,
      grader: 'exact',
      anchors: [{ blockId: firstParaId }],
    });
  });

  // Note deliberate non-mappings (honest gaps; not synthesized into passes).
  if (story.strategyExercise) {
    gaps.push('G4: legacy strategyExercise not adapted (correct_order/correct_trait lossy — needs backend block payload)');
  }
  if (story.spotlightV2?.blocks?.length) {
    gaps.push('G0: spotlightV2 blocks not adapted (string answers, no answerSpace/grader invariant)');
  }

  const candidate = {
    id: story.id,
    lessonCode,
    title: story.title ?? null,
    blocks,
  };

  const parsed = LessonSchema.safeParse(candidate);
  if (!parsed.success) {
    gaps.push(`adapter output failed LessonSchema: ${parsed.error.issues.map((x) => x.message).slice(0, 3).join('; ')}`);
    return { lesson: null, gaps };
  }
  return { lesson: parsed.data, gaps };
}
