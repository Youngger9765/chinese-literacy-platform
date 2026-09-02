/**
 * #3023 — playback-rate control for the *demo* reading voice.
 *
 * Teachers running 課後學習扶助 reported the 重點朗讀 demo reads too fast.
 * Measured on prod (21 chars / 4.608s) that voice is 273 字/分, while the
 * worksheet's own reading_benchmark.levels puts the top student band at
 * ＞231 -- so the model the student is asked to imitate is faster than the
 * best band the same worksheet defines.
 *
 * Azure's SSML rate is baked into the cached audio (cache key is
 * sha256(raw_text) with no provider/voice/rate in it, CLAUDE.md), so
 * re-synthesis is the expensive route. Client-side playbackRate costs
 * nothing and additionally lets one student slow down without slowing
 * everyone -- which the "different students need different speeds" case
 * actually wants.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TTS_RATE_STORAGE_KEY,
  TTS_RATE_OPTIONS,
  DEFAULT_TTS_RATE,
  getTtsPlaybackRate,
  setTtsPlaybackRate,
  applyDemoPlaybackRate,
} from '../ttsRate';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('#3023 getTtsPlaybackRate', () => {
  it('defaults to DEFAULT_TTS_RATE when nothing is stored', () => {
    expect(getTtsPlaybackRate()).toBe(DEFAULT_TTS_RATE);
  });

  it('round-trips a stored choice', () => {
    setTtsPlaybackRate(0.75);
    expect(getTtsPlaybackRate()).toBe(0.75);
  });

  it('every offered option survives the round trip', () => {
    for (const opt of TTS_RATE_OPTIONS) {
      setTtsPlaybackRate(opt.value);
      expect(getTtsPlaybackRate(), `option ${opt.label}`).toBe(opt.value);
    }
  });

  // A rate of 0 or a negative number silences or breaks the element; a huge
  // rate is unintelligible. A corrupted/hand-edited value must not reach
  // an <audio> element.
  it.each([
    ['0', 'zero'],
    ['-1', 'negative'],
    ['99', 'absurdly fast'],
    ['0.01', 'absurdly slow'],
    ['abc', 'not a number'],
    ['', 'empty'],
    ['NaN', 'literal NaN'],
    ['Infinity', 'literal Infinity'],
  ])('falls back to the default for a stored value of %s (%s)', (raw) => {
    localStorage.setItem(TTS_RATE_STORAGE_KEY, raw);
    expect(getTtsPlaybackRate()).toBe(DEFAULT_TTS_RATE);
  });

  it('survives localStorage throwing (private browsing / ITP)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => getTtsPlaybackRate()).not.toThrow();
    expect(getTtsPlaybackRate()).toBe(DEFAULT_TTS_RATE);
  });

  it('setTtsPlaybackRate rejects out-of-range input rather than storing it', () => {
    setTtsPlaybackRate(0);
    expect(getTtsPlaybackRate()).toBe(DEFAULT_TTS_RATE);
  });
});

describe('#3023 applyDemoPlaybackRate', () => {
  it('sets playbackRate on the element from the stored preference', () => {
    setTtsPlaybackRate(0.75);
    const el = { playbackRate: 1 } as HTMLAudioElement;
    applyDemoPlaybackRate(el);
    expect(el.playbackRate).toBe(0.75);
  });

  // preservesPitch=false makes a slowed voice sound like a tape deck. Chrome
  // and Safari both default it to true, but Firefox has flipped it before,
  // so pin it: this is a reading model, the pitch has to stay natural.
  it('keeps pitch preserved so the slowed voice is still a usable model', () => {
    const el = { playbackRate: 1, preservesPitch: false } as HTMLAudioElement;
    applyDemoPlaybackRate(el);
    expect(el.preservesPitch).toBe(true);
  });

  it('does not throw on an element that lacks preservesPitch', () => {
    const el = { playbackRate: 1 } as HTMLAudioElement;
    expect(() => applyDemoPlaybackRate(el)).not.toThrow();
    expect(el.playbackRate).toBe(DEFAULT_TTS_RATE);
  });
});

describe('#3023 the offered options', () => {
  it('offers the current speed as one of the choices', () => {
    expect(TTS_RATE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_TTS_RATE);
  });

  it('offers at least one speed slower than the default', () => {
    expect(TTS_RATE_OPTIONS.some((o) => o.value < DEFAULT_TTS_RATE)).toBe(true);
  });

  it('has unique values and non-empty labels', () => {
    const values = TTS_RATE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size, 'duplicate rate values').toBe(values.length);
    for (const o of TTS_RATE_OPTIONS) expect(o.label.trim().length).toBeGreaterThan(0);
  });
});
