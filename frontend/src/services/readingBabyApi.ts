/**
 * readingBabyApi.ts — API client for 閱讀寶貝 phase 2 (#3780).
 *
 *   GET /api/learning/students/{student_id}/reading-babies              — 179 課圖鑑
 *   GET /api/learning/students/{student_id}/reading-babies/{lesson_uid} — 單課寶貝卡
 *
 * Types below are copied field-for-field from the real backend Pydantic
 * response models (backend/app/schemas/reading_baby.py) — not guessed from
 * reading the route source. This replaces the deleted v1 `wordBabyApi.ts`
 * (`fetchMyWordBabies`/`feedWordBaby`) — 閱讀寶貝 has no "feed" action, so
 * there is no POST endpoint here at all (game-design.md §2: 零點擊成長).
 */
import { API_BASE, ApiError } from './apiConfig';

export type ReadingBabyStage = 'not_encountered' | 'basic' | 'intermediate' | 'advanced';

export interface ReadingBabyNextStep {
  station: string;
  station_label: string | null;
  building: string | null;
  indicator_code: string;
}

export interface ReadingBabyLessonGrowth {
  lesson_uid: string;
  title: string | null;
  ability_family: string | null;
  ability_family_name: string | null;
  stage: ReadingBabyStage;
  assessable_total: number;
  assessable_passed: number;
  progress_ratio: number;
  fragments_count: number;
  next_step: ReadingBabyNextStep | null;
  all_cleared: boolean;
}

export interface ReadingBabyAtlasResponse {
  student_id: number;
  total_lessons: number;
  total_fragments: number;
  babies: ReadingBabyLessonGrowth[];
}

/** 單課寶貝卡——跟圖鑑裡的一格同一個 schema（schemas/reading_baby.py
 *  ReadingBabyCardResponse 繼承 LessonGrowthResponse，欄位完全一樣）。 */
export type ReadingBabyCardResponse = ReadingBabyLessonGrowth;

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** 179 課閱讀寶貝圖鑑。 */
export async function fetchReadingBabyAtlas(
  studentId: number,
  token: string,
): Promise<ReadingBabyAtlasResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/reading-babies`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new ApiError(`fetchReadingBabyAtlas failed: ${res.status}`, res.status);
  }
  return res.json();
}

/** 單課寶貝卡——`lessonUid` 查不到（不在 179 課對照裡）時後端回 404。 */
export async function fetchReadingBabyCard(
  studentId: number,
  lessonUid: string,
  token: string,
): Promise<ReadingBabyCardResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/students/${studentId}/reading-babies/${lessonUid}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new ApiError(`fetchReadingBabyCard failed: ${res.status}`, res.status);
  }
  return res.json();
}
