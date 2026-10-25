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
