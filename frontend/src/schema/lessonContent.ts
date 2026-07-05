/**
 * lessonContent.ts — Block-based Lesson content contract (zod mirror).
 *
 * Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md), Phase 0 + Phase 1.
 *
 * This is the FRONTEND half of the shared content contract. The BACKEND half lives
 * at `backend/app/schemas/lesson_content.py`. The two MUST stay semantically in sync —
 * `src/schema/__tests__/lessonContent.contract.test.ts` validates the shared fixtures
 * in `backend/tests/fixtures/lesson_content/` through THIS schema, so if the two drift,
 * a fixture that the backend accepts will fail here (or vice-versa) and the test breaks.
 *
 * WHY (plan §2.2, the invariant): every exercise MUST carry `answerSpace` + `answer` +
 * `grader`. The renderer is free to make it pretty; the ANSWER is always structured and
 * machine-comparable. The `custom` escape hatch is not exempt — it must set
 * `needsReview: true`.
 *
 * NON-INVASIVE: additive only. Does not touch existing `types.ts`, `ComprehensionLayout`,
 * `StrategyExercise`, or any renderer. This is scaffolding for the Phase-2 unified renderer.
 */
import { z } from 'zod';

// ─── Shared value objects ────────────────────────────────────────────────────

export const AnswerSpace = z.enum([
  'choice',
  'multi_choice',
  'text',
  'order',
  'free_text',
]);
export type AnswerSpace = z.infer<typeof AnswerSpace>;

export const Grader = z.enum(['exact', 'set', 'ordered', 'rubric_ai', 'manual']);
export type Grader = z.infer<typeof Grader>;

export const AnchorSchema = z
  .object({
    blockId: z.string().min(1),
    charStart: z.number().int().min(0).optional(),
    charEnd: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (a) => a.charStart == null || a.charEnd == null || a.charEnd >= a.charStart,
    { message: 'charEnd must be >= charStart' },
  );
export type Anchor = z.infer<typeof AnchorSchema>;

// ─── Exercise question-type discriminated union ──────────────────────────────

const MultipleChoiceQuestion = z
  .object({
    kind: z.literal('multiple_choice'),
    question: z.string().min(1),
    options: z.array(z.string()).min(2),
    explanation: z.string().nullish(),
  })
  .strict();

// Gap 3: optional per-blank slot. `.refine`s here are ILLUSTRATIVE ONLY — because
// FillInBlankQuestion is a discriminatedUnion member it must stay a pure ZodObject, so
// the cross-field slot checks (set-slot-array, slot-id-uniqueness) are enforced in
// LessonSchema.superRefine (see slotError / fillInBlankSlotError below).
const BlankSlot = z
  .object({
    id: z.string().min(1),
    answer: z.union([z.string(), z.array(z.string())]),
    grader: z.enum(['exact', 'set']).default('exact'),
    hint: z.string().nullish(),
  })
  .strict();

const FillInBlankQuestion = z
  .object({
    kind: z.literal('fill_in_blank'),
    sentence: z.string().min(1),
    vocabBank: z.record(z.string(), z.string()).nullish(),
    slots: z.array(BlankSlot).nullish(),
  })
  .strict();

const OrderingQuestion = z
  .object({
    kind: z.literal('ordering'),
    instruction: z.string().min(1),
    items: z.array(z.string()).min(2),
  })
  .strict();

const TraitInferenceQuestion = z
  .object({
    kind: z.literal('trait_inference'),
    instruction: z.string().min(1),
    character: z.string().min(1),
    clues: z.array(z.string()).default([]),
    traitOptions: z.array(z.string()).min(2),
  })
  .strict();

const GuidedStep = z
  .object({
    prompt: z.string().min(1),
    type: z.enum(['select', 'multi_select', 'free_text']),
    options: z.array(z.string()).nullish(),
    // select → single index; multi_select → list of indices; free_text → null
    answer: z
      .union([z.number().int().min(0), z.array(z.number().int().min(0)), z.null()])
      .nullish(),
    referenceAnswer: z.string().nullish(),
    // Optional section label for visual grouping, e.g. "範例" / "課文" / "小試身手".
    section: z.string().nullish(),
    // Optional context passage shown above this step (e.g. the 例一 worked example),
    // so a worked example is self-contained. Presentation-only; never the answer.
    context: z.string().nullish(),
  })
  .strict()
  .refine(
    (s) =>
      (s.type !== 'select' && s.type !== 'multi_select') ||
      (s.options != null && s.options.length >= 2),
    { message: 'select/multi_select step must have >= 2 options' },
  )
  .refine(
    (s) =>
      s.type !== 'select' ||
      s.answer == null ||
      (typeof s.answer === 'number' && s.options != null && s.answer < s.options.length),
    { message: 'select step answer must be a single in-range index' },
  )
  .refine(
    (s) =>
      s.type !== 'multi_select' ||
      s.answer == null ||
      (Array.isArray(s.answer) &&
        s.options != null &&
        new Set(s.answer).size === s.answer.length &&
        s.answer.every((i) => i < s.options!.length)),
    { message: 'multi_select step answer must be distinct in-range indices' },
  )
  .refine((s) => s.type !== 'free_text' || s.answer == null, {
    message: 'free_text step answer must be null',
  });

const GuidedStepsQuestion = z
  .object({
    kind: z.literal('guided_steps'),
    strategyName: z.string().min(1),
    instruction: z.string().min(1),
    steps: z.array(GuidedStep).min(1),
  })
  .strict();

const GraphicTextIntegrationQuestion = z
  .object({
    kind: z.literal('graphic_text_integration'),
    strategyName: z.string().min(1),
    instruction: z.string().min(1),
    steps: z.array(GuidedStep).min(1),
  })
  .strict();

const CustomQuestion = z
  .object({
    kind: z.literal('custom'),
    prompt: z.string().min(1),
    renderHint: z.string().nullish(),
  })
  .strict();

// Gap 2(b): answer-bearing 重點表 (8th question kind). Pure ZodObjects so the outer
// KeypointsTableQuestion stays a valid discriminatedUnion member; the blank-id
// uniqueness + row→blank reference checks are enforced in LessonSchema.superRefine.
// KeypointBlank has two modes: free fill (options absent) or □-choice (options present,
// e.g. G7-L2 "充足 □少量" where 充足 is correct and 少量 is a distractor). In choice mode
// `answer` must be one of `options`. `.refine` here is fine — KeypointBlank is nested
// inside KeypointsTableQuestion.blanks, not itself a discriminatedUnion member.
const KeypointBlank = z
  .object({
    id: z.string().min(1),
    answer: z.string().min(1),
    hint: z.string().nullish(),
    options: z.array(z.string()).min(2).nullish(),
  })
  .strict()
  .refine((b) => b.options == null || b.options.includes(b.answer), {
    message: 'keypoints_table □-choice blank answer must be one of options',
  });

const KeypointRow = z
  .object({
    label: z.string().min(1),
    subLabel: z.string().nullish(),
    hint: z.string().nullish(),
    paragraph: z.string().nullish(),
    template: z.string().nullish(),
    blankIds: z.array(z.string()).default([]),
  })
  .strict();

const KeypointsTableQuestion = z
  .object({
    kind: z.literal('keypoints_table'),
    structure: z.enum(['flat', 'nested', 'hint_value', 'locate_paragraph']),
    title: z.string().nullish(),
    rows: z.array(KeypointRow).min(1),
    blanks: z.array(KeypointBlank).min(1),
  })
  .strict();

export const QuestionSchema = z.discriminatedUnion('kind', [
  MultipleChoiceQuestion,
  FillInBlankQuestion,
  OrderingQuestion,
  TraitInferenceQuestion,
  GuidedStepsQuestion,
  GraphicTextIntegrationQuestion,
  KeypointsTableQuestion,
  CustomQuestion,
]);
export type Question = z.infer<typeof QuestionSchema>;

// ─── Block discriminated union ────────────────────────────────────────────────

const ParagraphBlock = z
  .object({
    id: z.string().min(1),
    type: z.literal('paragraph'),
    text: z.string().min(1),
  })
  .strict();

const FigureBlock = z
  .object({
    id: z.string().min(1),
    type: z.literal('figure'),
    label: z.string().nullish(),
    caption: z.string().nullish(),
    asset: z.string().nullish(),
    // Rendering column: default/'reading' → left reference column; 'exercise' → right
    // answer column, WITH the questions (a diagram that belongs to the 題目, not 課文).
    placement: z.enum(['reading', 'exercise']).nullish(),
  })
  .strict();

// Gap 2(a): merged-cell overlay. Present only when there are merged cells; grid width
// consistency is checked in LessonSchema.superRefine (TableBlock must stay a pure
// ZodObject for the BlockSchema discriminatedUnion).
const TableCell = z
  .object({
    text: z.string().default(''),
    colspan: z.number().int().min(1).default(1),
    rowspan: z.number().int().min(1).default(1),
    isSectionLabel: z.boolean().default(false),
  })
  .strict();

const TableBlock = z
  .object({
    id: z.string().min(1),
    type: z.literal('table'),
    label: z.string().nullish(),
    title: z.string().nullish(),
    // Same semantics as FigureBlock.placement (left reference vs right answer column).
    placement: z.enum(['reading', 'exercise']).nullish(),
    headers: z.array(z.string()).default([]),
    rows: z.array(z.array(z.string())).default([]),
    // Gap 2(a): vmerged section-label COLUMN (G7-L30 表一 `異同`, G7-L2 story_structure).
    // `sectionLabelCol` is that column's header; `rowSections` gives each `rows` entry its
    // section membership (order-aligned to `rows`; consecutive equals = one vmerge span).
    // Coherence + rowspan-aware grid width are enforced in LessonSchema.superRefine (this
    // must stay a pure ZodObject for the BlockSchema discriminatedUnion).
    sectionLabelCol: z.string().nullish(),
    rowSections: z.array(z.string()).nullish(),
    grid: z.array(z.array(TableCell)).nullish(),
    notes: z.array(z.string()).default([]),
  })
  .strict();

// Gap 5: 雙欄對照『呈現』block (NOT an exercise, no answer).
const ParallelRow = z
  .object({
    left: z.string().min(1),
    right: z.string().min(1),
    note: z.string().nullish(),
  })
  .strict();

const ParallelPassageBlock = z
  .object({
    id: z.string().min(1),
    type: z.literal('parallel_passage'),
    leftLabel: z.string().min(1).default('白話'),
    rightLabel: z.string().min(1).default('文言'),
    title: z.string().nullish(),
    rows: z.array(ParallelRow).min(1),
    notes: z.array(z.string()).default([]),
  })
  .strict();

/** Machine-comparable answer. Shape depends on answerSpace (see backend docstring). */
const AnswerValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.any()),
  z.record(z.string(), z.any()),
  z.null(),
]);

const SPACE_TO_GRADERS: Record<AnswerSpace, Grader[]> = {
  choice: ['exact', 'manual'],
  multi_choice: ['set', 'manual'],
  text: ['exact', 'set', 'rubric_ai', 'manual'],
  order: ['ordered', 'manual'],
  free_text: ['rubric_ai', 'manual'],
};

function answerMissing(a: unknown): boolean {
  if (a == null) return true;
  if (typeof a === 'string' || Array.isArray(a)) return a.length === 0;
  if (typeof a === 'object') return Object.keys(a as object).length === 0;
  return false;
}

/**
 * Base exercise object (a plain ZodObject so it can be a discriminated-union member —
 * zod v3 requires union members expose the discriminator directly, which `.refine()`
 * wrapping hides). The answer-invariant refinements are applied by
 * {@link enforceExerciseInvariant} at the Lesson level (mirrors the pydantic
 * ExerciseBlock model_validator, which also runs after the whole object is built).
 */
export const ExerciseBlock = z
  .object({
    id: z.string().min(1),
    type: z.literal('exercise'),
    question: QuestionSchema,
    answerSpace: AnswerSpace,
    answer: AnswerValue,
    grader: Grader,
    anchors: z.array(AnchorSchema).default([]),
    needsReview: z.boolean().default(false),
  })
  .strict();
export type ExerciseBlockT = z.infer<typeof ExerciseBlock>;

/** Returns an error message if the exercise violates the answer invariant, else null. */
export function exerciseInvariantError(e: ExerciseBlockT): string | null {
  if (e.question.kind === 'custom' && e.needsReview !== true) {
    return 'custom exercise must set needsReview: true';
  }
  if (answerMissing(e.answer) && e.needsReview !== true) {
    return 'exercise has no machine-comparable answer; provide `answer` or set needsReview: true';
  }
  if (!SPACE_TO_GRADERS[e.answerSpace].includes(e.grader)) {
    return `grader '${e.grader}' is not valid for answerSpace '${e.answerSpace}'`;
  }
  return null;
}

export const BlockSchema = z.discriminatedUnion('type', [
  ParagraphBlock,
  FigureBlock,
  TableBlock,
  ParallelPassageBlock,
  ExerciseBlock,
]);
export type Block = z.infer<typeof BlockSchema>;

// ─── Lesson root ──────────────────────────────────────────────────────────────

export const LessonSchema = z
  .object({
    id: z.string().min(1),
    lessonCode: z.string().min(1),
    title: z.string().nullish(),
    blocks: z.array(BlockSchema).min(1),
  })
  .strict()
  .superRefine((lesson, ctx) => {
    const ids = lesson.blocks.map((b) => b.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate block ids: ${[...new Set(dupes)].join(', ')}`,
      });
    }
    const anchorable = new Set(
      lesson.blocks
        .filter((b) =>
          ['paragraph', 'figure', 'table', 'parallel_passage'].includes(b.type),
        )
        .map((b) => b.id),
    );
    for (const b of lesson.blocks) {
      if (b.type === 'table') {
        // Gap 2(a): vmerged section-label column coherence (mirrors pydantic _check_grid).
        if (b.rowSections != null) {
          if (b.sectionLabelCol == null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `table '${b.id}' has rowSections but no sectionLabelCol`,
            });
          }
          if (b.rows.length > 0 && b.rowSections.length !== b.rows.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `table '${b.id}' rowSections length ${b.rowSections.length} != rows length ${b.rows.length}`,
            });
          }
        }
        // Gap 2(a): merged-cell grid width, ROWSPAN-AWARE (mirrors pydantic _check_grid).
        // A cell with rowspan=k occupies its column(s) for k rows, so spanned rows carry
        // fewer physical cells — exactly how a vmerged section column emits. Track, per
        // column, how many more rows a vmerge from above still occupies it.
        if (b.grid != null && b.headers.length > 0) {
          // The vmerged section-label column (when present) is an EXTRA leftmost grid
          // column on top of the `headers` data columns, so the physical grid is one
          // column wider than `headers`.
          const ncols = b.headers.length + (b.sectionLabelCol ? 1 : 0);
          let carried = new Array<number>(ncols).fill(0);
          b.grid.forEach((row, ri) => {
            const occupied = carried.filter((c) => c > 0).length;
            const supplied = row.reduce((sum, c) => sum + c.colspan, 0);
            if (supplied !== ncols - occupied) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `table '${b.id}' grid row ${ri} width ${supplied} != expected ${ncols - occupied} (headers ${ncols}, ${occupied} column(s) still spanned from above)`,
              });
            }
            carried = carried.map((c) => Math.max(0, c - 1));
            let col = 0;
            for (const cell of row) {
              while (col < ncols && carried[col] > 0) col += 1;
              if (cell.rowspan > 1) {
                for (let k = 0; k < cell.colspan; k += 1) {
                  if (col + k < ncols) carried[col + k] = cell.rowspan - 1;
                }
              }
              col += cell.colspan;
            }
          });
        }
      }
      if (b.type !== 'exercise') continue;
      // answer invariant (mirrors pydantic ExerciseBlock model_validator)
      const invErr = exerciseInvariantError(b);
      if (invErr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `exercise '${b.id}': ${invErr}`,
          path: ['blocks'],
        });
      }
      // Gap 3: fill_in_blank slot checks (moved off the pure-object member).
      if (b.question.kind === 'fill_in_blank' && b.question.slots != null) {
        const slots = b.question.slots;
        const slotIds = slots.map((s) => s.id);
        if (new Set(slotIds).size !== slotIds.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `exercise '${b.id}': fill_in_blank slot ids must be unique`,
          });
        }
        for (const s of slots) {
          if (s.grader === 'set' && !Array.isArray(s.answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `exercise '${b.id}': set slot answer must be an array`,
            });
          }
        }
      }
      // Gap 2(b): keypoints_table blank-id uniqueness + row reference checks.
      if (b.question.kind === 'keypoints_table') {
        const blankIds = b.question.blanks.map((bl) => bl.id);
        if (new Set(blankIds).size !== blankIds.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `exercise '${b.id}': keypoints_table blank ids must be unique`,
          });
        }
        const known = new Set(blankIds);
        for (const row of b.question.rows) {
          for (const bid of row.blankIds ?? []) {
            if (!known.has(bid)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `exercise '${b.id}': keypoints_table row references unknown blank id '${bid}'`,
              });
            }
          }
        }
      }
      for (const a of b.anchors ?? []) {
        if (!anchorable.has(a.blockId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `exercise '${b.id}' anchors unknown block '${a.blockId}'`,
          });
        }
      }
    }
  });
export type Lesson = z.infer<typeof LessonSchema>;
