import { describe, expect, it } from 'vitest';
import { pickConservativeTranscript } from './transcriptGuard';

const TARGET =
  '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';

describe('pickConservativeTranscript', () => {
  it('keeps Gemini when it is only slightly longer than Web Speech', () => {
    const web = '公元前299年';
    const gemini = '公元前299年，秦昭王';
    expect(pickConservativeTranscript(gemini, web, TARGET)).toBe(gemini);
  });

  it('falls back to Web Speech when Gemini looks like the full paragraph', () => {
    const web = '公元前299年';
    const gemini = TARGET;
    expect(pickConservativeTranscript(gemini, web, TARGET)).toBe(web);
  });

  it('falls back when Gemini is much longer than Web Speech', () => {
    const web = '公元前';
    const gemini = '公元前299年秦昭王聽說孟嘗君';
    expect(pickConservativeTranscript(gemini, web, TARGET)).toBe(web);
  });

  it('uses Gemini when Web Speech is empty', () => {
    const gemini = '公元前299年';
    expect(pickConservativeTranscript(gemini, '', TARGET)).toBe(gemini);
  });
});
