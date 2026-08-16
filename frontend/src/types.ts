import type { Lesson } from './schema/lessonContent';

export enum AppView {
  HOME = 'HOME',
  LIBRARY = 'LIBRARY',
  INTRO = 'INTRO',
  TUTOR = 'TUTOR',
  COMPREHENSION = 'COMPREHENSION',
  VOCAB = 'VOCAB',
  DICTATION = 'DICTATION',
  FULL_READING = 'FULL_READING',
  REPORT = 'REPORT',
  WRITE = 'WRITE',
  TEACHER_DASHBOARD = 'TEACHER_DASHBOARD',
  CLASSROOM_DETAIL = 'CLASSROOM_DETAIL',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD',
  MY_ASSIGNMENTS = 'MY_ASSIGNMENTS',
  DIALOGUE_HISTORY = 'DIALOGUE_HISTORY',
  LEARNING_HISTORY = 'LEARNING_HISTORY',
  MY_VOCABULARY = 'MY_VOCABULARY',
  STUDENT_PROGRESS = 'STUDENT_PROGRESS',
  PARENT_DASHBOARD = 'PARENT_DASHBOARD',
  STUDENT_HOME = 'STUDENT_HOME',
  TEACHER_HOME = 'TEACHER_HOME',
  ACHIEVEMENTS = 'ACHIEVEMENTS',
  STUDENT_CLASSROOM_DASHBOARD = 'STUDENT_CLASSROOM_DASHBOARD',
  STUDENT_PROFILE = 'STUDENT_PROFILE',
  READING_ANNOTATION = 'READING_ANNOTATION',
  VOCAB_APPLICATION = 'VOCAB_APPLICATION',
  VOCAB_DEFINITION_MATCH = 'VOCAB_DEFINITION_MATCH',
  VOCAB_WORD_SEARCH = 'VOCAB_WORD_SEARCH',
  KNOWLEDGE_STATION = 'KNOWLEDGE_STATION',
  LISTENING = 'LISTENING',
  SENTENCE_PRACTICE = 'SENTENCE_PRACTICE',
  STORY_STRUCTURE = 'STORY_STRUCTURE',
  READING_STRATEGY = 'READING_STRATEGY',
}

export interface StoryIntro {
  author: string;
  background: string;
}

export interface VocabItem {
  word: string;
  definition: string;
  note?: string;
}

// ④ 語詞應用 (#615)
export interface FillInBlankItem {
  sentence: string;
  answer: string;  // letter code e.g. "A", "B"
}

// ⑦ 閱讀理解選擇題 (#615)
export interface MultipleChoiceItem {
  question: string;
  options: string[];
  answer: string | null;  // letter code e.g. "A", "B", or null if missing
  explanation: string | null;
}

// 閱讀策略練習 (#943)
export interface StrategyExerciseOrderingItem {
  text: string;
  correct_order: number;
}

export interface StrategyExerciseClue {
  text: string;
  source: string;
}

export interface StrategyExerciseStep {
  prompt: string;
  type: 'free_text' | 'select';
  options?: string[];
  answer?: number; // 0-indexed
}

export interface StrategyExercise {
  type: 'ordering' | 'trait_inference' | 'guided_steps';
  strategy_name: string;
  instruction: string;
  // ordering
  items?: StrategyExerciseOrderingItem[];
  // trait_inference
  character?: string;
  clues?: StrategyExerciseClue[];
  trait_options?: string[];
  correct_trait?: string;
  // guided_steps
  steps?: StrategyExerciseStep[];
}

/** Spotlight v2 block-sequence schema (#2205) */
export interface SpotlightGuideBlock {
  type: 'guide';
  text: string;
}

export interface SpotlightPassageBlock {
  type: 'passage';
  source?: string;
  paragraphs: string[];
}

export interface SpotlightSingleBlock {
  type: 'single';
  prompt: string;
  options?: string[];
  answer?: string | number | null;
}

export interface SpotlightMultiBlock {
  type: 'multi';
  prompt: string;
  options?: string[];
  answer?: string | number | number[] | null;
}

export interface SpotlightFreeTextBlock {
  type: 'free_text';
  prompt: string;
  answer?: string | null;
}

export interface SpotlightFigureBlock {
  type: 'figure';
  referent: string;
  asset?: string | null;
  bind_paragraph?: string | number | null;
}

/** 聚光燈裡的表格練習。抽取器原本把無圖表格標成 figure(referent=table)，
 *  而 loader 會丟棄沒有圖檔的 figure —— 172 個表格、88 課的練習內容因此消失。 */
export interface SpotlightTableBlock {
  type: 'table';
  rows: string[][];
}

/** 排序題：把句子依時間／因果順序編號。`correct_order` 是老師的答案，不可顯示。 */
export interface SpotlightOrderingBlock {
  type: 'ordering';
  items: { text: string; correct_order: number | null }[];
}

export interface SpotlightSelfCheckBlock {
  type: 'self_check';
  items: string[];
}

export interface SpotlightFillTableBlock {
  type: 'fill_table';
}

export interface SpotlightUnknownBlock {
  type: 'unknown' | string;
  text?: string;
  prompt?: string;
  [key: string]: unknown;
}

export type SpotlightBlock =
  | SpotlightGuideBlock
  | SpotlightPassageBlock
  | SpotlightSingleBlock
  | SpotlightMultiBlock
  | SpotlightFreeTextBlock
  | SpotlightFigureBlock
  | SpotlightOrderingBlock
  | SpotlightTableBlock
  | SpotlightSelfCheckBlock
  | SpotlightFillTableBlock
  | SpotlightUnknownBlock;

export interface SpotlightV2 {
  lesson: string;
  strategy_name: string;
  strategy_type: string;
  blocks: SpotlightBlock[];
}

/** G7 圖文整合格式：多練習清單，每項含步驟 (#1390) */
export interface StrategyExerciseItem {
  exercise: string;
  description: string;
  steps: { step: string; description: string }[];
}

export interface Story {
  id: string;
  title: string;
  level: string;                // "4".."9" / 文言文 / 品格教育
  content: string[];
  thumbnail: string;
  category: 'Fable' | 'Science' | 'History' | 'Daily';
  filename: string;
  intro?: StoryIntro;
  grade?: string;               // "4".."9" / 文言文 / 品格教育
  genre?: string;               // 記敘文/說明文/議論文
  readingStrategy?: string;     // for future Intro enhancement
  vocabulary?: VocabItem[];     // for future VocabPractice enhancement
  charCount?: number;           // for reading benchmark
  readingBenchmark?: { levels: { threshold: string; feedback: string }[] };
  /** 重點朗讀指定段 (#2559)：學生只朗讀老師 ☞ 標的重點段。缺→唸全文 fallback。 */
  keyReading?: { passage: string; startText?: string; extentChars?: number; source?: string };
  /** Teacher-defined difficulty override (overrides grade-based auto-detect). */
  difficultyLevel?: 'easy' | 'medium' | 'hard';
  /** Teacher-defined custom tags, e.g. ["重要考題", "期末複習"]. */
  customTags?: string[];
  // 三民教材練習題 (#615)
  fillInBlank?: FillInBlankItem[];           // ④ 語詞應用（PDF 現成資料）
  multipleChoice?: MultipleChoiceItem[];     // ⑦ 閱讀理解選擇題（PDF 現成資料）
  vocabBank?: Record<string, string>;        // { A: "疑難雜症", ... } for fillInBlank
  knowledgeVideoUrl?: string;               // ⑨ 知識補給站 — first video URL only (#615, legacy)
  /** Full video list for knowledge-station (#1683). Catalog has multiple videos per lesson;
   *  KnowledgeStation renders all of them. Each item: { title: '影片1', url: 'https://...' }. */
  videoLinks?: { title: string; url: string }[];
  strategyExercise?: StrategyExercise | StrategyExerciseItem[];  // 閱讀策略練習 (#943); StrategyExerciseItem[] for G7 圖文整合 (#1390)
  spotlightV2?: SpotlightV2;  // Block-sequence 聚光燈 (#2205 dev7)
  /**
   * Typed lesson_content contract (閱讀聚光燈 EDD refactor, DARK — handoff §4-#2).
   * Populated from the story-detail API's `lesson_content` field via
   * `LessonSchema.safeParse(camelizeKeys(...))` in api.ts, ONLY when the backend supplies
   * it (backend LESSON_RENDERER_V1 flag ON) and it parses. When present, the flag-guarded
   * LessonRenderer consumes THIS (real course data) in preference to the `storyToLesson`
   * front-end stopgap. Absent when the backend flag is OFF or the payload drifted from the
   * contract (safeParse failed) — the pages then fall back to storyToLesson.
   */
  lessonContent?: Lesson;
  /**
   * Optional per-lesson step sequence loaded from YAML `step_sequence` field (#1374).
   * When present, overrides DEFAULT_STEP_SEQUENCE for StepperNav and next/prev navigation.
   * Absent for all legacy (Layer-1) lessons — they use DEFAULT_STEP_SEQUENCE as fallback.
   */
  stepSequence?: string[];
  /** Layout variant for ComprehensionChat (#1341). Default: 'standard'. */
  layout_mode?: 'standard' | 'graphic-text' | 'graphic-chart';
  /** Canonical strategy type for backend dispatch (#1404). */
  reading_strategy_type?: string;
  /** Lesson code (e.g. 'G7-L28'), used for image URL construction (#1341). */
  lesson_code?: string;
  /** Images for graphic-text layout (#1341). */
  images?: {
    filename: string;
    size_bytes: number;
    image_hash: string;
    content_type: string;
    caption?: string;
    /**
     * The REAL 圖N title baked into the image pixels (e.g. '圖一'), #2085.
     * Array order is NOT figure order — per-paragraph pairing matches on this
     * label, NOT on array index.
     */
    figure_label?: string;
  }[];
  /** Paragraphs array (Layer-2 lessons use this instead of content). */
  paragraphs?: string[];
  /** 學習單 section ordering (#1434). e.g. [{number: '二', name: '念順順', type: 'reading_timer'}, ...] */
  worksheetSectionOrder?: Array<{ number: string; name: string; type: string }>;
  /** 學習單 intro metadata (#1434). Present only for Layer-2 lessons parsed from docx. */
  worksheetIntro?: {
    step_label?: string;
    target_strategy?: string;
    instructions?: string[];
    level_label?: string;
    lesson_label?: string;
    authors?: string;
  };
  /** Lesson intro — real course introduction (#1443, refined by #1598).
   *  - `course_intro`: AI/PDF 課文簡介（教師 6/1 review 期望內容；the "what is this lesson about")
   *  - `text`: legacy field, repurposed by #1598 as 學習策略 explanation
   *    (e.g. "圖文題就是文字帶著插圖的題目..."); rendered in the 學習策略 hint section
   *  - `source`: provenance of legacy `text` only
   *  - `course_intro_source`: provenance of `course_intro` (e.g. "ai-generated-2026-05-14") */
  lessonIntro?: {
    source: 'docx_explanation' | 'docx_guide' | 'excel';
    text: string;
    course_intro?: string;
    course_intro_source?: string;
    unit_topic?: string;
    strategy_title?: string;
  };
  /** Public PDF URL of the original 紙本學習單 (#1444).
   *  Hosted on GCS at gs://lingoleap-assets/worksheets/{lesson_code}.pdf.
   *  Optional — lessons without a matching PDF (e.g. G8-L3a, 文-L*) leave this null,
   *  which hides the "查看紙本學習單" button on the Intro page. */
  worksheetPdfUrl?: string;
  /** Direct docx URL for lessons where soffice PDF conversion produces broken output (#2073).
   *  When present, the "查看紙本學習單" button becomes a download link for the docx instead
   *  of opening the broken PDF in an iframe.
   *  Hosted on GCS at gs://lingoleap-assets/worksheets/{lesson_code}.docx. */
  worksheetDocxUrl?: string;
  /** Tables extracted from 紙本學習單 PDF (#1685).
   *  Used by 圖文表整合 lessons (G7-L28, G7-L30) where docx → yml parser dropped
   *  table row data. Frontend renders via TableDisplay with click-to-zoom.
   *  Absent for lessons without tables (摘要策略 / 推論策略 課文 etc.). */
  tables?: LessonTable[];
}

/** Row of a lesson table. `section` (optional) groups rows visually
 *  — e.g. G7-L30 表一 splits "相同處" vs "相異處". */
export interface LessonTableRow {
  cells: string[];
  section?: string;
}

/** Table extracted from 紙本學習單 PDF (#1685).
 *  `section_label_col` — if present, renders an extra leftmost column carrying the
 *  `section` label spanning consecutive rows in the same section (G7-L30 異同). */
export interface LessonTable {
  id: string;
  title: string;
  headers: string[];
  rows: LessonTableRow[];
  section_label_col?: string;
  notes?: string[];
}

export interface ReadingAttempt {
  storyId: string;
  accuracy: number;
  fluency: number;
  cpm: number;            // characters per minute (read-aloud speed)
  mispronouncedWords: string[];
  transcription: string;
  timestamp: number;
  lineBreakdown?: LineBreakdown[];
}

export type DiffType =
  | 'correct'
  | 'forgiven'
  | 'wrong'
  | 'missing'
  | 'extra'
  | 'unread'
  | 'punctuation';

export interface DiffToken {
  char: string;
  type: DiffType;
  expected?: string;
  spoken?: string;
  reason?: string;
  zhuyin?: string;
}

export interface ReadingEvalStats {
  correct_count: number;
  forgiven_count: number;
  wrong_count: number;
  missing_count: number;
  extra_count: number;
}

export interface ReadingEvalThresholds {
  reading_pass: number;
  reading_excellent: number;
}

export interface ReadingEvaluateResponse {
  match_rate: number;
  adjusted_match_rate: number;
  tier: 1 | 2 | 3;
  feedback: string;
  cpm: number | null;
  diff_tokens: DiffToken[];
  stats: ReadingEvalStats;
  thresholds: ReadingEvalThresholds;
  evaluation_method: 'deterministic' | 'fallback' | 'ai'; // 'deterministic' since #2266; 'ai' kept for backward compat
}

export interface LineBreakdown {
  lineIndex: number;
  matchRate: number;
  cpm: number;
  transcript: string;
  diffTokens: DiffToken[];
}

export interface ComprehensionResult {
  understoodCount: number;
  requiredCount: number;
  isComplete: boolean;
  conversationLength: number;
}

export interface VocabResult {
  practicedWords: string[];
  totalWords: number;
}

export interface DictationWordResult {
  word: string;
  studentAnswer: string;
  isCorrect: boolean;
  skipped: boolean;
}

export interface DictationResult {
  totalWords: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  results: DictationWordResult[];
}

export interface KeyPassageReadingResult {
  matchRate: number;
  feedback: string;
  cpm?: number;
  durationMs?: number;
  errorBreakdown?: { correct: number; wrong: number; missing: number; extra: number };
  diffTokens?: DiffToken[];
  transcript?: string;
}

export interface LearningSession {
  storyId: string;
  startedAt: number;
  introCompleted: boolean;
  readingAttempt: ReadingAttempt | null;
  comprehensionResult: ComprehensionResult | null;
  vocabResult: VocabResult | null;
  dictationResult: DictationResult | null;
  fullReadingResult: KeyPassageReadingResult | null;
  /** Paragraph indices (0-based) completed during ParagraphReading (progressive unlock). */
  completedParagraphs?: number[];
  /** Completion flags for the 5 new steps (issue #690). */
  readingAnnotationCompleted?: boolean;
  vocabDefinitionMatchCompleted?: boolean;
  vocabApplicationCompleted?: boolean;
  vocabWordSearchCompleted?: boolean;
  knowledgeStationCompleted?: boolean;
  /** Persisted completed step path keys (from step_progress.steps_completed). */
  completedSteps?: string[];
}

export interface LiveMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  type: 'transcription' | 'feedback' | 'evaluation';
}
