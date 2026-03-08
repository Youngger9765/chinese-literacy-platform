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
