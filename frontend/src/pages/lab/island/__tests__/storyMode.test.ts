/**
 * 回到島上時，哪一站要記成「做過」。
 * 課程簡介（港口燈塔）在平台設計上永遠不會進 steps_completed，
 * 只靠伺服器進度判定的話第一區永遠集不滿、後面的霧永遠不散。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  shouldMarkVisitedOnReturn,
  notifyIslandStepAborted,
  ISLAND_STEP_ABORTED,
  parseIslandReturnMessage,
  notifyIslandReadingBabyGrowth,
  parseReadingBabyGrowthMessage,
  READING_BABY_GROWTH,
  readSeenGrowthStations,
  markGrowthStationsSeen,
} from '../storyMode';

describe('shouldMarkVisitedOnReturn', () => {
  it('marks the stop when the lesson page reported it finished, even with reliable server progress', () => {
    expect(shouldMarkVisitedOnReturn({ finished: true, reliable: true })).toBe(true);
  });

  it('does not mark when the student only pressed 回到島上 and server progress is reliable', () => {
    expect(shouldMarkVisitedOnReturn({ finished: false, reliable: true })).toBe(false);
  });

  it('keeps the old fallback: no server progress at all → mark what was visited', () => {
    expect(shouldMarkVisitedOnReturn({ finished: false, reliable: false })).toBe(true);
  });
});

/**
 * 跟 notifyIslandStepDone 是不同的訊號（team-lead／Young 2026-10-26 明令）：
 * 一個站的學習頁壞掉（React 錯誤邊界接住）時，「跳過此步驟」在故事模式裡要
 * 改叫「回到島上」，而且**不算完成**——不能沿用 notifyIslandStepDone，因為
 * 那個訊號的接收端（ReadingIslandLab 的 message listener）一律把它當
 * finished=true 處理，會把壞掉沒做的站錯誤記成「已完成」。
 */
describe('notifyIslandStepAborted', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts an ISLAND_STEP_ABORTED message to the top window (distinct from ISLAND_STEP_DONE)', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { top: { postMessage }, location: { origin: 'https://example.test' } });
    notifyIslandStepAborted();
    expect(postMessage).toHaveBeenCalledWith({ type: ISLAND_STEP_ABORTED }, 'https://example.test');
    expect(ISLAND_STEP_ABORTED).not.toBe('island-step-done');
  });

  it('does nothing (does not throw) when not inside the island iframe', () => {
    vi.stubGlobal('window', { top: undefined, location: { origin: 'https://example.test' } });
    expect(() => notifyIslandStepAborted()).not.toThrow();
  });
});

/**
 * ReadingIslandLab 的 window message listener 用這支純函式決定收到的訊息要
 * 不要觸發 returnToIsland、finished 要傳 true 還是 false。抽成純函式是因為
 * 原本直接寫在元件裡的 `if (data?.type === ISLAND_STEP_DONE) return(true)`，
 * 多了 ISLAND_STEP_ABORTED 之後要再加一個分支，容易漏改、也沒辦法單獨測。
 */
describe('parseIslandReturnMessage', () => {
  it('ISLAND_STEP_DONE → finished: true (lights up the station)', () => {
    expect(parseIslandReturnMessage({ type: 'island-step-done', step: 'vocab-review' })).toEqual({ finished: true });
  });

  it('ISLAND_STEP_ABORTED → finished: false (returns to island, does not light up)', () => {
    expect(parseIslandReturnMessage({ type: 'island-step-aborted' })).toEqual({ finished: false });
  });

  it('unrelated messages (other postMessage traffic on the page) → null, listener ignores them', () => {
    expect(parseIslandReturnMessage({ type: 'webpack-hmr' })).toBeNull();
    expect(parseIslandReturnMessage(null)).toBeNull();
    expect(parseIslandReturnMessage(undefined)).toBeNull();
    expect(parseIslandReturnMessage('not an object')).toBeNull();
    expect(parseIslandReturnMessage({})).toBeNull();
  });
});

/**
 * #3780 reading-babies phase 2：過關回島時「寶貝長大了」的小提示。刻意跟
 * ISLAND_STEP_DONE 用不同的訊號（而不是把 events 塞進同一則訊息）——
 * notifyIslandStepDone 在 useLearningStepNavigation.ts 同步呼叫，而成長資料
 * 來自 useProgressSync 的 PUT /progress 回應（非同步、debounce 之後才會到），
 * 兩者時間點天生不同步，合成一則訊息會逼著改動已經很敏感的導覽時機。
 */
describe('notifyIslandReadingBabyGrowth', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts a READING_BABY_GROWTH message with the events payload to the top window', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { top: { postMessage }, location: { origin: 'https://example.test' } });
    const events = [
      { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
    ];
    notifyIslandReadingBabyGrowth(events);
    expect(postMessage).toHaveBeenCalledWith({ type: READING_BABY_GROWTH, events }, 'https://example.test');
  });

  it('does nothing (does not throw) when not inside the island iframe', () => {
    vi.stubGlobal('window', { top: undefined, location: { origin: 'https://example.test' } });
    expect(() => notifyIslandReadingBabyGrowth([])).not.toThrow();
  });
});

describe('parseReadingBabyGrowthMessage', () => {
  it('READING_BABY_GROWTH → the events array', () => {
    const events = [
      { station: 'lesson-intro', ability_id: '1-Ⅱ-2', quality_passed: false },
    ];
    expect(parseReadingBabyGrowthMessage({ type: 'reading-baby-growth', events })).toEqual(events);
  });

  it('unrelated messages → null, listener ignores them', () => {
    expect(parseReadingBabyGrowthMessage({ type: 'island-step-done', step: 'x' })).toBeNull();
    expect(parseReadingBabyGrowthMessage(null)).toBeNull();
    expect(parseReadingBabyGrowthMessage(undefined)).toBeNull();
    expect(parseReadingBabyGrowthMessage('not an object')).toBeNull();
    expect(parseReadingBabyGrowthMessage({})).toBeNull();
  });

  it('malformed events field (not an array) → null, does not crash the listener', () => {
    expect(parseReadingBabyGrowthMessage({ type: 'reading-baby-growth', events: 'not-an-array' })).toBeNull();
  });
});

/**
 * 同一筆閱讀寶貝成長事件只該提示一次，不管是在學習頁本身（即時回饋）先
 * 看到，還是回島後（`refreshProgress`／postMessage 兩條路徑）先看到。這支
 * 鎖的是「排重本身」——`ReadingIslandLab`／`useStepProgressPersistence` 兩邊
 * 的整合測試鎖的是「真的接上了這支」，兩層缺一不可（只鎖整合會漏掉排重
 * 邏輯本身的 edge case，只鎖這支會漏掉「忘記呼叫」這種接線缺陷）。
 *
 * v1 用數字 `id`（StudentStationRewardLog 主鍵）排重；閱讀寶貝沒有這個 id，
 * 改用 `station` 字串本身當排重鍵——同一站的成長紀錄冪等（見 storyMode.ts
 * 檔頭說明），`station` 字串天生就是安全的唯一鍵。
 */
describe('readSeenGrowthStations / markGrowthStationsSeen — 閱讀寶貝成長提示「只提示一次」的排重', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('還沒標記過任何站 → 回傳空集合', () => {
    expect(readSeenGrowthStations('u1', 's1').size).toBe(0);
  });

  it('標記過的站之後讀得到，而且不影響別的使用者/課文組合（key 有隔離）', () => {
    markGrowthStationsSeen('u1', 's1', ['vocab-definition', 'spotlight']);
    expect(readSeenGrowthStations('u1', 's1')).toEqual(new Set(['vocab-definition', 'spotlight']));
    // 同一個學生、不同課文 → 看不到剛剛那兩筆（不是全域共用一個 bucket）
    expect(readSeenGrowthStations('u1', 's2').size).toBe(0);
    // 同一課文、不同學生 → 一樣看不到
    expect(readSeenGrowthStations('u2', 's1').size).toBe(0);
  });

  it('多次呼叫 markGrowthStationsSeen 會累加，不會把前一批洗掉', () => {
    markGrowthStationsSeen('u1', 's1', ['lesson-intro']);
    markGrowthStationsSeen('u1', 's1', ['spotlight', 'comprehension']);
    expect(readSeenGrowthStations('u1', 's1')).toEqual(new Set(['lesson-intro', 'spotlight', 'comprehension']));
  });

  it('傳空陣列是 no-op（不會寫入、也不會把既有紀錄洗掉）', () => {
    markGrowthStationsSeen('u1', 's1', ['lesson-intro']);
    markGrowthStationsSeen('u1', 's1', []);
    expect(readSeenGrowthStations('u1', 's1')).toEqual(new Set(['lesson-intro']));
  });

  it('userId 缺省時退回共用的 "guest" bucket（跟原本元件內的寫法一致）', () => {
    markGrowthStationsSeen(undefined, 's1', ['lesson-intro']);
    expect(readSeenGrowthStations(undefined, 's1')).toEqual(new Set(['lesson-intro']));
    expect(readSeenGrowthStations('guest', 's1')).toEqual(new Set(['lesson-intro']));
  });

  it('sessionStorage 壞掉（讀出非 JSON）時不丟例外，當成空集合', () => {
    sessionStorage.setItem('reading-island-seen-rewards:u1:s1', 'not json');
    expect(readSeenGrowthStations('u1', 's1').size).toBe(0);
  });
});
