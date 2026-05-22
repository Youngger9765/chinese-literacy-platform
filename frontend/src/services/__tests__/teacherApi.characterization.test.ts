/**
 * Characterization tests for teacherApi.ts (Issue #1842)
 *
 * PURPOSE: Lock in current fetch behavior BEFORE migrating to httpClient,
 * then verify behavior is preserved after migration.
 *
 * Post-migration behavioral changes (httpClient contract):
 * - Auth token is read from storage (authToken.get()) — not from token param
 * - 401 throws SessionExpiredApiError (not a direct onApiUnauthorized call)
 * - Non-401 errors throw ApiError (== TeacherApiError re-export)
 * - deleteStoryTag: 404 silently swallowed via ApiError.status==404 check
 *
 * Invariants preserved after migration:
 * - All endpoint URLs/methods/bodies match original
 * - 204 / void DELETE endpoints return undefined
 * - exportClassroomReport returns Blob (NOT JSON-parsed)
 * - Query-string endpoints (getStudentLearningCurve)
 * - URL-encoded path params (story-tags)
 * - POST body serialization
 * - deleteInstruction returns JSON body (soft-delete, not void)
 * - deleteStoryTag silently swallows 404
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock fetch globally ────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── Mock storage so httpClient gets a known token ─────────────────────────────
vi.mock('../../utils/storage', () => ({
  authToken: {
    get: vi.fn(() => 'test-token-abc'),
    set: vi.fn(),
    clear: vi.fn(),
    header: vi.fn(() => 'Bearer test-token-abc'),
  },
  safeStorage: {
    local: {
      get: vi.fn(() => null),
      set: vi.fn(),
      remove: vi.fn(),
    },
    session: {
      get: vi.fn(() => null),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
  AUTH_TOKEN_KEY: 'auth_token',
  readJSON: vi.fn(),
  writeJSON: vi.fn(),
}));

// ── Mock sessionGuard ─────────────────────────────────────────────────────────
vi.mock('../sessionGuard', () => ({
  onApiUnauthorized: vi.fn(),
  SESSION_UNAUTHORIZED_EVENT: 'lingoleap:session-unauthorized',
  notifySessionUnauthorized: vi.fn(),
}));

// ── Mock apiConfig dynamic import (for exportClassroomReport) ─────────────────
vi.mock('../apiConfig', async (importOriginal) => {
  const original = await importOriginal<typeof import('../apiConfig')>();
  return {
    ...original,
    API_BASE: 'http://localhost:8000',
  };
});

// ── Import after mocks ────────────────────────────────────────────────────────
import { SessionExpiredApiError } from '../apiConfig';
import {
  getClassroomProgress,
  getClassroomTexts,
  assignText,
  getStudentSessions,
  getTeacherStudentDialogue,
  unassignText,
  exportClassroomReport,
  getClassroomStats,
  getErrorVocab,
  getTimeStats,
  getStudentTags,
  addStudentTag,
  removeStudentTag,
  getClassroomHeatmap,
  getClassroomAlerts,
  getStudentLearningCurve,
  createStudentInstruction,
  getStudentInstructions,
  getClassroomInstructionCounts,
  updateInstruction,
  deleteInstruction,
  getTeacherNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  getCrossTextAnalysis,
  getAtRiskStudents,
  getStoryTag,
  upsertStoryTag,
  deleteStoryTag,
  listStoryTags,
  getClassroomErrorHeatmap,
  fetchTeacherSessionReport,
  saveTeacherComment,
  generateAIComment,
  TeacherApiError,
} from '../teacherApi';

// ── Constants ─────────────────────────────────────────────────────────────────
const TOKEN = 'test-token-abc';
const AUTH_HEADER = `Bearer ${TOKEN}`;
const BASE = 'http://localhost:8000'; // default API_BASE in test env

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make fetch return a successful JSON response */
function mockJsonOk(data: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status,
    json: () => Promise.resolve(data),
    blob: () => Promise.resolve(new Blob([JSON.stringify(data)])),
  });
}

/** Make fetch return HTTP error */
function mockHttpError(status: number, detail?: string) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(detail ? { detail } : {}),
    blob: () => Promise.resolve(new Blob()),
  });
}

/** Make fetch return a Blob response */
function mockBlobOk() {
  const blob = new Blob(['csv,data'], { type: 'text/csv' });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(blob),
    json: () => { throw new Error('Should not call json() on blob response'); },
  });
  return blob;
}

/** Get the URL that fetch was called with */
function calledUrl(): string {
  return fetchMock.mock.calls[0][0] as string;
}

/** Get the init object that fetch was called with */
function calledInit(): RequestInit {
  return (fetchMock.mock.calls[0][1] ?? {}) as RequestInit;
}

/** Get Authorization header from fetch call — handles both Headers object and plain object */
function calledAuthHeader(): string | undefined {
  const init = calledInit();
  const headers = init.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get('Authorization') ?? undefined;
  const h = headers as Record<string, string>;
  return h['Authorization'] ?? h['authorization'];
}

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  expect(fetchMock).toHaveBeenCalled(); // ensure fetch was actually called
});

// ════════════════════════════════════════════════════════════════════════════════
// Progress & Sessions
// ════════════════════════════════════════════════════════════════════════════════

describe('getClassroomProgress', () => {
  it('calls correct URL with auth header', async () => {
    mockJsonOk([]);
    await getClassroomProgress(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/progress`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('returns parsed JSON data', async () => {
    const data = [{ student_id: 1, student_name: 'Alice', last_session_date: null, last_text_title: null, total_sessions: 0, tags: [] }];
    mockJsonOk(data);
    const result = await getClassroomProgress(TOKEN, 42);
    expect(result).toEqual(data);
  });

  it('throws error on 500', async () => {
    mockHttpError(500, 'server error');
    await expect(getClassroomProgress(TOKEN, 42)).rejects.toThrow();
  });

  it('throws SessionExpiredApiError on 401', async () => {
    mockHttpError(401);
    await expect(getClassroomProgress(TOKEN, 42)).rejects.toBeInstanceOf(SessionExpiredApiError);
  });
});

describe('getClassroomTexts', () => {
  it('calls /api/classrooms/:id/texts (not /teacher/)', async () => {
    mockJsonOk([]);
    await getClassroomTexts(TOKEN, 7);
    expect(calledUrl()).toBe(`${BASE}/api/classrooms/7/texts`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('assignText', () => {
  it('calls POST /api/classrooms/:id/texts with body', async () => {
    mockJsonOk({ id: 1, text_id: 'L01', title: 'Story', assigned_at: '2026-01-01' });
    await assignText(TOKEN, 7, 'L01', true);
    expect(calledUrl()).toBe(`${BASE}/api/classrooms/7/texts`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ text_id: 'L01', copyright_confirmed: true });
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('defaults copyright_confirmed to false', async () => {
    mockJsonOk({ id: 1, text_id: 'L02', title: 'S', assigned_at: '2026-01-01' });
    await assignText(TOKEN, 7, 'L02');
    const body = JSON.parse(calledInit().body as string);
    expect(body.copyright_confirmed).toBe(false);
  });
});

describe('getStudentSessions', () => {
  it('calls correct URL with auth', async () => {
    mockJsonOk([]);
    await getStudentSessions(TOKEN, 99);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/sessions`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('getTeacherStudentDialogue', () => {
  it('calls correct URL with student and session IDs', async () => {
    mockJsonOk({ session_id: 5, student_id: 99, story_slug: null, turns: [], total: 0 });
    await getTeacherStudentDialogue(TOKEN, 99, 5);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/sessions/5/dialogue`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Text Assignment: unassign (DELETE — void path)
// ════════════════════════════════════════════════════════════════════════════════

describe('unassignText', () => {
  it('calls DELETE /api/classrooms/:id/texts/:textId', async () => {
    // httpClient returns undefined for 204
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn(), blob: vi.fn() });
    await unassignText(TOKEN, 7, 'L01');
    expect(calledUrl()).toBe(`${BASE}/api/classrooms/7/texts/L01`);
    expect(calledInit().method).toBe('DELETE');
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('returns undefined on success (void)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn(), blob: vi.fn() });
    const result = await unassignText(TOKEN, 7, 'L01');
    expect(result).toBeUndefined();
  });

  it('throws error on 403', async () => {
    mockHttpError(403, 'forbidden');
    await expect(unassignText(TOKEN, 7, 'L01')).rejects.toThrow();
  });

  it('throws SessionExpiredApiError on 401', async () => {
    mockHttpError(401);
    await expect(unassignText(TOKEN, 7, 'L01')).rejects.toBeInstanceOf(SessionExpiredApiError);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Export — Blob response (CRITICAL: must NOT call json())
// ════════════════════════════════════════════════════════════════════════════════

describe('exportClassroomReport', () => {
  it('returns Blob from res.blob() — does NOT call res.json()', async () => {
    const expectedBlob = mockBlobOk();
    const result = await exportClassroomReport(TOKEN, 42);
    expect(result).toBeInstanceOf(Blob);
    expect(result).toBe(expectedBlob);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/export`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('throws on error status', async () => {
    mockHttpError(500);
    await expect(exportClassroomReport(TOKEN, 42)).rejects.toThrow();
  });

  it('throws SessionExpiredApiError on 401', async () => {
    mockHttpError(401);
    await expect(exportClassroomReport(TOKEN, 42)).rejects.toBeInstanceOf(SessionExpiredApiError);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Stats / Analytics
// ════════════════════════════════════════════════════════════════════════════════

describe('getClassroomStats', () => {
  it('calls /api/teacher/classrooms/:id/stats', async () => {
    mockJsonOk({ total_students: 20, total_sessions: 100, active_students: 15, inactive_students: 5, avg_accuracy: 0.8, completion_rate: 0.9, avg_session_duration_minutes: 30 });
    await getClassroomStats(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/stats`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('getErrorVocab', () => {
  it('calls /api/teacher/classrooms/:id/error-vocab', async () => {
    mockJsonOk([]);
    await getErrorVocab(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/error-vocab`);
  });
});

describe('getTimeStats', () => {
  it('calls /api/teacher/classrooms/:id/time-stats', async () => {
    mockJsonOk({ total_hours: 5, avg_minutes_per_session: 30, study_days: 10, sessions_this_week: 3, sessions_last_week: 2 });
    await getTimeStats(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/time-stats`);
  });
});

describe('getClassroomHeatmap', () => {
  it('calls /api/teacher/classrooms/:id/heatmap', async () => {
    mockJsonOk({ students: [], stories: [], scores: [] });
    await getClassroomHeatmap(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/heatmap`);
  });
});

describe('getClassroomAlerts', () => {
  it('calls /api/teacher/classrooms/:id/alerts', async () => {
    mockJsonOk([]);
    await getClassroomAlerts(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/alerts`);
  });
});

describe('getCrossTextAnalysis', () => {
  it('calls /api/teacher/classrooms/:id/cross-text-analysis', async () => {
    mockJsonOk({ classroom_id: 42, classroom_name: 'C', total_students: 0, total_sessions: 0, text_difficulty_ranking: [], class_score_trend: [], common_error_chars: [], student_patterns: [] });
    await getCrossTextAnalysis(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/cross-text-analysis`);
  });
});

describe('getAtRiskStudents', () => {
  it('calls /api/teacher/classrooms/:id/at-risk-students', async () => {
    mockJsonOk([]);
    await getAtRiskStudents(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/at-risk-students`);
  });
});

describe('getClassroomErrorHeatmap', () => {
  it('calls /api/teacher/classrooms/:id/error-heatmap', async () => {
    mockJsonOk({ students: [], characters: [], errors: [] });
    await getClassroomErrorHeatmap(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/error-heatmap`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Learning Curve — query string path
// ════════════════════════════════════════════════════════════════════════════════

describe('getStudentLearningCurve', () => {
  it('calls without query string when storySlug is omitted', async () => {
    mockJsonOk({ data: [] });
    await getStudentLearningCurve(TOKEN, 99);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/learning-curve`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('appends story_slug query param when provided', async () => {
    mockJsonOk({ data: [] });
    await getStudentLearningCurve(TOKEN, 99, 'my story');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/learning-curve?story_slug=my%20story`);
  });

  it('URL-encodes special characters in story slug', async () => {
    mockJsonOk({ data: [] });
    await getStudentLearningCurve(TOKEN, 99, '中文 slug');
    const url = calledUrl();
    expect(url).toContain('story_slug=');
    expect(url).not.toContain(' '); // spaces encoded
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Student Tags
// ════════════════════════════════════════════════════════════════════════════════

describe('getStudentTags', () => {
  it('calls GET /api/teacher/students/:id/tags', async () => {
    mockJsonOk([]);
    await getStudentTags(TOKEN, 99);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/tags`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('addStudentTag', () => {
  it('calls POST /api/teacher/students/:id/tags with body', async () => {
    mockJsonOk({ id: 1, student_id: 99, teacher_id: 1, tag_name: 'needs-help', color: 'red', created_at: '2026-01-01' });
    await addStudentTag(TOKEN, 99, 'needs-help', 'red');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/tags`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ tag_name: 'needs-help', color: 'red' });
  });

  it('defaults color to "gray"', async () => {
    mockJsonOk({ id: 1, student_id: 99, teacher_id: 1, tag_name: 'x', color: 'gray', created_at: '2026-01-01' });
    await addStudentTag(TOKEN, 99, 'x');
    const body = JSON.parse(calledInit().body as string);
    expect(body.color).toBe('gray');
  });
});

describe('removeStudentTag', () => {
  it('calls DELETE /api/teacher/students/:id/tags/:tagName URL-encoded', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn(), blob: vi.fn() });
    await removeStudentTag(TOKEN, 99, 'needs help');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/tags/needs%20help`);
    expect(calledInit().method).toBe('DELETE');
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });

  it('returns undefined on success (void)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn(), blob: vi.fn() });
    const result = await removeStudentTag(TOKEN, 99, 'tag');
    expect(result).toBeUndefined();
  });

  it('throws SessionExpiredApiError on 401', async () => {
    mockHttpError(401);
    await expect(removeStudentTag(TOKEN, 99, 'tag')).rejects.toBeInstanceOf(SessionExpiredApiError);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('createStudentInstruction', () => {
  it('calls POST /api/teacher/students/:id/instructions with body', async () => {
    const instruction = { id: 1, teacher_id: 1, student_id: 99, classroom_id: 7, instruction_type: 'focus', content: 'Focus on reading', is_active: true, created_at: '2026-01-01' };
    mockJsonOk(instruction);
    await createStudentInstruction(TOKEN, 99, { classroom_id: 7, instruction_type: 'focus', content: 'Focus on reading' });
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/instructions`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ classroom_id: 7, instruction_type: 'focus', content: 'Focus on reading' });
  });
});

describe('getStudentInstructions', () => {
  it('calls GET /api/teacher/students/:id/instructions', async () => {
    mockJsonOk([]);
    await getStudentInstructions(TOKEN, 99);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/instructions`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('getClassroomInstructionCounts', () => {
  it('calls GET /api/teacher/classrooms/:id/instruction-counts', async () => {
    mockJsonOk({ '1': 2, '2': 0 });
    await getClassroomInstructionCounts(TOKEN, 42);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/classrooms/42/instruction-counts`);
  });
});

describe('updateInstruction', () => {
  it('calls PATCH /api/teacher/instructions/:id with body', async () => {
    const inst = { id: 5, teacher_id: 1, student_id: 99, classroom_id: 7, instruction_type: 'focus', content: 'Updated', is_active: true, created_at: '2026-01-01' };
    mockJsonOk(inst);
    await updateInstruction(TOKEN, 5, { content: 'Updated', is_active: true });
    expect(calledUrl()).toBe(`${BASE}/api/teacher/instructions/5`);
    expect(calledInit().method).toBe('PATCH');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ content: 'Updated', is_active: true });
  });
});

describe('deleteInstruction', () => {
  it('calls DELETE /api/teacher/instructions/:id and returns JSON (soft-delete)', async () => {
    // Note: deleteInstruction returns TeacherInstruction (NOT void) — it's a soft-delete
    const inst = { id: 5, teacher_id: 1, student_id: 99, classroom_id: 7, instruction_type: 'focus', content: 'x', is_active: false, created_at: '2026-01-01' };
    mockJsonOk(inst);
    const result = await deleteInstruction(TOKEN, 5);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/instructions/5`);
    expect(calledInit().method).toBe('DELETE');
    expect(result).toEqual(inst); // returns JSON body, not void
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Notifications
// ════════════════════════════════════════════════════════════════════════════════

describe('getTeacherNotifications', () => {
  it('calls GET /api/teacher/notifications with auth', async () => {
    mockJsonOk({ total: 0, unread: 0, items: [] });
    await getTeacherNotifications(TOKEN);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/notifications`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('markNotificationsRead', () => {
  it('calls POST /api/teacher/notifications/mark-read with alert_keys', async () => {
    mockJsonOk({ marked: 2 });
    await markNotificationsRead(TOKEN, ['key1', 'key2']);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/notifications/mark-read`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ alert_keys: ['key1', 'key2'] });
  });
});

describe('markAllNotificationsRead', () => {
  it('calls POST /api/teacher/notifications/mark-all-read with empty body', async () => {
    mockJsonOk({ marked: 5 });
    await markAllNotificationsRead(TOKEN);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/notifications/mark-all-read`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({});
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Story Tags — URL-encoded path params + special 404 behavior
// ════════════════════════════════════════════════════════════════════════════════

describe('getStoryTag', () => {
  it('URL-encodes storyRef in path', async () => {
    mockJsonOk({ story_ref: 'lesson/01', difficulty_level: 'easy', custom_tags: [] });
    await getStoryTag(TOKEN, 'lesson/01');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/story-tags/lesson%2F01`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

describe('upsertStoryTag', () => {
  it('calls PUT with URL-encoded path and JSON body', async () => {
    mockJsonOk({ story_ref: 'lesson/01', difficulty_level: 'hard', custom_tags: ['important'] });
    await upsertStoryTag(TOKEN, 'lesson/01', { difficulty_level: 'hard', custom_tags: ['important'] });
    expect(calledUrl()).toBe(`${BASE}/api/teacher/story-tags/lesson%2F01`);
    expect(calledInit().method).toBe('PUT');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ difficulty_level: 'hard', custom_tags: ['important'] });
  });
});

describe('deleteStoryTag', () => {
  it('calls DELETE with URL-encoded path', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn(), blob: vi.fn() });
    await deleteStoryTag(TOKEN, 'lesson/01');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/story-tags/lesson%2F01`);
    expect(calledInit().method).toBe('DELETE');
  });

  it('silently swallows 404 (returns undefined)', async () => {
    // httpClient throws ApiError with status 404; deleteStoryTag catches and swallows it
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'not found' }),
    });
    // Should NOT throw for 404
    const result = await deleteStoryTag(TOKEN, 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('throws on non-404 errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'server error' }),
    });
    await expect(deleteStoryTag(TOKEN, 'lesson/01')).rejects.toThrow();
  });
});

describe('listStoryTags', () => {
  it('calls GET /api/teacher/story-tags', async () => {
    mockJsonOk([]);
    await listStoryTags(TOKEN);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/story-tags`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Session Report + Comment
// ════════════════════════════════════════════════════════════════════════════════

describe('fetchTeacherSessionReport', () => {
  it('calls GET /api/teacher/students/:sid/sessions/:sessionId/report', async () => {
    const report = { id: 10, student_id: 99, student_name: 'Alice', story_slug: null, story_title: null, status: 'completed', accuracy: null, overall_score: null, reading_result: null, comprehension_result: null, vocab_result: null, full_reading_result: null, comprehension_score: null, literal_score: null, inferential_score: null, evaluative_score: null, comprehension_feedback: null, ai_comment: null, teacher_comment: null, teacher_reviewed_at: null, started_at: '2026-01-01T00:00:00Z', completed_at: null };
    mockJsonOk(report);
    const result = await fetchTeacherSessionReport(TOKEN, 99, 10);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/sessions/10/report`);
    expect(calledAuthHeader()).toBe(AUTH_HEADER);
    expect(result.student_id).toBe(99);
  });
});

describe('saveTeacherComment', () => {
  it('calls POST /api/teacher/students/:sid/sessions/:sessionId/comment with body', async () => {
    mockJsonOk({ teacher_comment: 'Great work!', teacher_reviewed_at: '2026-01-01T00:00:00Z' });
    await saveTeacherComment(TOKEN, 99, 10, 'Great work!');
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/sessions/10/comment`);
    expect(calledInit().method).toBe('POST');
    const body = JSON.parse(calledInit().body as string);
    expect(body).toEqual({ comment: 'Great work!' });
  });
});

describe('generateAIComment', () => {
  it('calls POST /api/teacher/students/:sid/sessions/:sessionId/generate-ai-comment', async () => {
    mockJsonOk({ ai_comment: 'AI generated comment' });
    await generateAIComment(TOKEN, 99, 10);
    expect(calledUrl()).toBe(`${BASE}/api/teacher/students/99/sessions/10/generate-ai-comment`);
    expect(calledInit().method).toBe('POST');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Cross-cutting: 401 throws SessionExpiredApiError
// ════════════════════════════════════════════════════════════════════════════════

describe('401 handling — throws SessionExpiredApiError', () => {
  it('getClassroomStats 401 throws SessionExpiredApiError', async () => {
    mockHttpError(401);
    await expect(getClassroomStats(TOKEN, 42)).rejects.toBeInstanceOf(SessionExpiredApiError);
  });

  it('getStudentTags 401 throws SessionExpiredApiError', async () => {
    mockHttpError(401);
    await expect(getStudentTags(TOKEN, 99)).rejects.toBeInstanceOf(SessionExpiredApiError);
  });

  it('markNotificationsRead 401 throws SessionExpiredApiError', async () => {
    mockHttpError(401);
    await expect(markNotificationsRead(TOKEN, ['k'])).rejects.toBeInstanceOf(SessionExpiredApiError);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TeacherApiError (ApiError alias) carries status code
// ════════════════════════════════════════════════════════════════════════════════

describe('TeacherApiError', () => {
  it('error carries HTTP status code', async () => {
    mockHttpError(403, 'forbidden detail');
    try {
      await getClassroomProgress(TOKEN, 42);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TeacherApiError);
      expect((e as { status: number }).status).toBe(403);
      expect((e as Error).message).toBe('forbidden detail');
    }
  });
});
