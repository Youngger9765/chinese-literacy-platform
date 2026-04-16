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

/** Step category for color-coding in StepperNav */
export type StepCategory = 'reading' | 'comprehension' | 'practice' | 'report';

/** Color theme per step category */
export const STEP_CATEGORY_COLORS: Record<StepCategory, { badge: string; activeBg: string; text: string; headerBar: string }> = {
  reading:       { badge: 'bg-orange-500',  activeBg: 'bg-orange-50',  text: 'text-orange-600',  headerBar: 'bg-orange-500' },
  comprehension: { badge: 'bg-emerald-500', activeBg: 'bg-emerald-50', text: 'text-emerald-600', headerBar: 'bg-emerald-500' },
  practice:      { badge: 'bg-blue-500',    activeBg: 'bg-blue-50',    text: 'text-blue-600',    headerBar: 'bg-blue-500' },
  report:        { badge: 'bg-accent',      activeBg: 'bg-accent/10',  text: 'text-accent',      headerBar: 'bg-accent' },
};

export interface StepConfig {
  /** Unique identifier — must match the URL path segment under /learn/:storyId/ */
  id: string;
  /** Display label shown in StepperNav */
  label: string;
  /** Brief one-line instruction shown at the top of the immersive learning page */
  hint: string;
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
  /** Step category for color-coding */
  category: StepCategory;
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
    label: '讀全文-做記號',
    hint: '閱讀全文，選取不懂或重要的詞語做記號',
    view: AppView.READING_ANNOTATION,
    dbStepNumber: 8,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  {
    id: 'tutor',
    label: '逐段朗讀',
    hint: '跟著 AI 一段一段大聲朗讀',
    view: AppView.TUTOR,
    dbStepNumber: 2,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  {
    id: 'full-reading',
    label: '全文朗讀',
    hint: '挑戰一次唸完全篇課文',
    view: AppView.FULL_READING,
    dbStepNumber: 6,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  {
    id: 'listening',
    label: '聽力理解',
    hint: '聽完課文後，用自己的話說出重點',
    view: AppView.LISTENING,
    dbStepNumber: 13,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  {
    id: 'vocab',
    label: '生字練習',
    hint: '練習課文中的生字筆順與讀音',
    view: AppView.VOCAB,
    dbStepNumber: 4,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  {
    id: 'sentence-practice',
    label: '造句練習',
    hint: '用學到的詞語寫出自己的句子',
    view: AppView.SENTENCE_PRACTICE,
    dbStepNumber: 14,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  {
    id: 'vocab-definition',
    label: '詞語定義',
    hint: '為每個詞語找到正確的解釋',
    view: AppView.VOCAB_DEFINITION_MATCH,
    dbStepNumber: 12,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  {
    id: 'vocab-application',
    label: '語詞應用',
    hint: '把學到的詞語用在句子裡',
    view: AppView.VOCAB_APPLICATION,
    dbStepNumber: 9,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  {
    id: 'comprehension',
    label: '課文理解',
    hint: '回答 AI 提出的課文問題',
    view: AppView.COMPREHENSION,
    dbStepNumber: 3,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  {
    id: 'vocab-word-search',
    label: '語詞複習',
    hint: '在字母格中找出學過的詞語',
    view: AppView.VOCAB_WORD_SEARCH,
    dbStepNumber: 10,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  {
    id: 'dictation',
    label: '聽寫練習',
    hint: '聽 AI 唸字，把聽到的打出來',
    view: AppView.DICTATION,
    dbStepNumber: 5,
    needsStory: true,
    enabled: false, // hidden per product decision 2026-03-27
    category: 'practice',
  },
  {
    id: 'knowledge-station',
    label: '知識補給站',
    hint: '探索課文相關的延伸知識',
    view: AppView.KNOWLEDGE_STATION,
    dbStepNumber: 11,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  {
    id: 'report',
    label: '報告',
    hint: '查看這篇課文的學習成果',
    view: AppView.REPORT,
    dbStepNumber: 7,
    needsStory: false,
    enabled: true,
    category: 'report',
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

/** Map from URL path id to AppView (e.g. "intro" → AppView.INTRO). */
export const PATH_TO_VIEW: Record<string, AppView> = Object.fromEntries(
  STEP_CONFIG.map((s) => [s.id, s.view]),
);
