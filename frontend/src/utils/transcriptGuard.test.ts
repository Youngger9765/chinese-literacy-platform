import { describe, expect, it } from 'vitest';
import {
  maxPlausibleNormChars,
  pickConservativeTranscript,
  truncateTranscriptToNormLength,
} from './transcriptGuard';

const TARGET =
  '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';

const LONG_TARGET =
  '中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，為了要在競爭中勝出，各國都在搶傑出的管理人才，其中最有名的人才，就是齊國的孟嘗君。孟嘗君是有錢的貴族，最讓人津津樂道的是他在家裡養了三千名食客，食客就是在家裡吃飯的客人，三千人開飯的場面一眼望不完，真是非常壯觀。只要自認為有本事的人來投奔孟嘗君，他二話不說，總是張開雙手歡迎。這些食客具備各式各樣的才能，可以隨時幫他解決各種問題。';

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

  it('uses short Gemini when Web Speech is empty', () => {
    const gemini = '公元前299年';
    expect(pickConservativeTranscript(gemini, '', TARGET, 15_000)).toBe(gemini);
  });

  it('caps full-paragraph Gemini when Web Speech is empty and recording is short', () => {
    const gemini = LONG_TARGET;
    const capped = pickConservativeTranscript(gemini, '', LONG_TARGET, 12_000);
    expect(capped).not.toBe(gemini);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.length).toBeLessThan(gemini.length);
    expect(capped.startsWith('中國的戰國時期')).toBe(true);
  });

  it('rejects full-paragraph Gemini when Web Speech empty and duration unknown', () => {
    expect(pickConservativeTranscript(LONG_TARGET, '', LONG_TARGET)).toBe('');
  });
});

describe('truncateTranscriptToNormLength', () => {
  it('keeps a prefix within normalized length budget', () => {
    const text = '中國的戰國時期，有七個國家';
    const out = truncateTranscriptToNormLength(text, 8);
    expect(out).toBe('中國的戰國時期，有');
  });
});

describe('maxPlausibleNormChars', () => {
  it('scales with duration', () => {
    expect(maxPlausibleNormChars(12_000)).toBeLessThan(maxPlausibleNormChars(60_000));
  });
});
