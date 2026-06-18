/**
 * Story Structure Lab API — admin dashboard for YAML / keypoints / QA gates
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface QaGateResult {
  gate: string;
  pass: boolean;
  issues: string[];
}

export interface InteractionProfileSummary {
  mode?: string;
  layout?: string;
  fill_blank_count?: number;
  checkbox_count?: number;
  template_kind?: string;
}

export interface LabLessonSummary {
  story_id: number;
  title: string;
  grade?: number;
  catalog_code?: string;
  parsed_code?: string;
  tier: string;
  has_structure_table: boolean;
  has_story_structure_rows: boolean;
  has_keypoints_yml: boolean;
  interaction_profile: InteractionProfileSummary;
  qa_gates: Record<string, QaGateResult>;
  overall_pass: boolean;
  known_data_gap?: boolean;
  pinned: boolean;
}

export interface LabIndex {
  total: number;
  tier_counts: Record<string, number>;
  representative_lessons: Array<{
    parsed_code: string;
    catalog_code: string;
    story_id: number;
    note: string;
  }>;
  qa_report_available: boolean;
  lessons: LabLessonSummary[];
}

export interface LabDetail {
  story_id: number;
  title: string;
  grade?: number;
  catalog_code?: string;
  parsed_code?: string;
  tier: string;
  pinned: boolean;
  known_data_gap?: boolean;
  yaml_table?: unknown;
  yaml_rows?: unknown;
  keypoints?: Record<string, unknown>;
  docx_snapshot?: Record<string, unknown>;
  dual_source_eval?: {
    available: boolean;
    yaml_match?: boolean;
    has_docx_snapshot?: boolean;
    expected_rows?: number;
    on_disk_rows?: number;
  };
  structure_grading?: Record<string, unknown>;
  structure?: Record<string, unknown>;
  interaction_profile?: InteractionProfileSummary;
  qa_gates: Record<string, QaGateResult>;
  artifacts: {
    has_keypoints_yml: boolean;
    keypoints_path?: string | null;
    qa_report_available: boolean;
  };
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

export async function fetchStoryStructureLabIndex(token: string): Promise<LabIndex> {
  const res = await authFetch('/api/admin/story-structure-lab', token);
  return res.json();
}

export async function fetchStoryStructureLabDetail(
  token: string,
  storyId: number,
): Promise<LabDetail> {
  const res = await authFetch(`/api/admin/story-structure-lab/${storyId}`, token);
  return res.json();
}
