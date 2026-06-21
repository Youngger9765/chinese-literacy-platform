import { describe, it, expect } from 'vitest';
import {
  validateRecording,
  SILENT_PEAK_THRESHOLD,
  SILENT_MIN_DURATION_MS,
} from '../recordingValidation';

/**
 * #2362 — 錄音驗證（VAD）gate 行為驗證（合成音檔，免真人麥克風）
 *
 * peakVolume 取自 ffmpeg 合成音檔的實測 astats Max level：
 *   silence.webm    (anullsrc)            → 0.000   數位靜音
 *   tone.webm       (sine 440Hz)          → 0.125   有能量的純音
 *   whitenoise.webm (anoisesrc white a=.5)→ 0.668   大聲但無語音
 *
 * 前端 gate 只看「能量 + 時長」：
 *   - 靜音(0.0) → 擋（reason=silent）
 *   - 純音/語音/白噪音(>0.05) → 過能量關（白噪音故意過，留給後端 STT 幻覺 gate 擋）
 *   - <1500ms → 擋（reason=too_short），即使很大聲
 */
describe('validateRecording — VAD 靜音 gate（合成音檔實測值）', () => {
  it('擋數位靜音 peak=0.0（silence.webm）', () => {
    expect(validateRecording({ peakVolume: 0.0, durationMs: 3000 })).toEqual({
      ok: false,
      reason: 'silent',
    });
  });

  it('擋接近靜音的背景 peak=0.02（< 0.05）', () => {
    expect(validateRecording({ peakVolume: 0.02, durationMs: 3000 })).toEqual({
      ok: false,
      reason: 'silent',
    });
  });

  it('恰在門檻下界 peak=0.049 → 擋', () => {
    expect(validateRecording({ peakVolume: 0.049, durationMs: 3000 })).toEqual({
      ok: false,
      reason: 'silent',
    });
  });

  it('放行純音 peak=0.125（tone.webm，有能量）', () => {
    expect(validateRecording({ peakVolume: 0.125, durationMs: 3000 })).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('放行典型朗讀語音 peak=0.2', () => {
    expect(validateRecording({ peakVolume: 0.2, durationMs: 3000 })).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('白噪音 peak=0.668 過能量關（whitenoise.webm）→ 交後端 STT 幻覺 gate 擋', () => {
    expect(validateRecording({ peakVolume: 0.668, durationMs: 3000 })).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('擋誤觸短錄音 <1500ms，即使大聲（peak=0.668, 800ms）', () => {
    expect(validateRecording({ peakVolume: 0.668, durationMs: 800 })).toEqual({
      ok: false,
      reason: 'too_short',
    });
  });

  it('時長關優先於能量關：靜音又太短 → too_short', () => {
    expect(validateRecording({ peakVolume: 0.0, durationMs: 500 })).toEqual({
      ok: false,
      reason: 'too_short',
    });
  });

  it('門檻常數鎖定（避免日後誤改）', () => {
    expect(SILENT_PEAK_THRESHOLD).toBe(0.05);
    expect(SILENT_MIN_DURATION_MS).toBe(1500);
  });
});
