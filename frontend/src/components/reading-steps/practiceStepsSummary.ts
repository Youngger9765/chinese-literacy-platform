/**
 * practiceStepsSummary.ts (#2835)
 *
 * Pure-logic module for AssessmentReport's "練習關卡總覽" section.
 *
 * Before this issue, 讀全文-做記號 / 詞語理解 / 語詞應用 / 文章重點表 /
 * 閱讀聚光燈 / 語詞複習 / 知識補給站 (and, for 文言文 lessons, 文白句子比對 /
 * 文白詞語比對 / 自我挑戰) had ZERO representation anywhere in the diagnostic
 * report, even though every one of them is already persisted server-side
 * (session.completedSteps / step_progress.steps_completed + step_progress.step_data).
 * This module reads that EXISTING data — it does not change what gets
 * written, only what gets displayed.
 *
 * NOTHING in this file has side effects — no localStorage, no fetch, no state.
 */

/**
 * Ordered list of practice-step ids this section covers, in display order.
 *
 * Deliberately excludes:
 *   - lesson-intro / report — not exercises, nothing to score
 *   - key-passage-reading / paragraph-reading / classical-text — reading
 *     passages, already covered by sections 1-5 (or, for classical-text, not
 *     a graded exercise)
 *   - comprehension — already covered by section 6 (see AssessmentComprehensionSection)
 *   - sentence-practice / listening / character-practice / dictation — disabled
 *     steps in the live flow (see stepConfig.ts), not reachable by students
 *
 * classical-sentence-matching / classical-word-matching / classical-self-challenge
 * (#2752, 文言文-only, reached via a lesson's own custom step_sequence — never
 * in DEFAULT_STEP_SEQUENCE) ARE included: they are graded practice exercises
 * analogous to vocab-definition, and omitting them reproduces this issue's
 * exact bug for classical lessons (code review follow-up on #2835).
 */
export const PRACTICE_STEP_IDS: string[] = [
  'full-text-annotate',
  'vocab-definition',
  'vocab-application',
  'keypoints-table',
  'spotlight',
  'vocab-review',
  'knowledge-station',
  'classical-sentence-matching',
  'classical-word-matching',
  'classical-self-challenge',
];

/** Chinese display label for each covered step id (mirrors stepConfig.ts STEP_REGISTRY labels). */
const STEP_LABELS: Record<string, string> = {
  'full-text-annotate': '讀全文-做記號',
  'vocab-definition': '詞語理解',
  'vocab-application': '語詞應用',
  'keypoints-table': '文章重點表',
  'spotlight': '閱讀聚光燈',
  'vocab-review': '語詞複習',
  'knowledge-station': '知識補給站',
  'classical-sentence-matching': '文白句子比對',
  'classical-word-matching': '文白詞語比對',
  'classical-self-challenge': '自我挑戰',
};

export interface PracticeStepSummaryItem {
  stepId: string;
  label: string;
  completed: boolean;
  /** Human-readable score string (e.g. "答對 7/8 題"), or null when this step has no numeric score concept. */
  scoreLabel: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scoreLabelFor(stepId: string, entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;

  if (stepId === 'vocab-definition') {
    const result = entry.result;
    if (isPlainObject(result) && typeof result.matchedCount === 'number' && typeof result.totalCount === 'number') {
      return `答對 ${result.matchedCount}/${result.totalCount} 題`;
    }
    return null;
  }

  if (stepId === 'vocab-application') {
    if (typeof entry.score === 'number' && typeof entry.total === 'number') {
      return `答對 ${entry.score}/${entry.total} 題`;
    }
    return null;
  }

  if (stepId === 'keypoints-table') {
    // #2833 wired real answers/gradeResult into step_data['keypoints-table']
    // (POST /api/stories/{id}/structure/grade). gradeResult.score alone isn't
    // trustworthy as a count source — a network-failure sentinel sets it to
    // -1 with an empty results array — so derive from results.length /
    // .correct instead, and simply show nothing until the student has
    // actually submitted (no gradeResult yet, or the sentinel).
    const gradeResult = entry.gradeResult;
    if (isPlainObject(gradeResult) && Array.isArray(gradeResult.results) && gradeResult.results.length > 0) {
      const total = gradeResult.results.length;
      const correctCount = gradeResult.results.filter(
        (r) => isPlainObject(r) && r.correct === true,
      ).length;
      return `答對 ${correctCount}/${total} 題`;
    }
    return null;
  }

  // spotlight / vocab-review / knowledge-station / full-text-annotate /
  // classical-sentence-matching / classical-word-matching / classical-self-challenge:
  // no established numeric score concept persisted yet — completion status only.
  return null;
}

/**
 * Build the practice-steps summary for AssessmentReport's new section.
 *
 * @param activeStepIds  The lesson's active step ids in flow order (from
 *                        resolveActiveSteps(story?.stepSequence).map(s => s.id))
 *                        — same source StepperNav uses, so a step only shows
 *                        up here if the student could actually reach it.
 * @param completedSteps The persisted completed-step id list (session.completedSteps
 *                        / step_progress.steps_completed) — same source StepperNav
 *                        reads its checkmarks from.
 * @param stepData        The persisted step_progress.step_data JSONB bag, keyed by step id.
 */
export function computePracticeStepsSummary(
  activeStepIds: string[] | undefined | null,
  completedSteps: string[] | undefined | null,
  stepData: Record<string, unknown> | undefined | null,
): PracticeStepSummaryItem[] {
  const activeSet = new Set(activeStepIds ?? []);
  const completedSet = new Set(completedSteps ?? []);
  const data = stepData ?? {};

  return PRACTICE_STEP_IDS.filter((id) => activeSet.has(id)).map((id) => {
    const completed = completedSet.has(id);
    return {
      stepId: id,
      label: STEP_LABELS[id] ?? id,
      completed,
      scoreLabel: completed ? scoreLabelFor(id, data[id]) : null,
    };
  });
}
