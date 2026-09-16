/**
 * 逐字注音答案表的產生器（前端這一半）—— #3218
 *
 * ## 為什麼是「跑」而不是「移植」
 *
 * 讀音選擇的權威是出貨的那份 `polyphonicProcessor.ts`：樣式表是方大哥策展的，
 * 加上一/不變調、`skipPrev` 狀態機、`SPECIAL_DOUBLE_CHARACTERS`、`d` 欄位與
 * 字型槽的對應。**後端結構上無法重現它** —— #3215 移植過一次，吐出 `不 → ㄈㄨ`。
 *
 * 所以這支直接 import 真的那個 class，不重寫任何一行選擇邏輯。
 *
 * ## 輸出的是槽位不是注音
 *
 * 這支只回 `styleSet`（`0000`／`ss01`…）。槽位翻成注音由 Python 那半用
 * `extract_font_readings.py` 對**出貨的那顆字型**做 —— 字型是台灣讀音的唯一權威，
 * 記法轉換只有一份，不會漂移。
 *
 * 用法：node zhuyinAnswers.cjs <texts.json> <out.json>
 *   texts.json:  [{"key": "<hash>", "text": "…"}, …]
 *   out.json:    {"<hash>": ["0000", null, "ss01", …]}   // 逐字，非破音字為 null
 */
import fs from 'node:fs';
import { PolyphonicProcessor } from '../src/components/zhuyin/polyphonicProcessor';

type Item = { key: string; text: string };

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error('用法: node zhuyinAnswers.cjs <texts.json> <out.json>');
    process.exit(2);
  }
  // 路徑相對於 repo 的 frontend/（產生器由 Python 那半用固定 cwd 呼叫）
  const raw = JSON.parse(fs.readFileSync('public/data/poyin_db.json', 'utf8'));
  const proc = PolyphonicProcessor.instance as unknown as {
    polyphonicData: unknown;
    _loaded: boolean;
    process: (t: string) => { char: string; styleSet: string }[];
  };
  // 繞開 fetch()：抄既有測試 beforeAll 的做法，注入整包（真載入路徑是 removeComments(raw)，
  // 而 _comment 只影響註解欄位、不影響選擇）
  proc.polyphonicData = raw;
  proc._loaded = true;

  const items: Item[] = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const out: Record<string, (string | null)[]> = {};
  for (const it of items) {
    const chars = [...it.text];
    const res = proc.process(it.text);
    // ⛔ 對齊守衛不可省：整支的價值建立在「第 i 個輸出 == 原文第 i 個字」。
    //    一旦錯位，拿到的是一整份看起來合理、實際整串位移的答案（#3175 的形狀）。
    if (res.length !== chars.length) {
      console.error(`長度不符 key=${it.key}: 輸出 ${res.length} vs 原文 ${chars.length}`);
      process.exit(3);
    }
    for (let i = 0; i < chars.length; i++) {
      if (res[i].char !== chars[i]) {
        console.error(`字不符 key=${it.key} pos=${i}: 輸出「${res[i].char}」vs 原文「${chars[i]}」`);
        process.exit(3);
      }
    }
    out[it.key] = res.map((c) => c.styleSet ?? null);
  }
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.error(`寫出 ${Object.keys(out).length} 段`);
}

main();
