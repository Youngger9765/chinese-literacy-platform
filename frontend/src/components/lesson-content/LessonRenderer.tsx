/**
 * LessonRenderer — root of the Phase-2 unified block-based renderer (the ONE code path).
 *
 * Responsibilities:
 *  (a) `useMemo` the layout hint (resolveLayout) + paired-row grouping (groupPairedBlocks);
 *  (b) walk `lesson.blocks` IN ORDER, handing each to BlockRenderer;
 *  (c) hold aggregate state keyed by `block.id` (schema guarantees unique ids, so a
 *      reorder never corrupts state — unlike the legacy `${seg}-${blk}` key);
 *  (d) `allDone` = every gradable exercise (not custom / needsReview) has a verdict →
 *      calls onComplete;
 *  (e) emit the SAME onChange envelope shape the legacy spotlight used, so it drops
 *      straight into `saveStepProgressPatch`: onExerciseChange({ answers, feedback,
 *      textGrades, allDone, renderer: 'lesson_v1' }).
 *
 * 一般 vs 圖文 converge here: `resolveLayout` only decides grouping/CSS over the SAME
 * BlockRenderer output — there is no `if graphic-text return <OtherComponent>`.
 *
 * The outer shell copies ComprehensionLayout's height-safe recipe verbatim (flex flex-col
 * flex-1 min-h-0 overflow-hidden + inner overflow-y-auto) to avoid #1331/#1332 collapse
 * and #2194. All render-path derivation is inside useMemo (no mutation, StrictMode-safe).
 *
 * Every hook is declared at the top level, before any effect referencing it (#2279 TDZ).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lesson, Block } from '../../schema/lessonContent';
import { resolveLayout } from './lessonLayout';
import BlockRenderer from './BlockRenderer';

/**
 * Minimal story shape LessonRenderer needs (title for AI-grading context, lessonCode
 * as a figure-src fallback). Structurally compatible with the app-wide `Story` so a
 * full Story can be passed straight in. Kept local so this renderer does not import the
 * legacy `types.ts` Story (the adapter is the only bridge to that shape).
 */
export interface LessonStoryContext {
  title?: string | null;
  lessonCode?: string | null;
  lesson_code?: string | null;
}

/** Envelope emitted to the host page (identical field-set to the legacy spotlight). */
export interface LessonExerciseState {
  answers: Record<string, unknown>;
  feedback: Record<string, boolean | null>;
  textGrades: Record<string, unknown>;
  allDone: boolean;
  renderer: 'lesson_v1';
}

export interface LessonRendererProps {
  lesson: Lesson;
  story?: LessonStoryContext | null;
  lessonCode?: string;
  onExerciseChange?: (state: LessonExerciseState) => void;
  onComplete?: () => void;
  initialState?: Record<string, unknown>;
}

interface ExerciseMeta {
  gradable: boolean; // participates in allDone gating (custom/needsReview excluded)
}

/** Pre-compute per-block render metadata (paragraph numbers, figure indices, exercise
 *  gradability) in one pass so the render path is pure. */
function buildBlockMeta(blocks: Block[]): {
  paragraphNumber: Map<string, number>;
  figureIndex: Map<string, number>;
  exerciseMeta: Map<string, ExerciseMeta>;
  gradableIds: string[];
} {
  const paragraphNumber = new Map<string, number>();
  const figureIndex = new Map<string, number>();
  const exerciseMeta = new Map<string, ExerciseMeta>();
  const gradableIds: string[] = [];
  let pn = 0;
  let fi = 0;
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      pn += 1;
      paragraphNumber.set(b.id, pn);
    } else if (b.type === 'figure') {
      figureIndex.set(b.id, fi);
      fi += 1;
    } else if (b.type === 'exercise') {
      // custom / needsReview exercises never auto-pass → excluded from allDone gating.
      const gradable = b.question.kind !== 'custom' && b.needsReview !== true;
      exerciseMeta.set(b.id, { gradable });
      if (gradable) gradableIds.push(b.id);
    }
  }
  return { paragraphNumber, figureIndex, exerciseMeta, gradableIds };
}

const LessonRenderer: React.FC<LessonRendererProps> = ({
  lesson,
  story,
  lessonCode,
  onExerciseChange,
  onComplete,
  initialState,
}) => {
  const resolvedLessonCode =
    lessonCode || story?.lessonCode || story?.lesson_code || lesson.lessonCode;
  const storyTitle = story?.title ?? lesson.title ?? null;
  const passage = useMemo(
    () =>
      lesson.blocks
        .filter((b): b is Block & { type: 'paragraph' } => b.type === 'paragraph')
        .map((b) => b.text)
        .join('\n'),
    [lesson.blocks],
  );

  const layout = useMemo(() => resolveLayout(lesson), [lesson]);
  const meta = useMemo(() => buildBlockMeta(lesson.blocks), [lesson.blocks]);

  // Aggregate state keyed by block.id.
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    () => (initialState?.answers as Record<string, unknown>) ?? {},
  );
  const [feedback, setFeedback] = useState<Record<string, boolean | null>>(
    () => (initialState?.feedback as Record<string, boolean | null>) ?? {},
  );
  // Seed the manual-review set from BLOCK-LEVEL needs_review flags (honest from first
  // render — no interaction needed). This is what surfaces the "有 N 題需老師人工檢核"
  // status for a needs_review lesson so the renderer never pretends a flagged block is
  // complete/verifiable. `custom` blocks additionally add themselves via onGraded.
  const initialNeedsReview = useMemo(() => {
    const seed: Record<string, boolean> = {};
    for (const b of lesson.blocks) {
      if (b.type === 'exercise' && b.needsReview === true) seed[b.id] = true;
    }
    return seed;
  }, [lesson.blocks]);
  const [needsReview, setNeedsReview] = useState<Record<string, boolean>>(initialNeedsReview);

  const allDone = useMemo(
    () =>
      meta.gradableIds.length > 0 &&
      meta.gradableIds.every((id) => feedback[id] === true || feedback[id] === false),
    [meta.gradableIds, feedback],
  );

  // Emit the legacy-shaped envelope on every state change (drop-in for saveStepProgressPatch).
  useEffect(() => {
    onExerciseChange?.({ answers, feedback, textGrades: {}, allDone, renderer: 'lesson_v1' });
  }, [answers, feedback, allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire onComplete once when all gradable exercises are graded.
  useEffect(() => {
    if (allDone) onComplete?.();
  }, [allDone, onComplete]);

  const handleAnswerChange = useCallback((id: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleGraded = useCallback(
    (id: string, result: { verdict: boolean | null; needsReview: boolean }) => {
      setFeedback((prev) => ({ ...prev, [id]: result.verdict }));
      if (result.needsReview) setNeedsReview((prev) => ({ ...prev, [id]: true }));
    },
    [],
  );

  // Render one block (context or exercise), wiring exercise state by block.id.
  const renderBlock = useCallback(
    (block: Block) => (
      <BlockRenderer
        key={block.id}
        block={block}
        lessonCode={resolvedLessonCode}
        storyTitle={storyTitle}
        passage={passage}
        paragraphNumber={meta.paragraphNumber.get(block.id)}
        figureIndex={meta.figureIndex.get(block.id) ?? 0}
        answerValue={answers[block.id]}
        onAnswerChange={(v) => handleAnswerChange(block.id, v)}
        onGraded={(r) => handleGraded(block.id, r)}
        verdict={feedback[block.id]}
      />
    ),
    [resolvedLessonCode, storyTitle, passage, meta, answers, feedback, handleAnswerChange, handleGraded],
  );

  // Reading material (LEFT) vs exercise / answer area (RIGHT). 課文 paragraphs + the
  // lesson's own figures/tables/parallel passages are reference material students read
  // to answer, so they live on the LEFT (in document order). The 聚光燈 exercise — the
  // digitized worksheet answer block — is on the RIGHT. When both exist we use the
  // two-pane split (mirrors ComprehensionLayout's height-safe left-text/right-exercise
  // recipe); otherwise fall back to a single-column flow.
  const { readingBlocks, exerciseBlocks } = useMemo(() => {
    const reading: Block[] = [];
    const exercises: Block[] = [];
    for (const b of lesson.blocks) {
      if (b.type === 'exercise') exercises.push(b);
      else reading.push(b);
    }
    return { readingBlocks: reading, exerciseBlocks: exercises };
  }, [lesson.blocks]);
  const useSplit = readingBlocks.length > 0 && exerciseBlocks.length > 0;

  const notices = (
    <>
      {allDone ? (
        <p className="text-center text-base font-medium text-green-700 py-4">✓ 本課練習完成</p>
      ) : null}
      {Object.keys(needsReview).length > 0 ? (
        <p className="text-center text-sm text-amber-700 py-2">
          有 {Object.keys(needsReview).length} 題需老師人工檢核
        </p>
      ) : null}
    </>
  );

  return (
    <div
      data-testid="lesson-renderer"
      data-layout={useSplit ? 'reading-split' : layout}
      className="flex flex-col flex-1 min-h-0 overflow-hidden"
    >
      <header className="border-b border-gray-200 pb-4 mb-4 shrink-0">
        <div className="text-sm font-semibold text-violet-600 tracking-wide">閱讀學習</div>
        {(lesson.title ?? null) && (
          <h2 className="text-xl font-bold text-on-surface mt-1">{lesson.title}</h2>
        )}
      </header>

      {useSplit ? (
        // Two-pane: LEFT 課文(+其圖表)可捲動對照;RIGHT 聚光燈答題區可捲動。
        // 手機(單欄)整頁捲動;lg 以上各欄獨立捲動(min-h-0 + overflow)。
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[1fr] gap-4 lg:gap-6 overflow-y-auto lg:overflow-hidden">
          <section
            aria-label="課文"
            className="lg:col-span-7 lg:min-h-0 lg:overflow-y-auto custom-scrollbar lg:pr-2 space-y-6"
          >
            {readingBlocks.map((block) => (
              <div key={block.id} className="shrink-0">
                {renderBlock(block)}
              </div>
            ))}
          </section>
          <section
            aria-label="閱讀聚光燈作答區"
            className="lg:col-span-5 lg:min-h-0 lg:overflow-y-auto custom-scrollbar lg:pr-1 lg:border-l lg:border-gray-200 lg:pl-5 space-y-6"
          >
            {exerciseBlocks.map((block) => (
              <div key={block.id} className="shrink-0">
                {renderBlock(block)}
              </div>
            ))}
            {notices}
          </section>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
          <div className="space-y-6">
            {lesson.blocks.map((block) => (
              <div key={block.id} className="shrink-0">
                {renderBlock(block)}
              </div>
            ))}
          </div>
          {notices}
        </div>
      )}
    </div>
  );
};

export default LessonRenderer;
