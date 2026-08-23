/**
 * #2905 — a step that is not in this lesson's sequence must still be navigable.
 *
 * Reproduced on staging: lesson 20011 has no 聚光燈, so `spotlight` is absent from
 * its active steps. Open `/learn/20011/spotlight` and the whole navigation chrome
 * gives up — no active pill in the stepper, both chevrons disabled, the top bar
 * shows no step name, and `StepFooterNav` returns null so the bottom bar is not
 * in the DOM at all. Same step on 20013 (which has 聚光燈) is fine.
 *
 * Cause: both AppShell and StepFooterNav compute
 *
 *     currentStepIndex = activeSteps.findIndex(s => s.view === currentView)
 *
 * which is -1 here, and every downstream expression treats -1 as "nowhere".
 * The student is not fully stuck — the page renders its own 「跳過，下一關」 —
 * but every other way forward or back is gone.
 *
 * A step that is off this lesson's sequence still has a definite place in the
 * canonical order, so its neighbours are computable.
 */
import { describe, it, expect } from 'vitest';

import { stepNeighbours } from '../stepNeighbours';
import { resolveActiveSteps, DEFAULT_STEP_SEQUENCE } from '../stepConfig';

const WITHOUT_SPOTLIGHT = DEFAULT_STEP_SEQUENCE.filter((id) => id !== 'spotlight');

describe('#2905 stepNeighbours', () => {
  it('behaves exactly as before for a step that IS in the sequence', () => {
    const steps = resolveActiveSteps(null);
    const i = steps.findIndex((s) => s.id === 'spotlight');
    expect(i).toBeGreaterThan(0);
    const n = stepNeighbours(steps, 'spotlight');
    expect(n.index).toBe(i);
    expect(n.current?.id).toBe('spotlight');
    expect(n.prev?.id).toBe(steps[i - 1].id);
    expect(n.next?.id).toBe(steps[i + 1].id);
    expect(n.inSequence).toBe(true);
  });

  it('still gives neighbours for a step this lesson does not have', () => {
    const steps = resolveActiveSteps(WITHOUT_SPOTLIGHT);
    expect(steps.some((s) => s.id === 'spotlight')).toBe(false);

    const n = stepNeighbours(steps, 'spotlight');
    expect(n.inSequence).toBe(false);
    expect(n.current).toBeNull();          // it really is not one of this lesson's steps
    expect(n.prev, 'no way back').not.toBeNull();
    expect(n.next, 'no way forward').not.toBeNull();

    // The neighbours are the ones that surround where spotlight would have sat.
    const canonical = DEFAULT_STEP_SEQUENCE.indexOf('spotlight');
    const before = DEFAULT_STEP_SEQUENCE.slice(0, canonical).reverse()
      .find((id) => steps.some((s) => s.id === id));
    const after = DEFAULT_STEP_SEQUENCE.slice(canonical + 1)
      .find((id) => steps.some((s) => s.id === id));
    expect(n.prev?.id).toBe(before);
    expect(n.next?.id).toBe(after);
  });

  it('accepts a legacy alias for the current step', () => {
    // `full-reading` is an alias of `key-passage-reading` (stepConfig.ts:462).
    // The URL a printed QR points at may still carry the old one.
    const steps = resolveActiveSteps(null);
    expect(stepNeighbours(steps, 'full-reading').current?.id).toBe('key-passage-reading');
  });

  it('returns nothing rather than guessing for an unknown step id', () => {
    // Positive control for the fallback: it must not invent neighbours for a
    // string that is not a step at all.
    const n = stepNeighbours(resolveActiveSteps(null), 'not-a-step');
    expect(n.current).toBeNull();
    expect(n.prev).toBeNull();
    expect(n.next).toBeNull();
    expect(n.inSequence).toBe(false);
  });

  it('has no next at the last step and no prev at the first', () => {
    const steps = resolveActiveSteps(null);
    expect(stepNeighbours(steps, steps[0].id).prev).toBeNull();
    expect(stepNeighbours(steps, steps[steps.length - 1].id).next).toBeNull();
  });
});
