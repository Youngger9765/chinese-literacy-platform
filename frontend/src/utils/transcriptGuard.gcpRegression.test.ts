/**
 * Regression: GCP-proven false negative from conservative transcript clamp.
 * Do not delete — encodes staging incident 2026-06-16 (孟嘗君 line 1, 41s read).
 */
import { describe, expect, it } from 'vitest';
import { GCP_STAGING_TRANSCRIPT_GUARD_20260616 as INCIDENT } from './fixtures/gcpStagingTranscriptGuard20260616';
import { buildTranscriptForEvaluation } from './liveTutorTranscriptPipeline';
import { localEvaluateParagraph } from './localEval';
import {
  STREAK_MESSAGES,
  TIER1_POOL,
  TIER2_POOL,
  TIER3_POOL,
} from './liveTutorPools';
import { interleavePunctuation } from './textDiff';
import { pickConservativeTranscript } from './transcriptGuard';

const POOLS = {
  tier1: TIER1_POOL,
  tier2: TIER2_POOL,
  tier3: TIER3_POOL,
  streakMsgs: STREAK_MESSAGES,
};

describe('GCP staging 2026-06-16 — garbled Web Speech must not override Gemini audio', () => {
  it('pickConservativeTranscript keeps geminiAudioTranscript (not garbled webSpeech)', () => {
    const picked = pickConservativeTranscript(
      INCIDENT.geminiAudioTranscript,
      INCIDENT.garbledWebSpeech,
      INCIDENT.targetText,
      INCIDENT.durationMs,
    );
    expect(picked).toBe(INCIDENT.geminiAudioTranscript);
    expect(picked).not.toBe(INCIDENT.garbledWebSpeech);
  });

  it('buildTranscriptForEvaluation does not set conservativeClampApplied', () => {
    const { transcriptForEval, cleaned, conservativeClampApplied } =
      buildTranscriptForEvaluation({
        source: 'gemini',
        rawTranscript: INCIDENT.geminiAudioTranscript,
        rawStt: INCIDENT.garbledWebSpeech,
        targetText: INCIDENT.targetText,
        durationMs: INCIDENT.durationMs,
      });

    expect(conservativeClampApplied).toBe(false);
    expect(transcriptForEval).toBe(INCIDENT.geminiAudioTranscript);
    expect(cleaned).not.toBe(INCIDENT.garbledWebSpeech);
  });

  it('Gemini path scores high; garbled Web Speech path would falsely grey the tail', () => {
    const { matchRate: geminiMatch, diffTokens: geminiDiff } = localEvaluateParagraph(
      INCIDENT.geminiAudioTranscript,
      INCIDENT.targetText,
      INCIDENT.durationMs,
      POOLS,
      0,
    );
    const { matchRate: garbledMatch, diffTokens: garbledDiff } = localEvaluateParagraph(
      INCIDENT.garbledWebSpeech,
      INCIDENT.targetText,
      INCIDENT.durationMs,
      POOLS,
      0,
    );

    expect(geminiMatch).toBeGreaterThan(0.85);
    expect(garbledMatch).toBeLessThan(0.55);

    const geminiDisplay = interleavePunctuation(INCIDENT.targetText, geminiDiff);
    const garbledDisplay = interleavePunctuation(INCIDENT.targetText, garbledDiff);
    const greyIfGarbled = garbledDisplay.filter(
      (t) => t.type === 'missing' || t.type === 'unread',
    ).length;
    const greyIfGemini = geminiDisplay.filter(
      (t) => t.type === 'missing' || t.type === 'unread',
    ).length;

    expect(greyIfGarbled).toBeGreaterThan(greyIfGemini + 20);
  });

  it('still clamps when Web Speech is a clean partial read (student only spoke opening)', () => {
    const cleanPartial = '公元前299年，秦昭王聽說孟嘗君的賢達，';
    const picked = pickConservativeTranscript(
      INCIDENT.geminiAudioTranscript,
      cleanPartial,
      INCIDENT.targetText,
      12_000,
    );
    expect(picked).toBe(cleanPartial);
  });
});
