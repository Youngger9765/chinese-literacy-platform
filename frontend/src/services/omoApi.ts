/**
 * omoApi.ts — OMO (Online-Merge-Offline) API client.
 *
 * Wraps POST /api/omo/upload, GET /api/omo/:id, POST /api/omo/:id/confirm.
 * Phase 1: upload + AI lesson identification only.
 * Phase 2 stubs: confirm/grade are no-ops until backend implements them.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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

export type OmoStatus = 'pending' | 'identifying' | 'identified' | 'failed';

export interface OmoUploadResponse {
  upload_id: number;
  status: OmoStatus;
  candidates: OmoCandidate[];
}

export interface OmoStatusResponse {
  upload_id: number;
  status: OmoStatus;
  lesson_id: number | null;
  candidates: OmoCandidate[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OmoConfirmResponse {
  upload_id: number;
  lesson_id: number;
  status: OmoStatus;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Upload one or more worksheet images. Returns 201 with status=identifying.
 * The backend fires AI identification asynchronously.
 */
export async function uploadOmoImages(
  files: File[],
  token: string,
): Promise<OmoUploadResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
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
 * Poll identification status. Returns current status + candidates once identified.
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
    throw new Error(`Status fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<OmoStatusResponse>;
}

/**
 * Confirm which lesson was identified. Phase 1 stub — Phase 2 will wire this
 * to grade submission.
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
