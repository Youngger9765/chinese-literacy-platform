/**
 * teacherReadingBabyApi.ts — 閱讀寶貝老師端（#3780 第三階段）。
 *
 *   GET /api/teacher/classrooms/{id}/reading-baby-indicators
 *   GET /api/teacher/classrooms/{id}/reading-baby-indicators/{student_id}/{indicator_code}
 *
 * 型別逐欄對應 backend/app/schemas/reading_baby.py 的老師端 response model。
 */
import { API_BASE, ApiError } from './apiConfig';

export type IndicatorStatus =
  | 'not_assigned'
  | 'insufficient_data'
  | 'only_participated'
  | 'not_achieved'
  | 'achieved'
  | 'transferable';

export interface IndicatorCell {
  student_id: number;
  indicator_code: string;
  status: IndicatorStatus;
  passed_lesson_count: number;
  total_items: number;
}

export interface ClassroomIndicatorHeatmap {
  classroom_id: number;
  indicator_codes: string[];
  student_ids: number[];
  students: { student_id: number; name: string }[];
  indicators: { code: string; text: string | null }[];
  cells: IndicatorCell[];
  note: string;
}

export interface IndicatorEvidenceItem {
  lesson_uid: string;
  lesson_title: string | null;
  station: string;
  station_label: string | null;
  /** completion＝沒有對錯，只記參與（老師端不可顯示成「沒做到」）。 */
  signal_type: 'first_try_accuracy' | 'reading_fluency' | 'completion' | string | null;
  quality_passed: boolean;
  quality_score: number | null;
  items_total: number | null;
  items_first_try_correct: number | null;
  cpm: number | null;
  accuracy: number | null;
  source_ref: Record<string, unknown> | null;
  created_at: string;
}

export interface IndicatorEvidenceDetail {
  student_id: number;
  student_name: string | null;
  indicator_code: string;
  indicator_text: string | null;
  note: string;
  evidence: IndicatorEvidenceItem[];
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function fetchClassroomIndicatorHeatmap(
  token: string,
  classroomId: number,
): Promise<ClassroomIndicatorHeatmap> {
  const res = await fetch(`${API_BASE}/api/teacher/classrooms/${classroomId}/reading-baby-indicators`, {
    headers: headers(token),
  });
  if (!res.ok) throw new ApiError(`fetchClassroomIndicatorHeatmap failed: ${res.status}`, res.status);
  return res.json();
}

export async function fetchIndicatorEvidenceDetail(
  token: string,
  classroomId: number,
  studentId: number,
  indicatorCode: string,
): Promise<IndicatorEvidenceDetail> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/reading-baby-indicators/${studentId}/${encodeURIComponent(indicatorCode)}`,
    { headers: headers(token) },
  );
  if (!res.ok) throw new ApiError(`fetchIndicatorEvidenceDetail failed: ${res.status}`, res.status);
  return res.json();
}
