/**
 * #3023 — the shipped default has to land inside the worksheet's own top band.
 *
 * The demo voice measured 273 字/分 on prod (21 characters in 4.608s). The
 * same worksheet prints reading_benchmark.levels of ＜200 / 201~230 / ＞231,
 * so the model the student is told to imitate was 42 字/分 faster than the
 * best band that worksheet itself defines. That is the substance of the
 * teachers' report from 課後學習扶助.
 *
 * This test binds the REASON, not the number. If someone changes
 * DEFAULT_TTS_RATE it stays green as long as the resulting speed is still a
 * rate a student could actually be asked to match -- and goes red the moment
 * the default drifts back above the worksheet's own ceiling.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_TTS_RATE, TTS_RATE_OPTIONS, BASELINE_CHARS_PER_MIN, WORKSHEET_TOP_BAND_FLOOR } from '../ttsRate';

const speedAt = (rate: number) => BASELINE_CHARS_PER_MIN * rate;

describe('#3023 the shipped default vs the worksheet benchmark', () => {
  it('does not ask students to match a speed above the worksheet ceiling', () => {
    expect(
      speedAt(DEFAULT_TTS_RATE),
      `default reads at ${Math.round(speedAt(DEFAULT_TTS_RATE))} 字/分, above the ` +
        `worksheet's own top band floor of ${WORKSHEET_TOP_BAND_FLOOR}`,
    ).toBeLessThanOrEqual(BASELINE_CHARS_PER_MIN);
    expect(Math.round(speedAt(DEFAULT_TTS_RATE))).toBeLessThan(273);
  });

  // The other direction: a default that is TOO slow undersells fluent readers.
  // 201~230 is the middle band; dropping below it makes the model slower than
  // an average reader, which is not a model worth imitating either.
  it('is not slower than the middle band', () => {
    expect(
      Math.round(speedAt(DEFAULT_TTS_RATE)),
      'the demo must still sound like a competent reader',
    ).toBeGreaterThan(200);
  });

  it('lands inside the worksheet top band (>231), i.e. aspirational but reachable', () => {
    expect(Math.round(speedAt(DEFAULT_TTS_RATE))).toBeGreaterThanOrEqual(WORKSHEET_TOP_BAND_FLOOR);
  });

  it('the default is one of the offered options, so a student can see where they are', () => {
    expect(TTS_RATE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_TTS_RATE);
  });

  it('the option table advertises a speed matching what the rate actually produces', () => {
    for (const o of TTS_RATE_OPTIONS) {
      expect(
        Math.abs(o.approxCharsPerMin - speedAt(o.value)),
        `option ${o.label} claims ${o.approxCharsPerMin} 字/分 but ${o.value}x yields ` +
          `${Math.round(speedAt(o.value))}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('the original speed is still reachable for a student who wants it', () => {
    expect(TTS_RATE_OPTIONS.map((o) => o.value)).toContain(1);
  });
});
