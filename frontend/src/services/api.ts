/**
 * API call layer — all backend communication goes through here.
 * Use fetch or axios to call the FastAPI backend at VITE_API_URL.
 *
 * Environment variable: VITE_API_URL (default: http://localhost:8000)
 */

import type { Story } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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
  fill_in_blank: unknown;
  multiple_choice: unknown;
  reading_benchmark: { levels: { threshold: string; feedback: string }[] } | null;
  text_type: string;
  source_file: string;
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
  };
}

export async function fetchStories(token?: string): Promise<{ stories: Story[]; total: number; grades: number[] }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/stories`, { headers });
  if (!res.ok) throw new Error(`fetchStories failed: ${res.status}`);
  const data: ApiStoryListResponse = await res.json();
  return {
    stories: data.stories.map(apiListItemToStory),
    total: data.total,
    grades: data.grades,
  };
}

export async function fetchStory(id: string): Promise<Story> {
  const res = await fetch(`${API_BASE}/api/stories/${id}`);
  if (!res.ok) throw new Error(`fetchStory failed: ${res.status}`);
  const data: ApiStoryDetail = await res.json();
  return apiDetailToStory(data);
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

export interface ConversationTurn {
  role: 'ai' | 'student';
  text: string;
}

export interface ComprehensionResponse {
  question: string;
  question_number: number;
}

export async function askComprehensionQuestion(payload: {
  storyTitle: string;
  storyText: string;
  conversation: ConversationTurn[];
}): Promise<ComprehensionResponse> {
  const res = await fetch(`${API_BASE}/api/comprehension/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      story_text: payload.storyText,
      conversation: payload.conversation,
    }),
  });
  if (!res.ok) throw new Error(`askComprehensionQuestion failed: ${res.status}`);
  return res.json();
}

// --- New Comprehension Chat API (Issue #1: answer evaluation) ---

export interface ChatResponse {
  question: string;
  feedback: string | null;
  understood: boolean | null;
  understood_count: number;
  required_count: number;
  phase: string;
  is_complete: boolean;
  referenced_paragraph: number | null;
}

export async function sendComprehensionChat(payload: {
  sessionId: string;
  storyTitle: string;
  storyText: string;
  studentAnswer: string | null;
  mispronouncedWords?: string[];
  accuracy?: number;
  cpm?: number;
  /** DB LearningSession integer ID — when provided, dialogue turns are persisted (Issue #242) */
  dbSessionId?: number;
  token?: string;
}): Promise<ChatResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (payload.token) headers['Authorization'] = `Bearer ${payload.token}`;
  const res = await fetch(`${API_BASE}/api/comprehension/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: payload.sessionId,
      story_title: payload.storyTitle,
      story_text: payload.storyText,
      student_answer: payload.studentAnswer,
      mispronounced_words: payload.mispronouncedWords,
      accuracy: payload.accuracy,
      cpm: payload.cpm,
      db_session_id: payload.dbSessionId ?? null,
    }),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => ({ detail: '' }));
    const detail = body.detail ?? '';
    if (detail.includes('not found') || detail.includes('expired')) {
      throw new SessionExpiredError(detail);
    }
    throw new Error(detail || `sendComprehensionChat failed: 422`);
  }
  if (!res.ok) throw new Error(`sendComprehensionChat failed: ${res.status}`);
  return res.json();
}

// --- Dialogue history API (Issue #242) ---

export interface DialogueTurnItem {
  id: number;
  turn_order: number;
  role: 'ai' | 'student' | 'feedback';
  text: string;
  is_correct: boolean | null;
  phase: string | null;
  created_at: string;
}

export interface DialogueHistoryResponse {
  session_id: number;
  story_slug: string | null;
  turns: DialogueTurnItem[];
  total: number;
}

export async function fetchDialogueHistory(
  token: string,
  sessionId: number,
): Promise<DialogueHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/dialogue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchDialogueHistory failed: ${res.status}`);
  return res.json();
}

export async function fetchLearningSessions(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<{ items: LearningSummary[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const url = `${API_BASE}/api/learning/sessions${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`fetchLearningSessions failed: ${res.status}`);
  return res.json();
}

export interface LearningSummary {
  id: number;
  story_slug: string | null;
  status: string;
  current_step: number;
  accuracy: number | null;
  overall_score: number | null;
  started_at: string;
  completed_at: string | null;
}
