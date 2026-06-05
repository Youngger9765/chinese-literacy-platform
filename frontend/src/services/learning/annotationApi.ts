/**
 * annotationApi.ts — Reading annotation persistence (Issue #2070).
 *
 * Provides save/load helpers for the reading-annotation step.
 * The frontend always sends the full annotation list (full replace on PUT).
 * localStorage is kept as an offline / pre-session cache; DB is the SOT.
 */
import { get, put } from '../httpClient';

// ── Types (mirror backend Pydantic schemas) ──────────────────────────────────

/** One annotation mark as accepted by the backend. */
export interface AnnotationPayload {
  paragraph_index: number;
  char_start: number;
  char_end: number;
  annotation_type: 'unknown' | 'important';
  /** Client-generated id for dedup on reload. */
  client_id?: string;
}

/** One annotation mark as returned by the backend (with server id). */
export interface AnnotationRecord extends AnnotationPayload {
  id: number;
}

interface AnnotationLoadResponse {
  session_id: number;
  annotations: AnnotationRecord[];
}

// ── API calls ────────────────────────────────────────────────────────────────

/**
 * Replace all annotation marks for a session.
 * Sending an empty array clears all saved annotations.
 */
export async function saveAnnotations(
  sessionId: number,
  annotations: AnnotationPayload[]
): Promise<AnnotationRecord[]> {
  const res = await put<AnnotationLoadResponse>(
    `/api/learning/sessions/${sessionId}/annotations`,
    { annotations }
  );
  return res.annotations;
}

/**
 * Load all annotation marks for a session.
 * Returns [] when no annotations have been saved yet.
 */
export async function loadAnnotations(
  sessionId: number
): Promise<AnnotationRecord[]> {
  const res = await get<AnnotationLoadResponse>(
    `/api/learning/sessions/${sessionId}/annotations`
  );
  return res.annotations;
}
