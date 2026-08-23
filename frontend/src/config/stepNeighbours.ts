/**
 * Where a step sits relative to this lesson's sequence, and what is on either
 * side of it.
 *
 * ## Why this exists (#2905)
 *
 * `AppShell` and `StepFooterNav` each computed the same three things from
 *
 *     currentStepIndex = activeSteps.findIndex(s => s.view === currentView)
 *
 * and each treated `-1` as "nowhere". That is wrong for a step the lesson does
 * not have. Lesson 20011 has no 聚光燈, so opening `/learn/20011/spotlight` gave
 * a page with no active pill, both chevrons disabled, no step name in the top
 * bar, and no bottom bar in the DOM at all — while the same URL on 20013 was
 * fine. The student was not fully stuck (the page renders its own
 * 「跳過，下一關」) but every other way forward or back was gone.
 *
 * A step that is off the sequence still has a definite place in the canonical
 * order, so its neighbours are computable: walk `DEFAULT_STEP_SEQUENCE` outward
 * from where it would have sat and take the first step this lesson actually has.
 *
 * `current` stays null in that case, deliberately — the stepper should not light
 * up a pill for a step this lesson does not contain. Only the navigation is
 * restored, not the pretence of membership.
 */
import { DEFAULT_STEP_SEQUENCE, STEP_REGISTRY, resolveStepId, type StepConfig } from './stepConfig';

export interface StepNeighbours {
  /** Index in `activeSteps`, or -1 when this lesson does not have the step. */
  index: number;
  /** The step itself — null when this lesson does not have it. */
  current: StepConfig | null;
  prev: StepConfig | null;
  next: StepConfig | null;
  inSequence: boolean;
}

const NONE: StepNeighbours = { index: -1, current: null, prev: null, next: null, inSequence: false };

/**
 * `key` may be a step id (`'spotlight'`, or a legacy alias) **or** an `AppView`.
 *
 * Both call sites hand it an AppView — that is what the code this replaced
 * matched on (`s.view === currentView`). The first version of this helper only
 * compared `s.id`, so every lookup missed and both chevrons went dead on lessons
 * that had previously been fine. The unit tests passed throughout, because they
 * passed step ids: they exercised the helper, not the way it is actually called.
 */
export function stepNeighbours(activeSteps: StepConfig[], key: string): StepNeighbours {
  const id = resolveStepId(key);

  const matches = (s: StepConfig) => s.id === id || String(s.view) === String(key);
  const index = activeSteps.findIndex(matches);
  if (index >= 0) {
    return {
      index,
      current: activeSteps[index],
      prev: index > 0 ? activeSteps[index - 1] : null,
      next: index < activeSteps.length - 1 ? activeSteps[index + 1] : null,
      inSequence: true,
    };
  }

  // Not one of this lesson's steps. Only fall back for something that is a real
  // step — an unknown id gets nothing rather than a guess, or a typo in a URL
  // would silently navigate somewhere plausible.
  // Off-sequence: resolve to a canonical id first, accepting an AppView too.
  const canonicalId = STEP_REGISTRY[id]
    ? id
    : Object.values(STEP_REGISTRY).find((s) => String(s.view) === String(key))?.id;
  if (!canonicalId) return NONE;
  const canonical = DEFAULT_STEP_SEQUENCE.indexOf(canonicalId);
  if (canonical < 0) return NONE;

  const has = (candidate: string) => activeSteps.find((s) => s.id === candidate) ?? null;
  let prev: StepConfig | null = null;
  for (let i = canonical - 1; i >= 0 && !prev; i -= 1) prev = has(DEFAULT_STEP_SEQUENCE[i]);
  let next: StepConfig | null = null;
  for (let i = canonical + 1; i < DEFAULT_STEP_SEQUENCE.length && !next; i += 1) {
    next = has(DEFAULT_STEP_SEQUENCE[i]);
  }
  return { index: -1, current: null, prev, next, inSequence: false };
}
