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
 *   New lessons can include `step_sequence: ['full-text-annotate', 'paragraph-reading', ...]`
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
  /**
   * 一份學習單多篇文章時（#2916），同一個大題會出現好幾次。
   * 那幾步的 `id` 帶後綴（`key-passage-reading#4uee3`）讓它們天然不撞，
   * `baseId` 是拿掉後綴的原始 step id（決定要 render 哪個元件、走哪條路由），
   * `roundSlug` 是這一步屬於哪一篇（`?p=` 用它、進度紀錄的 key 也用它）。
   * 單篇課這兩個都是 undefined，行為跟以前一模一樣。
   */
  baseId?: string;
  roundSlug?: string;
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
  'lesson-intro': {
    id: 'lesson-intro',
    label: '課程簡介',
    displayChar: '簡',
    hint: '看看這堂課要學什麼策略，以及有哪些步驟',
    view: AppView.INTRO,
    dbStepNumber: 1,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'full-text-annotate': {
    id: 'full-text-annotate',
    label: '讀全文-做記號',
    displayChar: '記',
    hint: '閱讀全文，選取不懂或重要的詞語做記號',
    view: AppView.READING_ANNOTATION,
    dbStepNumber: 8,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'paragraph-reading': {
    id: 'paragraph-reading',
    label: '逐段朗讀',
    displayChar: '段',
    hint: '跟著 AI 一段一段大聲朗讀',
    view: AppView.TUTOR,
    dbStepNumber: 2,
    needsStory: true,
    enabled: false, // 2026-07-20 教授審查：朗讀簡化為單一「重點朗讀」→ 逐段從 StepperNav 隱藏（ToolPicker 仍可進）
    category: 'reading',
  },
  // 2026-07-20 教授審查決策（曾世傑教授）：朗讀只練老師指定的「重點段落」(念順順，約 300-400 字，
  // 課文旁手指頭符號標起點、右欄累計字數標長度)，不練全文。做法＝把既有 full-reading step **改造**成
  // 重點朗讀（保留 step id 'key-passage-reading' → 完成/進度/作業 gate 全沿用現成佈線，不新增 step 避免完成-識別 bug）。
  // 重點段資料就緒前，KeyPassageReadingPage 暫唸全文作 fallback；Phase 1 接 key_reading 欄位後只唸指定段
  // （見 docs/reading-key-passage-TODO.md、skill lesson-reading-pipeline）。
  // ⚠️ 改這個 id 一定要同步更新後端 `backend/app/models/session.py` 的 `_FRONTEND_STEP_ALIAS`
  // （前端 step key → 後端 canonical key → step number）。後端查無此 key 會算成 0，
  // 完成度掉單、作業提交卡住且靜默無 error（#2588）。
  'key-passage-reading': {
    id: 'key-passage-reading',
    label: '重點朗讀',
    displayChar: '朗',
    hint: '朗讀老師指定的重點段落，練習流暢度',
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
  'character-practice': {
    id: 'character-practice',
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
  'keypoints-table': {
    id: 'keypoints-table',
    label: '文章重點表',
    displayChar: '重',
    hint: '把課文重點填進去，讓 AI 幫你檢查',
    view: AppView.STORY_STRUCTURE,
    dbStepNumber: 15,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
  },
  'spotlight': {
    id: 'spotlight',
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
  'vocab-review': {
    id: 'vocab-review',
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

  // ── 文言文專屬 steps (#2752) ────────────────────────────────────────────
  //
  // Deliberately NOT added to DEFAULT_STEP_SEQUENCE: these ids only ever
  // appear in a lesson's own `step_sequence` (backend
  // `lesson_indexes.py::CLASSICAL_STEP_SEQUENCE`, populated only when
  // `classical_text` is present). Adding them to the default sequence would
  // put four empty-state steps into the stepper nav of the other ~165
  // 白話 lessons that have none of this data.
  //
  // `enabled: true` is still required — `resolveActiveSteps()` filters a
  // resolved sequence by `.enabled` regardless of which sequence it came
  // from, so `false` here would strip these out of the 文言文 lessons too,
  // not just hide them from the default.
  //
  // Routes for these ids exist because `learningRoutes.tsx::buildLearningRoutes()`
  // iterates `Object.keys(STEP_REGISTRY)` (not `DEFAULT_STEP_SEQUENCE`) — see
  // the comment there for why that iteration source had to change.
  'classical-text': {
    id: 'classical-text',
    label: '原文',
    displayChar: '文',
    hint: '閱讀文言文原文，對照白話翻譯與注釋',
    view: AppView.CLASSICAL_TEXT,
    dbStepNumber: 17,
    needsStory: true,
    enabled: true,
    category: 'reading',
  },
  'classical-sentence-matching': {
    id: 'classical-sentence-matching',
    label: '文白句子比對',
    displayChar: '句',
    hint: '找出原文句子對應的白話參考句',
    view: AppView.CLASSICAL_SENTENCE_MATCHING,
    dbStepNumber: 18,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  'classical-word-matching': {
    id: 'classical-word-matching',
    label: '文白詞語比對',
    displayChar: '詞',
    hint: '寫出方框文字對應的白話意思',
    view: AppView.CLASSICAL_WORD_MATCHING,
    dbStepNumber: 19,
    needsStory: true,
    enabled: true,
    category: 'practice',
  },
  'classical-self-challenge': {
    id: 'classical-self-challenge',
    label: '自我挑戰',
    displayChar: '戰',
    hint: '選做：閱讀另一段文言文，運用學到的策略作答',
    view: AppView.CLASSICAL_SELF_CHALLENGE,
    dbStepNumber: 20,
    needsStory: true,
    enabled: true,
    category: 'comprehension',
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
  'lesson-intro',
  'full-text-annotate',
  'paragraph-reading',
  'key-passage-reading',
  'listening',
  'character-practice',
  'vocab-definition',
  'vocab-application',
  'spotlight',
  'keypoints-table',
  'sentence-practice',
  'comprehension',
  'vocab-review',
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
    .map((key) => {
      // `key-passage-reading#4uee3` → registry 查 `key-passage-reading`，
      // 但回傳的 id 保留整個 key，讓三篇的步驟、進度紀錄、網址天然不撞（#2916）。
      const hash = key.indexOf('#');
      if (hash < 0) return STEP_REGISTRY[key];
      const base = key.slice(0, hash);
      const slug = key.slice(hash + 1);
      const cfg = STEP_REGISTRY[base];
      return cfg ? { ...cfg, id: key, baseId: base, roundSlug: slug } : undefined;
    })
    .filter((s): s is StepConfig => !!s && s.enabled);
}

/**
 * Parser section `type` → STEP_REGISTRY `id` aliases (#2526).
 *
 * The printed-worksheet parser emits a `type` vocabulary that does NOT line up
 * 1:1 with STEP_REGISTRY ids. The plain `_`→`-` transform only rescues the
 * cases that happen to match after that swap (e.g. `vocab_application` →
 * `vocab-application`); everything else was silently dropped, so ~74% of
 * sections vanished on ~16 courses that carry no manual `step_sequence`.
 *
 * These 5 mappings are UNAMBIGUOUS and applied BEFORE the dash transform.
 * When the parser vocabulary drifts, add the new alias here (a console.warn in
 * stepSequenceFromWorksheet flags any type that still resolves to nothing).
 */
export const WORKSHEET_TYPE_ALIASES: Record<string, string> = {
  // ── 模組名 → step id（#2916）────────────────────────────────────
  // `worksheet_section_order` 的 `type` 現在直接給模組名，因為那份順序是從
  // 每一課的總帳 `_manifest.yml` 來的，而總帳講的是模組。
  // ⚠️ 這張表要跟 `scripts/module_entry_gate.py` 的 ENTRY 保持一致 ——
  //    那道門會解析本檔驗證「每個抽出來的模組，學生都走得到」。
  full_text_annotate: 'full-text-annotate', //   一 讀全文-做記號
  key_reading: 'key-passage-reading', //          念順順 → 重點朗讀
  vocab_application: 'vocab-application', //      語詞應用
  keypoints: 'keypoints-table', //                文章重點表／文章重點整理
  vocab_review: 'vocab-review', //                詞語複習
  resources: 'knowledge-station', //              知識補給站
  comprehension: 'comprehension', //              閱讀理解
  spotlight: 'spotlight', //                      閱讀聚光燈／品格聚光燈

  // ── 舊的學習單 section type（parser 詞彙）──────────────────────
  vocab_definitions: 'vocab-definition', // 語詞我最棒 (plural type → singular id)
  structure_table: 'keypoints-table', //   文章重點表
  reading_strategy: 'spotlight', //   閱讀聚光燈（學習單的 section type 是 reading_strategy，不可改）
  mcq: 'comprehension', //                  閱讀理解
  word_search: 'vocab-review', //      詞語複習
  reading_timer: 'key-passage-reading', //         念順順 → 重點朗讀（full-reading 已改造成重點朗讀，2026-07-20）
};

/**
 * Worksheet section types that are KNOWN but deliberately NOT mapped.
 *
 * 2026-07-20 教授審查會議解決了唯一的歧義：`reading_timer` (念順順，1 分鐘計時流暢朗讀)
 * 曾在 tutor(逐段) / full-reading(全文) 間無法定案，會議定調朗讀只練老師指定的「重點段落」
 * → 把 full-reading step 改造成「重點朗讀」並把 reading_timer 對應過去（見 WORKSHEET_TYPE_ALIASES）。
 * 目前沒有其他已知未對應的 type；若 parser 詞彙漂移，新的未對應 type 會在
 * stepSequenceFromWorksheet 觸發 console.warn（intended，讓 drop 保持可見）。
 */
export const KNOWN_UNMAPPED_WORKSHEET_TYPES = [] as const;

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
 * 'lesson-intro' is prepended (the online flow always opens with it; the paper starts
 * at 讀全文). Unmapped types are dropped (with a console.warn — see below), and
 * disabled steps are dropped later by resolveActiveSteps. Returns null when
 * there is no worksheet order so callers fall back to DEFAULT_STEP_SEQUENCE.
 */
export const LEGACY_STEP_ID_ALIASES: Record<string, string> = {
  'full-reading': 'key-passage-reading',
  tutor: 'paragraph-reading',
  intro: 'lesson-intro',
  'reading-annotation': 'full-text-annotate',
  'reading-strategy': 'spotlight',
  'story-structure': 'keypoints-table',
  vocab: 'character-practice',
  'vocab-word-search': 'vocab-review',
};

/** Resolve a possibly-legacy step id to the current one. Unknown ids pass through. */
export function resolveStepId(id: string): string {
  return LEGACY_STEP_ID_ALIASES[id] ?? id;
}

/**
 * Steps a visitor may open without an account (#2649).
 *
 * A student scans a QR code printed on a paper worksheet. They have no session.
 * If every learning step sits behind the login wall, that QR code does nothing
 * but show them a password box — so the one step the QR code targets, 讀全文-做
 * 記號, has to be readable and listenable anonymously.
 *
 * Every other step stays private, and the reason is the same in each case: it
 * *writes* something. Recordings, annotations, practice results and scores all
 * have to belong to a user. Reading and listening do not.
 *
 * Keep this set at one entry unless the same argument can be made again.
 */
export const PUBLIC_LEARNING_STEPS: ReadonlySet<string> = new Set([
  'full-text-annotate',
  // The 念順順 passage. Its own step both plays the passage and records the
  // student reading it, so anonymous visitors get a listen-only view of it —
  // the recording half still needs an account to belong to. Without this the
  // 段落 QR printed on the worksheet walked straight into a login box.
  'key-passage-reading',
]);

/** True when `id` (canonical or legacy) is openable without logging in. */
export function isPublicLearningStep(id: string): boolean {
  return PUBLIC_LEARNING_STEPS.has(resolveStepId(id));
}

export function stepSequenceFromWorksheet(
  worksheet?: Array<{ number?: string; name?: string; type?: string; part?: number | string | null; slug?: string | null }> | null,
): string[] | null {
  if (!worksheet || worksheet.length === 0) return null;
  const ids: string[] = ['lesson-intro'];
  for (const section of worksheet) {
    const type = section?.type;
    if (!type) continue;
    // 一份學習單印好幾篇文章時（#2916），同一個大題會出現好幾次。
    // 帶 slug 的那幾列要各自成為一個步驟，所以 key 加後綴 `#<slug>`：
    //     key-passage-reading          單篇課，跟以前一模一樣
    //     key-passage-reading#4uee3    第 2 篇的念順順
    // ⚠️ 下面那行去重原本是 `!ids.includes(id)`，三個念順順會被收斂成一個 ——
    //    L0063 帳本 19 列、畫面只出現 9 步，學生看不到另外兩篇的入口
    //    （2026-08-25 真瀏覽器實測抓到）。後綴讓它們天然不相等。
    const round = section?.slug ? `#${section.slug}` : '';
    // Alias BEFORE the dash transform, then look up in the registry.
    const aliased = WORKSHEET_TYPE_ALIASES[type] ?? type;
    // Underscore→dash yields the *historical* id (reading_annotation →
    // reading-annotation). Run it through the legacy resolver so worksheet
    // vocabulary — printed on paper and therefore unrenameable — keeps
    // reaching the current step ids.
    const id = resolveStepId(aliased.replace(/_/g, '-'));
    if (STEP_REGISTRY[id]) {
      const key = id + round;
      if (!ids.includes(key)) ids.push(key);
    } else {
      // #2526: never silently drop. Surface unmapped types so future parser
      // vocabulary drift is visible instead of quietly deleting steps.
      // `reading_timer` (see KNOWN_UNMAPPED_WORKSHEET_TYPES) hits this until
      // product confirms its target — intended.
      console.warn(
        `[stepConfig] worksheet section type "${type}" (resolved to "${id}") has no ` +
          `matching STEP_REGISTRY id — section dropped. Add an alias to ` +
          `WORKSHEET_TYPE_ALIASES or confirm the mapping.`,
      );
    }
  }
  return ids.length > 1 ? ids : null;
}

// ---------------------------------------------------------------------------
// Derived lookup maps — computed once from STEP_CONFIG so consumers don't
// need to re-derive them.  Import these instead of building your own maps.
// ---------------------------------------------------------------------------

/** All enabled steps in default display order. Equivalent to resolveActiveSteps(). */
export const ACTIVE_STEPS = resolveActiveSteps();

/** Map from URL path id (e.g. "lesson-intro") to dbStepNumber (e.g. 1). */
export const STEP_PATH_TO_NUMBER: Record<string, number> = Object.fromEntries(
  Object.values(STEP_REGISTRY).map((s) => [s.id, s.dbStepNumber]),
);

/** Map from URL path id to AppView (e.g. "lesson-intro" → AppView.INTRO). */
export const PATH_TO_VIEW: Record<string, AppView> = Object.fromEntries(
  Object.values(STEP_REGISTRY).map((s) => [s.id, s.view]),
);

// ---------------------------------------------------------------------------
// Legacy step ids
// ---------------------------------------------------------------------------

/**
 * Old id → current id.
 *
 * The ids were renamed so each one says what its label says. Two were
 * outright inverted before that: `full-reading` read a single key passage,
 * while `reading-annotation` was the step that actually read the whole text —
 * which is how a feature ended up wired to `tutor`, a step disabled since
 * 2026-07-20, and how the 「全文」 QR codes came to point at the intro page.
 *
 * These aliases exist because URLs have already been handed out: QR codes
 * generated from the admin panel, links in issues, links in docs. Resolving
 * them costs one lookup and saves every one of those from 404ing.
 *
 * dbStepNumber is deliberately untouched by the rename — student progress is
 * stored as that integer, never as the id string, so no row had to move.
 */

