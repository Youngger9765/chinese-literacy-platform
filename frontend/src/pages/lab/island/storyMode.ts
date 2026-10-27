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
 * 跟 ISLAND_STEP_DONE 刻意分開的第二個訊號：學習頁壞掉（StepErrorBoundary 接住
 * React 錯誤）時，故事模式下的「跳過此步驟」要變成「回到島上」，但**不算完成**。
 * 不能沿用 notifyIslandStepDone——接收端（ReadingIslandLab 的 message listener）
 * 收到 ISLAND_STEP_DONE 一律當 finished=true 處理，會把壞掉沒做完的站誤記成
 * 已完成、錯誤點燈。
 */
export const ISLAND_STEP_ABORTED = 'island-step-aborted';

export function notifyIslandStepAborted(): void {
  try {
    window.top?.postMessage({ type: ISLAND_STEP_ABORTED }, window.location.origin);
  } catch {
    /* 不在島上就什麼都不做 */
  }
}

/**
 * ReadingIslandLab 的 window message listener 用這支決定收到的訊息要不要觸發
 * returnToIsland、finished 要傳 true 還是 false。回傳 null 代表不是這兩種島嶼
 * 訊號（例如 HMR 或其他 postMessage 流量），listener 應該完全忽略。
 */
export function parseIslandReturnMessage(data: unknown): { finished: boolean } | null {
  if (typeof data !== 'object' || data === null) return null;
  const type = (data as { type?: unknown }).type;
  if (type === ISLAND_STEP_DONE) return { finished: true };
  if (type === ISLAND_STEP_ABORTED) return { finished: false };
  return null;
}

/**
 * 文字寶貝的碎片/遭遇獎勵提示（#3780 接島上）：跟 ISLAND_STEP_DONE 刻意分開
 * 的第三個訊號——不是把 rewards 塞進同一則訊息，是因為 notifyIslandStepDone
 * 在 useLearningStepNavigation.ts 同步呼叫（這一關做完的當下），獎勵資料卻
 * 來自 useProgressSync 的 PUT /progress 回應（非同步、還有 5 秒 debounce），
 * 兩者天生不同步；合成一則訊息會逼著改動已經很敏感的「做完立刻回島」導覽
 * 時機。島側（ReadingIslandLab）收到這則獨立訊息時，不論回島動畫走到哪，
 * 都可以把這次 save 真的新發放的獎勵排進提示佇列。
 */
export const WORD_BABY_REWARD = 'word-baby-reward';

export interface WordBabyRewardMessagePayload {
  id: number;
  station: string;
  fragment_awarded: boolean;
  fragment_flavor: string | null;
  encounter_result: 'none' | 'caught' | 'duplicate';
  encounter_baby_id: string | null;
}

export function notifyIslandWordBabyReward(rewards: WordBabyRewardMessagePayload[]): void {
  try {
    window.top?.postMessage({ type: WORD_BABY_REWARD, rewards }, window.location.origin);
  } catch {
    /* 不在島上就什麼都不做 */
  }
}

export function parseWordBabyRewardMessage(data: unknown): WordBabyRewardMessagePayload[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, rewards } = data as { type?: unknown; rewards?: unknown };
  if (type !== WORD_BABY_REWARD) return null;
  if (!Array.isArray(rewards)) return null;
  return rewards as WordBabyRewardMessagePayload[];
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
