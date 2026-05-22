import { SessionExpiredError } from '../api';
import { API_BASE } from '../apiConfig';

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
 * Fetch AI reading analysis using the session-scoped cached endpoint.
 *
 * Issue #415: accepts optional comprehension/vocab data for richer analysis.
 * Issue #1648: sessionId is now required — always uses the session-scoped
 * endpoint with server-side caching. The no-cache standalone endpoint
 * /api/learning/ai-analysis is deprecated and must not be called from here.
 * Callers (AIAnalysisSection) must guard against null dbSessionId before
 * calling this function.
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
  sessionId: number,
): Promise<AIAnalysisResponse> {
  const url = `${API_BASE}/api/learning/sessions/${sessionId}/ai-analysis`;
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
