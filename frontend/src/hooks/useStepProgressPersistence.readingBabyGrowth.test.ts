/**
 * TDD tests for useStepProgressPersistence's #3780 reading-babies phase 2
 * growth-event forwarding + local "當頁成長提示" state (replaces the deleted
 * useStepProgressPersistence.wordBabyReward.test.ts and
 * .wordBabyRewardToast.test.ts — v1 整套移除，見 game-design.md §5).
 *
 * useProgressSync is mocked (same pattern as useStepProgressPersistence
 * .badgeUnlock.test.ts) — this test's job is to verify
 * useStepProgressPersistence WIRES the onReadingBabyGrowth option it passes
 * to useProgressSync into (a) a call to notifyIslandReadingBabyGrowth gated
 * on isIslandStoryMode(), and (b) a local `midSessionReadingBabyGrowth`
 * state that updates regardless of island mode (game-design.md §3.3「當頁
 * 成長提示」) — not to re-test useProgressSync's own network logic (that
 * lives in useProgressSync.readingBabyGrowth.test.ts) nor storyMode's own
 * postMessage plumbing (that lives in storyMode.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type GrowthEvent = { station: string; ability_id: string; quality_passed: boolean };

let capturedOnReadingBabyGrowth: ((events: GrowthEvent[]) => void) | undefined;

vi.mock('./useProgressSync', () => ({
  useProgressSync: (opts: { onReadingBabyGrowth?: (events: GrowthEvent[]) => void }) => {
    capturedOnReadingBabyGrowth = opts.onReadingBabyGrowth;
    return {
      syncProgress: vi.fn(),
      flushProgress: vi.fn(),
      isProgressLoading: false,
    };
  },
}));

const storyMode = { on: false };
const notify = vi.fn();

// 保留 `readSeenGrowthStations`／`markGrowthStationsSeen` 的真正實作——這支
// 的職責包含驗證排重本身，完全 mock 掉這兩個函式會讓排重檢查測不到真正
// 的行為。
vi.mock('../pages/lab/island/storyMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/lab/island/storyMode')>();
  return {
    ...actual,
    isIslandStoryMode: () => storyMode.on,
    notifyIslandReadingBabyGrowth: (events: GrowthEvent[]) => notify(events),
  };
});

import { useStepProgressPersistence } from './useStepProgressPersistence';
import { markGrowthStationsSeen, readSeenGrowthStations } from '../pages/lab/island/storyMode';

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

const sampleEvent: GrowthEvent = { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true };

describe('useStepProgressPersistence — reading-baby growth forwarding to the island (#3780)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedOnReadingBabyGrowth = undefined;
    notify.mockReset();
    storyMode.on = false;
  });

  it('passes onReadingBabyGrowth to useProgressSync', () => {
    setup();
    expect(capturedOnReadingBabyGrowth, 'useStepProgressPersistence must pass onReadingBabyGrowth to useProgressSync').toBeTypeOf('function');
  });

  it('forwards events to the island when in island story mode', () => {
    storyMode.on = true;
    setup();

    act(() => {
      capturedOnReadingBabyGrowth!([sampleEvent]);
    });

    expect(notify).toHaveBeenCalledWith([sampleEvent]);
  });

  it('does NOT forward to the island when NOT in island story mode (regular /learn flow has no listener)', () => {
    storyMode.on = false;
    setup();

    act(() => {
      capturedOnReadingBabyGrowth!([sampleEvent]);
    });

    expect(notify).not.toHaveBeenCalled();
  });
});

/**
 * game-design.md §3.3「當頁成長提示」：學習活動做完的當下，就在學習頁跳出
 * 「寶貝長大了」提示，不必等回島。既有的 `onReadingBabyGrowth` 只會（在
 * `isIslandStoryMode()` 為真時）postMessage 通知島嶼頁——這支測的是本地
 * state，給學習頁自己（不管是不是嵌在島上）當場顯示用。
 */
describe('useStepProgressPersistence — #3780 §3.3 即時回饋：學習頁本地成長提示 state（不靠 postMessage）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedOnReadingBabyGrowth = undefined;
    storyMode.on = false;
  });

  it('初始是空陣列', () => {
    const { result } = setup();
    expect(result.current.midSessionReadingBabyGrowth).toEqual([]);
  });

  it('不管是不是嵌在島上（isIslandStoryMode=false），收到成長事件都會更新本地 state', () => {
    storyMode.on = false; // 刻意跟「不轉發給島嶼」的既有行為相反場景一起測，證明這條路徑獨立
    const { result } = setup();

    act(() => {
      capturedOnReadingBabyGrowth!([sampleEvent]);
    });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([sampleEvent]);
  });

  it('嵌在島上時（isIslandStoryMode=true）本地 state 一樣會更新——兩條路徑互不影響', () => {
    storyMode.on = true;
    const { result } = setup();

    act(() => {
      capturedOnReadingBabyGrowth!([sampleEvent]);
    });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([sampleEvent]);
  });

  it('quality_passed=false 的事件不會進入本地提示佇列（沒做好不給提示）', () => {
    const { result } = setup();
    const notPassed: GrowthEvent = { station: 'keypoints-table', ability_id: '5-Ⅱ-6', quality_passed: false };

    act(() => { capturedOnReadingBabyGrowth!([notPassed]); });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([]);
  });

  it('連續兩次呼叫會累加，不是互相覆蓋', () => {
    const { result } = setup();
    const second: GrowthEvent = { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true };

    act(() => { capturedOnReadingBabyGrowth!([sampleEvent]); });
    act(() => { capturedOnReadingBabyGrowth!([second]); });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([sampleEvent, second]);
  });

  it('dismissMidSessionReadingBabyGrowth 清空 state', () => {
    const { result } = setup();
    act(() => { capturedOnReadingBabyGrowth!([sampleEvent]); });
    expect(result.current.midSessionReadingBabyGrowth).toHaveLength(1);

    act(() => { result.current.dismissMidSessionReadingBabyGrowth(); });
    expect(result.current.midSessionReadingBabyGrowth).toEqual([]);
  });
});

/**
 * 同一筆閱讀寶貝成長事件不該因為「學習頁當場跳一次、回島後又跳一次」而
 * 出現兩次。這支鎖的是這個 hook 這一半的契約，跟 `ReadingIslandLab` 那邊
 * 對稱的整合測試合起來才是完整的跨頁排重，因為兩邊用的是同一組
 * `readSeenGrowthStations`／`markGrowthStationsSeen`（sessionStorage，同一
 * 分頁內同源 iframe 本來就共用）。v1 用數字 id 排重，閱讀寶貝改用
 * `station` 字串（同一站的成長紀錄本身冪等，見 storyMode.ts）。
 */
describe('useStepProgressPersistence — 跨頁排重：同一筆成長事件不會因為兩條路徑而跳兩次', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedOnReadingBabyGrowth = undefined;
    storyMode.on = false;
  });

  it('這一站已經在別的路徑標記過看過了（模擬回島後 refreshProgress 先顯示）→ 學習頁不會再跳一次', () => {
    markGrowthStationsSeen(1, '99', [sampleEvent.station]);
    const { result } = setup();

    act(() => { capturedOnReadingBabyGrowth!([sampleEvent]); });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([]);
  });

  it('學習頁顯示了這筆成長事件之後，立刻標記為已看過——回島那條路徑讀得到，不會再跳第二次', () => {
    const { result } = setup();

    act(() => { capturedOnReadingBabyGrowth!([sampleEvent]); });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([sampleEvent]);
    expect(readSeenGrowthStations(1, '99').has(sampleEvent.station)).toBe(true);
  });

  it('同一批裡有的看過、有的沒看過 → 只有沒看過的進學習頁的提示佇列，看過的被濾掉', () => {
    const second: GrowthEvent = { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true };
    markGrowthStationsSeen(1, '99', [sampleEvent.station]);
    const { result } = setup();

    act(() => { capturedOnReadingBabyGrowth!([sampleEvent, second]); });

    expect(result.current.midSessionReadingBabyGrowth).toEqual([second]);
  });
});
