import type { TeacherWordSearchSource } from '../components/reading-steps/wordSearchGrid';
/**
 * api.ts — Core session utilities and story fetch APIs.
 *
 * Issue #646: God-object split. Domain-specific APIs have been moved:
 *   - learningApi.ts  — comprehension chat, reading eval, AI analysis, dialogue, exit ticket
 *   - progressApi.ts  — error patterns, vocab recs, student progress
 *   - parentApi.ts    — parent portal (invite codes, linked children)
 *   - gamificationApi.ts — gamification + get* aliases
 *
 * This file keeps: SessionExpiredError, session localStorage helpers,
 * fetchStories, fetchStory.
 */

import type {
  Story,
  ClassicalTextContent,
  ModernTranslationContent,
  ClassicalWordMatchingContent,
  ClassicalSentenceMatchingContent,
  ClassicalSelfChallengeContent,
  IntroGuideContent,
  GoalBoxContent,
  SelfCheckBeforeReadingContent,
  WritingPracticeContent,
  MultiTextPart,
  CrossTextBannerContent,
  KeypointsFollowupQuestionsContent,
} from '../types';
import { camelizeKeys } from '../schema/camelize';
import { LessonSchema } from '../schema/lessonContent';
import { API_BASE } from './apiConfig';
import { ASSET_BASE } from '../config/assetBase';
import { stepSequenceFromWorksheet } from '../config/stepConfig';

const inFlightStoryById = new Map<string, Promise<Story>>();

/**
 * Resolve a same-origin-relative "/assets/..." URL (thumbnail_url,
 * worksheet_pdf_url, worksheet_docx_url — issue #2486) onto ASSET_BASE.
 *
 * The backend always returns these as relative paths. That's correct when
 * the frontend is served through the Firebase Hosting `/assets/**` rewrite
 * (ASSET_BASE === "", stays relative) — but when the frontend and backend
 * are on different origins (Cloud Run direct-serve, PR previews, local dev),
 * a bare "/assets/..." resolves against the FRONTEND's own origin, which has
 * no such route and silently falls back to the SPA shell (broken <img>,
 * found via real-browser QA on the #2486 PR preview). ASSET_BASE already
 * encodes the correct origin for whichever deploy shape is active, so this
 * is the single choke point every consumer (Intro.tsx, StoryCard.tsx, ...)
 * goes through instead of each hand-rolling origin resolution.
 */
function resolveAssetUrl(url: string): string;
function resolveAssetUrl(url: string | null | undefined): string | undefined;
function resolveAssetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/assets/')) {
    return `${ASSET_BASE}${url.slice('/assets'.length)}`;
  }
  return url; // already absolute (or some other shape) — leave unchanged
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

// --- Stories API response types ---

interface ApiStoryIntro {
  author: string;
  background: string;
}

interface ApiVocabItem {
  word: string;
  definition: string;
}

interface ApiStoryListItem {
  id: number;
  lesson_number: number;
  title: string;
  grade: string;   // "4".."9" / 文言文 / 品格教育
  grade_code: string;
  genre: string;
  category: string;
  char_count: number;
  thumbnail_url: string;
  reading_strategy: string | null;
  intro: ApiStoryIntro;
}

interface ApiStoryDetail extends ApiStoryListItem {
  paragraphs: string[];
  vocabulary: ApiVocabItem[] | null;
  // New-format items (5/1 curriculum batch) use context_before/context_after instead of sentence.
  // Both schemas coexist; normalization in apiDetailToStory filters to legacy-format only (#1563).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fill_in_blank: Array<Record<string, any>> | null;
  multiple_choice: Array<{ question: string; options: string[]; answer: string | null; explanation: string | null }> | null;
  vocab_bank: Record<string, string> | null;
  knowledge_video_url: string | null;
  // Full video list (#1683). null for legacy lessons without video_links field.
  video_links: { title: string; url: string }[] | null;
  reading_benchmark: { levels: { threshold: string; feedback: string }[] } | null;
  // 重點朗讀指定段 (#2559)。null → 前端唸全文 fallback。
  key_reading: { passage: string; start_text: string | null; extent_chars: number | null; source: string | null } | null;
  text_type: string;
  source_file: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strategy_exercise: Record<string, any> | any[] | null;  // list for multi-exercise lessons (G7 圖文整合, #1390)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spotlight_v2?: Record<string, any> | null;
  // Schema-driven step composition (#1374)
  step_sequence: string[] | null;
  // Plugin-pattern dispatch fields (#1404 / #1341)
  layout_mode?: 'standard' | 'graphic-text' | 'graphic-chart';
  reading_strategy_type?: string;
  images?: Array<{ filename: string; size_bytes: number; image_hash: string; content_type: string; caption?: string; figure_label?: string }>;
  // 學習單 section order + intro metadata (#1434)
  worksheet_section_order?: Array<{ number: string; name: string; type: string }> | null;
  worksheet_intro?: {
    step_label?: string;
    target_strategy?: string;
    instructions?: string[];
    level_label?: string;
    lesson_label?: string;
    authors?: string;
  } | null;
  // Lesson intro (#1443, refined by #1598)
  lesson_intro?: {
    source: 'docx_explanation' | 'docx_guide' | 'excel';
    text: string;
    course_intro?: string;
    course_intro_source?: string;
    unit_topic?: string;
    strategy_title?: string;
  } | null;
  // 紙本學習單 PDF URL (#1444) — null when no matching PDF exists
  worksheet_pdf_url?: string | null;
  // Direct docx URL when soffice PDF conversion is broken (#2073)
  worksheet_docx_url?: string | null;
  // 紙本表格 HTML render (#1685) — null when lesson has no extracted tables
  tables?: Array<{
    id: string;
    title: string;
    headers: string[];
    rows: Array<{ cells: string[]; section?: string }>;
    section_label_col?: string;
    notes?: string[];
  }> | null;
  // Typed lesson_content contract (閱讀聚光燈 EDD, DARK — handoff §4-#2). snake_case dict
  // straight from pydantic model_dump; null when the backend flag is OFF or no source.
  // Parsed in apiDetailToStory via camelizeKeys + LessonSchema.safeParse (fail-safe).
  lesson_content?: Record<string, unknown> | null;
  // 文言文專屬模組 (#2752) — null for every non-文言文 lesson.
  vocab_review?: TeacherWordSearchSource | null;
  classical_text?: ClassicalTextContent | null;
  modern_translation?: ModernTranslationContent | null;
  word_matching?: ClassicalWordMatchingContent | null;
  sentence_matching?: ClassicalSentenceMatchingContent | null;
  self_challenge?: ClassicalSelfChallengeContent | null;
  intro_guide?: IntroGuideContent | null;
  // 一般課也有的無編號元素 (#2752 Phase 2) — null for lessons without one.
  goal_box?: GoalBoxContent | null;
  self_check_before_reading?: SelfCheckBeforeReadingContent | null;
  writing_practice?: WritingPracticeContent | null;
  multi_text_parts?: MultiTextPart[] | null;
  cross_text_banner?: CrossTextBannerContent | null;
  keypoints_followup_questions?: KeypointsFollowupQuestionsContent | null;
}

interface ApiStoryListResponse {
  stories: ApiStoryListItem[];
  total: number;
  grades: string[];
}

function apiListItemToStory(item: ApiStoryListItem): Story {
  return {
    id: String(item.lesson_number),
    title: item.title,
    level: item.grade,
    content: [],
    thumbnail: resolveAssetUrl(item.thumbnail_url),
    category: item.category as Story['category'],
    filename: '',
    intro: item.intro,
    grade: item.grade,
    genre: item.genre,
    readingStrategy: item.reading_strategy ?? undefined,
    charCount: item.char_count,
  };
}

function apiDetailToStory(detail: ApiStoryDetail): Story {
  return {
    id: String(detail.lesson_number),
    title: detail.title,
    level: detail.grade,
    content: detail.paragraphs,
    thumbnail: resolveAssetUrl(detail.thumbnail_url),
    category: detail.category as Story['category'],
    filename: detail.source_file,
    intro: detail.intro,
    grade: detail.grade,
    genre: detail.genre,
    readingStrategy: detail.reading_strategy ?? undefined,
    vocabulary: detail.vocabulary ?? undefined,
    charCount: detail.char_count,
    readingBenchmark: detail.reading_benchmark ?? undefined,
    keyReading: detail.key_reading
      ? {
          passage: detail.key_reading.passage,
          startText: detail.key_reading.start_text ?? undefined,
          extentChars: detail.key_reading.extent_chars ?? undefined,
          source: detail.key_reading.source ?? undefined,
        }
      : undefined,
    // Filter to legacy-format items only.
    // Two fill_in_blank schemas coexist (#1559, #1563):
    //   Legacy: { sentence, answer: "A" } — answer is a vocab_bank letter code.
    //   New-format (5/1 batch): { id, context_before, context_after, answer: "模仿雞叫" }
    //     answer is freetext (strategy cloze), NOT a vocab_bank letter code.
    //
    // lesson_loader.py _normalize_fill_in_blank_item() synthesizes `sentence` for
    // new-format items and tags both schemas with `_schema` ("legacy" | "context_fill").
    //
    // FillInBlankExercise requires legacy format: answer must match a vocab_bank key.
    // New-format items cause a broken exercise (no answer ever matches) or crash on
    // `.sentence` access when normalization is absent. Drop them here so
    // VocabApplication.hasData returns false → NoDataFallback renders.
    // When a cloze exercise component is built for new-format, remove this filter.
    fillInBlank: detail.fill_in_blank
      ? detail.fill_in_blank.filter((item) =>
          item['_schema'] === 'legacy' || typeof item['sentence'] === 'string' && !('context_before' in item)
        ) as Array<{ sentence: string; answer: string; options?: Record<string, string> }>
      : undefined,
    multipleChoice: detail.multiple_choice ?? undefined,
    vocabBank: detail.vocab_bank ?? undefined,
    knowledgeVideoUrl: detail.knowledge_video_url ?? undefined,
    videoLinks: detail.video_links ?? undefined,
    strategyExercise: detail.strategy_exercise ?? undefined,
    spotlightV2: detail.spotlight_v2 ?? undefined,
    // Step order source of truth: an explicit YAML step_sequence wins; otherwise
    // derive the sequence from the printed worksheet's section order so the online
    // flow matches each lesson's actual 學習單 (5/1「學習步驟動態對應學習單」).
    stepSequence:
      detail.step_sequence
      ?? stepSequenceFromWorksheet(detail.worksheet_section_order)
      ?? undefined,
    worksheetSectionOrder: detail.worksheet_section_order ?? undefined,
    worksheetIntro: detail.worksheet_intro ?? undefined,
    lessonIntro: detail.lesson_intro ?? undefined,
    worksheetPdfUrl: resolveAssetUrl(detail.worksheet_pdf_url),
    worksheetDocxUrl: resolveAssetUrl(detail.worksheet_docx_url),
    tables: detail.tables ?? undefined,
    // Plugin-pattern dispatch fields (#1404 / #1341):
    layout_mode: (detail.layout_mode as Story['layout_mode']) ?? 'standard',
    reading_strategy_type: detail.reading_strategy_type ?? 'general',
    images: detail.images ?? [],
    lesson_code: detail.grade_code ?? '',
    paragraphs: detail.paragraphs,
    // Typed lesson_content contract (閱讀聚光燈 EDD, DARK). Backend sends snake_case (or
    // null when its flag is OFF); camelize + zod-parse into the typed Lesson the unified
    // renderer wants. safeParse (never throws): on drift/half-shape → undefined, so the
    // pages fall back to the storyToLesson stopgap instead of white-screening.
    lessonContent: (() => {
      if (!detail.lesson_content) return undefined;
      const parsed = LessonSchema.safeParse(camelizeKeys(detail.lesson_content));
      if (!parsed.success) {
        if (import.meta.env.DEV) {
          console.warn('lesson_content safeParse failed; falling back to storyToLesson', parsed.error);
        }
        return undefined;
      }
      return parsed.data;
    })(),
    // 文言文專屬模組 (#2752) — undefined for every non-文言文 lesson (matches
    // the `undefined`-means-absent convention every other optional field here uses).
    vocabReview: detail.vocab_review ?? undefined,
    classicalText: detail.classical_text ?? undefined,
    modernTranslation: detail.modern_translation ?? undefined,
    wordMatching: detail.word_matching ?? undefined,
    sentenceMatching: detail.sentence_matching ?? undefined,
    selfChallenge: detail.self_challenge ?? undefined,
    introGuide: detail.intro_guide ?? undefined,
    goalBox: detail.goal_box ?? undefined,
    selfCheckBeforeReading: detail.self_check_before_reading ?? undefined,
    writingPractice: detail.writing_practice ?? undefined,
    multiTextParts: detail.multi_text_parts ?? undefined,
    crossTextBanner: detail.cross_text_banner ?? undefined,
    keypointsFollowupQuestions: detail.keypoints_followup_questions ?? undefined,
  };
}

export async function fetchStories(token?: string): Promise<{ stories: Story[]; total: number; grades: string[] }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Bounded content (~270 lessons): fetch all in one request so client-side
  // grade/search filter responds instantly without re-querying the API.
  const res = await fetch(`${API_BASE}/api/stories?page_size=300`, { headers });
  if (!res.ok) throw new Error(`fetchStories failed: ${res.status}`);
  const data: ApiStoryListResponse = await res.json();
  return {
    stories: data.stories.map(apiListItemToStory),
    total: data.total,
    grades: data.grades,
  };
}

export async function fetchStory(id: string): Promise<Story> {
  const existing = inFlightStoryById.get(id);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const res = await fetch(`${API_BASE}/api/stories/${id}`);
    if (!res.ok) throw new Error(`fetchStory failed: ${res.status}`);
    const data: ApiStoryDetail = await res.json();
    return apiDetailToStory(data);
  })();

  inFlightStoryById.set(id, request);
  try {
    return await request;
  } finally {
    inFlightStoryById.delete(id);
  }
}

export async function createLearningSession(payload: {
  studentId: string;
  storyId: string;
}) {
  const res = await fetch(`${API_BASE}/api/learning-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createLearningSession failed: ${res.status}`);
  return res.json();
}

// --- Session Resume API ---

export interface SessionStatusResponse {
  id: number;
  story_slug: string | null;
  current_step: number;
  status: string;
  is_resumable: boolean;
  is_completed: boolean;
  started_at: string;
  completed_at: string | null;
}

export async function getSessionStatus(
  sessionId: number,
  token: string,
): Promise<SessionStatusResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error('Session not found');
  if (res.status === 403) throw new Error('Not your session');
  if (!res.ok) throw new Error(`getSessionStatus failed: ${res.status}`);
  return res.json();
}

// --- Active Session localStorage helpers ---

export interface ActiveSessionRecord {
  sessionId: number;
  storyId: string;
  currentStep: number;
  timestamp: number;
}

const ACTIVE_SESSION_KEY_PREFIX = 'lingoleap-active-session-';

export function saveActiveSession(userId: string, record: ActiveSessionRecord): void {
  try {
    localStorage.setItem(
      `${ACTIVE_SESSION_KEY_PREFIX}${userId}`,
      JSON.stringify(record),
    );
  } catch {
    // localStorage unavailable (e.g. private browsing) — ignore silently
  }
}

export function loadActiveSession(userId: string): ActiveSessionRecord | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveSessionRecord;
  } catch {
    return null;
  }
}

export function clearActiveSession(userId: string): void {
  try {
    localStorage.removeItem(`${ACTIVE_SESSION_KEY_PREFIX}${userId}`);
  } catch {
    // ignore
  }
}
