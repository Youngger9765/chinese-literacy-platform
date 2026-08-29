/**
 * lessonAwareStepTransition.ts — per-lesson-aware "what comes next" (#2752).
 *
 * WHY THIS EXISTS
 * ----------------
 * `STEP_FINISH_TRANSITIONS` (stepNavigationTransitions.ts) is a single GLOBAL
 * table keyed by step id. That works as long as every lesson walks the same
 * `DEFAULT_STEP_SEQUENCE` — but a 文言文 lesson gets its own `step_sequence`
 * (backend `lesson_indexes.py::CLASSICAL_STEP_SEQUENCE`) where the SAME step id
 * can need a DIFFERENT next step. `key-passage-reading` is the concrete case:
 * a 白話 lesson goes on to `listening`; a 文言文 lesson has no `listening` data
 * at all and must go on to `classical-sentence-matching` instead. A table keyed
 * only by step id cannot represent that branch.
 *
 * `resolveActiveSteps()` already resolves the correct per-lesson list (it is
 * what StepperNav and StepFooterNav use to render prev/next) — this file reuses
 * that SAME resolution for the auto-advance-on-finish path, instead of letting
 * two different parts of the app disagree about what "next" means.
 *
 * SAFE FOR EXISTING LESSONS: when a lesson carries no `step_sequence` (every
 * lesson except the 10 文言文 ones, as of #2752), this returns `defaultNextStep`
 * unchanged — the static table's behavior is untouched.
 */

import { resolveActiveSteps } from '../config/stepConfig';

/**
 * The step id that follows `stepId` in THIS lesson's resolved sequence, or
 * `defaultNextStep` when the lesson has no custom `step_sequence` to consult.
 *
 * Returns 'report' when `stepId` is the sequence's last step, or when `stepId`
 * is not in the resolved sequence at all (defensive — should not happen for a
 * step the student is actually on).
 */
export function lessonAwareNextStep(
  stepId: string,
  lessonStepSequence: string[] | null | undefined,
  defaultNextStep: string,
): string {
  if (!lessonStepSequence || lessonStepSequence.length === 0) return defaultNextStep;
  const activeSteps = resolveActiveSteps(lessonStepSequence);
  const idx = activeSteps.findIndex((s) => s.id === stepId);
  if (idx === -1 || idx === activeSteps.length - 1) return 'report';
  return activeSteps[idx + 1].id;
}
