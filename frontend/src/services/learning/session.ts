import type { ReadingEvaluateResponse } from '../../types';
import { SessionExpiredError } from '../api';
import { API_BASE } from '../apiConfig';

// ---------------------------------------------------------------------------
// Gemini audio transcription (Issue #2131 — Block 3)
// ---------------------------------------------------------------------------

export interface TranscribeReadingResult {
  /** Transcribed text, or null if Gemini failed (use Web Speech fallback). */
  transcript: string | null;
  /** "gemini" on success, "fallback" when Gemini errored. */
  method: 'gemini' | 'fallback';
  /** Gemini's internal audit notes (empty string when method=fallback). */
  reasoning?: string;
  /**
   * Fallback reason (Issue #2156 — I4 fallback alert).
   *
   * Backend reasons (method='fallback'):
   *   'timeout' | 'safety' | 'decode' | 'empty' | 'error'
   *
   * Frontend reasons (set by caller before network call):
   *   'no_audio'  — no recorded blob was available
   *   'no_token'  — auth token missing; request not attempted
   *
   * Present only when method='fallback'. Used by both KeyPassageReading and ParagraphReading
   * to display the I4-compliant amber fallback alert banner.
   */
  reason?: 'timeout' | 'safety' | 'decode' | 'empty' | 'error' | 'no_audio' | 'no_token' | string;
}

/**
 * Send a recorded audio blob to the backend Gemini transcription endpoint.
 *
 * Returns a fail-closed result: on any network/auth/server error, `method`
 * will be "fallback" and `transcript` will be null — caller must use the
 * Web Speech transcript as fallback.  Never throws.
 *
 * NOTE: Requires real microphone audio to test end-to-end.
 * Unit-tested via mocks (vitest).  E2E requires manual mic verification.
 */
export async function transcribeReading(
  audioBlob: Blob,
  targetText: string,
  durationMs: number,
  token: string,
  /** @deprecated Issue #2297: GCS upload is deferred to saveReadingAudio().
   *  Kept for API compat; backend ignores this parameter. */
  dbSessionId?: number,
): Promise<TranscribeReadingResult> {
  const FALLBACK: TranscribeReadingResult = { transcript: null, method: 'fallback', reasoning: '', reason: 'error' };

  try {
    const form = new FormData();
    form.append('audio', audioBlob, 'recording.webm');
    form.append('target_text', targetText);
    form.append('duration_ms', String(durationMs));
    // Issue #2297: session_id is kept for API compat but no longer triggers upload.
    if (dbSessionId != null) {
      form.append('session_id', String(dbSessionId));
    }

    const res = await fetch(`${API_BASE}/api/reading/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      // Non-2xx (rate limit, auth, size cap, etc.) → fallback, no throw
      console.warn('[transcribeReading] non-OK response:', res.status);
      return FALLBACK;
    }

    const data = await res.json();
    // Validate: backend always returns {transcript, method} even on Gemini error
    if (data && typeof data.method === 'string') {
      return {
        transcript: data.transcript ?? null,
        method: data.method === 'gemini' ? 'gemini' : 'fallback',
        reasoning: data.reasoning ?? '',
        reason: data.reason ?? undefined,
      };
    }
    return FALLBACK;
  } catch (err) {
    // Network error or JSON parse failure → fallback
    console.warn('[transcribeReading] error:', err);
    return FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Reading audio replay (Issue #2266)
// ---------------------------------------------------------------------------

/**
 * Fetch a 10-minute signed URL so the student can replay their reading recording.
 *
 * Returns the signed URL string on success, or null if no audio was recorded
 * for this attempt or if GCS signed URL generation fails.
 *
 * @param sessionId  DB LearningSession id
 * @param attemptId  DB ReadingAttemptHistory id
 * @param token      JWT bearer token
 */
export async function getReadingAudioSignedUrl(
  sessionId: number,
  attemptId: number,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/learning/sessions/${sessionId}/reading-audio/${attemptId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.signed_url === 'string' ? data.signed_url : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deferred GCS audio upload (Issue #2297)
// ---------------------------------------------------------------------------

/**
 * Upload the accepted reading take audio to GCS via the backend.
 *
 * Called AFTER the student accepts the score (not at transcription time) so
 * only accepted takes are persisted.  Discarded / re-recorded takes are never
 * uploaded.
 *
 * Fail-safe: any network or server error is caught and returns {ok: false}.
 * This must NEVER throw or block the score display in the UI.
 *
 * @param audioBlob  The audio blob captured by the MediaRecorder.
 * @param sessionId  DB LearningSession id.
 * @param attemptId  Optional DB ReadingAttemptHistory id.  When omitted the
 *                   backend uses the latest attempt row for this session.
 * @param token      JWT bearer token.
 */
export async function saveReadingAudio(
  audioBlob: Blob,
  sessionId: number,
  attemptId?: number,
  token?: string,
): Promise<{ ok: boolean; audio_gcs_path?: string; attempt_id?: number }> {
  if (!token) {
    console.warn('[saveReadingAudio] no token — skipping upload');
    return { ok: false };
  }
  try {
    const form = new FormData();
    form.append('audio', audioBlob, 'recording.webm');
    form.append('session_id', String(sessionId));
    if (attemptId != null) {
      form.append('attempt_id', String(attemptId));
    }
    const res = await fetch(`${API_BASE}/api/reading/save-audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      console.warn('[saveReadingAudio] non-OK response:', res.status);
      return { ok: false };
    }
    const data = await res.json();
    return {
      ok: data?.ok === true,
      audio_gcs_path: typeof data?.audio_gcs_path === 'string' ? data.audio_gcs_path : undefined,
      attempt_id: typeof data?.attempt_id === 'number' ? data.attempt_id : undefined,
    };
  } catch (err) {
    console.warn('[saveReadingAudio] error:', err);
    return { ok: false };
  }
}

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

/**
 * Check whether the current user has any completed self-practice session for a
 * given story by querying the DB via GET /api/learning/sessions.
 *
 * Returns `true` when at least one completed self-practice session exists,
 * `false` otherwise (including on network/auth errors — the caller falls back
 * to localStorage in that case).
 */
export async function checkSelfPracticeCompleted(
  storySlug: string,
  token: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      story_slug: storySlug,
      status: 'completed',
      learning_source: 'self',
      // Note: limit only caps the returned `items` array; `total` still reflects
      // the full count because learning_source filtering happens in Python after
      // the SQL query.  We keep limit=1 to minimise payload size.
      limit: '1',
    });
    const res = await fetch(`${API_BASE}/api/learning/sessions?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      throw new SessionExpiredError('checkSelfPracticeCompleted: token expired');
    }
    if (!res.ok) return false;
    const data = (await res.json()) as { total: number };
    return data.total > 0;
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    console.error('[checkSelfPracticeCompleted] failed, falling back to localStorage:', err);
    return false;
  }
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
// Step Progress persistence (Issue #660)
// ---------------------------------------------------------------------------

export interface StepProgressData {
  current_step: string | null;
  steps_completed: string[];
  step_data: Record<string, unknown>;
  /** Optimistic concurrency version (#1187). Increments with each successful save. */
  version?: number;
}

export interface StepProgressResponse {
  session_id: number;
  step_progress: StepProgressData | null;
  /** XP newly awarded by THIS save (Issue #3024). Absent/0 = nothing new. */
  xp_awarded?: number;
  /** Badge keys newly unlocked by THIS save (Issue #3024). Absent/[] = none. */
  badges_unlocked?: string[];
}

/**
 * Raised when DB rejects a save because the incoming version is older than stored.
 * Caller should refresh state from the server and discard the stale client snapshot.
 */
export class StaleVersionError extends Error {
  storedVersion: number;
  incomingVersion: number;
  constructor(storedVersion: number, incomingVersion: number) {
    super(`Stale step_progress version: stored=${storedVersion} incoming=${incomingVersion}`);
    this.name = 'StaleVersionError';
    this.storedVersion = storedVersion;
    this.incomingVersion = incomingVersion;
  }
}

/**
 * Persist step progress to DB for a given learning session.
 * Non-blocking — caller should catch errors and not surface them to the user.
 * Throws StaleVersionError (409) when the incoming version is older than stored.
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
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail ?? {};
    if (d?.error === 'stale_version') {
      throw new StaleVersionError(d.stored_version ?? 0, d.incoming_version ?? 0);
    }
  }
  if (!res.ok) throw new Error(`saveStepProgress failed: ${res.status}`);
  return res.json();
}

/**
 * Fire-and-forget step progress save using fetch + keepalive.
 * Designed for beforeunload / page teardown where normal fetch may be cancelled.
 */
export function saveStepProgressBeacon(
  token: string,
  sessionId: number,
  progress: StepProgressData,
): void {
  const url = `${API_BASE}/api/learning/sessions/${sessionId}/progress`;
  fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(progress),
    keepalive: true,
  }).catch(() => { /* non-fatal */ });
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
