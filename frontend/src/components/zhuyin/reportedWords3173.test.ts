/**
 * 使用者回報的三個字：功夫「了」「得」、有多「難」（#3173）
 *
 * ## 回報內容
 *
 * 課程 20013《正太與小豬：武僧的養成之路》（L0130）的重點朗讀頁：
 *
 *   功夫了得   了 標成 ㄌㄜ˙，應為 ㄌㄧㄠˇ
 *   功夫了得   得 標成 ㄉㄜ˙，應為 ㄉㄜˊ      ← 使用者沒提，查的時候一起發現的
 *   有多難     難 標成 ㄋㄢˋ，應為 ㄋㄢˊ
 *
 * ## ⭐ 斷言打在「字型會畫出來的讀音」，不是 styleSet 字串
 *
 * `poyin_db.json` 本身**沒有讀音**，只有樣式與變體索引；讀音在字型裡 ——
 * `BpmfZihiSerif-Regular.ttf` 的變體字符是複合字符，第一個元件叫 `z_<拼音><聲調>`。
 *
 * 這件事不是形式問題。既有的 `polyphonicProcessor.test.ts` **44 條全綠**，
 * 而 `行`／`著` 最常用的兩個讀音在正式站是反的（#3177）——
 * 因為那些斷言停在 `'ss01'`，註解寫「ss01 = xíng二聲」而字型說 `ss01 = hang2`。
 * **綠著的 golden set 鎖住的是一個錯的信念。**
 *
 * 下面這張表由 `backend/scripts/extract_font_readings.py` 對**出貨的那顆字型**
 * 實際解出（2026-09-12）。#3177 會引進自動生成的完整 fixture；
 * 這裡只列本票用到的三個字，避免兩條分支改同一個檔。
 *
 * ## 三個根因不一樣，所以修法也不一樣
 *
 * - `了`：v[1]（ㄌㄧㄠˇ 那組）沒有 `*得` → 落到 v[0] 的空樣式 catch-all
 * - `得`：v[0]（ㄉㄜˊ 那組）沒有 `了*`。⚠️ **不可以改去拿掉 v[1] 尾巴那個空樣式** ——
 *         輕聲當 catch-all 是對的（「跑得快」就該是輕聲），拿掉會弄壞所有沒匹配到的 `得`
 * - `難`：v[1]（ㄋㄢˋ 那組）含 `多*`，把「有多難」當成「多難興邦」。
 *         而 `多難興邦` 在全庫課文出現 **0 次**（2026-09-12 掃 2445 個課程檔），
 *         所以拿掉 `多*` 零風險
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { PolyphonicProcessor } from './polyphonicProcessor';

/** 從出貨字型 BpmfZihiSerif-Regular.ttf 解出（z_<拼音><聲調> 元件名） */
const FONT_READINGS: Record<string, Record<string, string>> = {
  了: { '0000': 'le5', ss01: 'liao3' },
  得: { '0000': 'de2', ss01: 'de5', ss02: 'dei3' },
  難: { '0000': 'nan2', ss01: 'nan4', ss02: 'nuo2' },
};

let proc: PolyphonicProcessor;

beforeAll(() => {
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/data/poyin_db.json'), 'utf8'),
  );
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  proc = PolyphonicProcessor.instance;
  (proc as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = raw;
  (proc as unknown as { _loaded: boolean })._loaded = true;
});

/** 跑真的處理器，把 styleSet 用字型表翻成讀音 */
function reading(text: string, char: string, nth = 0): string {
  const out = proc.process(text);
  const hits = out.filter((c) => c.char === char);
  if (hits.length <= nth) {
    throw new Error(`「${text}」裡找不到第 ${nth + 1} 個「${char}」—— 輸入或處理器有問題`);
  }
  const ss = hits[nth].styleSet;
  const r = FONT_READINGS[char]?.[ss];
  if (!r) throw new Error(`字型表沒有 ${char} 的 ${ss} —— 表過期或 styleSet 超出範圍`);
  return r;
}

describe('#3173 使用者回報的三個字', () => {
  it('⭐ 功夫「了」得 → ㄌㄧㄠˇ', () => {
    expect(reading('功夫了得', '了')).toBe('liao3');
  });

  it('⭐ 功夫了「得」 → ㄉㄜˊ', () => {
    expect(reading('功夫了得', '得')).toBe('de2');
  });

  it('⭐ 根本感覺不出來有多「難」 → ㄋㄢˊ', () => {
    expect(reading('根本感覺不出來有多難', '難')).toBe('nan2');
  });
});

describe('#3173 不可退化的對照組', () => {
  // 少了這一組，「全部回預設」也會讓上面三條綠 —— 那什麼都沒證明
  it.each([
    ['了解', '了', 'liao3'],
    ['他走了', '了', 'le5'],
    ['受不了', '了', 'liao3'],
    ['困難', '難', 'nan2'],
    ['難得', '難', 'nan2'],
    ['災難', '難', 'nan4'],
    ['難民', '難', 'nan4'],
    ['患難與共', '難', 'nan4'],
    ['多難興邦', '難', 'nan4'],
    ['他跑得快', '得', 'de5'],
    ['獲得冠軍', '得', 'de2'],
    ['難得一見', '得', 'de2'],
    ['說得很好', '得', 'de5'],
  ])('「%s」的「%s」仍然是 %s', (word, char, want) => {
    expect(reading(word, char)).toBe(want);
  });
});

describe('#3173 正向對照：量具本身沒壞', () => {
  it('字型表涵蓋本票用到的三個字，且每個都有多個讀音', () => {
    for (const ch of ['了', '得', '難']) {
      expect(Object.keys(FONT_READINGS[ch]).length).toBeGreaterThan(1);
    }
  });

  it('處理器真的在做事 —— 同一個字在不同詞裡會給出不同讀音', () => {
    // 這條若紅，代表處理器整個沒動作，上面所有斷言都不算數
    expect(reading('了解', '了')).not.toBe(reading('他走了', '了'));
    expect(reading('災難', '難')).not.toBe(reading('困難', '難'));
  });
});
