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

// --- AI Reading Analysis API (Issue #241: Gemini reading diagnosis) ---

export interface AIAnalysisResponse {
  analysis_summary: string;
  strengths: string[];
  areas_for_improvement: string[];
  practice_suggestions: string[];
  encouragement_message: string;
}

/**
 * Fetch AI reading analysis. Uses session-based endpoint when sessionId is
 * available (with server-side caching), otherwise the standalone endpoint.
 */
export async function getAIAnalysis(
  token: string,
  payload: {
    storyTitle: string;
    accuracy: number;
    cpm: number;
    errorChars: string[];
    totalCharacters: number;
  },
  sessionId?: number,
): Promise<AIAnalysisResponse> {
  const url = sessionId
    ? `${API_BASE}/api/learning/sessions/${sessionId}/ai-analysis`
    : `${API_BASE}/api/learning/ai-analysis`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      accuracy: payload.accuracy,
      cpm: payload.cpm,
      error_chars: payload.errorChars,
      total_characters: payload.totalCharacters,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `AI analysis failed: ${res.status}`);
  }
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

// --- Comprehension Scoring API (Issue #243) ---

export interface ComprehensionScoreFeedback {
  literal: string;
  inferential: string;
  evaluative: string;
  overall: string;
}

export interface ComprehensionScoreResult {
  comprehension_score: number;
  literal_score: number;
  inferential_score: number;
  evaluative_score: number;
  feedback: ComprehensionScoreFeedback;
}

export async function getComprehensionScore(
  token: string,
  sessionId: number,
  payload: {
    storyTitle: string;
    storyText: string;
    dialogueTurns: ConversationTurn[];
  },
): Promise<ComprehensionScoreResult> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/comprehension-score`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      story_text: payload.storyText,
      dialogue_turns: payload.dialogueTurns,
    }),
  });
  if (!res.ok) throw new Error(`getComprehensionScore failed: ${res.status}`);
  return res.json();
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

// --- Error Correction API (Issue #248) ---

export interface ErrorPatternItem {
  character: string;
  total_error_count: number;
  sessions_with_error: number;
  last_error_date: string | null;
  suggested_practice: boolean;
  is_corrected: boolean;
}

export interface ErrorPatternsResponse {
  patterns: ErrorPatternItem[];
  total: number;
}

export interface RecommendedVocabItem {
  character: string;
  error_count: number;
  related_words: string[];
  zhuyin: string | null;
}

export interface RecommendedVocabResponse {
  items: RecommendedVocabItem[];
  total: number;
}

export interface ErrorCorrectionResponse {
  id: number;
  student_id: number;
  character: string;
  correction_type: string;
  created_at: string;
}

export async function getErrorPatterns(token: string, studentId: number): Promise<ErrorPatternsResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/error-patterns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getErrorPatterns failed: ${res.status}`);
  return res.json();
}

export async function getRecommendedVocab(token: string, studentId: number): Promise<RecommendedVocabResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/recommended-vocab`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getRecommendedVocab failed: ${res.status}`);
  return res.json();
}

// --- Student Progress API (Issue #257) ---

export interface StepStatusItem {
  step_key: string;
  step_label: string;
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface NextStepRec {
  action: 'continue' | 'retry_step' | 'new_text';
  step: string | null;
  step_label?: string;
  reason: string;
}

export interface TextProgressItem {
  story_slug: string;
  latest_session_id: number;
  status: string;
  steps: StepStatusItem[];
  completion_pct: number;
  overall_score: number | null;
  accuracy: number | null;
  started_at: string;
  completed_at: string | null;
  next_step: NextStepRec;
}

export interface StudentProgressResponse {
  student_id: number;
  texts_attempted: number;
  texts_completed: number;
  average_score: number | null;
  texts: TextProgressItem[];
}

export async function getStudentProgress(
  token: string,
  studentId: number,
): Promise<StudentProgressResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getStudentProgress failed: ${res.status}`);
  return res.json();
}

export async function markErrorCorrected(
  token: string,
  studentId: number,
  character: string,
  type: string,
): Promise<ErrorCorrectionResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/error-corrections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ character, correction_type: type }),
  });
  if (!res.ok) throw new Error(`markErrorCorrected failed: ${res.status}`);
  return res.json();
}

// --- Student Progress Dashboard (Issue #25) ---

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  sessions_completed: number;
  avg_score: number | null;
}

export interface StudentDashboardData {
  total_sessions: number;
  completed_sessions: number;
  avg_score: number | null;
  today_sessions: number;
  week_sessions: number;
  streak_days: number;
  longest_streak: number;
  daily_activity: DailyActivity[];
  completed_story_slugs: string[];
}

export async function fetchStudentDashboard(
  token: string,
  studentId: number,
): Promise<StudentDashboardData> {
  const res = await fetch(
    `${API_BASE}/api/learning/students/${studentId}/dashboard`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`fetchStudentDashboard failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Dictionary API (issue #259: MOE dictionary integration)
// ---------------------------------------------------------------------------

export interface DictionaryDefinition {
  type: string;
  definition: string;
  examples: string[];
}

export interface DictionaryEntry {
  character: string;
  zhuyin: string | null;
  stroke_count: number | null;
  definitions: DictionaryDefinition[];
  cached: boolean;
  not_found: boolean;
  error?: string;
}

export interface DictionaryBatchResponse {
  results: DictionaryEntry[];
}

/**
 * Look up a single Chinese character from the MOE dictionary (cached).
 * No authentication required.
 */
export async function lookupCharacter(character: string): Promise<DictionaryEntry> {
  const res = await fetch(
    `${API_BASE}/api/dictionary/character/${encodeURIComponent(character)}`,
  );
  if (!res.ok) throw new Error(`lookupCharacter failed: ${res.status}`);
  return res.json();
}

/**
 * Batch look up multiple Chinese characters (max 20, deduplication applied).
 * No authentication required.
 */
export async function lookupCharactersBatch(characters: string[]): Promise<DictionaryBatchResponse> {
  const res = await fetch(`${API_BASE}/api/dictionary/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters }),
  });
  if (!res.ok) throw new Error(`lookupCharactersBatch failed: ${res.status}`);
  return res.json();
}

// ── Parent portal API ─────────────────────────────────────────────────────────

export interface ParentInviteCode {
  id: number;
  code: string;
  student_id: number;
  student_name: string;
  expires_at: string;
  used: boolean;
}

export interface LinkedChild {
  student_id: number;
  student_name: string;
  linked_at: string;
}

export async function generateParentInviteCode(
  token: string,
  studentId: number,
): Promise<ParentInviteCode> {
  const res = await fetch(
    `${API_BASE}/api/parents/invite-codes?student_id=${studentId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `generateParentInviteCode failed: ${res.status}`);
  }
  return res.json();
}

export async function listParentInviteCodes(
  token: string,
  studentId: number,
): Promise<ParentInviteCode[]> {
  const res = await fetch(
    `${API_BASE}/api/parents/invite-codes/student/${studentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`listParentInviteCodes failed: ${res.status}`);
  const data = await res.json();
  return data.items;
}

export async function redeemParentInviteCode(
  token: string,
  code: string,
): Promise<LinkedChild> {
  const res = await fetch(`${API_BASE}/api/parents/link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `redeemParentInviteCode failed: ${res.status}`);
  }
  return res.json();
}

export async function listLinkedChildren(token: string): Promise<LinkedChild[]> {
  const res = await fetch(`${API_BASE}/api/parents/children`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`listLinkedChildren failed: ${res.status}`);
  const data = await res.json();
  return data.children;
}

export async function fetchChildDashboard(
  token: string,
  studentId: number,
): Promise<StudentDashboardData> {
  const res = await fetch(
    `${API_BASE}/api/parents/children/${studentId}/dashboard`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`fetchChildDashboard failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Gamification API (Issue #26)
// ---------------------------------------------------------------------------

export interface GamificationLevelInfo {
  level: number;
  level_name: string;
  total_xp: number;
  current_level_xp: number;
  next_level_xp: number | null;
  xp_to_next: number;
  progress_pct: number;
}

export interface GamificationStreak {
  current: number;
  longest: number;
  last_activity_date: string | null;
}

export interface GamificationBadge {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  unlocked?: boolean;
  unlocked_at?: string;
}

export interface GamificationSummary {
  student_id: number;
  total_xp: number;
  stories_completed: number;
  level_info: GamificationLevelInfo;
  streak: GamificationStreak;
  badges: GamificationBadge[];
  all_badges: GamificationBadge[];
}

export interface LeaderboardEntry {
  rank: number;
  student_id: number;
  name: string;
  total_xp: number;
  level: number;
  stories_completed: number;
}

export interface LeaderboardResponse {
  classroom_id: number;
  entries: LeaderboardEntry[];
  total_students: number;
}

export async function getGamificationSummary(
  studentId: number,
  token: string,
): Promise<GamificationSummary> {
  const res = await fetch(`${API_BASE}/api/gamification/summary/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getGamificationSummary failed: ${res.status}`);
  return res.json();
}

export async function getGamificationPoints(
  studentId: number,
  token: string,
): Promise<{ student_id: number; total_xp: number; stories_completed: number; level_info: GamificationLevelInfo }> {
  const res = await fetch(`${API_BASE}/api/gamification/points/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getGamificationPoints failed: ${res.status}`);
  return res.json();
}

export async function getGamificationStreak(
  studentId: number,
  token: string,
): Promise<GamificationStreak & { student_id: number }> {
  const res = await fetch(`${API_BASE}/api/gamification/streak/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getGamificationStreak failed: ${res.status}`);
  return res.json();
}

export async function getClassroomLeaderboard(
  classroomId: number,
  token: string,
  limit = 10,
): Promise<LeaderboardResponse> {
  const res = await fetch(
    `${API_BASE}/api/gamification/leaderboard/${classroomId}?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getClassroomLeaderboard failed: ${res.status}`);
  return res.json();
}

export async function reportSessionComplete(
  studentId: number,
  sessionId: number,
  token: string,
  opts: { readingAccuracy?: number; comprehensionPassed?: boolean } = {},
): Promise<{
  xp_earned: number;
  new_total_xp: number;
  level_info: GamificationLevelInfo;
  streak: GamificationStreak;
  badges_unlocked: string[];
}> {
  const res = await fetch(`${API_BASE}/api/gamification/session-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      student_id: studentId,
      session_id: sessionId,
      reading_accuracy: opts.readingAccuracy ?? null,
      comprehension_passed: opts.comprehensionPassed ?? false,
    }),
  });
  if (!res.ok) throw new Error(`reportSessionComplete failed: ${res.status}`);
  return res.json();
}
