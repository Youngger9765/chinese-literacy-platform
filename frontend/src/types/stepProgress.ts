/**
 * Per-step shape definitions for `LearningSession.step_progress.step_data[stepId]`.
 * Backend stores this as JSONB (Issue #1549); these types are the contract used by
 * each reading-step component when calling `saveStepProgressPatch({ stepId, stepData })`.
 *
 * Step IDs match `STEP_REGISTRY` keys in `config/stepConfig.ts`.
 */

import type { LineResult, ParagraphSummaryData } from '../components/reading-steps/paragraph-reading/paragraphReadingTypes';

/** Step 1 — Intro: just a "visited" marker so teachers can see the student entered the lesson. */
export interface IntroStepData {
  visited: true;
  started_at: string;
  pdf_opened?: boolean;
}

/** Step 2 — ParagraphReading (per-paragraph reading evaluation). */
export interface TutorParagraphSummary {
  paragraph_index: number;
  /** Cumulative attempts on this paragraph. */
  attempts: number;
  /** Match-rate of the latest attempt (0..1). */
  match_rate: number;
  cpm: number;
  duration_ms: number;
}

export interface TutorStepData {
  completed_paragraphs: number[];
  paragraph_summaries: TutorParagraphSummary[];
  /** Current paragraph the learner is on (for resume). */
  current_line_index?: number;
  /**
   * Final reading attempt summary, written when the whole flow finishes.
   * NOTE (#2533 review): the key is camelCase `readingAttempt` to match what is
   * actually written/read at runtime (useLearningStepNavigation.ts writes
   * `{ readingAttempt }`; useStepProgressPersistence.ts reads `tutorData.readingAttempt`).
   * The previous snake_case `reading_attempt` never matched the stored key.
   */
  readingAttempt?: {
    storyId: string;
    accuracy: number;
    cpm: number;
    transcription?: string;
    timestamp: number;
  };
  /** Issue #2530: full per-paragraph results (含 transcript / diffTokens) so the
   *  「朗讀對照」與「這次成績」在導航去總結報告再回來、以及跨 session 都能還原，
   *  逐段朗讀紀錄不再遺失。 */
  line_results?: LineResult[];
  paragraph_summaries_data?: Record<number, ParagraphSummaryData>;
}

/** Step 3 — Comprehension (multi-tab chat / mcq / strategy). */
export interface ComprehensionStepData {
  tab_completion?: {
    structureVisited?: boolean;
    mcqDone?: boolean;
    strategyDone?: boolean;
  };
  active_tab?: 'mcq' | 'structure' | 'strategy' | string;
  mcq_score?: number;
  mcq_total?: number;
}

/** Step 4 — VocabPractice (stroke-order + recall). */
export interface VocabStepData {
  practiced_chars: string[];
  current_index: number;
  /** Map of character → round-state code: 1 = round 1, 2 = round 2, 3 = done. */
  char_rounds?: Record<string, number>;
  /** Characters the learner skipped during recall round (round 2). */
  skipped_recall?: string[];
  /** Summary written on completion. */
  result?: {
    practiced_words: string[];
    total_words: number;
  };
}

/** Step 5 — DictationPractice (听写). */
export interface DictationWordResult {
  word: string;
  user_answer: string;
  correct: boolean;
  attempts: number;
  duration_ms?: number;
}

export interface DictationStepData {
  word_results: DictationWordResult[];
  current_index: number;
  phase: 'lesson-intro' | 'practice' | 'results';
  result?: {
    total_words: number;
    correct_count: number;
    incorrect_count: number;
    skipped_count: number;
  };
}

/** Step 6 — KeyPassageReading (whole-text reading + self-rating). */
export interface KeyPassageReadingResult {
  matchRate?: number;
  feedback?: string;
  diffTokens?: unknown[];
  cpm?: number;
  durationMs?: number;
  accuracy?: number;
  errorBreakdown?: Record<string, unknown>;
  audioUrl?: string;
}

export interface KeyPassageReadingStepData {
  result?: KeyPassageReadingResult;
  /** Student self-rating 1-5 (Issue #1386). */
  self_rating?: number;
  /** Raw streaming transcript captured during evaluation. */
  transcript?: string;
  /** Issue #2503: ReadingAttemptHistory id the GCS audio was bound to — lets the
   *  student replay their recording after the in-memory blob is gone (remount). */
  audio_attempt_id?: number;
}

/** Step 7 — AssessmentReport. */
export interface ReportStepData {
  viewed_at: string;
  exit_ticket_id?: number | null;
}

/** Discriminated map from stepId → expected stepData shape. */
export interface StepDataMap {
  intro: IntroStepData;
  tutor: TutorStepData;
  comprehension: ComprehensionStepData;
  vocab: VocabStepData;
  dictation: DictationStepData;
  'key-passage-reading': KeyPassageReadingStepData;
  report: ReportStepData;
}

export type StepId = keyof StepDataMap;
