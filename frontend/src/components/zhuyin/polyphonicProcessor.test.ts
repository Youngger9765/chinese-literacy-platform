/**
 * TDD tests for Issue #219: Polyphonic character (破音字) pronunciation bug.
 *
 * Bug: The style-set mapping between matched variant index (from poyin_db.json v[])
 * and the font's stylistic set code ('0000', 'ss01', ...) is incorrect for characters
 * whose font default pronunciation is NOT v[0] in the variant array.
 *
 * The BpmfIansui font has a per-character default pronunciation ('0000' = no selector).
 * For most characters this is v[0], but for some (e.g. 行, 著) it is v[1].
 * A new optional 'd' (default variant index) field in poyin_db.json encodes which
 * v[] index maps to '0000'. When absent, 'd' defaults to 0.
 *
 * Test cases:
 *   行走 → 行 should get 'ss01' (xíng二聲)  [currently wrong: gets '0000' = háng]
 *   銀行 → 行 should get '0000' (háng二聲, font default)
 *   走著 → 著 should get 'ss01' (zhe5 輕聲)  [currently wrong: gets '0000' = zhù]
 *   著作 → 著 should get '0000' (zhù四聲, font default)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PolyphonicProcessor } from './polyphonicProcessor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a minimal polyphonic data fixture that covers just the characters
 * needed for our tests.  This avoids a real fetch() in unit tests.
 */
function injectTestData(processor: PolyphonicProcessor) {
  const testData = {
    data: {
      // 行: d=1 → font default is v[1]=háng.  v[0]=xíng patterns, v[1]=háng patterns.
      '行': {
        s: 4,
        d: 1,
        v: [
          '流*/*頭/*動/*程/*為/人*/五*/一*人',           // v[0] xíng二聲
          '銀*/換*/*列/*號/排*/同*/內*/*家/外*/*員',     // v[1] háng二聲 (font default)
          '品*/德*/*狀/操*/獸*',                          // v[2] xíng四聲
          '**如也',                                       // v[3] háng四聲
        ],
      },

      // 著: d=1 → font default is v[1]=zhù.  v[0]=zhe5 patterns (large list), v[1]=zhù patterns.
      '著': {
        s: 5,
        d: 1,
        v: [
          '穿*/有*/走*/戴*/帶*/持*/過*/隨*/抱*/看*/拿*/坐*/提*/打*/放*/依*/',  // v[0] zhe5 (catch-all)
          '*作/*述/名*/土*/顯*/巨*/鉅*/*明/譯*/拙*/昭*/*稱/*名',               // v[1] zhù四聲 (font default)
          '*涼/*急/*風/*慌',                              // v[2] zhāo一聲
          '*火/睡*/*了/*店/正*/*想/*迷/點*',             // v[3] zháo二聲
          '*色/附*/衣*/*陸/一*/*落/黏*/粘*/不*痕跡',     // v[4] zhuó二聲
        ],
      },

      // 的: d=0 (default) → font default is v[0]=de1. Should NOT be broken by the fix.
      '的': {
        s: 3,
        d: 0,
        v: [
          '目*節/目*事/目*完/項目*/',   // v[0] de1 (font default, catch-all via trailing /)
          '*確',                         // v[1] di2
          '目*/標*/爾*摩/羅*海/驀*',    // v[2] di4
        ],
      },

      // 地: special-cased in processor, include to verify no regression
      '地': {
        s: 2,
        v: [
          '',       // v[0] di4 (font default)
          '成功*',  // v[1] de5
        ],
      },
    },
  };

  // Bypass loadPolyphonicData() via the private field (cast to any for testing)
  (processor as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = testData;
  (processor as unknown as { _loaded: boolean })._loaded = true;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PolyphonicProcessor — Issue #219: polyphonic character ss mapping', () => {
  let processor: PolyphonicProcessor;

  beforeAll(() => {
    // Create a fresh instance each test run (bypass singleton for isolation)
    (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
    processor = PolyphonicProcessor.instance;
    injectTestData(processor);
  });

  // ── 行 tests ────────────────────────────────────────────────────────────

  describe('行 (xíng / háng)', () => {
    it('行走 → 行 gets ss01 (xíng二聲, first variant)', () => {
      const result = processor.process('行走');
      const hang = result.find(c => c.char === '行');
      expect(hang).toBeDefined();
      expect(hang!.styleSet).toBe('ss01');
    });

    it('銀行 → 行 gets 0000 (háng二聲, font default)', () => {
      const result = processor.process('銀行');
      const hang = result.find(c => c.char === '行');
      expect(hang).toBeDefined();
      expect(hang!.styleSet).toBe('0000');
    });

    it('流行 → 行 gets ss01 (xíng二聲)', () => {
      const result = processor.process('流行');
      const hang = result.find(c => c.char === '行');
      expect(hang).toBeDefined();
      expect(hang!.styleSet).toBe('ss01');
    });

    it('行動 → 行 gets ss01 (xíng二聲, *動 pattern in v[0])', () => {
      const result = processor.process('行動');
      const hang = result.find(c => c.char === '行');
      expect(hang).toBeDefined();
      expect(hang!.styleSet).toBe('ss01');
    });

    it('同行 → 行 gets 0000 (háng, v[1] match)', () => {
      const result = processor.process('同行');
      const hang = result.find(c => c.char === '行');
      expect(hang).toBeDefined();
      expect(hang!.styleSet).toBe('0000');
    });
  });

  // ── 著 tests ────────────────────────────────────────────────────────────

  describe('著 (zhe5 / zhù / zhāo / zháo / zhuó)', () => {
    it('走著 → 著 gets ss01 (zhe5輕聲)', () => {
      const result = processor.process('走著');
      const zhu = result.find(c => c.char === '著');
      expect(zhu).toBeDefined();
      expect(zhu!.styleSet).toBe('ss01');
    });

    it('著作 → 著 gets 0000 (zhù四聲, font default)', () => {
      const result = processor.process('著作');
      const zhu = result.find(c => c.char === '著');
      expect(zhu).toBeDefined();
      expect(zhu!.styleSet).toBe('0000');
    });

    it('穿著 → 著 gets ss01 (zhe5輕聲)', () => {
      const result = processor.process('穿著');
      const zhu = result.find(c => c.char === '著');
      expect(zhu).toBeDefined();
      expect(zhu!.styleSet).toBe('ss01');
    });

    it('著涼 → 著 gets ss02 (zhāo一聲, v[2] match)', () => {
      const result = processor.process('著涼');
      const zhu = result.find(c => c.char === '著');
      expect(zhu).toBeDefined();
      expect(zhu!.styleSet).toBe('ss02');
    });
  });

  // ── 的 regression tests ────────────────────────────────────────────────

  describe('的 (de / di) — regression: fix must not break this char', () => {
    it('一般的 → 的 gets 0000 (de1, catch-all via empty pattern)', () => {
      const result = processor.process('一般的');
      const de = result.find(c => c.char === '的');
      expect(de).toBeDefined();
      expect(de!.styleSet).toBe('0000');
    });

    it('的確 → 的 gets ss01 (di2, v[1] *確 match)', () => {
      // 的確: 的 at index 0, nextChar=確, isFirstChar=True → first pass skipped
      // Second pass: v[1]='*確', starts with *, pos=0, start=0, end=2 ≤ 2
      // But isLastChar depends on nextChar=確. '確' IS a Chinese char → isLastChar=false
      // matchPattern: text[0..2)='的確', pattern.replaceAll('*','的')='的確' → MATCH
      const result = processor.process('的確');
      const de = result.find(c => c.char === '的');
      expect(de).toBeDefined();
      expect(de!.styleSet).toBe('ss01');
    });
  });

  // ── 地 regression tests ────────────────────────────────────────────────

  describe('地 (di4 / de5) — regression: special-cased character', () => {
    it('大地 → 地 gets 0000 (di4, default for 地)', () => {
      const result = processor.process('大地');
      const di = result.find(c => c.char === '地');
      expect(di).toBeDefined();
      expect(di!.styleSet).toBe('0000');
    });
  });
});

// ---------------------------------------------------------------------------
// 一 tone sandhi regression tests (Issue #638)
// ---------------------------------------------------------------------------
//
// Documents the CURRENT behavior of getNewToneForYiBu for 一.
// Standard Mandarin tone sandhi rules for 一:
//   Before 4th tone → 2nd tone (ss01)  e.g. 一個 yí gè
//   Before 1st/2nd/3rd tone → 4th tone (ss02)  e.g. 一天 yì tiān
//   In number context (第一, 十一, 一百...) → 1st tone (0000)
//   Standalone → 1st tone (0000)
//
// Known limitations (tracked in Issue #611):
//   - When 一 is the FIRST character in text (prevChar == null), the processor
//     returns 0000 (1st tone) regardless of the following character tone.
//     This means 一年/一天/一起 at the START of text incorrectly show 1st tone.
//     This is a pedagogical simplification — correct for in-context reading
//     where 一 is preceded by other characters.
//   - 一個/一是 also use specialYiCases/nextCharSet1 → 0000 (1st tone).
//     Standard pronunciation for 一個 is yí gè (2nd tone), but the app
//     treats it as 1st for simplicity.
//
// These tests document CURRENT behavior so regressions are caught.
// When fixing the linguistic accuracy (Issue #611), update tests accordingly.

import { getToneForChar } from '../zhuyin/toneData';

describe('一 tone sandhi regression tests (Issue #638)', () => {
  let proc: import('../zhuyin/polyphonicProcessor').PolyphonicProcessor;

  beforeAll(async () => {
    const { PolyphonicProcessor } = await import('../zhuyin/polyphonicProcessor');
    (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
    proc = PolyphonicProcessor.instance;
    // Inject empty polyphonic data — 一/不 sandhi uses toneData.ts, not polyphonicData
    (proc as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = { data: {} };
    (proc as unknown as { _loaded: boolean })._loaded = true;
  });

  const ssOf = (text: string) =>
    proc.process(text).find(c => c.char === '一')?.styleSet;

  describe('number / ordinal context → 1st tone (0000)', () => {
    it('一百 → 0000 (一 is first char; 百 is in nextCharSet1)', () => {
      expect(ssOf('一百')).toBe('0000');
    });
    it('一千 → 0000 (千 is in nextCharSet1)', () => {
      expect(ssOf('一千')).toBe('0000');
    });
    it('一萬 → 0000 (萬 is in nextCharSet1)', () => {
      expect(ssOf('一萬')).toBe('0000');
    });
    it('第一 → 0000 (第 is in prevCharSet1 → ordinal context)', () => {
      expect(ssOf('第一')).toBe('0000');
    });
    it('十一 → 0000 (十 is in prevCharSet1 → number context)', () => {
      expect(ssOf('十一')).toBe('0000');
    });
  });

  describe('一 as first character in text → currently 0000 (known limitation)', () => {
    // NOTE: Standard tone sandhi would give ss02 for 一天/一年/一起 and ss01 for 一個.
    // The processor returns 0000 because prevChar==null triggers the early-return path.
    // See Issue #611 for the planned fix.
    it('一天 → 0000 (known limitation: should be ss02, yì tiān)', () => {
      expect(getToneForChar('天')).toBe(1);
      expect(ssOf('一天')).toBe('0000');
    });
    it('一年 → 0000 (known limitation: should be ss02, yì nián)', () => {
      expect(getToneForChar('年')).toBe(2);
      expect(ssOf('一年')).toBe('0000');
    });
    it('一起 → 0000 (known limitation: should be ss02, yì qǐ)', () => {
      expect(getToneForChar('起')).toBe(3);
      expect(ssOf('一起')).toBe('0000');
    });
    it('一個 → 0000 (specialYiCases override; standard yí gè would be ss01)', () => {
      expect(getToneForChar('個')).toBe(4);
      expect(ssOf('一個')).toBe('0000');
    });
  });

  describe('tone sandhi DOES apply when 一 has a preceding char + nextChar not in nextCharSet1', () => {
    // Use characters NOT in nextCharSet1 or specialYiCases to exercise the real sandhi path.
    // 種 (zhǒng, 3rd tone) and 步 (bù, 4th tone) are not in any exception sets.
    it('做一種 → 一 gets ss02 (4th tone; 種 = 3rd, prevChar 做 not in prevCharSet1)', () => {
      expect(getToneForChar('種')).toBe(3);
      const result = proc.process('做一種');
      expect(result.find(c => c.char === '一')?.styleSet).toBe('ss02');
    });
    it('做一步 → 一 gets ss01 (2nd tone; 步 = 4th, before-4th-tone sandhi)', () => {
      expect(getToneForChar('步')).toBe(4);
      const result = proc.process('做一步');
      expect(result.find(c => c.char === '一')?.styleSet).toBe('ss01');
    });
  });

  describe('standalone → 1st tone (0000)', () => {
    it('standalone 一 → 0000', () => {
      expect(ssOf('一')).toBe('0000');
    });
  });
});

// ---------------------------------------------------------------------------
// 不 tone sandhi characterization tests (Issue #1843)
// ---------------------------------------------------------------------------
//
// 不 tone sandhi rules:
//   Before 4th tone → 2nd tone (ss01)  e.g. 不是 bú shì
//   Before 1st/2nd/3rd/5th tone → remain 4th tone (0000)  e.g. 不知 bù zhī
//   Special phrases: 不禁/不菲/不勝/不著/不了/不好/不假 → 0000 (unchanged)
//   Special phrase: 不當 → ss01 (2nd tone)
//   Standalone → 0000 (4th tone)

describe('不 tone sandhi characterization tests (Issue #1843)', () => {
  let proc: import('./polyphonicProcessor').PolyphonicProcessor;

  beforeAll(async () => {
    const { PolyphonicProcessor } = await import('./polyphonicProcessor');
    (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
    proc = PolyphonicProcessor.instance;
    (proc as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = { data: {} };
    (proc as unknown as { _loaded: boolean })._loaded = true;
  });

  const ssOfBu = (text: string) =>
    proc.process(text).find(c => c.char === '不')?.styleSet;

  it('standalone 不 → 0000 (4th tone)', () => {
    expect(ssOfBu('不')).toBe('0000');
  });

  it('不是 → 0000 (是 is 4th tone but nextTone=4 → ss01, BUT 是 is in nextCharSet1 check? No — let test document actual)', () => {
    // 是 is in nextCharSet1, so 一 before 是 is special-cased.
    // For 不, we check specialBuCases first (是 not in it), then nextTone.
    // getToneForChar('是') = 4, so → ss01
    expect(getToneForChar('是')).toBe(4);
    expect(ssOfBu('不是')).toBe('ss01');
  });

  it('不知 → 0000 (知 is 1st tone → remain 4th)', () => {
    expect(getToneForChar('知')).toBe(1);
    expect(ssOfBu('不知')).toBe('0000');
  });

  it('不同 → 0000 (同 is 2nd tone → remain 4th)', () => {
    expect(getToneForChar('同')).toBe(2);
    expect(ssOfBu('不同')).toBe('0000');
  });

  it('不好 → 0000 (specialBuCases: 好 → 0000)', () => {
    expect(ssOfBu('不好')).toBe('0000');
  });

  it('不當 → ss01 (specialBuCases: 當 → ss01, 2nd tone)', () => {
    expect(ssOfBu('不當')).toBe('ss01');
  });

  it('不禁 → 0000 (specialBuCases override)', () => {
    expect(ssOfBu('不禁')).toBe('0000');
  });
});

// ---------------------------------------------------------------------------
// 地 special phrase (de5) characterization tests (Issue #1843)
// ---------------------------------------------------------------------------
//
// 地 is special-cased: PHRASES_ENDS_WITH_DI set determines de5 vs di4.
// Three-char phrase = prev2Char + prevChar + '地'
//   If phrase in PHRASES_ENDS_WITH_DI → ss01 (index=1, de5)
//   Otherwise → 0000 (index=0, di4, the default)

describe('地 de5/di4 characterization tests (Issue #1843)', () => {
  let proc: import('./polyphonicProcessor').PolyphonicProcessor;

  beforeAll(async () => {
    const { PolyphonicProcessor } = await import('./polyphonicProcessor');
    (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
    proc = PolyphonicProcessor.instance;
    (proc as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = {
      data: {
        '地': { s: 2, v: ['', '成功*'] },
      },
    };
    (proc as unknown as { _loaded: boolean })._loaded = true;
  });

  it('大地 → 0000 (di4, not in PHRASES_ENDS_WITH_DI)', () => {
    const result = proc.process('大地');
    expect(result.find(c => c.char === '地')?.styleSet).toBe('0000');
  });

  it('快樂地 → ss01 (de5, in PHRASES_ENDS_WITH_DI)', () => {
    const result = proc.process('快樂地');
    expect(result.find(c => c.char === '地')?.styleSet).toBe('ss01');
  });

  it('靜靜地 → ss01 (de5, in PHRASES_ENDS_WITH_DI)', () => {
    const result = proc.process('靜靜地');
    expect(result.find(c => c.char === '地')?.styleSet).toBe('ss01');
  });

  it('走在地上 → 0000 (di4, 在地 not in PHRASES_ENDS_WITH_DI)', () => {
    // prev2=在, prevChar=地, but we look at char=地: prev2=走, prevChar=在
    // threeCharPhrase = '走在地' — not in set
    const result = proc.process('走在地上');
    expect(result.find(c => c.char === '地')?.styleSet).toBe('0000');
  });
});

// ---------------------------------------------------------------------------
// double-character special pairs characterization tests (Issue #1843)
// ---------------------------------------------------------------------------
//
// SPECIAL_DOUBLE_CHARACTERS: pair → styleSet
// Both chars in the pair get the SAME styleSet (or 0000 when ss00).
// Context overrides exist for some pairs.

describe('double-character special pairs (Issue #1843)', () => {
  let proc: import('./polyphonicProcessor').PolyphonicProcessor;

  beforeAll(async () => {
    const { PolyphonicProcessor } = await import('./polyphonicProcessor');
    (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
    proc = PolyphonicProcessor.instance;
    (proc as unknown as { polyphonicData: unknown; _loaded: boolean }).polyphonicData = {
      data: {
        '重': { s: 2, v: ['', ''] },
        '行': { s: 4, d: 1, v: ['流*', '銀*', '品*', '**如也'] },
        '好': { s: 2, v: ['', ''] },
        '數': { s: 2, v: ['', ''] },
        '晃': { s: 2, v: ['', ''] },
      },
    };
    (proc as unknown as { _loaded: boolean })._loaded = true;
  });

  it('重重 → both chars get ss01 (SPECIAL_DOUBLE_CHARACTERS default)', () => {
    const result = proc.process('重重');
    expect(result[0].char).toBe('重');
    expect(result[0].styleSet).toBe('ss01');
    expect(result[1].char).toBe('重');
    expect(result[1].styleSet).toBe('ss01');
  });

  it('重重的 → both chars get 0000 (context override: nextChar=的)', () => {
    const result = proc.process('重重的');
    expect(result[0].char).toBe('重');
    expect(result[0].styleSet).toBe('0000');
    expect(result[1].char).toBe('重');
    expect(result[1].styleSet).toBe('0000');
  });

  it('好好 → both chars get 0000 (ss00 in map → renders as 0000)', () => {
    const result = proc.process('好好');
    expect(result[0].char).toBe('好');
    expect(result[0].styleSet).toBe('0000');
    expect(result[1].char).toBe('好');
    expect(result[1].styleSet).toBe('0000');
  });

  it('數數 → both chars get ss01', () => {
    const result = proc.process('數數');
    expect(result[0].char).toBe('數');
    expect(result[0].styleSet).toBe('ss01');
    expect(result[1].char).toBe('數');
    expect(result[1].styleSet).toBe('ss01');
  });
});

// ---------------------------------------------------------------------------
// buildZhuyinString PUA selector characterization tests (Issue #1843)
// ---------------------------------------------------------------------------
//
// buildZhuyinString appends a PUA variant selector for non-default style sets.
// Only ss01–ss05 trigger PUA (SS_MAPPING). '0000' = no selector appended.

import { buildZhuyinString } from './polyphonicProcessor';
import { SS_MAPPING } from './bopomoConstants';

describe('buildZhuyinString PUA selector (Issue #1843)', () => {
  it('0000 styleSet → no PUA selector appended', () => {
    const result = buildZhuyinString([{ char: '行', styleSet: '0000' }]);
    expect(result).toBe('行');
    expect(result.length).toBe(1);
  });

  it('ss01 styleSet → PUA selector E01E1 appended after char', () => {
    const result = buildZhuyinString([{ char: '行', styleSet: 'ss01' }]);
    // U+E01E1 is above U+FFFF → surrogate pair (2 UTF-16 code units)
    // result.length = 1 (行) + 2 (surrogate pair for U+E01E1) = 3
    expect(result.length).toBe(3);
    expect(result[0]).toBe('行');
    expect(result.codePointAt(1)).toBe(parseInt(SS_MAPPING['ss01'], 16));
  });

  it('ss02 styleSet → PUA selector E01E2 appended', () => {
    const result = buildZhuyinString([{ char: '著', styleSet: 'ss02' }]);
    // U+E01E2 → surrogate pair → length 3
    expect(result.length).toBe(3);
    expect(result.codePointAt(1)).toBe(parseInt(SS_MAPPING['ss02'], 16));
  });

  it('mixed: 0000 + ss01 + 0000 → only middle char gets PUA', () => {
    const result = buildZhuyinString([
      { char: '銀', styleSet: '0000' },
      { char: '行', styleSet: 'ss01' },
      { char: '家', styleSet: '0000' },
    ]);
    // 銀(1) + 行(1) + PUA(1) + 家(1) = 4 code units
    // But PUA is in supplementary plane (U+E01E1), so it's 2 UTF-16 code units
    // result.length = 1 + 1 + 2 + 1 = 5? No: U+E01E1 is BMP? 0xE01E1 > 0xFFFF → surrogate pair → 2 code units
    // Actually let's use codePointAt to verify
    expect(result).toContain('銀');
    expect(result).toContain('行');
    expect(result).toContain('家');
    // 銀 has no PUA
    const yinIdx = result.indexOf('銀');
    expect(result.codePointAt(yinIdx + 1)).toBe('行'.codePointAt(0)); // next is 行, not PUA
    // 行 has PUA selector
    const hangIdx = result.indexOf('行');
    expect(result.codePointAt(hangIdx + 1)).toBe(parseInt(SS_MAPPING['ss01'], 16));
  });

  it('unknown styleSet (not in SS_MAPPING) → no PUA appended (graceful)', () => {
    // 'ss00' is used internally as sentinel but not in SS_MAPPING
    const result = buildZhuyinString([{ char: '行', styleSet: 'ss00' }]);
    expect(result).toBe('行');
    expect(result.length).toBe(1);
  });
});
