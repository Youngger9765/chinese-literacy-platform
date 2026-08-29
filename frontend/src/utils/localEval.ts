/**
 * Local (offline) evaluation utilities for ParagraphReading hybrid STT architecture.
 *
 * Used in the hybrid eval flow:
 *   - Phase 1 (instant): localEvaluateParagraph → tier 1/2/3 with diffTokens (<1ms)
 *   - Phase 2 (async):   evaluateReading (Gemini) only called when local says tier 3
 *
 * getReadingPassThreshold mirrors backend _apply_short_text_compensation
 * (reading_evaluation_service.py:114). Keep in sync if backend thresholds change.
 *
 * splitIntoSentences is used for 分期付款 UX: per-sentence feedback as student reads.
 */
import type { DiffToken } from '../types';
import { analyzeFluency } from './fluencyAnalyzer';
import { READING_EXCELLENT, READING_PASS } from './personaConfig';
import { normalizeForComparison } from './textDiff';

// ── Public types ─────────────────────────────────────────────────────────────

export interface LocalEvalResult {
  tier: 1 | 2 | 3;
  matchRate: number;    // adjusted accuracy (0–1)
  diffTokens: DiffToken[];
  cpm: number;
  feedback: string;     // from TIER1_POOL/TIER2_POOL/TIER3_POOL (passed in)
  nextStreak: number;   // caller does setStreak(result.nextStreak)
}

export interface FeedbackPools {
  tier1: string[];
  tier2: string[];
  tier3: string[];
  streakMsgs: string[];
}

// ── Threshold helper ─────────────────────────────────────────────────────────

/**
 * Lower pass threshold for short paragraphs.
 * Mirrors backend _apply_short_text_compensation (reading_evaluation_service.py:114).
 *   ≤ 5 chars  → READING_PASS - 0.2
 *   ≤ 10 chars → READING_PASS - 0.1
 *   > 10 chars → READING_PASS unchanged
 */
export function getReadingPassThreshold(targetLength: number): number {
  if (targetLength <= 5) return Math.max(0, READING_PASS - 0.2);
  if (targetLength <= 10) return Math.max(0, READING_PASS - 0.1);
  return READING_PASS;
}

// ── Sentence segmentation ─────────────────────────────────────────────────────

/** Maximum characters per sentence segment before force-splitting. */
const MAX_SENTENCE_CHARS = 20;

/**
 * Split Chinese text into sentences at common punctuation marks.
 * Each segment keeps its trailing delimiter so targets stay faithful to the original.
 *
 * Punctuation recognized: ，。！？；：、─—…」』）
 * Primary split: sentence-ending marks (，。！？；：)
 * If any resulting segment exceeds MAX_SENTENCE_CHARS, further split at secondary
 * marks (、─—…」』）). Only closing quotes/brackets are split points.
 * If a segment still exceeds MAX_SENTENCE_CHARS after secondary split
 * (no secondary punctuation present), it is returned as-is.
 *
 * Example: '媽媽說，你好。' → ['媽媽說，', '你好。']
 * Example: '一二三。'       → ['一二三。']
 * Returns the full text as a single element when there are no delimiters and text ≤ MAX_SENTENCE_CHARS.
 */
export function splitIntoSentences(text: string): string[] {
  // Primary split: sentence-level punctuation
  const primarySegments = text.split(/(?<=[，。！？；：])/u).filter(s => s.length > 0);

  const result: string[] = [];
  for (const seg of primarySegments) {
    if (Array.from(seg).length <= MAX_SENTENCE_CHARS) {
      result.push(seg);
    } else {
      // Secondary split on enumeration / parenthetical marks
      const subSegments = seg.split(/(?<=[、─—…」』）])/u).filter(s => s.length > 0);
      result.push(...subSegments);
    }
  }
  return result;
}

// ── Core local evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate a single spoken transcript against a target text locally (no network).
 *
 * Uses analyzeFluency() from fluencyAnalyzer.ts with:
 *   - accuracyPass = getReadingPassThreshold(normalizedTargetLength)
 *   - cpmPass = 0 (no CPM gate per-paragraph/sentence)
 *
 * @param transcript  Raw STT transcript for this segment
 * @param targetText  The target text (paragraph or sentence)
 * @param durationMs  Elapsed recording time in ms (used for CPM calc; pass/fail unaffected since cpmPass=0)
 * @param pools       Feedback pools from ParagraphReading (TIER1_POOL, etc.)
 * @param streak      Current streak value from ParagraphReading state
 */
export function localEvaluateParagraph(
  transcript: string,
  targetText: string,
  durationMs: number,
  pools: FeedbackPools,
  streak: number,
): LocalEvalResult {
  const normalizedLen = normalizeForComparison(targetText).length;
  const threshold = getReadingPassThreshold(normalizedLen);

  const result = analyzeFluency({
    spoken: transcript,
    target: targetText,
    durationMs: Math.max(durationMs, 500), // guard against 0ms
    thresholds: { accuracyPass: threshold, cpmPass: 0 },
  });

  const accuracy = result.accuracy;
  const tier: 1 | 2 | 3 =
    accuracy >= READING_EXCELLENT ? 1 :
    accuracy >= threshold         ? 2 :
                                    3;

  const nextStreak = tier <= 2 ? streak + 1 : 0;

  let feedback: string;
  if (tier <= 2 && nextStreak >= 3 && nextStreak < pools.streakMsgs.length && pools.streakMsgs[nextStreak]) {
    feedback = pools.streakMsgs[nextStreak];
  } else if (tier === 1) {
    feedback = pick(pools.tier1);
  } else if (tier === 2) {
    feedback = pick(pools.tier2);
  } else {
    feedback = pick(pools.tier3);
  }

  return {
    tier,
    matchRate: accuracy,
    diffTokens: result.diffTokens,
    cpm: result.cpm,
    feedback,
    nextStreak,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}
