/**
 * Teacher Dashboard API service -- student progress & text management.
 * Follows the same pattern as classroomApi.ts.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// --- Response types ---

export interface StudentTag {
  id: number;
  student_id: number;
  teacher_id: number;
  tag_name: string;
  color: string;
  created_at: string;
}

export interface StudentProgress {
  student_id: number;
  student_name: string;
  last_session_date: string | null;
  last_text_title: string | null;
  total_sessions: number;
  tags: StudentTag[];
}

export interface ClassroomTextItem {
  id: number;
  text_id: string;
  title: string;
  assigned_at: string;
}

// --- Error class ---

export class TeacherApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeacherApiError';
    this.status = status;
  }
}

// --- Helpers ---

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new TeacherApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export interface ClassroomStats {
  total_students: number;
  total_sessions: number;
  active_students: number;
  inactive_students: number;
  avg_accuracy: number | null;
  completion_rate: number;
  avg_session_duration_minutes: number | null;
}

export interface ErrorVocabItem {
  character: string;
  error_type: string;
  count: number;
  student_count: number;
}

export interface TimeStats {
  total_hours: number;
  avg_minutes_per_session: number | null;
  study_days: number;
  sessions_this_week: number;
  sessions_last_week: number;
}

// --- API functions ---

/** Get student progress for a classroom. */
export async function getClassroomProgress(
  token: string,
  classroomId: number,
): Promise<StudentProgress[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/progress`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentProgress[]>(res);
}

/** Get assigned texts for a classroom. */
export async function getClassroomTexts(
  token: string,
  classroomId: number,
): Promise<ClassroomTextItem[]> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/texts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ClassroomTextItem[]>(res);
}

/** Assign a text (story) to a classroom. */
export async function assignText(
  token: string,
  classroomId: number,
  textId: string,
): Promise<ClassroomTextItem> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/texts`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text_id: textId }),
    },
  );
  return handleResponse<ClassroomTextItem>(res);
}

export interface StudentSession {
  id: number;
  story_title: string | null;
  started_at: string;
  completed_at: string | null;
  overall_score: number | null;
  status: string;
}

/** Get learning session history for a specific student. */
export async function getStudentSessions(
  token: string,
  studentId: number,
): Promise<StudentSession[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/sessions`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentSession[]>(res);
}

/** Unassign a text from a classroom. */
export async function unassignText(
  token: string,
  classroomId: number,
  textId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/texts/${textId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore
    }
    throw new TeacherApiError(message, res.status);
  }
}

/** Export classroom report as a CSV Blob. */
export async function exportClassroomReport(token: string, classroomId: number): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/teacher/classrooms/${classroomId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new TeacherApiError('Export failed', res.status);
  return res.blob();
}

/** Get classroom aggregate statistics. */
export async function getClassroomStats(
  token: string,
  classroomId: number,
): Promise<ClassroomStats> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/stats`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ClassroomStats>(res);
}

/** Get top error vocabulary for a classroom. */
export async function getErrorVocab(
  token: string,
  classroomId: number,
): Promise<ErrorVocabItem[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/error-vocab`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ErrorVocabItem[]>(res);
}

/** Get learning time statistics for a classroom. */
export async function getTimeStats(
  token: string,
  classroomId: number,
): Promise<TimeStats> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/time-stats`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<TimeStats>(res);
}

// --- Student Tag API ---

/** List all tags for a student. */
export async function getStudentTags(
  token: string,
  studentId: number,
): Promise<StudentTag[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/tags`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentTag[]>(res);
}

/** Add a tag to a student. */
export async function addStudentTag(
  token: string,
  studentId: number,
  tagName: string,
  color: string = 'gray',
): Promise<StudentTag> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/tags`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ tag_name: tagName, color }),
    },
  );
  return handleResponse<StudentTag>(res);
}

/** Remove a tag from a student. */
export async function removeStudentTag(
  token: string,
  studentId: number,
  tagName: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/tags/${encodeURIComponent(tagName)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore
    }
    throw new TeacherApiError(message, res.status);
  }
}
