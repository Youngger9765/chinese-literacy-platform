/**
 * Teacher Dashboard API service -- student progress & text management.
 * Follows the same pattern as classroomApi.ts.
 */

import { onApiUnauthorized } from './sessionGuard';

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
    onApiUnauthorized(res);
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

// ── Dialogue history (Issue #418) ──────────────────────────────────────────

export interface TeacherDialogueTurn {
  id: number;
  turn_order: number;
  role: string;
  text: string;
  is_correct: boolean | null;
  phase: string | null;
  created_at: string;
}

export interface TeacherDialogueHistoryResponse {
  session_id: number;
  student_id: number;
  story_slug: string | null;
  turns: TeacherDialogueTurn[];
  total: number;
}

/** Fetch Socratic dialogue history for a student session (teacher view). */
export async function getTeacherStudentDialogue(
  token: string,
  studentId: number,
  sessionId: number,
): Promise<TeacherDialogueHistoryResponse> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/sessions/${sessionId}/dialogue`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<TeacherDialogueHistoryResponse>(res);
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
    onApiUnauthorized(res);
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
  if (!res.ok) {
    onApiUnauthorized(res);
    throw new TeacherApiError('Export failed', res.status);
  }
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
    onApiUnauthorized(res);
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

// --- Heatmap types ---

export interface HeatmapStudent {
  id: number;
  name: string;
}

export interface HeatmapStory {
  id: string;
  title: string;
}

export interface HeatmapScore {
  student_id: number;
  story_id: string;
  score: number;
  status: string;
}

export interface ClassroomHeatmap {
  students: HeatmapStudent[];
  stories: HeatmapStory[];
  scores: HeatmapScore[];
}

/** Get student × story score heatmap for a classroom. */
export async function getClassroomHeatmap(
  token: string,
  classroomId: number,
): Promise<ClassroomHeatmap> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/heatmap`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ClassroomHeatmap>(res);
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
  story_slug: string | null;
  cpm: number | null;
  accuracy: number | null;
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
  storySlug?: string,
): Promise<LearningCurveData> {
  let url = `${API_BASE}/api/teacher/students/${studentId}/learning-curve`;
  if (storySlug) url += `?story_slug=${encodeURIComponent(storySlug)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return handleResponse<LearningCurveData>(res);
}

// --- Teacher Instructions (Individualized) ---

export interface TeacherInstruction {
  id: number;
  teacher_id: number;
  student_id: number;
  classroom_id: number;
  instruction_type: string;
  content: string;
  is_active: boolean;
  created_at: string;
}

export interface InstructionCreateData {
  classroom_id: number;
  instruction_type: string;
  content: string;
}

export interface InstructionUpdateData {
  content?: string;
  instruction_type?: string;
  is_active?: boolean;
}

/** Create a special instruction for a student. */
export async function createStudentInstruction(
  token: string,
  studentId: number,
  data: InstructionCreateData,
): Promise<TeacherInstruction> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/instructions`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    },
  );
  return handleResponse<TeacherInstruction>(res);
}

/** Get active instructions for a student. */
export async function getStudentInstructions(
  token: string,
  studentId: number,
): Promise<TeacherInstruction[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/instructions`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<TeacherInstruction[]>(res);
}

/** Get active instruction counts for all students in a classroom (bulk, avoids N+1). */
export async function getClassroomInstructionCounts(
  token: string,
  classroomId: number,
): Promise<Record<number, number>> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/instruction-counts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<Record<number, number>>(res);
}

/** Update an instruction. */
export async function updateInstruction(
  token: string,
  instructionId: number,
  data: InstructionUpdateData,
): Promise<TeacherInstruction> {
  const res = await fetch(
    `${API_BASE}/api/teacher/instructions/${instructionId}`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    },
  );
  return handleResponse<TeacherInstruction>(res);
}

/** Soft-delete an instruction. */
export async function deleteInstruction(
  token: string,
  instructionId: number,
): Promise<TeacherInstruction> {
  const res = await fetch(
    `${API_BASE}/api/teacher/instructions/${instructionId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return handleResponse<TeacherInstruction>(res);
}

// --- Notification Center ---

export interface NotificationItem {
  alert_key: string;
  classroom_id: number;
  classroom_name: string;
  student_id: number;
  student_name: string;
  alert_type: 'inactive' | 'low_performance' | 'declining';
  detail: string;
  last_session_date: string | null;
  is_read: boolean;
  read_at: string | null;
}

export interface NotificationSummary {
  total: number;
  unread: number;
  items: NotificationItem[];
}

/** Fetch all aggregated alerts across all teacher classrooms with read state. */
export async function getTeacherNotifications(
  token: string,
): Promise<NotificationSummary> {
  const res = await fetch(`${API_BASE}/api/teacher/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<NotificationSummary>(res);
}

/** Mark specific alert keys as read. */
export async function markNotificationsRead(
  token: string,
  alertKeys: string[],
): Promise<{ marked: number }> {
  const res = await fetch(`${API_BASE}/api/teacher/notifications/mark-read`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ alert_keys: alertKeys }),
  });
  return handleResponse<{ marked: number }>(res);
}

/** Mark all current alerts as read. */
export async function markAllNotificationsRead(
  token: string,
): Promise<{ marked: number }> {
  const res = await fetch(`${API_BASE}/api/teacher/notifications/mark-all-read`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  return handleResponse<{ marked: number }>(res);
}

// ── Cross-Text Analysis (Issue #253) ─────────────────────────────────────────

export interface TextPerformanceSummary {
  story_slug: string;
  story_title: string | null;
  attempt_count: number;
  avg_score: number | null;
  avg_accuracy: number | null;
  avg_comprehension_score: number | null;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
}

export interface RepeatedErrorChar {
  char: string;
  error_count: number;
  story_count: number;
  story_slugs: string[];
}

export interface StudentCrossTextPattern {
  student_id: number;
  student_name: string;
  total_texts_attempted: number;
  total_sessions: number;
  overall_avg_score: number | null;
  score_trend: Array<{
    date: string;
    score: number | null;
    story_slug: string;
    title: string | null;
  }>;
  text_performance: TextPerformanceSummary[];
  repeated_error_chars: RepeatedErrorChar[];
  strong_texts: string[];
  weak_texts: string[];
}

export interface ClassroomCrossTextPattern {
  classroom_id: number;
  classroom_name: string;
  total_students: number;
  total_sessions: number;
  text_difficulty_ranking: Array<{
    story_slug: string;
    title: string | null;
    avg_score: number | null;
    attempt_count: number;
  }>;
  class_score_trend: Array<{ date: string; avg_score: number }>;
  common_error_chars: Array<{ char: string; student_count: number; total_errors: number }>;
  student_patterns: StudentCrossTextPattern[];
}

/** Fetch cross-text learning pattern analysis for a classroom. */
export async function getCrossTextAnalysis(
  token: string,
  classroomId: number,
): Promise<ClassroomCrossTextPattern> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/cross-text-analysis`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ClassroomCrossTextPattern>(res);
}

// ── At-Risk Students / Predictive Detection (Issue #254) ──────────────────────

export interface AtRiskStudent {
  student_id: number;
  student_name: string;
  risk_level: 'low' | 'medium' | 'high';
  risk_factors: string[];
  recommended_actions: string[];
  confidence_score: number;
  supporting_data: Record<string, unknown>;
}

/** Fetch predictive at-risk student list for a classroom. */
export async function getAtRiskStudents(
  token: string,
  classroomId: number,
): Promise<AtRiskStudent[]> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/at-risk-students`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<AtRiskStudent[]>(res);
}


// ── Story Tags: difficulty + custom labels (Issue #422) ───────────────────────

export interface StoryTagData {
  story_ref: string;
  difficulty_level: 'easy' | 'medium' | 'hard' | null;
  custom_tags: string[];
}

export interface StoryTagUpsertRequest {
  difficulty_level?: 'easy' | 'medium' | 'hard' | null;
  custom_tags?: string[];
}

/** Get teacher's difficulty and custom tags for a story. */
export async function getStoryTag(
  token: string,
  storyRef: string,
): Promise<StoryTagData> {
  const res = await fetch(
    `${API_BASE}/api/teacher/story-tags/${encodeURIComponent(storyRef)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StoryTagData>(res);
}

/** Set or update difficulty and custom tags for a story. */
export async function upsertStoryTag(
  token: string,
  storyRef: string,
  data: StoryTagUpsertRequest,
): Promise<StoryTagData> {
  const res = await fetch(
    `${API_BASE}/api/teacher/story-tags/${encodeURIComponent(storyRef)}`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    },
  );
  return handleResponse<StoryTagData>(res);
}

/** Remove all custom tags and difficulty override for a story. */
export async function deleteStoryTag(
  token: string,
  storyRef: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/teacher/story-tags/${encodeURIComponent(storyRef)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new TeacherApiError(data.detail ?? 'Failed to delete story tag', res.status);
  }
}

/** List all story tags created by the authenticated teacher. */
export async function listStoryTags(token: string): Promise<StoryTagData[]> {
  const res = await fetch(`${API_BASE}/api/teacher/story-tags`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<StoryTagData[]>(res);
}

// --- Error Heatmap types ---

export interface ErrorHeatmapStudent {
  id: number;
  name: string;
}

export interface ErrorHeatmapError {
  student_id: number;
  character: string;
  error_count: number;
}

export interface ClassroomErrorHeatmap {
  students: ErrorHeatmapStudent[];
  characters: string[];
  errors: ErrorHeatmapError[];
}

/** Get student × character error heatmap for a classroom. */
export async function getClassroomErrorHeatmap(
  token: string,
  classroomId: number,
): Promise<ClassroomErrorHeatmap> {
  const res = await fetch(
    `${API_BASE}/api/teacher/classrooms/${classroomId}/error-heatmap`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<ClassroomErrorHeatmap>(res);
}

// --- Teacher Session Report + Comment (Issue #993) ---

export interface TeacherSessionReport {
  id: number;
  student_id: number;
  student_name: string;
  story_slug: string | null;
  story_title: string | null;
  status: string;
  accuracy: number | null;
  overall_score: number | null;
  reading_result: Record<string, unknown> | null;
  comprehension_result: Record<string, unknown> | null;
  vocab_result: Record<string, unknown> | null;
  full_reading_result: Record<string, unknown> | null;
  comprehension_score: number | null;
  literal_score: number | null;
  inferential_score: number | null;
  evaluative_score: number | null;
  comprehension_feedback: string | null;
  ai_comment: string | null;
  teacher_comment: string | null;
  teacher_reviewed_at: string | null;
  started_at: string;
  completed_at: string | null;
}

export async function fetchTeacherSessionReport(
  token: string,
  studentId: number,
  sessionId: number,
): Promise<TeacherSessionReport> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/sessions/${sessionId}/report`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<TeacherSessionReport>(res);
}

export async function saveTeacherComment(
  token: string,
  studentId: number,
  sessionId: number,
  comment: string,
): Promise<{ teacher_comment: string; teacher_reviewed_at: string }> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/sessions/${sessionId}/comment`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ comment }),
    },
  );
  return handleResponse(res);
}

export async function generateAIComment(
  token: string,
  studentId: number,
  sessionId: number,
): Promise<{ ai_comment: string }> {
  const res = await fetch(
    `${API_BASE}/api/teacher/students/${studentId}/sessions/${sessionId}/generate-ai-comment`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse(res);
}
