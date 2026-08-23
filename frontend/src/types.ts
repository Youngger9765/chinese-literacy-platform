import type { TeacherWordSearchSource } from './components/reading-steps/wordSearchGrid';
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
  // 文言文專屬 (#2752) — 原文/白話對照、文白句子比對、文白詞語比對、自我挑戰。
  CLASSICAL_TEXT = 'CLASSICAL_TEXT',
  CLASSICAL_SENTENCE_MATCHING = 'CLASSICAL_SENTENCE_MATCHING',
  CLASSICAL_WORD_MATCHING = 'CLASSICAL_WORD_MATCHING',
  CLASSICAL_SELF_CHALLENGE = 'CLASSICAL_SELF_CHALLENGE',
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
  /**
   * 這一題自己的選項組（語詞應用底下的「子練習」用）。
   *
   * 🔴 沒有它的話，◎牛刀小試 / ◎詞義辨識 / 相似詞應用 這些子練習
   * 只能沿用整課的 A–G，而它們的選項**自成一組**（肆虐/蔓延、
   * 事半功倍/事倍功半、象徵/意味著/代表）—— 沿用等於做出一個
   * 學生永遠答不對的題目。後端 `_sub_exercise_cloze` 產生它。
   *
   * 沒有這個欄位時就用整課的 vocabBank，跟以前一樣。
   */
  options?: Record<string, string>;
  /** 子練習的標題（◎牛刀小試…）。只用來顯示，不影響判分。 */
  _sub_exercise?: string;
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
  /** 老師版填在【】裡的答案，依閱讀順序。不可顯示 —— 同 ordering 的 correct_order。 */
  answers?: string[];
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

/** 策略說明框。每一課的聚光燈都以它開場，舊抽取把它壓成 guide 文字流。 */
export interface SpotlightConceptBoxBlock {
  type: 'concept_box';
  text: string;
  label?: string;
}

/**
 * 連連看。答案在教師版上是紅色連線 —— 圖形，不在 DOCX 文字流裡，
 * 所以只有多模態閱讀抽得到。`answer` 是左欄代號 → 右欄代號清單。
 */
export interface SpotlightMatchingBlock {
  type: 'matching';
  label?: string;
  instruction?: string;
  left_header?: string;
  right_header?: string;
  left: Record<string, string>;
  right: Record<string, string>;
  answer?: Record<string, string[]>;
}

/**
 * 巢狀小題（一、→（一）→ 1.2.3.）。學習單本來就是這個形狀，
 * 舊抽取沒有遞迴，把它壓平成一串 guide + free_text，層級全部消失。
 */
export interface SpotlightSubBlock {
  type: 'sub_block';
  label?: string;
  prompt?: string;
  stem?: string;
  intro?: string;
  instruction?: string;
  hint?: string;
  value?: string;
  options?: Record<string, string> | string[];
  answer?: string | number | number[];
  blanks?: { answer: string; hint?: string }[];
  items?: SpotlightSubBlock[];
  reflection?: string;
}

/** 小試身手：打勾表格 ＋ 填代號，兩種練習共用一個容器。 */
export interface SpotlightExerciseBlock {
  type: 'exercise';
  index?: number;
  label?: string;
  prompt?: string;
  instruction?: string;
  option_bank?: Record<string, string>;
  rows?: Record<string, unknown>[];
  items?: { index?: number; stem?: string; answer?: string | number }[];
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
  // ⚠️ concept_box / matching / sub_block / exercise 刻意**不**進這個 union。
  //    `SpotlightUnknownBlock` 帶 `[key: string]: unknown` 的 index signature，
  //    多加一個成員會讓 TS 對既有成員的窄化失效（`block.options` 變成 unknown，
  //    連 single / table / ordering 都一起壞）。它們由 renderer 在 case 內轉型使用，
  //    型別定義留在下面供元件與測試引用。
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
  readingStrategy?: string;     // 策略「名稱」，13 字左右的標籤
  /** #2898：批次預生成的 2-3 句白話說明。策略名稱只是標籤，學生看不出要練什麼。 */
  readingStrategyExplained?: string;
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

  // ── 文言文專屬模組 (#2752) — 只有 10 課有這些欄位，其餘課全部 undefined ──
  /** 原文＋注釋（大題無編號，印在「原文」區）。 */
  /**
   * 詞語複習的教師版找字表（#2860）。150 課抽了 grid + answer_paths，
   * 但這條路徑上後端 response、api.ts 映射、前端元件三處都沒有它，
   * 於是 VocabWordSearch 一直用 story.vocabulary 自己隨機生格子 ——
   * 沒有錯誤訊息，畫面上完全正常，只是那張表不是老師出的。
   */
  vocabReview?: TeacherWordSearchSource;
  classicalText?: ClassicalTextContent;
  /** 古文今譯／白話翻譯（大題無編號）。 */
  modernTranslation?: ModernTranslationContent;
  /** 文白詞語比對（大題二：方框字填白話）。 */
  wordMatching?: ClassicalWordMatchingContent;
  /** 文白句子比對（大題一：8 句配對）。 */
  sentenceMatching?: ClassicalSentenceMatchingContent;
  /** 自我挑戰（大題六，選做：另一段文言文＋自己的題組）。 */
  selfChallenge?: ClassicalSelfChallengeContent;
  /** 導讀（無編號，印在標題下方）。 */
  introGuide?: IntroGuideContent;

  // ── 一般課也有的無編號元素 (#2752 Phase 2) — 70／58 課，不限單一課型 ──
  /** 目標策略框（印在標題附近，年級/文體徽章 + 本課目標策略一句話）。 */
  goalBox?: GoalBoxContent;
  /** 讀前自我檢核（「大題一 讀全文-做記號」開始前的自我檢核清單）。 */
  selfCheckBeforeReading?: SelfCheckBeforeReadingContent;
  /** 語詞書寫練習／難字挑戰（多為大題九，緊接在「八 詞語複習」之後）。 */
  writingPractice?: WritingPracticeContent;

  // ── 多文本合讀課 (#2752 Phase 3) — 4 課，第 1 篇已經在既有欄位（paragraphs 等）
  // 由 full_text_annotate 提供；這裡放的是**第 2、3 篇**。 ──
  /** 第 2、3 篇（第 1 篇走既有的 paragraphs/full-text-annotate 欄位）。 */
  multiTextParts?: MultiTextPart[];
  /** 「跨課文習作／三篇合讀」過場字，讀完所有篇次後顯示。 */
  crossTextBanner?: CrossTextBannerContent;
  /**
   * 第一篇專屬追問——兩種形狀共用同一個欄位名（來源模組本來就是同一個檔案）：
   *   - `questions` 形狀：文章重點表的加碼題（FOLD 進 keypoints-table）
   *   - `items` 形狀：「閱讀接力」——check 剛讀的一篇 + 導向下一篇的問題
   *     （FOLD 進 full-text-annotate，跟 multiTextParts 同頁）
   */
  keypointsFollowupQuestions?: KeypointsFollowupQuestionsContent;
}

export interface MultiTextPart {
  lesson_heading?: string;
  part_no?: number | null;
  part_of?: number | null;
  body?: {
    paragraphs?: Array<{ idx?: number; text: string } | string>;
  };
  /** 少數課（如 L0144）在每一篇底下也帶了自己的「閱讀接力」——目前只顯示
   *  頂層 keypointsFollowupQuestions 的第一篇版本，這裡先不重複渲染二三篇的，
   *  留作已知的後續深化項（見 module_entry_gate.py 的 note）。 */
  reading_relay?: unknown;
}

export interface CrossTextBannerContent {
  title_block?: { title?: string };
  heading?: string;
  note_line?: string;
  text?: string;
}

export interface KeypointsFollowupQuestionsItem {
  answer: string | number;
  stem: string;
  options?: Record<string, string>;
  explanation?: string;
}

export interface KeypointsFollowupQuestionsRelayItem {
  type: 'single' | 'guide' | string;
  label?: string;
  prompt?: string;
  text?: string;
  options?: Record<string, string>;
  answer?: string | number;
}

export interface KeypointsFollowupQuestionsContent {
  instruction?: string;
  belongs_to?: string;
  /** L0063 形狀：重點表加碼題。 */
  questions?: KeypointsFollowupQuestionsItem[];
  /** L0144 形狀：閱讀接力（check + 導引到下一篇）。 */
  items?: KeypointsFollowupQuestionsRelayItem[];
  section_name_printed?: string;
  subtitle?: string;
}

export interface WritingPracticeContent {
  /** 少見的替代標題，如「難字挑戰」——沒有時用預設的「語詞書寫練習」。 */
  label?: string;
  instruction?: string;
  words: string[];
  /** 原稿加框標出的「時間不夠時只寫這幾個」難字（少見）。 */
  boxed_chars?: string[];
}

export interface GoalBoxContent {
  /** 裝飾性標題，如「閱讀之旅的起點」。跟 level_badge 二選一，不一定同時有。 */
  title?: string;
  /** 「Level N・文體」格式徽章 —— 跟既有的年級/類別 badge 語意重複，故意不重複顯示。 */
  level_badge?: string;
  /** 本課目標策略一句話，如「目標策略：讀出故事道理」——這是本欄位唯一必用的內容。 */
  strategy_line: string;
}

export interface SelfCheckBeforeReadingContent {
  /** 「※ 如果你有做到下列事項，請在□內打勾。」——部分課沒有這句（原稿如此）。 */
  instruction?: string;
  items: string[];
}

// ── 文言文專屬模組的內容型別 (#2752) ─────────────────────────────────────────
// 直接對映 backend/data/lessons/*/v3/{classical_text,...}.yml 的形狀
// （lesson_uid_loader 已把外層 wrapper 拆掉，見該檔案註解）。

export interface ClassicalTextContent {
  source_label?: string;
  paragraphs: string[];
  annotations_label?: string;
  annotations?: { term: string; text: string }[];
}

export interface ModernTranslationContent {
  section_name?: string;
  paragraphs: string[];
}

export interface ClassicalWordMatchingBlank {
  answer: string;
}

export interface ClassicalWordMatchingItem {
  index: number;
  classical: string;
  boxed_terms?: string[];
  vernacular: string;
  blanks: ClassicalWordMatchingBlank[];
}

export interface ClassicalWordMatchingContent {
  instruction?: string;
  items: ClassicalWordMatchingItem[];
}

export interface ClassicalSentenceMatchingSegment {
  index: number;
  classical: string;
  answer: number;
}

export interface ClassicalSentenceMatchingContent {
  instruction?: string;
  passage_paragraphs?: string[];
  reference_label?: string;
  reference_sentences: Record<string, string>;
  segments: ClassicalSentenceMatchingSegment[];
}

/** One question in self_challenge's part_one/part_two — either a short-answer
 *  fill-in (only `answer`) or a multiple-choice pick (`options` + `answer`). */
export interface ClassicalSelfChallengeQuestionItem {
  index: number;
  stem: string;
  options?: Record<string, string>;
  answer: string | number;
  instruction?: string;
}

export interface ClassicalSelfChallengePart {
  label?: string;
  items: ClassicalSelfChallengeQuestionItem[];
}

export interface ClassicalSelfChallengeContent {
  optional_note?: string;
  instruction?: string;
  strategy_banner?: string;
  passage: string;
  annotations?: { index?: number; term: string; text: string }[];
  translation?: string;
  part_one?: ClassicalSelfChallengePart;
  part_two?: ClassicalSelfChallengePart;
}

export interface IntroGuideContent {
  section_name?: string;
  text: string;
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
