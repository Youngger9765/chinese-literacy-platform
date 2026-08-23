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
import { resolveActiveSteps, DEFAULT_STEP_SEQUENCE, STEP_REGISTRY } from '../stepConfig';

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


// ---------------------------------------------------------------------------
// 這一組是被踩出來的：第一版只比 `s.id`，而兩個呼叫端傳的都是 AppView
// ---------------------------------------------------------------------------

describe('#2905 呼叫端傳的是 AppView，不是 step id', () => {
  it('finds the step when given an AppView, the way both call sites do', () => {
    // AppShell 與 StepFooterNav 都是 stepNeighbours(activeSteps, currentView)。
    // 第一版只比 s.id，於是每一次查找都落空 —— 本來好好的課（20013）兩顆箭頭
    // 一起變 disabled、底部整條消失。**五條單元測試全綠**，因為它們餵的是 id：
    // 測到了 helper，沒測到它實際被呼叫的方式。
    const steps = resolveActiveSteps(null);
    const spotlight = STEP_REGISTRY['spotlight'];
    const byView = stepNeighbours(steps, String(spotlight.view));
    const byId = stepNeighbours(steps, 'spotlight');
    expect(byView.index).toBe(byId.index);
    expect(byView.current?.id).toBe('spotlight');
    expect(byView.prev?.id).toBe(byId.prev?.id);
    expect(byView.next?.id).toBe(byId.next?.id);
  });

  it('falls back to neighbours for an off-sequence step given as an AppView', () => {
    const steps = resolveActiveSteps(WITHOUT_SPOTLIGHT);
    const n = stepNeighbours(steps, String(STEP_REGISTRY['spotlight'].view));
    expect(n.inSequence).toBe(false);
    expect(n.current).toBeNull();
    expect(n.prev, 'no way back when addressed by view').not.toBeNull();
    expect(n.next, 'no way forward when addressed by view').not.toBeNull();
  });

  it('every enabled step is reachable by its own view', () => {
    // 數量斷言，不是抽一個試 —— 只對一個 step 成立的比對，換一個 step 就可能又壞。
    const steps = resolveActiveSteps(null);
    const missed = steps.filter((s) => stepNeighbours(steps, String(s.view)).current?.id !== s.id);
    expect(missed.map((s) => s.id)).toEqual([]);
    expect(steps.length).toBeGreaterThan(8);
  });
});
