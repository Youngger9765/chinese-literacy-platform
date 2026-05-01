/**
 * useStepSequence — resolve the active step list for the current lesson.
 *
 * Returns the ordered, enabled StepConfig[] for rendering StepperNav and
 * computing next/prev navigation.
 *
 * Resolution order (#1374 schema-driven step composition):
 *   1. lesson.stepSequence (per-lesson YAML field)  — if present and non-empty
 *   2. DEFAULT_STEP_SEQUENCE                         — fallback for legacy lessons
 *
 * In both cases, steps with `enabled: false` in STEP_REGISTRY are excluded.
 */

import { useMemo } from 'react';
import type { Story } from '../types';
import { resolveActiveSteps } from '../config/stepConfig';
import type { StepConfig } from '../config/stepConfig';

/**
 * Returns the effective active steps for the given lesson.
 *
 * @param lesson - The currently loaded story/lesson (may be null while loading).
 * @returns Ordered array of enabled StepConfig objects for StepperNav rendering.
 */
export function useStepSequence(lesson: Story | null): StepConfig[] {
  return useMemo(
    () => resolveActiveSteps(lesson?.stepSequence),
    [lesson?.stepSequence],
  );
}
