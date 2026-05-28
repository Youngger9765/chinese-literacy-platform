import { API_BASE } from './apiConfig';
/**
 * omoApi.ts — OMO (Online-Merge-Offline) API client.
 *
 * Phase 1b: upload + dedup (from_cache/already_graded) + regrade.
 * Phase 2 stubs: full result page wiring.
 */


export class OmoApiError extends Error {
  status: number;
  responseText: string;

  constructor(message: string, status: number, responseText: string) {
    super(message);
    this.name = 'OmoApiError';
    this.status = status;
    this.responseText = responseText;
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface OmoCandidate {
  lesson_id: number;
  grade_code: string;
  title: string;
  confidence: number;
  reasoning: string;
}

/** Summary entry returned by GET /api/omo/lessons — for manual picker */
export interface OmoLessonSummary {
  lesson_id: number;
  grade_code: string;
  title: string;
}

export type OmoStatus =
  | 'pending'
  | 'identifying'
  | 'identified'
  | 'grading'
  | 'graded'
  | 'error'
  | 'failed'; // frontend-only timeout sentinel

export interface OmoAnswerItem {
  question_id: string;
  student_answer: string;
  correct_answer: string;
  score: number;
  ai_confidence: number;
  reasoning: string;
  /** Issue #2011 follow-up: prompt text from lesson YAML.
   *  Optional / nullable — uploads graded before this field was added will
   *  not have it; frontend falls back to「題目 {question_id}」 in that case. */
  context?: string | null;
  source_attempt_id?: number | null;
  position?: { x: number; y: number } | null;
  crop_image_url?: string | null;
  flag?: { flagged_by: number; reason: string; flagged_at: string } | null;
}

export interface OmoUploadResponse {
  upload_id: number;
  status: OmoStatus;
  candidates: OmoCandidate[];
  answers: OmoAnswerItem[];
  overall_score?: number | null;
  ai_overall_confidence?: number | null;
  progress?: Record<string, unknown> | null;
  error_message?: string | null;
  /** Phase 1b: true if this response is from a dedup cache hit (same image hash) */
  from_cache?: boolean;
  /** Phase 1b: true if the cached upload has already been graded */
  already_graded?: boolean;
}

export type OmoStatusResponse = OmoUploadResponse & {
  lesson_id?: number | null;
};

export interface OmoConfirmResponse {
  upload_id: number;
  lesson_id: number;
  status: string;
  message: string;
}

export interface OmoRegradeResponse {
  upload_id: number;
  status: string;
  message: string;
}

export interface OmoFlagResponse {
  upload_id: number;
  question_id: string;
  flagged: boolean;
}

export interface OmoSignedImageInfo {
  attempt_id: number;
  index: number;
  url?: string | null;
}

export interface OmoPriorUploadResponse {
  upload_id?: number | null;
  status?: OmoStatus | null;
  has_prior_upload: boolean;
  images: OmoSignedImageInfo[];
}

export interface OmoSignedUrlResponse {
  url?: string | null;
  expires_in_seconds: number;
}

/** Issue #1975 — compact item shown in the OMO history list page. */
export interface OmoHistoryItem {
  upload_id: number;
  lesson_id?: number | null;
  lesson_title?: string | null;
  grade_code?: string | null;
  status: OmoStatus;
  overall_score?: number | null;
  answers_count: number;
  created_at: string;          // ISO-8601
  thumbnail_url?: string | null;
}

export interface OmoHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  items: OmoHistoryItem[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Upload one or more worksheet images. Returns 201 with status=identifying.
 * Phase 1b: if same hash exists for this user, returns the existing record
 * with from_cache=true (and possibly already_graded=true if status=graded).
 *
 * Issue #1637: when `lessonCodeHint` is provided (student uploads from within
 * a lesson reading page), the backend skips Gemini fuzzy-match and resolves
 * the lesson directly — faster (~0 latency vs 6-24 s) and cheaper (~$0 vs
 * ~$0.0003 per call).
 */
export async function uploadOmoImages(
  files: File[],
  token: string,
  lessonCodeHint?: string,
): Promise<OmoUploadResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  if (lessonCodeHint) {
    form.append('lesson_code_hint', lessonCodeHint);
  }
  const res = await fetch(`${API_BASE}/api/omo/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoUploadResponse>;
}

/**
 * Poll identification + grading status.
 */
export async function getOmoStatus(
  uploadId: number,
  token: string,
): Promise<OmoStatusResponse> {
  const res = await fetch(`${API_BASE}/api/omo/${uploadId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new OmoApiError(`Status fetch failed (${res.status}): ${text}`, res.status, text);
  }
  return res.json() as Promise<OmoStatusResponse>;
}

/**
 * Confirm which lesson was identified. Kicks off grading job.
 * Phase 1b: returns 409 if status=grading or status=graded (use regradeOmo instead).
 */
export async function confirmOmoLesson(
  uploadId: number,
  lessonId: number,
  token: string,
): Promise<OmoConfirmResponse> {
  const res = await fetch(`${API_BASE}/api/omo/${uploadId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmed_lesson_id: lessonId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Confirm failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoConfirmResponse>;
}

/**
 * Re-trigger grading for an already-graded upload.
 * Phase 1b: student-initiated intentional re-grade.
 */
export async function regradeOmo(
  uploadId: number,
  token: string,
): Promise<OmoRegradeResponse> {
  const res = await fetch(`${API_BASE}/api/omo/${uploadId}/regrade`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Regrade failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoRegradeResponse>;
}

/**
 * Flag a question as incorrectly graded.
 */
export async function flagOmoAnswer(
  uploadId: number,
  questionId: string,
  reason: string,
  token: string,
): Promise<OmoFlagResponse> {
  const res = await fetch(
    `${API_BASE}/api/omo/${uploadId}/answers/${encodeURIComponent(questionId)}/flag`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flag failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoFlagResponse>;
}

/**
 * Get the list of OMO-eligible lessons for the manual picker.
 * Returns a simplified summary: lesson_id, grade_code, title.
 */
export async function getOmoLessons(token: string): Promise<OmoLessonSummary[]> {
  const res = await fetch(`${API_BASE}/api/omo/lessons`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lessons fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoLessonSummary[]>;
}

/**
 * Issue #1975 — paginated list of the current user's OMO uploads, newest first.
 * Excludes superseded uploads and in-flight statuses (pending/identifying/error).
 */
export async function getOmoHistory(
  token: string,
  limit = 20,
  offset = 0,
): Promise<OmoHistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(`${API_BASE}/api/omo/history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`History fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoHistoryResponse>;
}

export async function getPriorOmoUploadByLesson(
  lessonId: number,
  token: string,
): Promise<OmoPriorUploadResponse> {
  const res = await fetch(`${API_BASE}/api/omo/by-lesson/${lessonId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prior upload fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoPriorUploadResponse>;
}

export async function getOmoImageSignedUrl(
  uploadId: number,
  attemptId: number,
  index: number,
  token: string,
): Promise<OmoSignedUrlResponse> {
  const res = await fetch(`${API_BASE}/api/omo/${uploadId}/images/${attemptId}/${index}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Image fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoSignedUrlResponse>;
}

export async function getOmoCropSignedUrl(
  uploadId: number,
  questionId: string,
  token: string,
): Promise<OmoSignedUrlResponse> {
  const res = await fetch(
    `${API_BASE}/api/omo/${uploadId}/crops/${encodeURIComponent(questionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Crop fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoSignedUrlResponse>;
}
