
export enum AppView {
  HOME = 'HOME',
  LIBRARY = 'LIBRARY',
  INTRO = 'INTRO',
  TUTOR = 'TUTOR',
  COMPREHENSION = 'COMPREHENSION',
  VOCAB = 'VOCAB',
  FULL_READING = 'FULL_READING',
  REPORT = 'REPORT',
  WRITE = 'WRITE',
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

export type DiffType = 'correct' | 'wrong' | 'missing' | 'extra';

export interface DiffToken {
  char: string;
  type: DiffType;
  expected?: string;
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
  practicedChars: string[];
  totalChars: number;
}

export interface FullReadingResult {
  matchRate: number;
  feedback: string;
}

export interface LearningSession {
  storyId: string;
  startedAt: number;
  readingAttempt: ReadingAttempt | null;
  comprehensionResult: ComprehensionResult | null;
  vocabResult: VocabResult | null;
  fullReadingResult: FullReadingResult | null;
}

export interface LiveMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  type: 'transcription' | 'feedback' | 'evaluation';
}
