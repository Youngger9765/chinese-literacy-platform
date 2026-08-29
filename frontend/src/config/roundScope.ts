import type { ManifestSection, StepConfig } from './stepConfig';

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

/**
 * 這一步該印哪一個代號到 QR 上（#2916）。
 *
 * 跟 `articleSlugForStep` 相反：那支回「這一步要用**誰的課文**」，
 * 這支回「**這一節自己**的代號」。QR 印的是後者。
 *
 * ⚠️ 不從網址拿。單篇課的網址沒有 `?p=`（只有多篇課才需要圈輪次），
 * 所以靠 `?p=` 取代號的話 170 課的 QR 會全部退回長網址 ——
 * 掃得開、頁面對，只是把課號跟路由名印在紙上了。代號在帳本裡，就從帳本拿。
 *
 * @param stepId 基礎 step id（`key-passage-reading`）或帶輪次的 key（`…#9a7x4`）
 */
export function sectionSlugForStep(
  manifest: ManifestSection[] | null | undefined,
  stepId: string,
  moduleOf: (step: string) => string | undefined,
): string | null {
  const hash = stepId.indexOf('#');
  // 帶輪次的直接用它 —— 那本來就是這一節自己的代號
  if (hash >= 0) return stepId.slice(hash + 1) || null;
  const mod = moduleOf(stepId);
  if (!mod) return null;
  const rows = (manifest ?? []).filter((s) => s?.module === mod && s?.slug);
  // 多份而網址沒說是哪一份 → 不猜。猜錯會讓紙上印到別篇的碼。
  return rows.length === 1 ? (rows[0].slug ?? null) : null;
}

/**
 * 一顆 stepper 圈圈連同它屬於哪一篇。
 *
 * 單篇課 `partNo` / `partTotal` 都是 undefined，`a11yLabel` 跟以前一模一樣。
 */
export interface AnnotatedStep {
  step: StepConfig;
  /** 1-based 篇次；共用步（課程簡介／聚光燈／報告…）與跨篇的節沒有 */
  partNo?: number;
  /** 這一課共幾篇；單篇課 undefined */
  partTotal?: number;
  /** 該篇的第一步 —— stepper 用它畫分隔 */
  isPartStart: boolean;
  /** 螢幕閱讀器與 tooltip 用的標籤；多篇課帶「第 N 篇」讓它在整列裡唯一 */
  a11yLabel: string;
}

/**
 * 給每一步標上篇次（#2916 階段 6）。
 *
 * 為什麼要有這個：2026-08-27 prod 實測 L0063（3 篇）的 stepper 是攤平 21 顆，
 * 五個標籤原樣重複三次 —— 每顆點下去 `?p=` 與內容都正確，但**學生看不出
 * 哪一組是哪一篇**，只能靠位置猜。
 *
 * ⛔ **篇次一定要跟內容用同一個來源** —— 走 `articleSlugForStep()`
 * （帳本的 `text_ref`），不是自己數第幾組五步，也不是讀 `manifest_sections`
 * 的 `part` 欄位：
 *   - 按組距切 → 每篇步驟數可以不一樣（有的篇沒有念順順），會切錯
 *   - 讀 `part` 欄位 → 它跟挑內容的機制不同源，一旦不一致就會出現
 *     「標籤寫第 2 篇、畫面是第 3 篇的內容」，比沒有標籤更糟
 *     （實測單篇課 L0011 的 `part` 8 列全是 null）
 */
export function annotateStepParts(
  steps: StepConfig[],
  manifestSections?: ManifestSection[] | null,
): AnnotatedStep[] {
  const articleOf = (step: StepConfig): string | null =>
    step.roundSlug ? articleSlugForStep(manifestSections, step.id) : null;

  const order: string[] = [];
  for (const s of steps) {
    const a = articleOf(s);
    if (a && !order.includes(a)) order.push(a);
  }
  // 單篇課（0 或 1 篇）完全不標，行為與以前一致
  const multi = order.length > 1;
  const seen = new Set<string>();

  return steps.map((step, i) => {
    const article = multi ? articleOf(step) : null;
    const partNo = article ? order.indexOf(article) + 1 : undefined;
    const isPartStart = !!(partNo && article && !seen.has(article));
    if (article) seen.add(article);
    const base = `${i + 1}. ${step.label}`;
    return {
      step,
      partNo,
      partTotal: partNo ? order.length : undefined,
      isPartStart,
      a11yLabel: partNo ? `${base}（第 ${partNo} 篇）` : base,
    };
  });
}
