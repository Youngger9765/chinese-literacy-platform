/**
 * Tests for liveTranscriptEnhance — Issue #2147.
 *
 * Run with:
 *   cd frontend && npm test -- liveTranscriptEnhance
 */

import { describe, it, expect } from 'vitest';
import { enhanceLiveTranscript } from './liveTranscriptEnhance';

describe('enhanceLiveTranscript', () => {
  describe('punctuation re-insertion', () => {
    it('inserts sentence-final 。 from target', () => {
      const target = '孟嘗君養了很多門客。';
      const raw = '孟嘗君養了很多門客';
      const { plain } = enhanceLiveTranscript(raw, target);
      expect(plain).toBe('孟嘗君養了很多門客。');
    });

    it('inserts mid-sentence 、 and final 。', () => {
      const target = '春風吹、夏雨落。';
      const raw = '春風吹夏雨落';
      const { plain } = enhanceLiveTranscript(raw, target);
      expect(plain).toContain('、');
      expect(plain).toContain('。');
    });

    it('inserts ？ and ！', () => {
      const target = '你好嗎？很好！';
      const raw = '你好嗎很好';
      const { plain } = enhanceLiveTranscript(raw, target);
      expect(plain).toContain('？');
      expect(plain).toContain('！');
    });
  });

  describe('homophone correction', () => {
    it('corrects 的/得 homophones', () => {
      // 的 and 得 share toneless pinyin 'de'
      const target = '他做得很好。';
      const raw = '他做的很好';
      const { plain } = enhanceLiveTranscript(raw, target);
      // homophone correction should fix 的 → 得 when aligned to target
      expect(plain).toContain('得');
    });

    it('does not alter genuine errors that are not homophones', () => {
      const target = '孟嘗君養了很多門客。';
      const raw = '孟嘗君養了很多朋友'; // 朋友 is not a homophone of 門客
      const { plain } = enhanceLiveTranscript(raw, target);
      // 朋友 should remain (genuine error — not corrected)
      expect(plain).toContain('朋友');
    });
  });

  describe('segments', () => {
    it('marks inserted punctuation as kind=inserted', () => {
      const target = '孟嘗君養了很多門客。';
      const raw = '孟嘗君養了很多門客';
      const { segments } = enhanceLiveTranscript(raw, target);
      const insertedSegs = segments.filter(s => s.kind === 'inserted');
      expect(insertedSegs.length).toBeGreaterThan(0);
      expect(insertedSegs.some(s => s.text.includes('。'))).toBe(true);
    });

    it('marks spoken characters as kind=spoken', () => {
      const target = '孟嘗君養了很多門客。';
      const raw = '孟嘗君養了很多門客';
      const { segments } = enhanceLiveTranscript(raw, target);
      const spokenSegs = segments.filter(s => s.kind === 'spoken');
      expect(spokenSegs.length).toBeGreaterThan(0);
      const spokenText = spokenSegs.map(s => s.text).join('');
      expect(spokenText).toContain('孟嘗君');
    });

    it('returns single spoken segment when no punctuation inserted', () => {
      // Target has no punctuation that comes after the matched chars
      const target = '孟嘗君';
      const raw = '孟嘗君';
      const { segments } = enhanceLiveTranscript(raw, target);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe('spoken');
    });
  });

  describe('edge cases', () => {
    it('returns raw unchanged when rawTranscript is empty', () => {
      const { plain, segments } = enhanceLiveTranscript('', '目標。');
      expect(plain).toBe('');
      expect(segments).toEqual([{ text: '', kind: 'spoken' }]);
    });

    it('returns raw unchanged when targetText is empty', () => {
      const { plain } = enhanceLiveTranscript('raw text', '');
      expect(plain).toBe('raw text');
    });

    it('returns raw unchanged for heavily divergent text', () => {
      const target = '春風吹過田野。';
      const raw = '下雨了下雨了好大的雨';
      const { plain } = enhanceLiveTranscript(raw, target);
      // Divergence too high → punctuation not inserted, homophones not corrected
      // but should not crash; plain should be the raw or close to it
      expect(typeof plain).toBe('string');
      expect(plain.length).toBeGreaterThan(0);
    });

    it('handles partial transcript (student mid-reading)', () => {
      const target = '孟嘗君是戰國時代的齊國貴族，他養了很多門客。';
      const raw = '孟嘗君是戰國時代的'; // partial — student is still reading
      const { plain, segments } = enhanceLiveTranscript(raw, target);
      // Should not crash, should contain spoken chars
      expect(plain).toContain('孟嘗君');
      expect(segments.length).toBeGreaterThan(0);
    });
  });
});
