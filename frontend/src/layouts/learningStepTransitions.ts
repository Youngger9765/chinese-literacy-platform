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
  'paragraph-reading': {
    completeStep: 'paragraph-reading',
    nextStep: 'key-passage-reading',
    stepDataKey: 'paragraph-reading',
  },
  'comprehension': {
    completeStep: 'comprehension',
    nextStep: 'vocab-review',
    stepDataKey: 'comprehension',
  },
  'character-practice': {
    completeStep: 'character-practice',
    nextStep: 'vocab-definition',
    stepDataKey: 'character-practice',
  },
  'key-passage-reading': {
    completeStep: 'key-passage-reading',
    nextStep: 'listening',
    stepDataKey: 'key-passage-reading',
  },
  'listening': {
    completeStep: 'listening',
    nextStep: 'character-practice',
    stepDataKey: 'listening',
  },
  'full-text-annotate': {
    completeStep: 'full-text-annotate',
    nextStep: 'paragraph-reading',
    stepDataKey: 'full-text-annotate',
  },
  'vocab-definition': {
    completeStep: 'vocab-definition',
    nextStep: 'vocab-application',
    stepDataKey: 'vocab-definition',
  },
  'vocab-application': {
    completeStep: 'vocab-application',
    nextStep: 'keypoints-table',
    stepDataKey: 'vocab-application',
  },
  'keypoints-table': {
    completeStep: 'keypoints-table',
    nextStep: 'spotlight',
    stepDataKey: 'keypoints-table',
  },
  'spotlight': {
    completeStep: 'spotlight',
    nextStep: 'comprehension',
    stepDataKey: 'spotlight',
  },
  'sentence-practice': {
    completeStep: 'sentence-practice',
    nextStep: 'vocab-definition',
    stepDataKey: 'sentence-practice',
  },
  'vocab-review': {
    completeStep: 'vocab-review',
    nextStep: 'knowledge-station',
    stepDataKey: 'vocab-review',
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
