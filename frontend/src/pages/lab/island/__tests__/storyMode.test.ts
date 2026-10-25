/**
 * 回到島上時，哪一站要記成「做過」。
 * 課程簡介（港口燈塔）在平台設計上永遠不會進 steps_completed，
 * 只靠伺服器進度判定的話第一區永遠集不滿、後面的霧永遠不散。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldMarkVisitedOnReturn, notifyIslandStepAborted, ISLAND_STEP_ABORTED, parseIslandReturnMessage } from '../storyMode';

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
