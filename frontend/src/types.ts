
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

/** G7 圖文整合格式：多練習清單，每項含步驟 (#1390) */
export interface StrategyExerciseItem {
  exercise: string;
  description: string;
  steps: { step: string; description: string }[];
}

export interface Story {
  id: string;
  title: string;
  level: number;
  content: string[];
  thumbnail: string;
  category: 'Fable' | 'Science' | 'History' | 'Daily';
  filename: string;
  intro?: StoryIntro;
  grade?: number;               // 4-9
  genre?: string;               // 記敘文/說明文/議論文
  readingStrategy?: string;     // for future Intro enhancement
  vocabulary?: VocabItem[];     // for future VocabPractice enhancement
  charCount?: number;           // for reading benchmark
  readingBenchmark?: { levels: { threshold: string; feedback: string }[] };
  /** Teacher-defined difficulty override (overrides grade-based auto-detect). */
  difficultyLevel?: 'easy' | 'medium' | 'hard';
  /** Teacher-defined custom tags, e.g. ["重要考題", "期末複習"]. */
  customTags?: string[];
  // 三民教材練習題 (#615)
  fillInBlank?: FillInBlankItem[];           // ④ 語詞應用（PDF 現成資料）
  multipleChoice?: MultipleChoiceItem[];     // ⑦ 閱讀理解選擇題（PDF 現成資料）
  vocabBank?: Record<string, string>;        // { A: "疑難雜症", ... } for fillInBlank
  knowledgeVideoUrl?: string;               // ⑨ 知識補給站 YouTube URL
  strategyExercise?: StrategyExercise | StrategyExerciseItem[];  // 閱讀策略練習 (#943); StrategyExerciseItem[] for G7 圖文整合 (#1390)
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
  }[];
  /** Paragraphs array (Layer-2 lessons use this instead of content). */
  paragraphs?: string[];
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

export type DiffType = 'correct' | 'forgiven' | 'wrong' | 'missing' | 'extra' | 'unread';

export interface DiffToken {
  char: string;
  type: DiffType;
  expected?: string;
  spoken?: string;
  reason?: string;
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
  evaluation_method: 'ai' | 'fallback';
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

export interface FullReadingResult {
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
  fullReadingResult: FullReadingResult | null;
  /** Paragraph indices (0-based) completed during LiveTutor (progressive unlock). */
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
