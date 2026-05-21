/**
 * Admin demo-seed API (Issue #989 minimal version).
 * POST /api/admin/seed/demo-students
 * Requires system_admin role. Only available when ENABLE_TEST_SEED=true on backend.
 */

import { onApiUnauthorized } from './sessionGuard';
import { API_BASE } from './apiConfig';


export interface SeededStudentInfo {
  user_id: number;
  email: string;
  name: string;
  session_id: number;
}

export interface DemoStudentSeedRequest {
  classroom_id: number;
  count?: number;
  prefix?: string;
}

export interface DemoStudentSeedResponse {
  classroom_id: number;
  students_created: number;
  sessions_created: number;
  students: SeededStudentInfo[];
  story_slug: string | null;
  note: string;
}

export class AdminSeedApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminSeedApiError';
    this.status = status;
  }
}

export async function seedDemoStudents(
  token: string,
  req: DemoStudentSeedRequest,
): Promise<DemoStudentSeedResponse> {
  const res = await fetch(`${API_BASE}/api/admin/seed/demo-students`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });

  if (res.status === 401) {
    onApiUnauthorized(res);
    throw new AdminSeedApiError('未授權', 401);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore parse error
    }
    throw new AdminSeedApiError(detail, res.status);
  }
  return res.json();
}
