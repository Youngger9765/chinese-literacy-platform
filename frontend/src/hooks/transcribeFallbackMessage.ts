/**
 * 轉寫失敗時該跟學生說什麼（#3299）。
 *
 * ⛔ 修之前只有一句：「辨識失敗，請重錄一次」—— 不分原因。
 *    prod 實測近 30 天 44 次轉寫有 4 次 fallback（9%），而**原因完全不同**：
 *      · 1,716ms / 2,334ms / 4,515ms → Gemini 回空的轉寫（錄音太短）
 *      · 103,807ms                   → 轉檔失敗（錄音太長）
 *    對「太短」那三個學生來說，「請重錄一次」是**無效的指示** ——
 *    照同樣長度再錄一次，會同樣失敗。他還等了 9–20 秒才看到這句話
 *    （p50 9,430ms / p95 19,810ms）。
 *
 * 後端每一種失敗都已經回了 `reason`，只是前端從來沒有用它。
 *
 * ⚠️ 這裡刻意**不**去調 `_MIN_AUDIO_DURATION_MS`（後端那個 1 秒門檻遠低於實際
 *    開始失敗的長度）。要把它調到對的位置需要知道「多長才穩」，而我手上只有
 *    3 個 fallback 的長度 —— 用 3 個點推門檻是猜，包裝成數據。那一半留在 #3299
 *    等有足夠樣本再做。
 */

/** 後端 `POST /api/reading/transcribe` 回的 `reason` 值。 */
export type TranscribeFallbackReason =
  | 'too_short'
  | 'silent'
  | 'empty'
  | 'truncated'
  | 'decode'
  | 'timeout'
  | 'safety'
  | 'hallucination'
  | 'error';

/**
 * 每一種原因對應一句**可以照著做**的話。
 *
 * 判準：這句話有沒有告訴學生「下一步該做什麼不一樣的事」。
 * 「請重錄一次」對「太短」與「太長」都不成立，所以那兩類必須講出方向。
 */
const MESSAGES: Record<TranscribeFallbackReason, string> = {
  // 錄音太短 —— 重錄同樣長度不會有用，要講清楚「多讀一點」
  too_short: '錄音太短了，請把整段唸完再按完成。',
  empty: '這段錄音太短，聽不出內容，請把整段多唸一點再試一次。',
  // 沒有聲音 —— 問題在麥克風或沒開口，不是重錄
  silent: '沒有聽到聲音，請確認麥克風有開，然後再唸一次。',
  // 太長 / 被截斷 —— 要分段
  decode: '這段錄音太長了，分成小段唸會比較順利。',
  truncated: '這段錄音太長，只聽到前面一部分，分成小段唸會比較好。',
  // 環境或暫時性問題 —— 重試是有效的指示
  timeout: '網路有點慢，等一下再按一次完成就好。',
  error: '剛剛出了點小狀況，再按一次完成試試看。',
  // 內容被判定有問題
  safety: '這段錄音沒辦法辨識，請重新唸一次。',
  hallucination: '沒有聽清楚你唸的內容，請再唸一次。',
};

/** 找不到對應的 reason 時用這句（仍然比原本的「辨識失敗」多一點方向）。 */
const DEFAULT = '沒有聽清楚，請再唸一次。';

export function transcribeFallbackMessage(reason: string | null | undefined): string {
  if (!reason) return DEFAULT;
  return MESSAGES[reason as TranscribeFallbackReason] ?? DEFAULT;
}

/** 這些原因照同樣做法重錄也不會成功 —— UI 可以用它決定要不要多給提示。 */
export function retryingTheSameWayWillFail(reason: string | null | undefined): boolean {
  return reason === 'too_short' || reason === 'empty'
    || reason === 'decode' || reason === 'truncated' || reason === 'silent';
}
