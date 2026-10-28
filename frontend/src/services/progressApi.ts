import { API_BASE } from './apiConfig';
/**
 * progressApi.ts — Student progress, error patterns, vocab recommendations, story slugs.
 *
 * Split from api.ts (#646). Covers all endpoints under /api/learning/students/{id}/
 * related to tracking what a student has done and what they need to practice.
 */


// ---------------------------------------------------------------------------
// Error patterns + vocab recommendations (Issue #248)
// ---------------------------------------------------------------------------

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

export interface StorySlugItem {
  slug: string;
  title: string;
}

export interface StudentStorySlugsResponse {
  slugs: string[];
  stories: StorySlugItem[];
  total: number;
}

export async function getStudentStorySlugs(token: string, studentId: number): Promise<StudentStorySlugsResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/story-slugs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getStudentStorySlugs failed: ${res.status}`);
  return res.json();
}

export async function getErrorPatterns(
  token: string,
  studentId: number,
  storySlug?: string,
): Promise<ErrorPatternsResponse> {
  // #3719: `new URL(path)` with no base throws on a relative string
  // (IAP-prep's same-origin API_BASE="" for staging/preview, already true
  // of prod's Firebase build). Build the query string by hand instead of
  // going through URL, so the request stays byte-identical to before in
  // both the relative and absolute cases — no extra absolutization.
  const qs = storySlug ? `?${new URLSearchParams({ story_slug: storySlug })}` : '';
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/error-patterns${qs}`, {
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

// ---------------------------------------------------------------------------
// Repeated error alerts (Issue #248)
// ---------------------------------------------------------------------------

export interface RepeatedErrorAlertItem {
  character: string;
  error_count: number;
}

export interface RepeatedErrorAlertResponse {
  alerts: RepeatedErrorAlertItem[];
  total: number;
}

/**
 * Fetch characters that have hit the ≥3 repeated-error threshold.
 * Used to show a post-session modal directing the student to vocab practice.
 */
export async function getRepeatedErrorsAlert(
  token: string,
  studentId: number,
): Promise<RepeatedErrorAlertResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/students/${studentId}/repeated-errors-alert`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getRepeatedErrorsAlert failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// AI learning path recommendations (Issue #252)
// ---------------------------------------------------------------------------

export interface StoryRecommendationItem {
  story_slug: string;
  title: string;
  grade: number;
  genre: string;
  difficulty_match_score: number;
  reason: string;
}

export interface StoryRecommendationsResponse {
  recommendations: StoryRecommendationItem[];
  total: number;
}

export async function getStoryRecommendations(
  token: string,
  studentId: number,
  limit = 5,
): Promise<StoryRecommendationsResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/recommendations/${studentId}?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getStoryRecommendations failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Student progress (Issue #257)
// ---------------------------------------------------------------------------

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
  story_title: string | null;
  latest_session_id: number;
  status: string;
  steps: StepStatusItem[];
  completion_pct: number;
  overall_score: number | null;
  accuracy: number | null;
  started_at: string;
  completed_at: string | null;
  next_step: NextStepRec;
  // #3780 D2（PRD §5.6）— 給喝采島範本模式用，不經過上面舊 6 步模型。
  steps_completed: string[];
  has_session: boolean;
  // #3780 D（PRD §5.6）— 伺服器算好的「這堂課在喝采島上佔領了沒」，不是
  // 前端自己猜（前端沒有 step_sequence，猜不出一堂課總共幾站）。
  is_occupied: boolean;
  stations_done: number;
  stations_total: number;
}

export interface StudentProgressResponse {
  student_id: number;
  texts_attempted: number;
  texts_completed: number;
  average_score: number | null;
  texts: TextProgressItem[];
}

const inFlightStudentProgress = new Map<string, Promise<StudentProgressResponse>>();

export async function getStudentProgress(
  token: string,
  studentId: number,
): Promise<StudentProgressResponse> {
  const key = `${studentId}:${token}`;
  const existing = inFlightStudentProgress.get(key);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/progress`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`getStudentProgress failed: ${res.status}`);
    return res.json() as Promise<StudentProgressResponse>;
  })();

  inFlightStudentProgress.set(key, request);
  try {
    return await request;
  } finally {
    inFlightStudentProgress.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Library status (Issue #1249)
// ---------------------------------------------------------------------------

export type LibraryStoryStatus = 'assigned' | 'in_progress' | 'completed';

/** Map of story_slug → status.  Absent key = not started. */
export async function getLibraryStatus(token: string): Promise<Record<string, LibraryStoryStatus>> {
  const res = await fetch(`${API_BASE}/api/library/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getLibraryStatus failed: ${res.status}`);
  return res.json() as Promise<Record<string, LibraryStoryStatus>>;
}
