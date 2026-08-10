/**
 * stepHandlerUtils.ts — Pure helper for step-finish payload construction (Issue #1954)
 *
 * Extracted from useLearningStepNavigation.ts.  All 13 handleFinish* callbacks
 * follow the same pattern:
 *
 *   1. Look up completeStep + nextStep + stepDataKey from STEP_FINISH_TRANSITIONS
 *   2. Build a PersistStepProgressOptions object with:
 *        completeStep  (the step being finished)
 *        currentStep   (the step we're going TO — same as nextStep)
 *        stepDataPatch ({ [stepDataKey]: stepData })
 *   3. Call persistStepProgressState(opts, true)
 *   4. Persist the db step number and navigate
 *
 * This helper encapsulates steps 1–2 as a pure function so it can be
 * unit-tested without mounting a React component.
 */

import { STEP_FINISH_TRANSITIONS, getDefaultNextStep } from './stepNavigationTransitions';

export interface StepFinishPayload {
  /** Step ID being completed — used in persistStepProgressState. */
  completeStep: string;
  /** Step to navigate to — also called `currentStep` in persistStepProgressState. */
  currentStep: string;
  /** Convenience alias for currentStep. */
  nextStep: string;
  /** Data patch to merge into step progress state. */
  stepDataPatch: Record<string, unknown>;
}

/**
 * Build the payload object used in persistStepProgressState calls.
 *
 * Pure function — no React dependency, fully testable in isolation.
 *
 * @param stepId   The step that just finished (e.g. 'full-text-annotate').
 * @param stepData Arbitrary data to store in the step's progress record.
 */
export function buildStepFinishPayload(
  stepId: string,
  stepData: Record<string, unknown>,
): StepFinishPayload {
  const transition = STEP_FINISH_TRANSITIONS[stepId];
  const nextStep = getDefaultNextStep(stepId);
  const stepDataKey = transition?.stepDataKey ?? stepId;

  return {
    completeStep: stepId,
    currentStep: nextStep,
    nextStep,
    stepDataPatch: { [stepDataKey]: stepData },
  };
}
