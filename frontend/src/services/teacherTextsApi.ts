/**
 * Teacher Custom Text Library API — CRUD for teacher-created texts (我的課文).
 * Wraps /api/teacher/my-texts endpoints.
 */

import { onApiUnauthorized } from './sessionGuard';
import { API_BASE } from './apiConfig';

export class TeacherTextsApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'TeacherTextsApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    onApiUnauthorized(res);
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore
    }
    throw new TeacherTextsApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TeacherTextItem {
  id: number;
  title: string;
  grade: number;
  grade_code: string;
  genre: string;
  text_type: string;
  paragraph_count: number;
  char_count: number;
  reading_strategy: string | null;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface TeacherTextDetail extends TeacherTextItem {
  paragraphs: string[];
  vocabulary: VocabItem[] | null;
}

export interface VocabItem {
  word: string;
  definition: string;
  note?: string;
}

export interface TeacherTextListResponse {
  texts: TeacherTextItem[];
  total: number;
}

export interface TeacherTextCreateRequest {
  title: string;
  grade: number;
  genre: string;
  text_type?: string;
  reading_strategy?: string;
  paragraphs: string[];
  vocabulary?: VocabItem[];
}

export interface TeacherTextUpdateRequest {
  title?: string;
  grade?: number;
  genre?: string;
  text_type?: string;
  reading_strategy?: string;
  paragraphs?: string[];
  vocabulary?: VocabItem[];
}

// ── API Functions ────────────────────────────────────────────────────────────

export async function listMyTexts(
  token: string,
  params?: { search?: string; grade?: number; genre?: string },
): Promise<TeacherTextListResponse> {
  const url = new URL(`${API_BASE}/api/teacher/my-texts`);
  if (params?.search) url.searchParams.set('search', params.search);
  if (params?.grade !== undefined) url.searchParams.set('grade', String(params.grade));
  if (params?.genre) url.searchParams.set('genre', params.genre);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<TeacherTextListResponse>(res);
}

export async function getMyText(token: string, textId: number): Promise<TeacherTextDetail> {
  const res = await fetch(`${API_BASE}/api/teacher/my-texts/${textId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<TeacherTextDetail>(res);
}

export async function createMyText(
  token: string,
  body: TeacherTextCreateRequest,
): Promise<TeacherTextDetail> {
  const res = await fetch(`${API_BASE}/api/teacher/my-texts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<TeacherTextDetail>(res);
}

export async function updateMyText(
  token: string,
  textId: number,
  body: TeacherTextUpdateRequest,
): Promise<TeacherTextDetail> {
  const res = await fetch(`${API_BASE}/api/teacher/my-texts/${textId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<TeacherTextDetail>(res);
}

export async function deleteMyText(token: string, textId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/teacher/my-texts/${textId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<void>(res);
}
