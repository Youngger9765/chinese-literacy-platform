/**
 * stepConfig.ts — single source of truth for the learning step order.
 *
 * Each entry in STEP_CONFIG defines one step in the learning flow.
 * The array order controls the display order in StepperNav and the
 * step numbers shown to students (1-based index).
 *
 * To reorder steps: move entries in the array.
 * To add a new step: append a new entry (and add its route in AppRoutes.tsx).
 * To disable a step: set `enabled: false` (StepperNav will skip it).
 *
 * Future: this config can be fetched from the DB per-lesson or per-teacher
 * preference instead of being a static file.
 */

import { AppView } from '../types';

export interface StepConfig {
  /** Unique identifier — must match the URL path segment under /learn/:storyId/ */
  id: string;
  /** Display label shown in StepperNav */
  label: string;
  /** AppView enum value used by the legacy view routing system */
  view: AppView;
  /**
   * 1-based step number stored in DB (learning_sessions.current_step).
   * Must match the value that was previously hard-coded in STEP_PATH_TO_NUMBER.
   * Changing this would require a DB migration — do not change without care.
   */
  dbStepNumber: number;
  /**
   * Whether a story must be selected before this step is accessible.
   * false only for steps that make sense without a loaded story (e.g. HOME, REPORT).
   */
  needsStory: boolean;
  /** When false the step is excluded from StepperNav entirely (not yet implemented steps). */
  enabled: boolean;
}

/**
 * Default step order for the 10-step learning flow (三民版).
 *
 * To customise order per lesson/teacher, override this array at runtime
 * (future: load from DB/API and pass to StepperNav as a prop).
 *
 * dbStepNumber is the value stored in the DB (learning_sessions.current_step).
 * Existing steps keep their original dbStepNumbers (1–7) to avoid a DB migration.
 * The three new 三民 steps use dbStepNumbers 8–10.
 */
export const STEP_CONFIG: StepConfig[] = [
  {
    id: 'reading-annotation',
    label: '閱讀標記',
    view: AppView.READING_ANNOTATION,
    dbStepNumber: 8,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'tutor',
    label: '逐段朗讀',
    view: AppView.TUTOR,
    dbStepNumber: 2,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'comprehension',
    label: '課文理解',
    view: AppView.COMPREHENSION,
    dbStepNumber: 3,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'vocab',
    label: '生字練習',
    view: AppView.VOCAB,
    dbStepNumber: 4,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'vocab-application',
    label: '語詞應用',
    view: AppView.VOCAB_APPLICATION,
    dbStepNumber: 9,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'dictation',
    label: '聽寫練習',
    view: AppView.DICTATION,
    dbStepNumber: 5,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'vocab-word-search',
    label: '語詞複習',
    view: AppView.VOCAB_WORD_SEARCH,
    dbStepNumber: 10,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'full-reading',
    label: '全文朗讀',
    view: AppView.FULL_READING,
    dbStepNumber: 6,
    needsStory: true,
    enabled: true,
  },
  {
    id: 'report',
    label: '報告',
    view: AppView.REPORT,
    dbStepNumber: 7,
    needsStory: false,
    enabled: true,
  },
];

// ---------------------------------------------------------------------------
// Derived lookup maps — computed once from STEP_CONFIG so consumers don't
// need to re-derive them.  Import these instead of building your own maps.
// ---------------------------------------------------------------------------

/** All enabled steps in display order. */
export const ACTIVE_STEPS = STEP_CONFIG.filter((s) => s.enabled);

/** Map from URL path id (e.g. "intro") to dbStepNumber (e.g. 1). */
export const STEP_PATH_TO_NUMBER: Record<string, number> = Object.fromEntries(
  STEP_CONFIG.map((s) => [s.id, s.dbStepNumber]),
);

/** Map from AppView to URL path id (e.g. AppView.INTRO → "intro"). */
export const VIEW_TO_PATH: Record<string, string> = Object.fromEntries(
  STEP_CONFIG.map((s) => [s.view, s.id]),
);

/** Map from URL path id to AppView (e.g. "intro" → AppView.INTRO). */
export const PATH_TO_VIEW: Record<string, AppView> = Object.fromEntries(
  STEP_CONFIG.map((s) => [s.id, s.view]),
);
// trigger CI
