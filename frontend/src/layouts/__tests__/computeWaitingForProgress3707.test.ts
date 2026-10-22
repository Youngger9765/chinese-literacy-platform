/**
 * TDD regression lock for Issue #3707 (+critic-review finding on a sibling
 * race path) — direct test of `computeWaitingForProgress`, the exact
 * boolean LearningLayout uses to decide whether a step page's Outlet may
 * render yet.
 *
 * This is a "pure-logic test on the data structures" in the same style as
 * `learningLayout.test.ts`'s `computeIsReady` — it imports and calls the
 * REAL exported function (not a re-derivation of its formula), so reverting
 * LearningLayout.tsx's fix makes this file fail, not just encode the same
 * bug twice.
 *
 * Why a second test file in addition to
 * useLearningSessionBootstrap.hasCheckedStoredSession.test.ts: that file
 * only proves the HOOK correctly resolves and exposes
 * hasCheckedStoredSession. A critic review mutation-tested it directly —
 * reverting LearningLayout.tsx's waitingForProgress formula back to
 * `dbSessionId !== null && isProgressLoading` left that test fully GREEN,
 * because it never touches the gate formula at all. This file is the one
 * that actually goes red for that mutation (see case 1 below).
 */
import { describe, it, expect } from 'vitest';
import { computeWaitingForProgress } from '../LearningLayout';

describe('computeWaitingForProgress (#3707)', () => {
  it('case 1 — the original bug: unchecked sessionStorage must not look like "no session"', () => {
    // This is the exact state on the very first render after reopening a
    // lesson: dbSessionId is still its useState default of null because the
    // sessionStorage restore-lookup effect hasn't run yet. The OLD formula
    // (`dbSessionId !== null && isProgressLoading`) evaluates to
    // `false && false = false` here — "not waiting" — which is the #3707 bug.
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: false,
        dbSessionId: null,
        isProgressLoading: false,
        hasCheckedForOrphanedSession: false,
        isToolboxFlow: false,
      }),
    ).toBe(true);
  });

  it('case 2 — sibling race: storage checked and empty, but the orphaned-session lookup has not settled yet', () => {
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: true,
        dbSessionId: null,
        isProgressLoading: false,
        hasCheckedForOrphanedSession: false,
        isToolboxFlow: false,
      }),
    ).toBe(true);
  });

  it('case 3 — toolbox mode never attempts the orphaned-session lookup — must not spin forever', () => {
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: true,
        dbSessionId: null,
        isProgressLoading: false,
        hasCheckedForOrphanedSession: false,
        isToolboxFlow: true,
      }),
    ).toBe(false);
  });

  it('case 4 — settled with genuinely no session (orphaned-session lookup found/created nothing)', () => {
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: true,
        dbSessionId: null,
        isProgressLoading: false,
        hasCheckedForOrphanedSession: true,
        isToolboxFlow: false,
      }),
    ).toBe(false);
  });

  it('case 5 — a session exists but its progress is still loading (#1549, the original gate) → must wait', () => {
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: true,
        dbSessionId: 123,
        isProgressLoading: true,
        hasCheckedForOrphanedSession: true,
        isToolboxFlow: false,
      }),
    ).toBe(true);
  });

  it('case 6 — fully settled: session exists and its progress has loaded → safe to render', () => {
    expect(
      computeWaitingForProgress({
        hasCheckedStoredSession: true,
        dbSessionId: 123,
        isProgressLoading: false,
        hasCheckedForOrphanedSession: true,
        isToolboxFlow: false,
      }),
    ).toBe(false);
  });
});
