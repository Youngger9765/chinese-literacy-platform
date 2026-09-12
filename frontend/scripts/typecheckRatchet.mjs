/**
 * typecheckRatchet.mjs — 型別檢查棘輪（#3195）
 *
 * 這個 repo 反覆出現的形狀是「抽對了、門全綠、學生看不到」：前後端形狀不一致，
 * 而唯一靜態抓得到它的工具（tsc）從來沒有接進 CI。`build` 是裸 `vite build`，
 * esbuild 只轉譯不檢查型別。
 *
 * 為什麼是棘輪不是「歸零」：接線當下出貨程式碼有 39 個既有錯誤。要求歸零的門
 * 第一天就會被關掉；要求「不准變多」的門，第一天就開始有用。
 *
 * 為什麼只算出貨程式碼：152 個錯裡 113 個在測試檔。把測試雜訊算進來，這道門
 * 大部分時間在管跟學生無關的東西，然後變成每個 PR 都要繞過的障礙。
 * 出貨那 39 個裡最多的是 TS2339（屬性不存在）與 TS2322（型別不可指派）——
 * 那兩個就是「形狀對不上」本人，正是這道門要抓的。
 *
 * 基準值住在 committed 的 typecheck-baseline.json，不是這裡也不是 workflow 的
 * 字面值 —— 改基準要是一個看得見的 diff，否則被擋住的人會順手把數字改大。
 */

/**
 * 基準檔的格式版本。**改 keyOf 就要 +1。**
 *
 * v1: entries = {file, code}          （鍵是 file|code）
 * v2: entries = {file, code, text}    （鍵是 file|code|text）
 *
 * 為什麼需要這個：改了鍵卻沒重建基準時，每一條都對不上、看起來像「一次多了 39 個錯」。
 * 我原本想從症狀反推成因（比對 file+code 的重疊率），但那行不通 ——
 * 「同檔同碼換成另一個錯」放大之後重疊率也是 100%，而那是**真的回歸**、
 * 是這道門最該擋的東西。兩種成因在那個軸上根本分不開，所以任何門檻都會錯。
 * 版本號是直接檢查**原因**，不是猜。
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** tsc 的一行錯誤：`路徑(行,列): error TSxxxx: 訊息` */
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/**
 * 這個檔算不算「出貨程式碼」。
 *
 * ⚠️ 用**路徑片段**比對，不是子字串 —— `src/pages/testset/…`、`latestVersion.ts`、
 *    `ContestBanner.tsx` 名字裡都有 test，用子字串會把它們誤判成測試檔，
 *    那會讓真的型別錯誤從棘輪底下溜走。
 */
export function isShippedCode(file) {
  const parts = file.split('/');
  const name = parts[parts.length - 1];
  if (parts.includes('__tests__') || parts.includes('__smoke__')) return false;
  // `src/test/` 這個目錄（setup.ts 等測試基礎設施）—— 但不是 `src/testset/`
  if (parts.includes('test') || parts.includes('tests')) return false;
  if (/\.(test|spec|eval)\.[cm]?[jt]sx?$/.test(name)) return false;
  // ⚠️ 給將來要改這個函式的人：判斷用**路徑片段**，所以把真的功能目錄取名叫
  //    `tests/` 或 `__tests__/`（例如做一個「測驗管理」功能）會讓那整個目錄
  //    永遠對這道門隱形，而且不會有任何警告。要加目錄名之前先想這件事。
  return true;
}

/** 把 tsc 的輸出切成「出貨 / 測試 / 認不得」三堆。認不得的要回報，不可以靜靜丟掉。 */
export function parseErrors(text) {
  const shipped = [], test = [], unparsed = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    const m = ERROR_LINE.exec(line);
    if (!m) { unparsed.push(line); continue; }
    const entry = { file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4], text: m[5] };
    (isShippedCode(entry.file) ? shipped : test).push(entry);
  }
  return { shipped, test, unparsed };
}

/**
 * 比對用的鍵：檔案 + 錯碼 + 訊息。
 *
 * ⛔ **不含行號** —— 行號會隨無關的編輯位移，含了會天天誤報。
 * ✅ **含訊息**：少了它，「修好一個 TS2339、同時在同一個檔新增另一個 TS2339」
 *    數量沒變、鍵也相同，那個新的錯就完全隱形。BlockSequenceRenderer.tsx 一個檔
 *    就背著 5 個 TS2339，這種一換一在那裡是很容易發生的。
 *
 * ⚠️ 代價要講明白：**把一個已列入基準的錯誤搬到別的檔（純改名／抽檔）會被判成新增**。
 *    那是刻意的取捨 —— 寧可要一個會講話的誤報（訊息會說「跑 --write-baseline 更新」），
 *    也不要一個安靜的漏報。
 */
const keyOf = (e) => `${e.file}|${e.code}|${e.text}`;

/**
 * 判定。
 *
 * 除了「數量不可以變多」，還要比對**內容**：修好一個、同時新增一個，數量沒變，
 * 但那確實是一個新的型別錯誤。只比數字的話它會溜過去。
 */
export function evaluateRatchet(current, baselineCount, baselineList, baselineSchemaVersion) {
  const count = current.length;

  // 基準檔的格式跟現在的比對鍵對不上 —— 這是**查出來的**不是猜的，所以可以斷言。
  // 放在最前面：格式不對的時候，底下算出來的「新增」清單沒有意義。
  if (Array.isArray(baselineList) && baselineList.length > 0 &&
      baselineSchemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false, count, baselineCount, added: [],
      message:
        `基準檔的格式版本是 ${baselineSchemaVersion ?? '（沒有）'}，現在的比對鍵需要 ${CURRENT_SCHEMA_VERSION}。\n` +
        `在對不上的格式下算出來的「新增」清單沒有意義，所以這裡不列。\n` +
        `跑 \`npm run typecheck:ratchet -- --write-baseline\` 重建基準再看差異。`,
    };
  }

  // 版本號對，但資料的形狀不對（手改過基準檔、合併衝突解壞了）。
  // 版本檢查對這種情況是結構性地看不見的 —— 它只讀那個宣告的數字，而被改壞的檔案
  // 正好就是在那個數字上說謊。少了這道，症狀是「39 條全部都是新的」，看的人無從下手。
  //
  // ⚠️ 這是**結構事實**（欄位在不在），不是從症狀反推成因 ——
  //    跟我先前拿掉的那個重疊率猜測不是同一種東西。
  if (Array.isArray(baselineList) && baselineList.length > 0) {
    const broken = baselineList.filter((e) => typeof e.text !== 'string').length;
    if (broken > 0) {
      return {
        ok: false, count, baselineCount, added: [],
        message:
          `基準檔宣告格式版本 ${CURRENT_SCHEMA_VERSION}，但其中 ${broken} 筆沒有 \`text\` 欄位 ——\n` +
          `那個格式每一筆都要有。多半是手改過或合併衝突解壞了。\n` +
          `跑 \`npm run typecheck:ratchet -- --write-baseline\` 重建。`,
      };
    }
  }

  let added = [];
  if (Array.isArray(baselineList)) {
    const pool = new Map();
    for (const e of baselineList) pool.set(keyOf(e), (pool.get(keyOf(e)) ?? 0) + 1);
    for (const e of current) {
      const k = keyOf(e);
      const left = pool.get(k) ?? 0;
      if (left > 0) pool.set(k, left - 1);
      else added.push(e);
    }
  } else if (count > baselineCount) {
    added = current.slice(baselineCount);
  }

  const ok = added.length === 0 && count <= baselineCount;

  let message;
  if (!ok) {
    const list = added.map((e) => `  ${e.file}:${e.line}  ${e.code}  ${e.text}`).join('\n');
    message =
      `型別錯誤變多了（出貨程式碼 ${count}，基準 ${baselineCount}）。\n` +
      `新增的 ${added.length} 個：\n${list}\n\n` +
      `這道門只擋「變多」，既有的 ${baselineCount} 個不擋任何人。\n` +
      `如果這些錯是刻意的，請在 PR 裡說明並更新 frontend/typecheck-baseline.json ——\n` +
      `那是一個看得見的 diff，不是偷偷把數字改大。\n\n` +
      `如果你只是**把既有的錯誤搬到別的檔**（改名／抽檔），那不是新增：\n` +
      `跑 \`npm run typecheck:ratchet -- --write-baseline\` 重建基準，並在 PR 說明是搬檔。`;
  } else if (count < baselineCount) {
    message =
      `型別錯誤從 ${baselineCount} 降到 ${count}。\n` +
      `請把 frontend/typecheck-baseline.json 的 shippedErrors 調降到 ${count}，把棘輪收緊 ——\n` +
      `不調降的話它會永遠停在舊數字，等於把剛修好的空間又讓出去。`;
  } else {
    message = `型別錯誤維持在基準 ${count}，沒有變多。`;
  }

  return { ok, count, baselineCount, added, message };
}
