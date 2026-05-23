/**
 * learningStepTransitions.ts — table-driven step-transition map (Issue #1878)
 *
 * Extracted from LearningLayout.tsx so the finish-handler logic lives in one
 * place and can be unit-tested without mounting a React component.
 *
 * Each entry describes what happens when a step is finished:
 *   completeStep  — the step ID being completed (added to steps_completed)
 *   nextStep      — the step to navigate to next (default sequence)
 *   stepDataKey   — key used in persistStepProgressState stepDataPatch
 *
 * NOTE: nextStep is the *default* sequence next step.  When a lesson has a
 * custom step_sequence, callers should use getNextEnabledStep() instead, which
 * respects the active ordered list.
 */

export interface StepTransition {
  /** The step ID being completed (added to steps_completed). */
  completeStep: string;
  /** Default next step to navigate to (used when no active sequence available). */
  nextStep: string;
  /** Key in persistStepProgressState's stepDataPatch. */
  stepDataKey: string;
}

/**
 * Table-driven map from step ID → transition descriptor.
 *
 * Mirrors the hard-coded transitions previously scattered across 13 individual
 * handleFinish* callbacks in LearningLayout.tsx.
 */
export const STEP_TRANSITIONS: Record<string, StepTransition> = {
  'tutor': {
    completeStep: 'tutor',
    nextStep: 'full-reading',
    stepDataKey: 'tutor',
  },
  'comprehension': {
    completeStep: 'comprehension',
    nextStep: 'vocab-word-search',
    stepDataKey: 'comprehension',
  },
  'vocab': {
    completeStep: 'vocab',
    nextStep: 'vocab-definition',
    stepDataKey: 'vocab',
  },
  'full-reading': {
    completeStep: 'full-reading',
    nextStep: 'listening',
    stepDataKey: 'full-reading',
  },
  'listening': {
    completeStep: 'listening',
    nextStep: 'vocab',
    stepDataKey: 'listening',
  },
  'reading-annotation': {
    completeStep: 'reading-annotation',
    nextStep: 'tutor',
    stepDataKey: 'reading-annotation',
  },
  'vocab-definition': {
    completeStep: 'vocab-definition',
    nextStep: 'vocab-application',
    stepDataKey: 'vocab-definition',
  },
  'vocab-application': {
    completeStep: 'vocab-application',
    nextStep: 'story-structure',
    stepDataKey: 'vocab-application',
  },
  'story-structure': {
    completeStep: 'story-structure',
    nextStep: 'reading-strategy',
    stepDataKey: 'story-structure',
  },
  'reading-strategy': {
    completeStep: 'reading-strategy',
    nextStep: 'comprehension',
    stepDataKey: 'reading-strategy',
  },
  'sentence-practice': {
    completeStep: 'sentence-practice',
    nextStep: 'vocab-definition',
    stepDataKey: 'sentence-practice',
  },
  'vocab-word-search': {
    completeStep: 'vocab-word-search',
    nextStep: 'knowledge-station',
    stepDataKey: 'vocab-word-search',
  },
  'knowledge-station': {
    completeStep: 'knowledge-station',
    nextStep: 'report',
    stepDataKey: 'knowledge-station',
  },
};

/**
 * Given an ordered list of active step IDs (from resolveActiveSteps filtered to
 * enabled steps), return the next step that follows `stepId`.
 *
 * - If `stepId` is found in the list and is not the last entry, returns the
 *   immediately following step ID.
 * - Otherwise falls back to STEP_TRANSITIONS[stepId].nextStep (default sequence).
 * - Ultimate fallback: 'report'.
 *
 * Use this instead of STEP_TRANSITIONS[stepId].nextStep when a lesson may have
 * a custom step_sequence that differs from the default.
 */
export function getNextEnabledStep(stepId: string, activeStepIds: string[]): string {
  const idx = activeStepIds.indexOf(stepId);
  if (idx >= 0 && idx < activeStepIds.length - 1) {
    return activeStepIds[idx + 1];
  }
  return STEP_TRANSITIONS[stepId]?.nextStep ?? 'report';
}
