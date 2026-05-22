/**
 * Teacher Dashboard API service -- student progress & text management.
 * Migrated to httpClient in Issue #1842.
 *
 * IMPORTANT behavioral notes preserved from old implementation:
 * - getClassroomTexts/assignText/unassignText use /api/classrooms/ (not /api/teacher/)
 * - exportClassroomReport: uses request() with responseType blob workaround
 * - deleteStoryTag: silently swallows 404 (non-404 errors throw)
 * - deleteInstruction: soft-delete, returns TeacherInstruction JSON (not void)
 * - getStudentLearningCurve: optional story_slug query param
 * - onApiUnauthorized is called via SessionExpiredApiError thrown by httpClient
 */

import { request, get, post, put, patch, del } from './httpClient';
import { SessionExpiredApiError, ApiError } from './apiConfig';
import { notifySessionUnauthorized } from './sessionGuard';

// TeacherApiError backward-compat alias: httpClient throws ApiError (status-carrying).
// Re-export ApiError as TeacherApiError so `instanceof TeacherApiError` still works.
export { ApiError as TeacherApiError } from './apiConfig';


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

export interface StudentSession {
  id: number;
  story_title: string | null;
  started_at: string;
  completed_at: string | null;
  overall_score: number | null;
  status: string;
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

// ════════════════════════════════════════════════════════════════════════════════
// API functions
// ════════════════════════════════════════════════════════════════════════════════

/** Get student progress for a classroom. */
export function getClassroomProgress(
  _token: string,
  classroomId: number,
): Promise<StudentProgress[]> {
  return get(`/api/teacher/classrooms/${classroomId}/progress`);
}

/** Get assigned texts for a classroom. */
export function getClassroomTexts(
  _token: string,
  classroomId: number,
): Promise<ClassroomTextItem[]> {
  return get(`/api/classrooms/${classroomId}/texts`);
}

/** Assign a text (story) to a classroom. */
export function assignText(
  _token: string,
  classroomId: number,
  textId: string,
  copyrightConfirmed: boolean = false,
): Promise<ClassroomTextItem> {
  return post(`/api/classrooms/${classroomId}/texts`, {
    text_id: textId,
    copyright_confirmed: copyrightConfirmed,
  });
}

/** Get learning session history for a specific student. */
export function getStudentSessions(
  _token: string,
  studentId: number,
): Promise<StudentSession[]> {
  return get(`/api/teacher/students/${studentId}/sessions`);
}

/** Fetch Socratic dialogue history for a student session (teacher view). */
export function getTeacherStudentDialogue(
  _token: string,
  studentId: number,
  sessionId: number,
): Promise<TeacherDialogueHistoryResponse> {
  return get(`/api/teacher/students/${studentId}/sessions/${sessionId}/dialogue`);
}

/** Unassign a text from a classroom. */
export function unassignText(
  _token: string,
  classroomId: number,
  textId: string,
): Promise<void> {
  return del(`/api/classrooms/${classroomId}/texts/${textId}`);
}

/** Export classroom report as a CSV Blob. */
export async function exportClassroomReport(_token: string, classroomId: number): Promise<Blob> {
  // httpClient.request() returns parsed JSON by default.
  // For blob responses we must bypass it and call fetch + res.blob() directly.
  // We still use the auth token via httpClient internals by calling request with
  // a custom responseType workaround: fetch raw, handle blob.
  const { API_BASE } = await import('./apiConfig');
  const { authToken } = await import('../utils/storage');
  const token = authToken.get();
  const res = await fetch(`${API_BASE}/api/teacher/classrooms/${classroomId}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    notifySessionUnauthorized();
    if (res.status === 401) throw new SessionExpiredApiError();
    throw new ApiError('Export failed', res.status);
  }
  return res.blob();
}

/** Get classroom aggregate statistics. */
export function getClassroomStats(
  _token: string,
  classroomId: number,
): Promise<ClassroomStats> {
  return get(`/api/teacher/classrooms/${classroomId}/stats`);
}

/** Get top error vocabulary for a classroom. */
export function getErrorVocab(
  _token: string,
  classroomId: number,
): Promise<ErrorVocabItem[]> {
  return get(`/api/teacher/classrooms/${classroomId}/error-vocab`);
}

/** Get learning time statistics for a classroom. */
export function getTimeStats(
  _token: string,
  classroomId: number,
): Promise<TimeStats> {
  return get(`/api/teacher/classrooms/${classroomId}/time-stats`);
}

// --- Student Tag API ---

/** List all tags for a student. */
export function getStudentTags(
  _token: string,
  studentId: number,
): Promise<StudentTag[]> {
  return get(`/api/teacher/students/${studentId}/tags`);
}

/** Add a tag to a student. */
export function addStudentTag(
  _token: string,
  studentId: number,
  tagName: string,
  color: string = 'gray',
): Promise<StudentTag> {
  return post(`/api/teacher/students/${studentId}/tags`, { tag_name: tagName, color });
}

/** Remove a tag from a student. */
export function removeStudentTag(
  _token: string,
  studentId: number,
  tagName: string,
): Promise<void> {
  return del(`/api/teacher/students/${studentId}/tags/${encodeURIComponent(tagName)}`);
}

/** Get student × story score heatmap for a classroom. */
export function getClassroomHeatmap(
  _token: string,
  classroomId: number,
): Promise<ClassroomHeatmap> {
  return get(`/api/teacher/classrooms/${classroomId}/heatmap`);
}

/** Get at-risk student alerts for a classroom. */
export function getClassroomAlerts(
  _token: string,
  classroomId: number,
): Promise<StudentAlert[]> {
  return get(`/api/teacher/classrooms/${classroomId}/alerts`);
}

/** Get time-series learning curve data for a student. */
export function getStudentLearningCurve(
  _token: string,
  studentId: number,
  storySlug?: string,
): Promise<LearningCurveData> {
  let path = `/api/teacher/students/${studentId}/learning-curve`;
  if (storySlug) path += `?story_slug=${encodeURIComponent(storySlug)}`;
  return get(path);
}

// --- Teacher Instructions ---

/** Create a special instruction for a student. */
export function createStudentInstruction(
  _token: string,
  studentId: number,
  data: InstructionCreateData,
): Promise<TeacherInstruction> {
  return post(`/api/teacher/students/${studentId}/instructions`, data);
}

/** Get active instructions for a student. */
export function getStudentInstructions(
  _token: string,
  studentId: number,
): Promise<TeacherInstruction[]> {
  return get(`/api/teacher/students/${studentId}/instructions`);
}

/** Get active instruction counts for all students in a classroom (bulk, avoids N+1). */
export function getClassroomInstructionCounts(
  _token: string,
  classroomId: number,
): Promise<Record<number, number>> {
  return get(`/api/teacher/classrooms/${classroomId}/instruction-counts`);
}

/** Update an instruction. */
export function updateInstruction(
  _token: string,
  instructionId: number,
  data: InstructionUpdateData,
): Promise<TeacherInstruction> {
  return patch(`/api/teacher/instructions/${instructionId}`, data);
}

/** Soft-delete an instruction. */
export function deleteInstruction(
  _token: string,
  instructionId: number,
): Promise<TeacherInstruction> {
  // Returns JSON body (soft-delete returns updated record), NOT void
  return del<TeacherInstruction>(`/api/teacher/instructions/${instructionId}`);
}

// --- Notification Center ---

/** Fetch all aggregated alerts across all teacher classrooms with read state. */
export function getTeacherNotifications(
  _token: string,
): Promise<NotificationSummary> {
  return get('/api/teacher/notifications');
}

/** Mark specific alert keys as read. */
export function markNotificationsRead(
  _token: string,
  alertKeys: string[],
): Promise<{ marked: number }> {
  return post('/api/teacher/notifications/mark-read', { alert_keys: alertKeys });
}

/** Mark all current alerts as read. */
export function markAllNotificationsRead(
  _token: string,
): Promise<{ marked: number }> {
  return post('/api/teacher/notifications/mark-all-read', {});
}

/** Fetch cross-text learning pattern analysis for a classroom. */
export function getCrossTextAnalysis(
  _token: string,
  classroomId: number,
): Promise<ClassroomCrossTextPattern> {
  return get(`/api/teacher/classrooms/${classroomId}/cross-text-analysis`);
}

/** Fetch predictive at-risk student list for a classroom. */
export function getAtRiskStudents(
  _token: string,
  classroomId: number,
): Promise<AtRiskStudent[]> {
  return get(`/api/teacher/classrooms/${classroomId}/at-risk-students`);
}

// ── Story Tags ────────────────────────────────────────────────────────────────

/** Get teacher's difficulty and custom tags for a story. */
export function getStoryTag(
  _token: string,
  storyRef: string,
): Promise<StoryTagData> {
  return get(`/api/teacher/story-tags/${encodeURIComponent(storyRef)}`);
}

/** Set or update difficulty and custom tags for a story. */
export function upsertStoryTag(
  _token: string,
  storyRef: string,
  data: StoryTagUpsertRequest,
): Promise<StoryTagData> {
  return put(`/api/teacher/story-tags/${encodeURIComponent(storyRef)}`, data);
}

/** Remove all custom tags and difficulty override for a story.
 *  Silently swallows 404 (already deleted). Non-404 errors throw.
 */
export async function deleteStoryTag(
  _token: string,
  storyRef: string,
): Promise<void> {
  try {
    await del(`/api/teacher/story-tags/${encodeURIComponent(storyRef)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return; // swallow
    throw e;
  }
}

/** List all story tags created by the authenticated teacher. */
export function listStoryTags(_token: string): Promise<StoryTagData[]> {
  return get('/api/teacher/story-tags');
}

// --- Error Heatmap ---

/** Get student × character error heatmap for a classroom. */
export function getClassroomErrorHeatmap(
  _token: string,
  classroomId: number,
): Promise<ClassroomErrorHeatmap> {
  return get(`/api/teacher/classrooms/${classroomId}/error-heatmap`);
}

// --- Teacher Session Report + Comment (Issue #993) ---

export function fetchTeacherSessionReport(
  _token: string,
  studentId: number,
  sessionId: number,
): Promise<TeacherSessionReport> {
  return get(`/api/teacher/students/${studentId}/sessions/${sessionId}/report`);
}

export function saveTeacherComment(
  _token: string,
  studentId: number,
  sessionId: number,
  comment: string,
): Promise<{ teacher_comment: string; teacher_reviewed_at: string }> {
  return post(`/api/teacher/students/${studentId}/sessions/${sessionId}/comment`, { comment });
}

export function generateAIComment(
  _token: string,
  studentId: number,
  sessionId: number,
): Promise<{ ai_comment: string }> {
  return post(`/api/teacher/students/${studentId}/sessions/${sessionId}/generate-ai-comment`, {});
}
