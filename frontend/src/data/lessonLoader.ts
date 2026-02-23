import { Story, VocabItem } from '../types';

interface ParsedLesson {
  lesson_number: number;
  grade: number;
  grade_code: string;
  title: string;
  genre: string;
  text_type: string;
  reading_strategy: string;
  paragraphs: string[];
  char_count: number;
  vocabulary: VocabItem[];
  source_file: string;
  reading_benchmark?: {
    levels: Array<{
      threshold: string;
      feedback: string;
    }>;
  };
}

// Eagerly load all lesson JSON files
const lessonModules = import.meta.glob<{ default: ParsedLesson }>('./lessons/*.json', { eager: true });

/**
 * Map genre to Story category
 */
function mapGenreToCategory(genre: string): 'Fable' | 'Science' | 'History' | 'Daily' {
  switch (genre) {
    case '記敘文':
      return 'Fable';
    case '說明文':
    case '説明文':  // handle both spellings
      return 'Science';
    case '議論文':
      return 'History';
    case '文言文':
      return 'History';
    case '應用文':
      return 'Daily';
    default:
      return 'Daily';
  }
}

/**
 * Convert ParsedLesson to Story
 */
function parsedLessonToStory(parsed: ParsedLesson): Story {
  const { lesson_number, grade, title, genre, reading_strategy, paragraphs, vocabulary, char_count, source_file } = parsed;

  // Generate stable seeded thumbnail
  const thumbnail = `https://picsum.photos/seed/lesson-${grade}-${lesson_number}/400/300`;

  // Map category
  const category = mapGenreToCategory(genre);

  // Build intro.author: genre + optional reading strategy
  const author = reading_strategy !== '無' ? `${genre} · ${reading_strategy}` : genre;

  // Build intro.background: first paragraph truncated to 100 chars
  const background = paragraphs[0]?.length > 100
    ? paragraphs[0].substring(0, 100) + '...'
    : paragraphs[0] || '';

  return {
    id: String(lesson_number),
    title,
    level: grade,
    content: paragraphs,
    thumbnail,
    category,
    filename: source_file,
    intro: {
      author,
      background
    },
    grade,
    genre,
    readingStrategy: reading_strategy === '無' ? undefined : reading_strategy,
    vocabulary,
    charCount: char_count
  };
}

// Load and convert all lessons
const allLessons: Story[] = Object.values(lessonModules)
  .map(module => parsedLessonToStory(module.default))
  .sort((a, b) => Number(a.id) - Number(b.id));

/**
 * Get all lessons sorted by lesson_number
 */
export function getAllLessons(): Story[] {
  return allLessons;
}

/**
 * Get lessons filtered by grade
 */
export function getLessonsByGrade(grade: number): Story[] {
  return allLessons.filter(lesson => lesson.grade === grade);
}

/**
 * Get a single lesson by id
 */
export function getLessonById(id: string): Story | undefined {
  return allLessons.find(lesson => lesson.id === id);
}

/**
 * Get sorted list of available grades from actual data
 */
export function getAvailableGrades(): number[] {
  const grades = new Set(allLessons.map(lesson => lesson.grade || 0).filter(g => g > 0));
  return Array.from(grades).sort((a, b) => a - b);
}
