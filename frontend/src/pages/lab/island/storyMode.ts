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
 * 閱讀寶貝的「寶貝長大了」成長提示（#3780 reading-babies phase 2，取代 v1
 * 的 WORD_BABY_REWARD）：跟 ISLAND_STEP_DONE 刻意分開的第三個訊號——不是把
 * growth events 塞進同一則訊息，是因為 notifyIslandStepDone 在
 * useLearningStepNavigation.ts 同步呼叫（這一關做完的當下），成長資料卻
 * 來自 useProgressSync 的 PUT /progress 回應（非同步、還有 5 秒 debounce），
 * 兩者天生不同步；合成一則訊息會逼著改動已經很敏感的「做完立刻回島」導覽
 * 時機。島側（ReadingIslandLab）收到這則獨立訊息時，不論回島動畫走到哪，
 * 都可以把這次 save 真的新記錄的成長事件排進提示佇列。
 *
 * 跟 v1 的關鍵差異：v1 的獎勵有 `id`（StudentStationRewardLog 主鍵）當排重
 * 的天然唯一鍵；閱讀寶貝的 `StudentIndicatorEvidence`
 * （backend/app/schemas/session.py `ReadingBabyGrowthEvent`）沒有回傳 id，
 * 但 `(lesson_uid, station)` 本身就是冪等鍵——同一站一旦
 * `quality_passed=true` 就不會再寫第二筆（reading_baby_service.py
 * `record_station_evidence` 的 docstring）——所以 `station` 字串本身就是
 * 安全的排重鍵，不需要額外的數字 id。
 */
export const READING_BABY_GROWTH = 'reading-baby-growth';

export interface ReadingBabyGrowthMessagePayload {
  station: string;
  ability_id: string;
  quality_passed: boolean;
}

export function notifyIslandReadingBabyGrowth(events: ReadingBabyGrowthMessagePayload[]): void {
  try {
    window.top?.postMessage({ type: READING_BABY_GROWTH, events }, window.location.origin);
  } catch {
    /* 不在島上就什麼都不做 */
  }
}

export function parseReadingBabyGrowthMessage(data: unknown): ReadingBabyGrowthMessagePayload[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, events } = data as { type?: unknown; events?: unknown };
  if (type !== READING_BABY_GROWTH) return null;
  if (!Array.isArray(events)) return null;
  return events as ReadingBabyGrowthMessagePayload[];
}

/**
 * 閱讀寶貝成長提示「只提示一次」的排重（沿用 v1 #3794 PRD §5 二次訂正的
 * 精神）：原本只有 ReadingIslandLab.tsx 自己的 `postMessage` 路徑跟
 * `refreshProgress` GET 路徑共用這份排重，所以「島嶼頁內部」不會重複跳；
 * `useStepProgressPersistence.ts` 的 `onReadingBabyGrowth`（學習頁本身當場
 * 跳提示）也要接上同一份排重，避免同一站的成長事件在故事模式下先在學習頁
 * 跳一次（PUT /progress 回應回來時），回島後 `refreshProgress(true)` 又跳
 * 第二次。
 *
 * 抽成這裡而不是留在 ReadingIslandLab.tsx：sessionStorage 依「同一分頁的
 * top-level browsing context」共用，不分 origin 下的哪個 frame——學習頁被嵌在
 * 島的 iframe 裡時（同源）跟島嶼頁本身讀寫的是同一份 sessionStorage，所以
 * 兩條路徑只要呼叫同一組函式、用同一個 key 公式，先到的那條標記後，另一條
 * 自然就會把它濾掉，不需要任何跨 frame 的訊息往返。
 */
function seenGrowthStorageKey(userId: string | number | null | undefined, storyId: string | undefined): string {
  return `reading-island-seen-rewards:${userId ?? 'guest'}:${storyId}`;
}

export function readSeenGrowthStations(userId: string | number | null | undefined, storyId: string | undefined): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(seenGrowthStorageKey(userId, storyId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markGrowthStationsSeen(userId: string | number | null | undefined, storyId: string | undefined, stations: string[]): void {
  if (stations.length === 0) return;
  const key = seenGrowthStorageKey(userId, storyId);
  const seen = readSeenGrowthStations(userId, storyId);
  stations.forEach((station) => seen.add(station));
  try { sessionStorage.setItem(key, JSON.stringify([...seen])); } catch { /* 存不了就算了，頂多下次重複跳一次 */ }
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
