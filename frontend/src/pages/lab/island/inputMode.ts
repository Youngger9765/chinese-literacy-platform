/**
 * #3780 P0-1（playtest 回饋，2026-10-26）：iPad（820px 寬）之前是用螢幕寬度
 * 的 `md:` 斷點判斷「是不是手機」，被誤判成桌機——搖桿被 `md:hidden` 藏
 * 起來，畫面卻顯示「WASD / 方向鍵移動」（iPad 沒有鍵盤，孩子完全走不動）。
 *
 * 改成依**輸入方式**判斷，不是螢幕寬度：`(pointer: coarse)` 媒體查詢
 * （主要輸入裝置是觸控／手寫筆，精準度低）或 `navigator.maxTouchPoints`
 * 任一成立就算觸控裝置。兩個條件都查，因為个別瀏覽器/裝置對
 * `matchMedia('(pointer: coarse)')` 的支援度不一致，單靠一個容易漏判。
 */
export function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch {
    // matchMedia 在極少數環境可能丟錯（例如某些測試/舊版瀏覽器 polyfill 不完整），
    // 當作查不到，繼續看下一個訊號，不要讓這個函式本身變成崩潰點。
  }
  return (navigator?.maxTouchPoints ?? 0) > 0;
}

/**
 * #3780 P0-1 退件（審查員，2026-10-26）：觸控 Chromebook 這種混合裝置
 * `maxTouchPoints > 0` 會讓 `isCoarsePointerDevice()` 判斷成觸控，於是只顯示
 * 搖桿提示——但它同時也接了一個精準指向裝置（滑鼠／觸控板），鍵盤其實照樣
 * 能用，學生卻看不到「WASD 移動」的提示，不知道有這條路。
 *
 * 用 `(any-pointer: fine)` 問「這台裝置上**有沒有任何一個**精準輸入裝置」
 * （跟 `(pointer: fine)` 只問主要輸入裝置不同——混合裝置的「主要」輸入
 * 可能被判定成觸控，但 `any-pointer` 兩種都會抓到）。matchMedia 丟例外時
 * 跟 `isCoarsePointerDevice()` 一樣，當作查不到、回 false，不崩潰。
 */
export function isFinePointerDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.matchMedia?.('(any-pointer: fine)').matches);
  } catch {
    return false;
  }
}
