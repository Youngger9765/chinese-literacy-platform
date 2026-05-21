import { API_BASE } from './apiConfig';
/**
 * readingHistoryApi.ts — Reading history and progress tracking APIs.
 *
 * Issue #909: 重複朗讀 + 進步曲線
 */


// ── Types ────────────────────────────────────────────────────────────────────

export interface ReadingHistoryItem {
  id: number;
  student_id: number;
  lesson_id: string;
  paragraph_index: number | null;
  reading_type: string;
  cpm: number;
  accuracy: number;
  duration_seconds: number;
  created_at: string;
}

export interface ReadingHistoryResponse {
  history: ReadingHistoryItem[];
  target_cpm: number;
  target_source: string;
}

export interface ReadingProgressSummary {
  total_attempts: number;
  best_cpm: number;
  latest_cpm: number;
  best_accuracy: number;
  latest_accuracy: number;
  cpm_improvement_pct: number;
  target_cpm: number;
  target_reached: boolean;
  encouragement: string;
}

// ── Save a reading attempt ───────────────────────────────────────────────────

export async function saveReadingHistory(
  payload: {
    lesson_id: string;
    paragraph_index?: number | null;
    reading_type: 'paragraph' | 'full';
    cpm: number;
    accuracy: number;
    duration_seconds: number;
  },
  token: string,
): Promise<ReadingHistoryItem> {
  const res = await fetch(`${API_BASE}/api/reading-history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`saveReadingHistory failed: ${res.status}`);
  return res.json();
}

// ── Get reading history ──────────────────────────────────────────────────────

export async function getReadingHistory(
  studentId: number,
  lessonId: string,
  token: string,
  readingType?: string,
  paragraphIndex?: number,
): Promise<ReadingHistoryResponse> {
  const params = new URLSearchParams();
  if (readingType) params.set('reading_type', readingType);
  if (paragraphIndex !== undefined) params.set('paragraph_index', String(paragraphIndex));
  const qs = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(
    `${API_BASE}/api/reading-history/${studentId}/${lessonId}${qs}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`getReadingHistory failed: ${res.status}`);
  return res.json();
}

// ── Get reading summary ──────────────────────────────────────────────────────

export async function getReadingSummary(
  studentId: number,
  lessonId: string,
  token: string,
  readingType: string = 'full',
): Promise<ReadingProgressSummary> {
  const res = await fetch(
    `${API_BASE}/api/reading-history/${studentId}/${lessonId}/summary?reading_type=${readingType}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`getReadingSummary failed: ${res.status}`);
  return res.json();
}
