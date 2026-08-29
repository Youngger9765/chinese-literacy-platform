/**
 * stepNavigationTransitions.ts — Step finish transition table for Issue #1954
 *
 * Extracted from useLearningStepNavigation.ts (was inline in 13 handleFinish*
 * callbacks).  Mirrors the same data as layouts/learningStepTransitions.ts but
 * lives next to the hook that consumes it, making the coupling explicit.
 *
 * Each entry describes what happens when a given step is completed:
 *   completeStep  — the step ID being completed (added to steps_completed)
 *   nextStep      — the step to navigate to next
 *   stepDataKey   — key used in persistStepProgressState's stepDataPatch
 */

export interface StepFinishTransition {
  /** The step ID being completed. */
  completeStep: string;
  /** The step to navigate to after completion. */
  nextStep: string;
  /** Key used as the field name in persistStepProgressState's stepDataPatch. */
  stepDataKey: string;
}

/**
 * Table-driven map: step ID → finish transition descriptor.
 *
 * Mirrors the hardcoded next-step logic previously scattered across 13
 * handleFinish* callbacks in useLearningStepNavigation.ts.
 */
export const STEP_FINISH_TRANSITIONS: Record<string, StepFinishTransition> = {
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
 * Return the default next step for a given step ID.
 *
 * Falls back to 'report' when the step ID is not in the table (e.g. custom
 * steps or the final report step itself).
 *
 * Pure function — no side effects, safe to call outside React context.
 */
export function getDefaultNextStep(stepId: string): string {
  return STEP_FINISH_TRANSITIONS[stepId]?.nextStep ?? 'report';
}
