/**
 * 喝采島「故事模式」：學習頁被嵌在 /lab/island/* 裡時，一次只做一關。
 * - 不顯示頂部關卡列、底部上一步／下一步
 * - 做完這一關不跳下一關，通知島嶼頁，由島嶼帶回故事裡
 * 一般從圖書館進入（不在 iframe 裡）時永遠回傳 false，行為完全不變。
 */
export const ISLAND_STEP_DONE = 'island-step-done';

export function isIslandStoryMode(): boolean {
  try {
    return window.self !== window.top && !!window.top && window.top.location.pathname.startsWith('/lab/island/');
  } catch {
    return false;
  }
}

export function notifyIslandStepDone(step: string): void {
  try {
    window.top?.postMessage({ type: ISLAND_STEP_DONE, step }, window.location.origin);
  } catch {
    /* 不在島上就什麼都不做 */
  }
}

/**
 * 回到島上時要不要把這一站記成「做過」。
 * - 學習頁回報做完（finished）一律記：課程簡介在平台設計上不會進 steps_completed，
 *   只靠伺服器進度判定，第一區永遠集不滿，後面的霧永遠不散
 * - 只按「回到島上」中途離開：伺服器進度可信就不記
 * - 完全拿不到伺服器進度：沿用舊行為，去過就記
 */
export function shouldMarkVisitedOnReturn({ finished, reliable }: { finished: boolean; reliable: boolean }): boolean {
  return finished || !reliable;
}
