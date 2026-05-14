/**
 * Per-step shape definitions for `LearningSession.step_progress.step_data[stepId]`.
 * Backend stores this as JSONB (Issue #1549); these types are the contract used by
 * each reading-step component when calling `saveStepProgressPatch({ stepId, stepData })`.
 *
 * Step IDs match `STEP_REGISTRY` keys in `config/stepConfig.ts`.
 */

/** Step 1 — Intro: just a "visited" marker so teachers can see the student entered the lesson. */
export interface IntroStepData {
  visited: true;
  started_at: string;
  pdf_opened?: boolean;
}

/** Step 2 — LiveTutor (per-paragraph reading evaluation). */
export interface TutorParagraphSummary {
  paragraph_index: number;
  cpm: number | null;
  accuracy: number | null;
  attempts: number;
  completed_at?: string;
}

export interface TutorStepData {
  completed_paragraphs: number[];
  paragraph_summaries: TutorParagraphSummary[];
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
  /** Map of character → completed round number (1-3). */
  char_rounds?: Record<string, number>;
  /** Characters the learner skipped during recall round (round 2). */
  skipped_recall?: string[];
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
  phase: 'intro' | 'practice' | 'results';
  result?: {
    total_words: number;
    correct_count: number;
    incorrect_count: number;
    skipped_count: number;
  };
}

/** Step 6 — FullReading (whole-text reading + self-rating). */
export interface FullReadingResult {
  matchRate?: number;
  feedback?: string;
  diffTokens?: unknown[];
  cpm?: number;
  durationMs?: number;
  accuracy?: number;
  errorBreakdown?: Record<string, unknown>;
  audioUrl?: string;
}

export interface FullReadingStepData {
  result?: FullReadingResult;
  /** Student self-rating 1-5 (Issue #1386). */
  self_rating?: number;
  /** Raw streaming transcript captured during evaluation. */
  transcript?: string;
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
  'full-reading': FullReadingStepData;
  report: ReportStepData;
}

export type StepId = keyof StepDataMap;
