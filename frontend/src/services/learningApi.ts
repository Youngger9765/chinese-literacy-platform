/**
 * learningApi.ts — Learning session, comprehension, dialogue, listening, and exit ticket APIs.
 *
 * Split from api.ts (#646). Covers all endpoints under /api/learning/, /api/comprehension/,
 * and /api/reading/ that are used during an active learning session.
 */

import type { ReadingEvaluateResponse } from '../types';
import { SessionExpiredError } from './api';

// Re-export so consumers can import SessionExpiredError from learningApi without
// needing to know it lives in api.ts.
export { SessionExpiredError };

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Learning session creation + reading evaluation
// ---------------------------------------------------------------------------

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

export async function evaluateReading(
  spokenText: string,
  targetText: string,
  durationMs?: number,
  token?: string,
  signal?: AbortSignal,
): Promise<ReadingEvaluateResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/reading/evaluate`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      spoken_text: spokenText,
      target_text: targetText,
      duration_ms: durationMs,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `evaluateReading failed: ${res.status}`);
  }

  return await res.json();
}

// ---------------------------------------------------------------------------
// Session status (used by SessionResumePrompt)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Self-practice session completion (Issue #1070)
// ---------------------------------------------------------------------------

/**
 * Mark a self-practice session as completed in the DB.
 *
 * Calls PATCH /api/learning/sessions/{sessionId} with status="completed".
 * completed_at is intentionally omitted — the backend sets it via server time
 * to avoid client clock skew.  Fire-and-forget — errors are non-fatal and
 * logged to console only.
 *
 * Throws SessionExpiredError on 401 so callers can distinguish token expiry
 * from other failures.
 */
export async function completeSelfPracticeSession(
  sessionId: number,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: 'completed',
    }),
  });
  if (res.status === 401) {
    throw new SessionExpiredError('completeSelfPracticeSession: token expired');
  }
  if (!res.ok) {
    throw new Error(`completeSelfPracticeSession failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Comprehension chat
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AI Reading Analysis (Issue #241, #415)
// ---------------------------------------------------------------------------

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
 *
 * Issue #415: accepts optional comprehension/vocab data for richer analysis.
 */
export async function getAIAnalysis(
  token: string,
  payload: {
    storyTitle: string;
    accuracy: number;
    cpm: number;
    errorChars: string[];
    totalCharacters: number;
    comprehensionScore?: number | null;
    vocabPracticedCount?: number | null;
    vocabTotalCount?: number | null;
    dictationCorrectCount?: number | null;
    dictationTotalCount?: number | null;
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
      comprehension_score: payload.comprehensionScore ?? null,
      vocab_practiced_count: payload.vocabPracticedCount ?? null,
      vocab_total_count: payload.vocabTotalCount ?? null,
      dictation_correct_count: payload.dictationCorrectCount ?? null,
      dictation_total_count: payload.dictationTotalCount ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `AI analysis failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Comprehension chat + scoring (Issue #1, #243)
// ---------------------------------------------------------------------------

export interface ConversationHistoryItem {
  role: 'ai' | 'student' | 'feedback';
  text: string;
  understood: boolean | null;
}

export interface ChatResponse {
  question: string;
  feedback: string | null;
  understood: boolean | null;
  understood_count: number;
  required_count: number;
  phase: string;
  is_complete: boolean;
  referenced_paragraph: number | null;
  resumed?: boolean;
  conversation_history?: ConversationHistoryItem[];
}

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
  dbSessionId?: number;
  genre?: string;
  readingStrategy?: string;
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
      genre: payload.genre ?? null,
      reading_strategy: payload.readingStrategy ?? null,
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

/** Clear the in-memory + DB session so the next fetchFirstQuestion starts fresh (Issue #632). */
export async function restartComprehensionSession(payload: {
  sessionId: string;
  dbSessionId?: number;
  token?: string;
}): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (payload.token) headers['Authorization'] = `Bearer ${payload.token}`;
  await fetch(`${API_BASE}/api/comprehension/restart`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: payload.sessionId,
      db_session_id: payload.dbSessionId ?? null,
    }),
  });
  // Fire-and-forget: non-fatal if this fails
}

// ---------------------------------------------------------------------------
// Dialogue history (Issue #242)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Learning session list + report (Issue #580)
// ---------------------------------------------------------------------------

export interface LearningSummary {
  id: number;
  story_slug: string | null;
  story_title: string | null;
  learning_source?: 'self' | 'assignment' | null;
  status: string;
  current_step: number;
  accuracy: number | null;
  overall_score: number | null;
  started_at: string;
  completed_at: string | null;
}

export async function fetchLearningSessions(
  token: string,
  params?: {
    limit?: number;
    offset?: number;
    status?: string;
    story_slug?: string;
    learning_source?: 'self' | 'assignment';
  },
): Promise<{ items: LearningSummary[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  if (params?.story_slug) qs.set('story_slug', params.story_slug);
  if (params?.learning_source) qs.set('learning_source', params.learning_source);
  const url = `${API_BASE}/api/learning/sessions${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`fetchLearningSessions failed: ${res.status}`);
  return res.json();
}

export interface SessionDetailResponse {
  id: number;
  story_slug: string | null;
  status: string;
  current_step: number;
  accuracy: number | null;
  overall_score: number | null;
  started_at: string;
  completed_at: string | null;
  reading_result: Record<string, unknown> | null;
  comprehension_result: Record<string, unknown> | null;
  vocab_result: Record<string, unknown> | null;
  full_reading_result: Record<string, unknown> | null;
  comprehension_score: number | null;
  literal_score: number | null;
  inferential_score: number | null;
  evaluative_score: number | null;
  comprehension_feedback: string | null;
  teacher_reviewed_at: string | null;
  teacher_comment: string | null;
}

export async function fetchSessionReport(
  token: string,
  sessionId: number,
): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchSessionReport failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Student progress dashboard (Issue #25)
// ---------------------------------------------------------------------------

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
// Listening comprehension (Issue #251)
// ---------------------------------------------------------------------------

export interface ListeningEvaluateResponse {
  score: number;
  key_points_covered: string[];
  key_points_missed: string[];
  feedback: string;
  encouragement: string;
}

export async function evaluateListeningRetelling(
  token: string,
  payload: {
    storyTitle: string;
    originalText: string;
    studentRetelling: string;
  },
): Promise<ListeningEvaluateResponse> {
  const res = await fetch(`${API_BASE}/api/learning/listening/evaluate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      original_text: payload.originalText,
      student_retelling: payload.studentRetelling,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `Listening evaluation failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Student enrolled classrooms (Issue #462)
// ---------------------------------------------------------------------------

export interface StudentEnrolledClassroom {
  id: number;
  name: string;
  grade: number | null;
  teacher_id: number;
  teacher_name: string;
  is_active: boolean;
  enrolled_at: string;
}

export interface StudentEnrolledClassroomsResponse {
  classrooms: StudentEnrolledClassroom[];
  total: number;
}

export async function fetchMyEnrolledClassrooms(
  token: string,
): Promise<StudentEnrolledClassroomsResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms/my-enrollments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`fetchMyEnrolledClassrooms failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Dictionary lookup (Issue #259)
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

/** Look up a single Chinese character from the MOE dictionary (cached). No auth required. */
export async function lookupCharacter(character: string): Promise<DictionaryEntry> {
  const res = await fetch(
    `${API_BASE}/api/dictionary/character/${encodeURIComponent(character)}`,
  );
  if (!res.ok) throw new Error(`lookupCharacter failed: ${res.status}`);
  return res.json();
}

/** Batch look up multiple Chinese characters (max 20, deduplication applied). No auth required. */
export async function lookupCharactersBatch(characters: string[]): Promise<DictionaryBatchResponse> {
  const res = await fetch(`${API_BASE}/api/dictionary/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters }),
  });
  if (!res.ok) throw new Error(`lookupCharactersBatch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Exit ticket (Issue #463)
// ---------------------------------------------------------------------------

export interface ExitTicketQuestion {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface ExitTicketGenerateResponse {
  questions: ExitTicketQuestion[];
  source: 'ai' | 'fallback';
}

export interface ExitTicketSubmitResponse {
  score: number;
  correct_count: number;
  total: number;
  passed: boolean;
}

export async function generateExitTicket(
  token: string,
  sessionId: number,
  storyContent: string[],
  wrongChars?: string[],
): Promise<ExitTicketGenerateResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/sessions/${sessionId}/exit-ticket/generate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        story_content: storyContent,
        wrong_chars: wrongChars ?? [],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `generateExitTicket failed: ${res.status}`);
  }
  return res.json();
}

export async function submitExitTicket(
  token: string,
  sessionId: number,
  answers: Array<{ question_id: number; selected_index: number }>,
  score: number,
  totalQuestions: number,
): Promise<ExitTicketSubmitResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/sessions/${sessionId}/exit-ticket/submit`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        answers,
        score,
        total_questions: totalQuestions,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `submitExitTicket failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Step Progress persistence (Issue #660)
// ---------------------------------------------------------------------------

export interface StepProgressData {
  current_step: string | null;
  steps_completed: string[];
  step_data: Record<string, unknown>;
}

export interface StepProgressResponse {
  session_id: number;
  step_progress: StepProgressData | null;
}

/**
 * Persist step progress to DB for a given learning session.
 * Non-blocking — caller should catch errors and not surface them to the user.
 */
export async function saveStepProgress(
  token: string,
  sessionId: number,
  progress: StepProgressData,
): Promise<StepProgressResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/progress`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(progress),
  });
  if (!res.ok) throw new Error(`saveStepProgress failed: ${res.status}`);
  return res.json();
}

/**
 * Load step progress from DB for a given learning session.
 * Returns null step_progress when nothing has been saved yet.
 */
export async function loadStepProgress(
  token: string,
  sessionId: number,
): Promise<StepProgressResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sessions/${sessionId}/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`loadStepProgress failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Reading history (for progress curve)
// ---------------------------------------------------------------------------

export interface ReadingHistoryPoint {
  session_id: number;
  started_at: string;
  cpm: number | null;
  accuracy: number | null;
  match_rate: number | null;
  overall_score: number | null;
}

export async function getReadingHistory(
  token: string,
  storySlug: string,
): Promise<ReadingHistoryPoint[]> {
  const res = await fetch(
    `${API_BASE}/api/learning/sessions/reading-history?story_slug=${encodeURIComponent(storySlug)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getReadingHistory failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Sentence practice (Issue #109, #927)
// ---------------------------------------------------------------------------

export interface ExampleSentence {
  sentence: string;
  explanation: string;
}

export type ExampleSentenceSource = 'pregenerated' | 'ai';

export async function fetchExampleSentences(
  token: string,
  word: string,
  storyTitle: string,
): Promise<{ sentences: ExampleSentence[]; source: ExampleSentenceSource }> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/example-sentences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ word, story_title: storyTitle }),
  });
  if (!res.ok) throw new Error(`fetchExampleSentences failed: ${res.status}`);
  const data = await res.json();
  return { sentences: data.sentences as ExampleSentence[], source: (data.source ?? 'ai') as ExampleSentenceSource };
}

export async function validateSentence(
  token: string,
  word: string,
  studentSentence: string,
  storyTitle: string,
): Promise<{ is_correct: boolean; feedback: string; suggestion: string }> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ word, student_sentence: studentSentence, story_title: storyTitle }),
  });
  if (!res.ok) throw new Error(`validateSentence failed: ${res.status}`);
  return res.json();
}
