/**
 * Admin Story API service -- CRUD operations for platform story management.
 * Endpoints require system_admin JWT token.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// --- Types ---

export interface VocabItem {
  word: string;
  definition: string;
  note?: string;
}

export interface ReadingBenchmarkLevel {
  threshold: string;
  feedback: string;
}

export interface ReadingBenchmark {
  levels: ReadingBenchmarkLevel[];
}

/** Admin list view -- lightweight, no full content */
export interface StoryAdminListItem {
  lesson_number: number;
  title: string;
  grade: number;
  grade_code: string;
  genre: string;
  text_type: string;
  paragraph_count: number;
  char_count: number;
  reading_strategy: string | null;
  source_file: string | null;
}

export interface StoryAdminListResponse {
  stories: StoryAdminListItem[];
  total: number;
}

/** Full story detail returned by GET /api/admin/stories/{lesson_number} */
export interface StoryAdminDetail extends StoryAdminListItem {
  id: number;
  grade_code: string;
  category: string;
  thumbnail_url: string | null;
  intro: { author: string; background: string } | null;
  paragraphs: string[];
  vocabulary: VocabItem[] | null;
  fill_in_blank: Record<string, unknown>[] | null;
  multiple_choice: Record<string, unknown>[] | null;
  reading_benchmark: ReadingBenchmark | null;
  source_file: string | null;
}

/** Request body for creating a story */
export interface StoryCreateRequest {
  lesson_number: number;
  title: string;
  grade: number;
  grade_code: string;
  genre: string;
  text_type?: string;
  reading_strategy?: string;
  paragraphs: string[];
  vocabulary?: VocabItem[];
  fill_in_blank?: Record<string, unknown>[];
  multiple_choice?: Record<string, unknown>[];
  reading_benchmark?: ReadingBenchmark;
  source_file?: string;
}

/** Request body for updating a story (all fields optional) */
export type StoryUpdateRequest = Partial<Omit<StoryCreateRequest, 'lesson_number'>>;

// --- Error class ---

export class AdminStoryApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminStoryApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AdminStoryApiError(res.status, body.detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// --- API functions ---

export async function listAdminStories(
  token: string,
  opts?: { search?: string; grade?: number },
): Promise<StoryAdminListResponse> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.grade != null) params.set('grade', String(opts.grade));
  const qs = params.toString() ? `?${params}` : '';
  const res = await fetch(`${API_BASE}/api/admin/stories${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<StoryAdminListResponse>(res);
}

export async function getAdminStory(
  token: string,
  lessonNumber: number,
): Promise<StoryAdminDetail> {
  const res = await fetch(`${API_BASE}/api/admin/stories/${lessonNumber}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<StoryAdminDetail>(res);
}

export async function createStory(
  token: string,
  body: StoryCreateRequest,
): Promise<StoryAdminListItem> {
  const res = await fetch(`${API_BASE}/api/admin/stories`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<StoryAdminListItem>(res);
}

export async function updateStory(
  token: string,
  lessonNumber: number,
  body: StoryUpdateRequest,
): Promise<StoryAdminListItem> {
  const res = await fetch(`${API_BASE}/api/admin/stories/${lessonNumber}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<StoryAdminListItem>(res);
}

export async function deleteStory(
  token: string,
  lessonNumber: number,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/stories/${lessonNumber}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<void>(res);
}
