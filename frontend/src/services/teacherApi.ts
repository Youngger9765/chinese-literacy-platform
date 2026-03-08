/**
 * Teacher Dashboard API service -- student progress & text management.
 * Follows the same pattern as classroomApi.ts.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// --- Response types ---

export interface StudentProgress {
  student_id: number;
  student_name: string;
  last_session_date: string | null;
  last_text_title: string | null;
  total_sessions: number;
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
  copyrightConfirmed: boolean = false,
): Promise<ClassroomTextItem> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/texts`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text_id: textId, copyright_confirmed: copyrightConfirmed }),
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

// --- Alert & Learning Curve types ---

export interface StudentAlert {
  student_id: number;
  student_name: string;
  alert_type: 'inactive' | 'low_performance' | 'declining';
  detail: string;
  last_session_date: string | null;
}

export interface LearningCurvePoint {
  date: string;
  score: number;
  story_title: string | null;
  session_id: number;
}

export interface LearningCurveData {
  data: LearningCurvePoint[];
}

/** Get at-risk student alerts for a classroom. */
export async function getClassroomAlerts(
  token: string,
  classroomId: number,
): Promise<StudentAlert[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/alerts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentAlert[]>(res);
}

/** Get time-series learning curve data for a student. */
export async function getStudentLearningCurve(
  token: string,
  studentId: number,
): Promise<LearningCurveData> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/learning-curve`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<LearningCurveData>(res);
}
