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
