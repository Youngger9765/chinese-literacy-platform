/**
 * stepConfig.ts — step registry and default sequence for the learning flow.
 *
 * ## Architecture (schema-driven step composition — #1374)
 *
 * STEP_REGISTRY: id → metadata + component.  Order has NO meaning here.
 *   Use this for label/hint/view/dbStepNumber lookups.
 *
 * DEFAULT_STEP_SEQUENCE: the canonical ordered list of step IDs for legacy lessons
 *   that do not carry their own step_sequence field.
 *   New lessons can include `step_sequence: ['reading-annotation', 'tutor', ...]`
 *   in their YAML to override this default.
 *
 * Consumers that need the active ordered list should use:
 *   - `useStepSequence(lesson)` hook   — lesson-aware, returns per-lesson or default
 *   - `ACTIVE_STEPS`                   — legacy compat alias = default sequence filtered to enabled
 *
 * To add a new step:
 *   1. Register it in STEP_REGISTRY
 *   2. Add its route in AppRoutes.tsx
 *   3. Include its id in the lesson YAML step_sequence
 *   (Default sequence is NOT changed — existing lessons are unaffected)
 *
 * To reorder the default flow: edit DEFAULT_STEP_SEQUENCE.
 * To disable a step globally: set `enabled: false` in STEP_REGISTRY.
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
  /** Single-char hint shown inside the step badge circle (mobile / compact view). Pick the most representative character of the step, not necessarily label[0]. */
  displayChar: string;
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
  /** When false the step is excluded from the active sequence entirely (not yet implemented steps). */
  enabled: boolean;
  /** Step category for color-coding */
  category: StepCategory;
  /** Issue #2192: larger stepper pill + icon so students can find 閱讀聚光燈 */
  navEmphasis?: boolean;
  /** Compact label on mobile when navEmphasis is true */
  navShortLabel?: string;
}

// ---------------------------------------------------------------------------
// STEP_REGISTRY — id → metadata lookup (NO ordering semantics)
// ---------------------------------------------------------------------------

/**
 * Registry of all known steps.  Use for label/hint/view/dbStepNumber lookups.
 * Order of keys here has no meaning — step order is determined by
 * DEFAULT_STEP_SEQUENCE (or per-lesson step_sequence from YAML).
 *
 * dbStepNumber comments:
 *   Existing steps keep their original dbStepNumbers (1–14) to avoid a DB migration.
 *   New comprehension split steps use dbStepNumbers 15–16 (Issue #1335).
 */
export const STEP_REGISTRY: Record<string, StepConfig> = {
  'intro': {
    id: 'intro',
    label: '課程簡介',
    displayChar: '簡',
    hint: '看看這堂課要學什麼策略，以及有哪些步驟',
    view: AppView.INTRO,
    dbStepNumber: 1,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'reading-annotation': {
    id: 'reading-annotation',
    label: '讀全文-做記號',
    displayChar: '記',
    hint: '閱讀全文，選取不懂或重要的詞語做記號',
    view: AppView.READING_ANNOTATION,
    dbStepNumber: 8,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'tutor': {
    id: 'tutor',
    label: '逐段朗讀',
    displayChar: '段',
    hint: '跟著 AI 一段一段大聲朗讀',
    view: AppView.TUTOR,
    dbStepNumber: 2,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'full-reading': {
    id: 'full-reading',
    label: '全文朗讀',
    displayChar: '讀',
    hint: '挑戰一次唸完全篇課文',
    view: AppView.FULL_READING,
    dbStepNumber: 6,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'listening': {
    id: 'listening',
    label: '聽力理解',
    displayChar: '聽',
    hint: '聽完課文後，用自己的話說出重點',
    view: AppView.LISTENING,
    dbStepNumber: 13,
    needsStory: true,
    enabled: false, // hidden from StepperNav per product decision 2026-05-01 — accessible via ToolPicker
    category: 'comprehension',
  },
  'vocab': {
    id: 'vocab',
    label: '生字練習',
    displayChar: '字',
    hint: '練習課文中的生字筆順與讀音',
    view: AppView.VOCAB,
    dbStepNumber: 4,
    needsStory: true,
    enabled: false, // hidden from StepperNav per product decision 2026-05-01 — accessible via ToolPicker
    category: 'practice',
  },
  'vocab-definition': {
    id: 'vocab-definition',
    label: '詞語理解',
    displayChar: '詞',
    hint: '為每個詞語找到正確的解釋',
    view: AppView.VOCAB_DEFINITION_MATCH,
    dbStepNumber: 12,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  'vocab-application': {
    id: 'vocab-application',
    label: '語詞應用',
    displayChar: '用',
    hint: '把學到的詞語用在句子裡',
    view: AppView.VOCAB_APPLICATION,
    dbStepNumber: 9,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  // Issue #1335: split old "comprehension" tab-container into 3 independent steps
  'story-structure': {
    id: 'story-structure',
    label: '文章重點表',
    displayChar: '重',
    hint: '把課文重點填進去，讓 AI 幫你檢查',
    view: AppView.STORY_STRUCTURE,
    dbStepNumber: 15,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  'reading-strategy': {
    id: 'reading-strategy',
    label: '閱讀聚光燈',
    displayChar: '光',
    hint: '練習這課的閱讀策略',
    view: AppView.READING_STRATEGY,
    dbStepNumber: 16,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
    // navEmphasis 移除（Young 2026-06-21）：原本 #2192 讓聚光燈用 💡+放大+紫框，
    // 跟其他步單字灰圈不一致 → 統一成 displayChar '光' 灰圈。findability 若要再加用顏色非換 icon。
  },
  'sentence-practice': {
    id: 'sentence-practice',
    label: '造句練習',
    displayChar: '造',
    hint: '用學到的詞語寫出自己的句子',
    view: AppView.SENTENCE_PRACTICE,
    dbStepNumber: 14,
    needsStory: true,
    enabled: false, // hidden per 2026-05-01 expert review — hardest vocab task, optional after 7/1
    category: 'practice',
  },
  'comprehension': {
    id: 'comprehension',
    label: '閱讀理解',
    displayChar: '解',
    hint: '回答課文理解選擇題',
    view: AppView.COMPREHENSION,
    dbStepNumber: 3,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  'vocab-word-search': {
    id: 'vocab-word-search',
    label: '語詞複習',
    displayChar: '複',
    hint: '在字母格中找出學過的詞語',
    view: AppView.VOCAB_WORD_SEARCH,
    dbStepNumber: 10,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  'dictation': {
    id: 'dictation',
    label: '聽寫練習',
    displayChar: '聽',
    hint: '聽 AI 唸字，把聽到的打出來',
    view: AppView.DICTATION,
    dbStepNumber: 5,
    needsStory: true,
    enabled: false, // hidden per product decision 2026-03-27
    category: 'practice',
  },
  'knowledge-station': {
    id: 'knowledge-station',
    label: '知識補給站',
    displayChar: '補',
    hint: '探索課文相關的延伸知識',
    view: AppView.KNOWLEDGE_STATION,
    dbStepNumber: 11,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  'report': {
    id: 'report',
    label: '報告',
    displayChar: '報',
    hint: '查看這篇課文的學習成果',
    view: AppView.REPORT,
    dbStepNumber: 7,
    needsStory: false,
    enabled: true,
    category: 'report',
  },
};

// ---------------------------------------------------------------------------
// DEFAULT_STEP_SEQUENCE — canonical order for legacy lessons (no step_sequence field)
// ---------------------------------------------------------------------------

/**
 * Default step order for the 12-step learning flow (三民版, aligned with 學習單).
 *
 * This list controls StepperNav display order and next/prev navigation
 * for lessons that do NOT carry a `step_sequence` field in their YAML.
 *
 * New lessons can specify a custom sequence via `step_sequence: [...]` in YAML.
 * Disabled steps (enabled: false in STEP_REGISTRY) are automatically filtered out
 * by `resolveActiveSteps()` before rendering.
 *
 * Comprehension steps alignment with paper worksheet:
 *   - 文章重點表 (story-structure, dbStep 15) — was tab 2 inside ComprehensionChat
 *   - 閱讀聚光燈 (reading-strategy, dbStep 16)  — was tab 3 inside ComprehensionChat
 *   - 閱讀理解   (comprehension, dbStep 3)       — was tab 1 inside ComprehensionChat
 */
export const DEFAULT_STEP_SEQUENCE: string[] = [
  'intro',
  'reading-annotation',
  'tutor',
  'full-reading',
  'listening',
  'vocab',
  'vocab-definition',
  'vocab-application',
  'reading-strategy',
  'story-structure',
  'sentence-practice',
  'comprehension',
  'vocab-word-search',
  'dictation',
  'knowledge-station',
  'report',
];

// ---------------------------------------------------------------------------
// STEP_CONFIG — backward-compat ordered array (re-derived from registry + default sequence)
// ---------------------------------------------------------------------------

/**
 * @deprecated Prefer STEP_REGISTRY for lookups and DEFAULT_STEP_SEQUENCE for ordering.
 * This array is kept for backward compatibility with callers that iterate it.
 * It is derived from STEP_REGISTRY in DEFAULT_STEP_SEQUENCE order.
 */
export const STEP_CONFIG: StepConfig[] = DEFAULT_STEP_SEQUENCE
  .map((id) => STEP_REGISTRY[id])
  .filter(Boolean);

// ---------------------------------------------------------------------------
// resolveActiveSteps — get the effective ordered+enabled steps for a lesson
// ---------------------------------------------------------------------------

/**
 * Given an optional per-lesson step sequence (from YAML `step_sequence` field),
 * return the ordered list of enabled StepConfig objects.
 *
 * - If `lessonStepSequence` is provided: use it (unknown ids are silently dropped).
 * - If absent: fall back to DEFAULT_STEP_SEQUENCE.
 * - In both cases, steps with `enabled: false` are excluded.
 *
 * This is the single resolution function — StepperNav and LearningLayout should
 * call this (or the `useStepSequence` hook) rather than importing ACTIVE_STEPS.
 */
export function resolveActiveSteps(lessonStepSequence?: string[] | null): StepConfig[] {
  const seq = (lessonStepSequence && lessonStepSequence.length > 0)
    ? lessonStepSequence
    : DEFAULT_STEP_SEQUENCE;
  return seq
    .map((id) => STEP_REGISTRY[id])
    .filter((s): s is StepConfig => !!s && s.enabled);
}

/**
 * Derive a per-lesson step sequence from the printed worksheet's section order.
 *
 * Each lesson YAML carries `worksheet_section_order`: the AUTHORITATIVE ordered
 * list of the paper 學習單 sections, e.g.
 *   [{number:'一', name:'讀全文-做記號', type:'reading_annotation'}, ...]
 * The section `type` (underscored) maps 1:1 to a STEP_REGISTRY id (hyphenated),
 * so this makes the online step flow follow each lesson's ACTUAL worksheet order
 * — the 5/1 "學習步驟動態對應學習單" requirement — instead of the flat
 * DEFAULT_STEP_SEQUENCE (which e.g. orders 文章重點表/閱讀聚光燈 opposite to the paper).
 *
 * 'intro' is prepended (the online flow always opens with it; the paper starts
 * at 讀全文). Unknown types are skipped here; disabled steps are dropped later by
 * resolveActiveSteps. Returns null when there is no worksheet order so callers
 * fall back to DEFAULT_STEP_SEQUENCE.
 */
export function stepSequenceFromWorksheet(
  worksheet?: Array<{ number?: string; name?: string; type?: string }> | null,
): string[] | null {
  if (!worksheet || worksheet.length === 0) return null;
  const ids: string[] = ['intro'];
  for (const section of worksheet) {
    const type = section?.type;
    if (!type) continue;
    const id = type.replace(/_/g, '-'); // reading_annotation → reading-annotation
    if (STEP_REGISTRY[id] && !ids.includes(id)) ids.push(id);
  }
  return ids.length > 1 ? ids : null;
}

// ---------------------------------------------------------------------------
// Derived lookup maps — computed once from STEP_CONFIG so consumers don't
// need to re-derive them.  Import these instead of building your own maps.
// ---------------------------------------------------------------------------

/** All enabled steps in default display order. Equivalent to resolveActiveSteps(). */
export const ACTIVE_STEPS = resolveActiveSteps();

/** Map from URL path id (e.g. "intro") to dbStepNumber (e.g. 1). */
export const STEP_PATH_TO_NUMBER: Record<string, number> = Object.fromEntries(
  Object.values(STEP_REGISTRY).map((s) => [s.id, s.dbStepNumber]),
);

/** Map from URL path id to AppView (e.g. "intro" → AppView.INTRO). */
export const PATH_TO_VIEW: Record<string, AppView> = Object.fromEntries(
  Object.values(STEP_REGISTRY).map((s) => [s.id, s.view]),
);
