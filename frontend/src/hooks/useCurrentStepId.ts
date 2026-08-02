import { useLocation } from 'react-router-dom';
import { STEP_REGISTRY } from '../config/stepConfig';

/**
 * Derive the learning step id from the current route instead of hardcoding it
 * in the page component (#2588).
 *
 * Learning routes are generated from STEP_REGISTRY by buildLearningRoutes():
 * `/learn/:storyId/<stepId>`, so the last path segment *is* the step id.  A page
 * that hardcodes its own id silently drifts when the step is renamed or mounted
 * on a second route — progress would be written under one key and read/completed
 * under another, which breaks assignment submission with no visible error.
 *
 * Fail-safe: the segment is only accepted when it is a registered step.  Anything
 * else (unknown segment, non-learning route, trailing slash) falls back to the
 * canonical id the caller passes in, so we never persist an unknown step key.
 *
 * ⚠️ Step ids are also persisted to the backend, which maps them to step numbers
 * via `_FRONTEND_STEP_ALIAS` / `STEP_NAMES` in `backend/app/models/session.py`.
 * Renaming a step id requires updating that map too.
 */
export function useCurrentStepId(fallbackStepId: string): string {
  const { pathname } = useLocation();

  const segment = pathname.split('/').filter(Boolean).pop() ?? '';

  return STEP_REGISTRY[segment] ? segment : fallbackStepId;
}

export default useCurrentStepId;
