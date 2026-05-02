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

import type { Story } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const inFlightStoryById = new Map<string, Promise<Story>>();

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
  grade: number;
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
  fill_in_blank: Array<{ sentence: string; answer: string }> | null;
  multiple_choice: Array<{ question: string; options: string[]; answer: string | null; explanation: string | null }> | null;
  vocab_bank: Record<string, string> | null;
  knowledge_video_url: string | null;
  reading_benchmark: { levels: { threshold: string; feedback: string }[] } | null;
  text_type: string;
  source_file: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strategy_exercise: Record<string, any> | any[] | null;  // list for multi-exercise lessons (G7 圖文整合, #1390)
  // Schema-driven step composition (#1374)
  step_sequence: string[] | null;
  // Plugin-pattern dispatch fields (#1404 / #1341)
  layout_mode?: 'standard' | 'graphic-text' | 'graphic-chart';
  reading_strategy_type?: string;
  images?: Array<{ filename: string; size_bytes: number; image_hash: string; content_type: string; caption?: string }>;
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
  // Lesson intro (#1443): docx 說明/導讀 or excel fallback
  lesson_intro?: {
    source: 'docx_explanation' | 'docx_guide' | 'excel';
    text: string;
    unit_topic?: string;
    strategy_title?: string;
  } | null;
}

interface ApiStoryListResponse {
  stories: ApiStoryListItem[];
  total: number;
  grades: number[];
}

function apiListItemToStory(item: ApiStoryListItem): Story {
  return {
    id: String(item.lesson_number),
    title: item.title,
    level: item.grade,
    content: [],
    thumbnail: item.thumbnail_url,
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
    thumbnail: detail.thumbnail_url,
    category: detail.category as Story['category'],
    filename: detail.source_file,
    intro: detail.intro,
    grade: detail.grade,
    genre: detail.genre,
    readingStrategy: detail.reading_strategy ?? undefined,
    vocabulary: detail.vocabulary ?? undefined,
    charCount: detail.char_count,
    readingBenchmark: detail.reading_benchmark ?? undefined,
    fillInBlank: detail.fill_in_blank ?? undefined,
    multipleChoice: detail.multiple_choice ?? undefined,
    vocabBank: detail.vocab_bank ?? undefined,
    knowledgeVideoUrl: detail.knowledge_video_url ?? undefined,
    strategyExercise: detail.strategy_exercise ?? undefined,
    stepSequence: detail.step_sequence ?? undefined,
    worksheetSectionOrder: detail.worksheet_section_order ?? undefined,
    worksheetIntro: detail.worksheet_intro ?? undefined,
    lessonIntro: detail.lesson_intro ?? undefined,
    // Plugin-pattern dispatch fields (#1404 / #1341):
    layout_mode: (detail.layout_mode as Story['layout_mode']) ?? 'standard',
    reading_strategy_type: detail.reading_strategy_type ?? 'general',
    images: detail.images ?? [],
    lesson_code: detail.grade_code ?? '',
    paragraphs: detail.paragraphs,
  };
}

export async function fetchStories(token?: string): Promise<{ stories: Story[]; total: number; grades: number[] }> {
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
