/**
 * 注音的斷言打在「字型會畫出來的讀音」上，不是 styleSet 字串。(#3177)
 *
 * ## 為什麼要有這一支
 *
 * `polyphonicProcessor.test.ts` 44 條全綠，而 `行`／`著` 在正式站的兩個最常用
 * 讀音是**反的** —— 銀行讀成 ㄒㄧㄥˊ、著作讀成 ㄓㄜ˙，錯了半年沒人發現。
 *
 * 原因是那些斷言停在 **styleSet 字串**（`expect(...).toBe('ss01')`），而註解寫
 * 「ss01 = xíng二聲」—— 出貨的字型說 `ss01 = hang2`。
 * **綠著的 golden set 鎖住的是一個錯的信念。**
 *
 * 這一支換掉兩個地基：
 *
 *   1. **真值來自出貨的字型**，不是註解。`__fixtures__/fontReadings.generated.json`
 *      由 `backend/scripts/extract_font_readings.py` 從
 *      `frontend/public/fonts/BpmfZihiSerif-Regular.ttf` 抽出來（cmap format 14 →
 *      `uniXXXX.ssNN` → 複合字符的第一個元件 `z_<拼音><聲調>`）。
 *      那份 fixture 會不會跟字型漂掉，由後端的
 *      `test_font_readings_match_shipped_font_3177.py` 盯著。
 *
 *   2. **資料用真的 `public/data/poyin_db.json`**，不是測試自己捏的縮小版。
 *      舊測試餵自己寫的 fixture —— 那等於連資料表對不對都沒在驗。
 *
 * ⛔ 不要把這裡的斷言改回 styleSet。那正是這支要防的事。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PolyphonicProcessor } from './polyphonicProcessor';
import fontReadings from './__fixtures__/fontReadings.generated.json';

const POYIN_DB = path.resolve(__dirname, '../../../public/data/poyin_db.json');

let processor: PolyphonicProcessor;

/** 整段文字跑真的處理器，回傳每個字實際會被畫出來的讀音。 */
function readingsOf(text: string): { char: string; styleSet: string; reading: string | null }[] {
  return processor.process(text).map(c => ({
    char: c.char,
    styleSet: c.styleSet,
    reading: (fontReadings as Record<string, Record<string, string>>)[c.char]?.[c.styleSet] ?? null,
  }));
}

/** 某個字在這段文字裡實際被畫出來的讀音。`index` 指定同字重複時取第幾個。 */
function readingOf(text: string, char: string, index = 0): string | null {
  const hits = readingsOf(text).filter(c => c.char === char);
  expect(hits.length, `「${char}」不在「${text}」的處理結果裡`).toBeGreaterThan(index);
  return hits[index].reading;
}

beforeAll(() => {
  const raw = JSON.parse(fs.readFileSync(POYIN_DB, 'utf-8'));
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  processor = PolyphonicProcessor.instance;
  (processor as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = {
    data: raw.data,
  };
  (processor as unknown as { _loaded: boolean })._loaded = true;
});

// ── 地基先驗：裁判本身是好的 ─────────────────────────────────────────────
describe('地基', () => {
  it('字型讀音表載得到，而且蓋住 poyin_db 有變體的每一個字', () => {
    const raw = JSON.parse(fs.readFileSync(POYIN_DB, 'utf-8'));
    const withVariants = Object.keys(raw.data).filter(
      ch => Array.isArray(raw.data[ch]?.v) && raw.data[ch].v.length > 0,
    );
    expect(withVariants.length).toBeGreaterThan(500);
    const missing = withVariants.filter(ch => !(ch in fontReadings));
    expect(missing, `這些字在 poyin_db 有變體卻不在字型讀音表裡：${missing.slice(0, 10)}`).toEqual([]);
  });

  it('每個 v[] 槽都翻譯得出讀音 —— 沒有「查不到」被當成通過', () => {
    // ⛔ 少了這條，readingOf() 回 null 時所有 `not.toBe(...)` 都會恆真。
    const unresolved = readingsOf('銀行流行著作看著了得有多難困難災難').filter(
      c => c.reading === null && c.char in fontReadings,
    );
    expect(unresolved).toEqual([]);
  });

  it('沒有任何字帶 `d` 欄位 —— 棘輪（#3177）', () => {
    // `d` 宣稱「這個字的字型預設是 v[N] 而不是 v[0]」。全庫唯二用過它的
    // 行／著，經字型實測證明那個宣稱是錯的，兩個字最常用的讀音因此反了半年。
    // 要再加回來，得先拿出字型說它是對的證據 —— 這條會擋下來。
    const raw = JSON.parse(fs.readFileSync(POYIN_DB, 'utf-8'));
    const withD = Object.entries(raw.data)
      .filter(([, e]) => e && typeof e === 'object' && 'd' in (e as object))
      .map(([ch]) => ch);
    expect(withD, `這些字帶了 d：${withD}。字型的 0000 就是 v[0]，加 d 會讓讀音對調`).toEqual([]);
  });

  it('裁判有牙齒：拿一個已知錯的 styleSet 去查，讀音真的會不一樣', () => {
    // 「行」的 0000 與 ss01 必須是不同的讀音，否則下面所有斷言都分不出對錯。
    const xing = (fontReadings as Record<string, Record<string, string>>)['行'];
    expect(xing['0000']).toBe('xing2');
    expect(xing['ss01']).toBe('hang2');
    expect(xing['0000']).not.toBe(xing['ss01']);
  });
});

// ── #3177：行／著 兩個最常用的讀音在正式站是反的 ────────────────────────
describe('#3177 行／著（6050 處中的 5607 處）', () => {
  it.each([
    ['銀行裡的行員', '行', 'hang2'],
    ['我去銀行', '行', 'hang2'],
    ['流行歌曲', '行', 'xing2'],
    ['行動電話', '行', 'xing2'],
    ['品行端正', '行', 'xing4'],
  ])('「%s」的「%s」應讀 %s', (text, char, expected) => {
    expect(readingOf(text, char)).toBe(expected);
  });

  it.each([
    ['他看著遠方', '著', 'zhe5'],
    ['穿著整齊', '著', 'zhe5'],
    ['這本書的著作', '著', 'zhu4'],
    ['著涼了', '著', 'zhao1'],
    ['著火了', '著', 'zhao2'],
    ['著色本', '著', 'zhuo2'],
  ])('「%s」的「%s」應讀 %s', (text, char, expected) => {
    expect(readingOf(text, char)).toBe(expected);
  });
});

// ── 不可退化的對照組 ────────────────────────────────────────────────────
describe('對照組（修完必須仍然正確）', () => {
  it.each([
    ['了解', '了', 'liao3'],
    ['他走了', '了', 'le5'],
    ['困難', '難', 'nan2'],
    ['難得', '難', 'nan2'],
    ['災難', '難', 'nan4'],
    ['難民', '難', 'nan4'],
    ['患難與共', '難', 'nan4'],
    ['多難興邦', '難', 'nan4'],
    ['他跑得快', '得', 'de5'],
    ['獲得冠軍', '得', 'de2'],
  ])('「%s」的「%s」仍讀 %s', (text, char, expected) => {
    expect(readingOf(text, char)).toBe(expected);
  });
});

// ── 一／不 的變調不可以被弄壞 ───────────────────────────────────────────
describe('一／不 變調（前端做對、pypinyin 結構上做不到的那一類）', () => {
  // ⚠️ 我第一版寫「一天 vs 一件 應該不一樣」，紅了 —— 而那是**我挑錯案例**：
  //    `一` 在句首會走 prevChar == null 那條，而「天」「件」都在 `toneSandhi.ts`
  //    的 nextCharSet1 裡，兩條都回 0000。
  //    ⚠️ 但**不要因此以為 `一天` 讀 yi1 是對的** —— `polyphonicProcessor.test.ts`
  //    把 `一天`／`一年`／`一起` 明確記成 known limitation（標準讀音是 yì tiān）。
  //    那是另一件事，不在這輪的範圍。這裡只挑**現在就會變調**的案例當對照組。
  it.each([
    ['買一張紙', '一', 'yi4'],   // 張 是一聲 → 一 變四聲
    ['拿一杯水', '一', 'yi4'],   // 杯 是一聲
    ['買一半', '一', 'yi2'],     // 半 是四聲 → 一 變二聲
    ['第一名', '一', 'yi1'],     // 序數，不變調
    ['一起走', '一', 'yi1'],     // 句首
  ])('「%s」的「%s」讀 %s', (text, char, expected) => {
    expect(readingOf(text, char)).toBe(expected);
  });

  it.each([
    ['我不去', '不', 'bu2'],      // 去 是四聲 → 不 變二聲
    ['不好意思', '不', 'bu4'],    // 好 是三聲 → 不 不變
  ])('「%s」的「%s」讀 %s', (text, char, expected) => {
    expect(readingOf(text, char)).toBe(expected);
  });

  it('這一類正是 pypinyin 給不出來的 —— 變調要真的有發生', () => {
    // 正向對照：如果整個變調機制死掉，上面每一條都會退化成同一個讀音。
    const readings = new Set(['買一張紙', '買一半', '第一名'].map(t => readingOf(t, '一')));
    expect(readings.size, `「一」在三種語境下應該有三種讀音，實際只有 ${[...readings]}`).toBe(3);
  });
});
