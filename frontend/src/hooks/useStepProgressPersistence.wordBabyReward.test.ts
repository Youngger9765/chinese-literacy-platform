/**
 * TDD tests for useStepProgressPersistence's #3780 接島上 word-baby reward
 * forwarding to the island.
 *
 * useProgressSync is mocked (same pattern as useStepProgressPersistence
 * .badgeUnlock.test.ts) — this test's job is to verify
 * useStepProgressPersistence WIRES the onWordBabyRewarded option it passes
 * to useProgressSync into a call to notifyIslandWordBabyReward, GATED on
 * isIslandStoryMode() — not to re-test useProgressSync's own network logic
 * (that lives in useProgressSync.wordBabyRewards.test.ts) nor storyMode's
 * own postMessage plumbing (that lives in storyMode.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type WordBabyReward = {
  id: number;
  station: string;
  fragment_awarded: boolean;
  fragment_flavor: string | null;
  encounter_result: 'none' | 'caught' | 'duplicate';
  encounter_baby_id: string | null;
};

let capturedOnWordBabyRewarded: ((rewards: WordBabyReward[]) => void) | undefined;

vi.mock('./useProgressSync', () => ({
  useProgressSync: (opts: { onWordBabyRewarded?: (rewards: WordBabyReward[]) => void }) => {
    capturedOnWordBabyRewarded = opts.onWordBabyRewarded;
    return {
      syncProgress: vi.fn(),
      flushProgress: vi.fn(),
      isProgressLoading: false,
    };
  },
}));

const storyMode = { on: false };
const notify = vi.fn();

// #3794 二次訂正：保留 `readSeenRewardIds`／`markRewardIdsSeen` 的真正實作
// （見 useStepProgressPersistence.wordBabyRewardToast.test.ts 同樣的說明）
// ——這支的職責只是驗證「有沒有轉發給島嶼」的接線，不是排重邏輯本身，
// 但完全 mock 掉這兩個函式會讓新加的排重檢查呼叫到 `undefined` 而炸掉。
vi.mock('../pages/lab/island/storyMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/lab/island/storyMode')>();
  return {
    ...actual,
    isIslandStoryMode: () => storyMode.on,
    notifyIslandWordBabyReward: (rewards: WordBabyReward[]) => notify(rewards),
  };
});

import { useStepProgressPersistence } from './useStepProgressPersistence';

function setup() {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '99',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory: null,
      isAssignmentFlow: false,
      setSession,
    }),
  );
  return { result };
}

const sampleReward: WordBabyReward = {
  id: 1,
  station: 'vocab-definition',
  fragment_awarded: true,
  fragment_flavor: '語文基礎',
  encounter_result: 'none',
  encounter_baby_id: null,
};

describe('useStepProgressPersistence — word-baby reward forwarding (#3780 接島上)', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedOnWordBabyRewarded = undefined;
    notify.mockReset();
    storyMode.on = false;
  });

  it('passes onWordBabyRewarded to useProgressSync', () => {
    setup();
    expect(capturedOnWordBabyRewarded, 'useStepProgressPersistence must pass onWordBabyRewarded to useProgressSync').toBeTypeOf('function');
  });

  it('forwards rewards to the island when in island story mode', () => {
    storyMode.on = true;
    setup();

    act(() => {
      capturedOnWordBabyRewarded!([sampleReward]);
    });

    expect(notify).toHaveBeenCalledWith([sampleReward]);
  });

  it('does NOT forward to the island when NOT in island story mode (regular /learn flow has no listener)', () => {
    storyMode.on = false;
    setup();

    act(() => {
      capturedOnWordBabyRewarded!([sampleReward]);
    });

    expect(notify).not.toHaveBeenCalled();
  });
});
