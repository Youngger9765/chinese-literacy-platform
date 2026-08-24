import type { ManifestSection } from './stepConfig';

/**
 * 一課多篇課文時，「這一步該用哪一篇的資料」（#2916）。
 *
 * ## slug 是身分，text_ref 是引用
 *
 * 每一份模組 yml 都有自己的 slug，寫在自己的檔名裡（`key_reading.9a7x4.yml`）。
 * 需要課文的節，用 `text_ref` 指向**別人的** slug —— 那個別人一定是某篇課文。
 * 課文自己沒有 `text_ref`，因為它就是被指的那一個。
 *
 * 這個區分是 2026-08-25 owner 訂的：
 * 「你對於 slug 是不是有誤會啊？」「ref 誰才是寫別人的 slug 啊」。
 * 在那之前所有模組共用課文的 slug 當檔名，於是「這是誰」跟「這要用誰」分不開。
 *
 * ## 為什麼不在後端做完
 *
 * 後端不知道學生現在站在哪一步。`repeat_rounds` 是完整的三輪資料，
 * 挑哪一輪是畫面當下的事，所以在前端這一層收斂。
 */

/** 步驟 key（`key-passage-reading#9a7x4`）的 `#` 後半，沒有就 null。 */
function roundSlugOf(stepKey: string): string | null {
  const i = stepKey.indexOf('#');
  return i < 0 ? null : stepKey.slice(i + 1) || null;
}

/**
 * 這一步要用哪一篇課文的 slug。
 *
 * - 引用型的節 → 它 `text_ref` 指到的那篇
 * - 課文本身 → 它自己的 slug
 * - 跨篇的節（`text_ref` 是清單）→ null，**維持頂層資料**。
 *   挑其中一篇會讓「綜合」變成「其中一篇」，那是無聲的內容錯誤。
 * - 查無此列 / 沒有 `#slug` → null，不猜
 */
export function articleSlugForStep(
  manifest: ManifestSection[] | null | undefined,
  stepKey: string,
): string | null {
  const slug = roundSlugOf(stepKey);
  if (!slug) return null;
  const row = (manifest ?? []).find((s) => s?.slug === slug);
  if (!row) return null;
  const ref = row.text_ref;
  if (typeof ref === 'string' && ref) return ref;
  if (Array.isArray(ref)) return null;              // 跨篇
  return row.module === 'full_text_annotate' ? slug : null;
}

/**
 * 把 API 原始 detail 換成「這一輪」的資料。

 * 作用在**對應之前**的 snake 形狀，不是對應後的 Story。因為 Story 的欄位
 * 名跟內部形狀都被 `apiDetailToStory` 重塑過（`key_reading.start_text` →
 * `keyReading.startText`），在那之後覆蓋等於要再寫一套對應 ——
 * 兩套對應遲早會分岔。換完再走原本那一套，對應只有一份。
 *
 * `repeat_rounds` 以**課文 slug** 為 key，底下是那一輪各模組的內容：
 *
 *     repeat_rounds:
 *       4uee3:                       ← 第 2 篇
 *         key_reading: {...}         ← 第 2 篇的重點段
 *         keypoints:   {...}         ← 第 2 篇的重點表
 *
 * 不做這一步的話，三篇的念順順都會渲染頂層的 `key_reading`（＝第 1 篇），
 * 而畫面上完全看不出來 —— 有段落、會唸、不報錯，只是唸錯篇。
 */
export function scopeDetailToRound<T extends Record<string, unknown>>(
  detail: T,
  manifest: ManifestSection[] | null | undefined,
  stepKey: string,
): T {
  const article = articleSlugForStep(manifest, stepKey);
  if (!article) return detail;
  const rounds = detail.repeat_rounds as Record<string, Record<string, unknown>> | undefined;
  const round = rounds?.[article];
  if (!round) return detail;
  // 只覆蓋這一輪真的有的模組。用展開會把該輪缺少的模組寫成 undefined，
  // 而消費端多半是 `story.spotlight ?? fallback` —— undefined 會吃掉 fallback。
  const out: Record<string, unknown> = { ...detail };
  for (const [mod, data] of Object.entries(round)) {
    if (data !== undefined && data !== null) out[mod] = data;
  }
  // ⚠️ 這裡曾經自己從 `round.full_text_annotate.paragraphs` 把段落提上來。
  //    那份是抽取的原始形狀 `[{idx, text}]`，而 API 頂層的 `paragraphs`
  //    是攤平的字串陣列 —— 提錯形狀，讀全文整頁 `text.match is not a function`。
  //    攤平現在只有一份實作（後端 `_flat_paragraphs`），每一輪自己就帶著
  //    攤好的 `paragraphs`，所以上面那個一般迴圈已經把它覆蓋進來了。
  //    **不要在這裡再寫第二套。**
  return out as T;
}
