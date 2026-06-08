/**
 * Tests for punctuationReinsert — Block 2 (Issue #2131).
 *
 * Run with:
 *   cd frontend && npm test -- punctuationReinsert
 */

import { describe, it, expect } from 'vitest';
import { reinsertPunctuation } from './punctuationReinsert';

describe('reinsertPunctuation', () => {
  it('inserts sentence-final 。 at end of matching text', () => {
    const target = '孟嘗君養了很多門客。';
    const raw = '孟嘗君養了很多門客';
    const result = reinsertPunctuation(raw, target);
    expect(result).toBe('孟嘗君養了很多門客。');
  });

  it('inserts mid-sentence comma 、', () => {
    const target = '春風吹、夏雨落。';
    const raw = '春風吹夏雨落';
    const result = reinsertPunctuation(raw, target);
    expect(result).toContain('、');
    expect(result).toContain('。');
  });

  it('returns rawTranscript unchanged when no target given', () => {
    const raw = '沒有標點';
    expect(reinsertPunctuation(raw, '')).toBe(raw);
  });

  it('returns rawTranscript unchanged when raw is empty', () => {
    expect(reinsertPunctuation('', '目標文字。')).toBe('');
  });

  it('does not add characters not present in rawTranscript', () => {
    const target = '孟嘗君養了很多門客。';
    const raw = '孟嘗君';
    const result = reinsertPunctuation(raw, target);
    // Should NOT append 。 because "門客" never matched
    expect(result).not.toContain('。');
    expect(result).toBe('孟嘗君');
  });

  it('returns rawTranscript unchanged when divergence is too high', () => {
    const target = '春風吹過田野。';
    // Completely different text — alignment confidence will be < 50%
    const raw = '下雨了下雨了好大的雨';
    const result = reinsertPunctuation(raw, target);
    expect(result).toBe(raw);
  });

  it('handles question marks and exclamation marks', () => {
    const target = '你好嗎？很好！';
    const raw = '你好嗎很好';
    const result = reinsertPunctuation(raw, target);
    expect(result).toContain('？');
    expect(result).toContain('！');
  });

  it('is idempotent: applying twice gives same result as once', () => {
    const target = '孟嘗君養了很多門客。';
    const raw = '孟嘗君養了很多門客';
    const once = reinsertPunctuation(raw, target);
    const twice = reinsertPunctuation(once, target);
    expect(twice).toBe(once);
  });
});
