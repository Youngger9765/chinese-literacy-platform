/**
 * Pure mapping helpers — convert raw backend dicts to frontend types.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import type {
  ReadingAttempt,
  ComprehensionResult,
  VocabResult,
  FullReadingResult,
  DiffToken,
} from '../../../types';
import type {
  SessionDetailResponse,
  ComprehensionScoreResult,
} from '../../../services/learningApi';
import type { LearningSession } from '../../../types';

// ---------------------------------------------------------------------------

export function toReadingAttempt(
  raw: Record<string, unknown> | null,
  storyId: string,
): ReadingAttempt | null {
  if (!raw) return null;
  return {
    storyId,
    accuracy: typeof raw.accuracy === 'number' ? raw.accuracy : 0,
    fluency: typeof raw.fluency === 'number' ? raw.fluency : 0,
    cpm: typeof raw.cpm === 'number' ? raw.cpm : 0,
    mispronouncedWords: Array.isArray(raw.mispronounced_words)
      ? (raw.mispronounced_words as string[])
      : [],
    transcription: typeof raw.transcription === 'string' ? raw.transcription : '',
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    lineBreakdown: undefined,
  };
}

export function toComprehensionResult(
  raw: Record<string, unknown> | null,
): ComprehensionResult | null {
  if (!raw) return null;
  return {
    understoodCount: typeof raw.understood_count === 'number' ? raw.understood_count : 0,
    requiredCount: typeof raw.required_count === 'number' ? raw.required_count : 0,
    isComplete: raw.is_complete === true,
    conversationLength:
      typeof raw.conversation_length === 'number' ? raw.conversation_length : 0,
  };
}

export function toVocabResult(raw: Record<string, unknown> | null): VocabResult | null {
  if (!raw) return null;
  const words = Array.isArray(raw.practiced_words)
    ? (raw.practiced_words as string[])
    : Array.isArray(raw.practiced_chars)
      ? (raw.practiced_chars as string[])
      : [];
  const total =
    typeof raw.total_words === 'number'
      ? raw.total_words
      : typeof raw.total_chars === 'number'
        ? raw.total_chars
        : 0;
  return { practicedWords: words, totalWords: total };
}

export function toFullReadingResult(
  raw: Record<string, unknown> | null,
): FullReadingResult | null {
  if (!raw) return null;
  return {
    matchRate: typeof raw.match_rate === 'number' ? raw.match_rate : 0,
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
    cpm: typeof raw.cpm === 'number' ? raw.cpm : undefined,
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
    errorBreakdown:
      raw.error_breakdown && typeof raw.error_breakdown === 'object'
        ? (raw.error_breakdown as {
            correct: number;
            wrong: number;
            missing: number;
            extra: number;
          })
        : undefined,
    diffTokens: Array.isArray(raw.diff_tokens) ? (raw.diff_tokens as DiffToken[]) : undefined,
    transcript: typeof raw.transcript === 'string' ? raw.transcript : undefined,
  };
}

export function buildLearningSession(detail: SessionDetailResponse): LearningSession {
  const storyId = detail.story_slug ?? '';
  return {
    storyId,
    startedAt: new Date(detail.started_at).getTime(),
    introCompleted: detail.current_step > 1,
    readingAttempt: toReadingAttempt(detail.reading_result, storyId),
    comprehensionResult: toComprehensionResult(detail.comprehension_result),
    vocabResult: toVocabResult(detail.vocab_result),
    dictationResult: null,
    fullReadingResult: toFullReadingResult(detail.full_reading_result),
  };
}

export function buildComprehensionScores(
  detail: SessionDetailResponse,
): ComprehensionScoreResult | null {
  if (detail.comprehension_score == null) return null;

  // comprehension_feedback is stored in the DB as a JSON string like
  // '{"literal":"...","inferential":"...","evaluative":"...","overall":"..."}'
  let feedbackObj: {
    literal?: string;
    inferential?: string;
    evaluative?: string;
    overall?: string;
  } = {};
  if (detail.comprehension_feedback) {
    try {
      feedbackObj = JSON.parse(detail.comprehension_feedback);
    } catch {
      feedbackObj = { overall: detail.comprehension_feedback };
    }
  }

  return {
    comprehension_score: detail.comprehension_score,
    literal_score: detail.literal_score ?? 0,
    inferential_score: detail.inferential_score ?? 0,
    evaluative_score: detail.evaluative_score ?? 0,
    feedback: {
      literal: feedbackObj.literal ?? '',
      inferential: feedbackObj.inferential ?? '',
      evaluative: feedbackObj.evaluative ?? '',
      overall: feedbackObj.overall ?? '',
    },
  };
}
