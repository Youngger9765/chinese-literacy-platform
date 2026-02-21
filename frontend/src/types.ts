
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

export interface Story {
  id: string;
  title: string;
  level: number;
  content: string[];
  thumbnail: string;
  category: 'Fable' | 'Science' | 'History' | 'Daily';
  filename: string;
  intro?: StoryIntro;
}

export interface ReadingAttempt {
  storyId: string;
  accuracy: number;
  fluency: number;
  cpm: number;            // characters per minute (read-aloud speed)
  mispronouncedWords: string[];
  transcription: string;
  timestamp: number;
}

export interface LiveMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  type: 'transcription' | 'feedback' | 'evaluation';
}
