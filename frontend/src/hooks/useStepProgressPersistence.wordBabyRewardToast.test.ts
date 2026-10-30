/**
 * TDD — PRD §5（docs/prd/2026-10-30-island-v2-rpg-pets-story-prd.md）
 * 「即時回饋：學習活動做完的當下，就在學習頁跳出碎片／寶貝提示，不必等
 * 回島」。
 *
 * 既有的 `onWordBabyRewarded` 只會（在 `isIslandStoryMode()` 為真時）
 * postMessage 通知島嶼頁——見 `useStepProgressPersistence.wordBabyReward
 * .test.ts` 的「regular /learn flow has no listener」那條，那是刻意的舊
 * 設計，不是這支要改的範圍。這支測的是**新增**的、不看 `isIslandStoryMode()`
 * 的本地 state，給學習頁自己（不管是不是嵌在島上）當場顯示用。
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
// #3794 二次訂正：只覆寫 `isIslandStoryMode`／`notifyIslandWordBabyReward`
// 這兩個跟「要不要轉發給島嶼」有關的部分——`readSeenRewardIds`／
// `markRewardIdsSeen` 保留真正的實作（sessionStorage 讀寫），這樣下面
// 「同一筆獎勵跨學習頁／島嶼頁只提示一次」的測試才是在測真正的排重邏輯，
// 不是在測一個被完全 mock 掉、永遠回傳空集合的假函式。
vi.mock('../pages/lab/island/storyMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/lab/island/storyMode')>();
  return {
    ...actual,
    isIslandStoryMode: () => storyMode.on,
    notifyIslandWordBabyReward: vi.fn(),
  };
});

import { useStepProgressPersistence } from './useStepProgressPersistence';
import { markRewardIdsSeen, readSeenRewardIds } from '../pages/lab/island/storyMode';

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

describe('useStepProgressPersistence — #5 即時回饋：學習頁本地獎勵 state（不靠 postMessage）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedOnWordBabyRewarded = undefined;
    storyMode.on = false;
  });

  it('初始是空陣列', () => {
    const { result } = setup();
    expect(result.current.midSessionWordBabyRewards).toEqual([]);
  });

  it('不管是不是嵌在島上（isIslandStoryMode=false），收到獎勵都會更新本地 state', () => {
    storyMode.on = false; // 刻意跟「不轉發給島嶼」的既有行為相反場景一起測，證明這條路徑獨立
    const { result } = setup();

    act(() => {
      capturedOnWordBabyRewarded!([sampleReward]);
    });

    expect(result.current.midSessionWordBabyRewards).toEqual([sampleReward]);
  });

  it('嵌在島上時（isIslandStoryMode=true）本地 state 一樣會更新——兩條路徑互不影響', () => {
    storyMode.on = true;
    const { result } = setup();

    act(() => {
      capturedOnWordBabyRewarded!([sampleReward]);
    });

    expect(result.current.midSessionWordBabyRewards).toEqual([sampleReward]);
  });

  it('連續兩次呼叫會累加，不是互相覆蓋', () => {
    const { result } = setup();
    const second: WordBabyReward = { ...sampleReward, id: 2, station: 'reading-comprehension' };

    act(() => { capturedOnWordBabyRewarded!([sampleReward]); });
    act(() => { capturedOnWordBabyRewarded!([second]); });

    expect(result.current.midSessionWordBabyRewards).toEqual([sampleReward, second]);
  });

  it('dismissMidSessionWordBabyRewards 清空 state', () => {
    const { result } = setup();
    act(() => { capturedOnWordBabyRewarded!([sampleReward]); });
    expect(result.current.midSessionWordBabyRewards).toHaveLength(1);

    act(() => { result.current.dismissMidSessionWordBabyRewards(); });
    expect(result.current.midSessionWordBabyRewards).toEqual([]);
  });
});

/**
 * #3794 二次訂正（code-reviewer 2026-10-30 finding，1af86d25 blocker）：
 * 同一筆文字寶貝獎勵不該因為「學習頁當場跳一次、回島後又跳一次」而出現
 * 兩次。這支鎖的是這個 hook 這一半的契約——跟
 * `ReadingIslandLab.wordBabyRewardToast.test.tsx` 裡對稱的那條（模擬
 * 「學習頁已經先顯示過」→ 回島後不再跳）合起來，才是完整的跨頁排重，
 * 因為兩邊用的是同一組 `readSeenRewardIds`／`markRewardIdsSeen`
 * （sessionStorage，同一分頁內同源 iframe 本來就共用）。
 */
describe('useStepProgressPersistence — #3794 跨頁排重：同一筆獎勵不會因為兩條路徑而跳兩次', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedOnWordBabyRewarded = undefined;
    storyMode.on = false;
  });

  it('這筆 id 已經在別的路徑標記過看過了（模擬回島後 refreshProgress 先顯示）→ 學習頁不會再跳一次', () => {
    markRewardIdsSeen(1, '99', [sampleReward.id]);
    const { result } = setup();

    act(() => { capturedOnWordBabyRewarded!([sampleReward]); });

    expect(result.current.midSessionWordBabyRewards).toEqual([]);
  });

  it('學習頁顯示了這筆獎勵之後，立刻標記為已看過——回島那條路徑讀得到，不會再跳第二次', () => {
    const { result } = setup();

    act(() => { capturedOnWordBabyRewarded!([sampleReward]); });

    expect(result.current.midSessionWordBabyRewards).toEqual([sampleReward]);
    expect(readSeenRewardIds(1, '99').has(sampleReward.id)).toBe(true);
  });

  it('同一批裡有的看過、有的沒看過 → 只有沒看過的進學習頁的提示佇列，看過的被濾掉', () => {
    const second: WordBabyReward = { ...sampleReward, id: 2 };
    markRewardIdsSeen(1, '99', [sampleReward.id]);
    const { result } = setup();

    act(() => { capturedOnWordBabyRewarded!([sampleReward, second]); });

    expect(result.current.midSessionWordBabyRewards).toEqual([second]);
  });
});
