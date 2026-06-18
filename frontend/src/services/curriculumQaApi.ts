/**
 * curriculumQaApi — admin curriculum QA dashboard API
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface GateResult {
  gate: string;
  pass: boolean;
  issues: string[];
}

export interface KeypointsLessonSummary {
  lesson_id: string;
  title: string;
  story_id: number | null;
  tier: string;
  overall_pass: boolean;
  overall_status: string;
  gates: Record<string, GateResult>;
  layout: {
    mode?: string;
    layout?: string;
    fill_blank_count?: number;
    checkbox_count?: number;
    row_count?: number;
  };
  artifacts: {
    has_keypoints_yml: boolean;
    has_original_preview: boolean;
    has_structure_snapshot: boolean;
  };
  yaml_path?: string;
}

export interface KeypointsManifest {
  schema_version: number;
  generated_at?: string;
  smoke_only?: boolean;
  gates_included?: string[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    failure_count?: number;
  };
  lessons: KeypointsLessonSummary[];
  error?: string;
}

export interface KeypointsLessonDetail extends KeypointsLessonSummary {
  keypoints?: Record<string, unknown>;
  structure?: Record<string, unknown>;
}

async function authFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}

export async function fetchKeypointsManifest(token: string): Promise<KeypointsManifest> {
  const res = await authFetch('/api/curriculum-qa/keypoints', token);
  return res.json();
}

export async function fetchKeypointsLessonDetail(
  token: string,
  lessonId: string,
): Promise<KeypointsLessonDetail> {
  const res = await authFetch(`/api/curriculum-qa/keypoints/${encodeURIComponent(lessonId)}`, token);
  return res.json();
}

export function originalPreviewUrl(lessonId: string): string {
  return `${API_BASE}/api/curriculum-qa/keypoints/${encodeURIComponent(lessonId)}/preview/original`;
}
