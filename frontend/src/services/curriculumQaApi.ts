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
  lesson_uid?: string;
  title: string;
  story_id?: number | null;
  tier: string;
  known_data_gap?: boolean;
  /**
   * A human's verdict, and absent when nobody has recorded one — 34 lessons are new to
   * the second edition and carry no review. The builder will not invent a pass for them
   * (that would be deriving a QA verdict from the thing being QA'd), so this is
   * `boolean | undefined` and the UI has to show three states, not two.
   */
  overall_pass?: boolean;
  overall_status?: string;
  /**
   * Only the gates that were actually computed. L1's source (the first edition's DOCX
   * curation workspace) was deleted, and a per-lesson L2 would be true by construction —
   * so an entry carries L3 alone. Render what is here; do not name gates that are not.
   */
  gates?: Record<string, GateResult>;
  layout: {
    mode?: string;
    layout?: string;
    fill_blank_count?: number;
    checkbox_count?: number;
    row_count?: number;
  };
  artifacts?: {
    has_structure_snapshot?: boolean;
    has_keypoints_snapshot?: boolean;
    has_original_preview?: boolean;
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
    /** "not known to fail" — includes the unreviewed. Not the same as "reviewed and approved". */
    pass: number;
    fail: number;
    known_gap_count?: number;
    failure_count?: number;
    unreviewed?: number;
    display_only?: number;
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

export interface SpotlightLessonSummary {
  /** The lesson_uid (`L0042`) since #2747 — identity a renumber cannot move. */
  lesson_id: string;
  lesson_uid?: string;
  grade_code?: string;
  title?: string;
  strategy_type?: string;
  block_count?: number;
  overall_pass: boolean;
  eval?: {
    pass?: boolean;
    guide_retained?: boolean;
    answer_recall?: number;
    mcq_leakage?: number;
    struct_errors?: string[];
    semantic?: { semantic_pass?: boolean; semantic_errors?: string[] };
  };
  /** `match: null` = this lesson has no fingerprint baseline yet, which is not a failure. */
  gold?: { match?: boolean | null; diffs?: Record<string, unknown>; reason?: string };
  type_histogram?: Record<string, number>;
  fingerprint?: Record<string, unknown>;
  error?: string;
}

export interface SpotlightManifest {
  schema_version: number;
  summary: {
    /** Lessons that HAVE a spotlight — not the size of the corpus. */
    total: number;
    pass: number;
    fail: number;
    /** Served lessons with no 聚光燈 at all; excluded from `total` on purpose. */
    lessons_without_spotlight?: number;
    corpus_total?: number;
  };
  lessons_without_spotlight?: string[];
  lessons: SpotlightLessonSummary[];
}

export interface SpotlightLessonDetail extends SpotlightLessonSummary {
  spotlight?: Record<string, unknown>;
}

export async function fetchSpotlightManifest(token: string): Promise<SpotlightManifest> {
  const res = await authFetch('/api/curriculum-qa/spotlight', token);
  return res.json();
}

export async function fetchSpotlightLessonDetail(
  token: string,
  lessonId: string,
): Promise<SpotlightLessonDetail> {
  const res = await authFetch(`/api/curriculum-qa/spotlight/${encodeURIComponent(lessonId)}`, token);
  return res.json();
}
