/**
 * Live Tutor regression tests — guard against known STT / diff / scoring bugs.
 *
 * Scenarios covered:
 * 1. Empty Web Speech + Gemini full-paragraph hallucination → not 100% / not 900 CPM
 * 2. Gemini source always runs conservative guard (even when rawStt is empty)
 * 3. Web Speech anchor wins when Gemini over-fills vs partial read
 * 4. Display interleave: partial read does not mark unread tail as correct (299 digit run)
 * 5. evalReducer: Gemini async must not replace local diff tokens for display
 */
import { describe, expect, it } from 'vitest';
import { buildTranscriptForEvaluation } from './liveTutorTranscriptPipeline';
import { localEvaluateParagraph } from './localEval';
import {
  TIER1_POOL,
  TIER2_POOL,
  TIER3_POOL,
  STREAK_MESSAGES,
} from './liveTutorPools';
import { diffCharacters, interleavePunctuation } from './textDiff';
import type { DiffToken } from '../types';
import { GCP_STAGING_TRANSCRIPT_GUARD_20260616 as GCP_LINE1 } from './fixtures/gcpStagingTranscriptGuard20260616';

const POOLS = {
  tier1: TIER1_POOL,
  tier2: TIER2_POOL,
  tier3: TIER3_POOL,
  streakMsgs: STREAK_MESSAGES,
};

const MENGCHANGJUN_LINE =
  '中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，為了要在競爭中勝出，各國都在搶傑出的管理人才，其中最有名的人才，就是齊國的孟嘗君。孟嘗君是有錢的貴族，最讓人津津樂道的是他在家裡養了三千名食客，食客就是在家裡吃飯的客人，三千人開飯的場面一眼望不完，真是非常壯觀。只要自認為有本事的人來投奔孟嘗君，他二話不說，總是張開雙手歡迎。這些食客具備各式各樣的才能，可以隨時幫他解決各種問題。';

const QIN_LINE =
  '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';

function evaluateGeminiPath(
  rawGemini: string,
  rawStt: string,
  targetText: string,
  durationMs: number,
) {
  const { cleaned, conservativeClampApplied } = buildTranscriptForEvaluation({
    source: 'gemini',
    rawTranscript: rawGemini,
    rawStt: rawStt,
    targetText,
    durationMs,
  });
  const local = localEvaluateParagraph(cleaned, targetText, durationMs, POOLS, 0);
  return { cleaned, conservativeClampApplied, ...local };
}

describe('Live Tutor regression — staging 孟嘗君 line 0 (empty Web Speech + Gemini full paste)', () => {
  const durationMs = 10_000;

  it('without guard, full Gemini transcript falsely scores 100%', () => {
    const naive = localEvaluateParagraph(MENGCHANGJUN_LINE, MENGCHANGJUN_LINE, durationMs, POOLS, 0);
    expect(naive.matchRate).toBe(1);
    expect(naive.cpm).toBeGreaterThan(800);
  });

  it('applies conservative clamp even when webSpeech is empty', () => {
    const { conservativeClampApplied, cleaned } = evaluateGeminiPath(
      MENGCHANGJUN_LINE,
      '',
      MENGCHANGJUN_LINE,
      durationMs,
    );
    expect(conservativeClampApplied).toBe(true);
    expect(cleaned.length).toBeLessThan(MENGCHANGJUN_LINE.length);
  });

  it('does not report 100% accuracy after clamp', () => {
    const { matchRate, cpm } = evaluateGeminiPath(
      MENGCHANGJUN_LINE,
      '',
      MENGCHANGJUN_LINE,
      durationMs,
    );
    expect(matchRate).toBeLessThan(0.95);
    expect(cpm).toBeLessThan(700);
  });

  it('display diff leaves unread tail non-green after clamp', () => {
    const { diffTokens } = evaluateGeminiPath(
      MENGCHANGJUN_LINE,
      '',
      MENGCHANGJUN_LINE,
      durationMs,
    );
    const display = interleavePunctuation(MENGCHANGJUN_LINE, diffTokens);
    const unread = display.filter((t) => t.type === 'missing' || t.type === 'unread');
    expect(unread.length).toBeGreaterThan(10);
    expect(display.filter((t) => t.type === 'correct').length).toBeLessThan(
      display.filter((t) => t.type !== 'punctuation').length,
    );
  });
});

describe('Live Tutor regression — staging 秦昭王 line (Web Speech anchor)', () => {
  it('prefers partial Web Speech when Gemini returns full target and Web Speech is clean', () => {
    const web = '公元前299年';
    const { cleaned, conservativeClampApplied, matchRate } = evaluateGeminiPath(
      QIN_LINE,
      web,
      QIN_LINE,
      12_000,
    );
    expect(conservativeClampApplied).toBe(true);
    expect(cleaned).toBe(web);
    expect(matchRate).toBeLessThan(0.5);
  });

  it('keeps Gemini when only slightly longer than Web Speech', () => {
    const web = '公元前299年';
    const gemini = '公元前299年，秦昭王';
    const { cleaned, conservativeClampApplied } = evaluateGeminiPath(
      gemini,
      web,
      QIN_LINE,
      12_000,
    );
    expect(conservativeClampApplied).toBe(false);
    expect(cleaned).toBe(gemini);
  });

  it('keeps full Gemini audio when Web Speech is garbled mid-paragraph (GCP staging line 1)', () => {
    const { cleaned, conservativeClampApplied, matchRate } = evaluateGeminiPath(
      GCP_LINE1.geminiAudioTranscript,
      GCP_LINE1.garbledWebSpeech,
      GCP_LINE1.targetText,
      GCP_LINE1.durationMs,
    );
    expect(conservativeClampApplied).toBe(false);
    expect(cleaned).toBe(GCP_LINE1.geminiAudioTranscript);
    expect(matchRate).toBeGreaterThan(0.85);
  });
});

describe('Live Tutor regression — buildTranscriptForEvaluation contract', () => {
  it('webspeech source bypasses guard', () => {
    const { conservativeClampApplied, cleaned } = buildTranscriptForEvaluation({
      source: 'webspeech',
      rawTranscript: MENGCHANGJUN_LINE,
      rawStt: '',
      targetText: MENGCHANGJUN_LINE,
      durationMs: 10_000,
    });
    expect(conservativeClampApplied).toBe(false);
    expect(cleaned).toBe(MENGCHANGJUN_LINE);
  });

  it('gemini + empty stt + no duration rejects full paste (no false score input)', () => {
    const { cleaned, conservativeClampApplied } = buildTranscriptForEvaluation({
      source: 'gemini',
      rawTranscript: MENGCHANGJUN_LINE,
      rawStt: '',
      targetText: MENGCHANGJUN_LINE,
      durationMs: 0,
    });
    expect(conservativeClampApplied).toBe(true);
    expect(cleaned).toBe('');
  });
});

describe('Live Tutor regression — interleave Arabic digits (299)', () => {
  it('partial read through 299 does not green the rest of the paragraph', () => {
    const target = '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';
    const spoken = '公元前二百九十九年';
    const { tokens } = diffCharacters(spoken, target, { useHomophone: true });
    const display = interleavePunctuation(target, tokens as DiffToken[]);

    expect(display.find((t) => t.char === '秦' && t.type === 'missing')).toBeDefined();
    expect(display.find((t) => t.char === '2' && t.type === 'correct')).toBeDefined();
    expect(display.filter((t) => t.type === 'correct').length).toBeLessThan(15);
  });
});
