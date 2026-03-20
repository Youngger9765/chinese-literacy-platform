/**
 * Assignment API service -- teacher assignment management & student assignment access.
 *
 * 副本策略 (Copy Strategy):
 * - story_id: YAML platform text (lesson_number string, e.g. "1"). Never forked.
 * - text_id: DB text (texts table). Backend forks mutable texts at creation.
 *   Exactly one of story_id or text_id is set on each assignment.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const inFlightMyAssignments = new Map<string, Promise<StudentAssignmentResponse[]>>();

// --- Response types ---

// Default reading goals (Issue #84) — mirrors backend defaults
export const DEFAULT_TARGET_CPM = 150;
export const DEFAULT_TARGET_ACCURACY = 90;

export interface ReadingGoals {
  target_cpm: number | null;
  target_accuracy: number | null;
  difficulty_label: string | null;
  /** Effective value — defaults applied when teacher hasn't set custom ones. */
  effective_cpm: number;
  effective_accuracy: number;
}

export interface AssignmentResponse extends ReadingGoals {
  id: number;
  classroom_id: number;
  /** Set for YAML platform texts; null for DB texts. */
  story_id: string | null;
  /** Set for DB texts (points to fork for mutable texts); null for YAML texts. */
  text_id: number | null;
  /** Resolved display title (from YAML or DB). */
  story_title: string;
  title: string | null;
  description: string | null;
  assignment_type: string;
  due_date: string | null;
  is_active: boolean;
  created_at: string;
  submission_count: number;
  completed_count: number;
}

export interface SubmissionResponse {
  id: number;
  assignment_id: number;
  student_id: number;
  student_name: string;
  status: string;
  submitted_at: string | null;
  score: number | null;
  // Reading metrics from linked LearningSession (Issue #423)
  reading_accuracy: number | null;
  reading_cpm: number | null;
  reading_error_chars: string[];
  /** Per-student teacher feedback, set when grading (Issue #424). */
  teacher_feedback: string | null;
}

export interface AssignmentDetailResponse extends AssignmentResponse {
  submissions: SubmissionResponse[];
}

export interface StudentAssignmentResponse extends ReadingGoals {
  assignment_id: number;
  story_id: string | null;
  text_id: number | null;
  story_title: string;
  title: string | null;
  description: string | null;
  assignment_type: string;
  due_date: string | null;
  classroom_name: string;
  status: string;
  submitted_at: string | null;
  score: number | null;
  /** Per-student teacher feedback visible to the student (Issue #424). */
  teacher_feedback: string | null;
}

export interface StartAssignmentResponse {
  session_id: number;
  story_id: string | null;
  text_id: number | null;
  status: string;
  // Reading goals (Issue #414) — returned so student knows the target
  target_cpm: number | null;
  target_accuracy: number | null;
  difficulty_label: string | null;
  effective_cpm: number;
  effective_accuracy: number;
}

// --- Error class ---

export class AssignmentApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AssignmentApiError';
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
    throw new AssignmentApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

/**
 * Create a new assignment for a classroom.
 * Provide exactly one of story_id (YAML text) or text_id (DB text).
 */
export async function createAssignment(
  token: string,
  classroomId: number,
  data: (
    | { story_id: string; text_id?: never }
    | { text_id: number; story_id?: never }
  ) & {
    title?: string;
    description?: string;
    assignment_type?: string;
    due_date?: string;
    // Reading goals (Issue #84)
    target_cpm?: number | null;
    target_accuracy?: number | null;
    difficulty_label?: string | null;
  },
): Promise<AssignmentResponse> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/assignments`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    },
  );
  return handleResponse<AssignmentResponse>(res);
}

/** Get all assignments for a classroom. */
export async function getClassroomAssignments(
  token: string,
  classroomId: number,
): Promise<{ items: AssignmentResponse[]; total: number }> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/assignments`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<{ items: AssignmentResponse[]; total: number }>(res);
}

/** Get assignment detail with submissions. */
export async function getAssignmentDetail(
  token: string,
  assignmentId: number,
): Promise<AssignmentDetailResponse> {
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<AssignmentDetailResponse>(res);
}

/** Update an assignment (including reading goals). */
export async function updateAssignment(
  token: string,
  assignmentId: number,
  data: {
    title?: string;
    description?: string;
    due_date?: string | null;
    is_active?: boolean;
    // Reading goals (Issue #84)
    target_cpm?: number | null;
    target_accuracy?: number | null;
    difficulty_label?: string | null;
  },
): Promise<AssignmentResponse> {
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(data),
    },
  );
  return handleResponse<AssignmentResponse>(res);
}

/** Get current student's assignments. */
export async function getMyAssignments(
  token: string,
): Promise<StudentAssignmentResponse[]> {
  const existing = inFlightMyAssignments.get(token);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const res = await fetch(
      `${API_BASE}/api/assignments/my`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return handleResponse<StudentAssignmentResponse[]>(res);
  })();
  inFlightMyAssignments.set(token, request);
  try {
    return await request;
  } finally {
    inFlightMyAssignments.delete(token);
  }
}

/** Delete an assignment and all its submissions. Teacher or admin only. */
export async function deleteAssignment(
  token: string,
  assignmentId: number,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}`,
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
      // ignore JSON parse errors
    }
    throw new AssignmentApiError(message, res.status);
  }
}

/** Get detail for one of the current student's assignments. */
export async function getMyAssignmentDetail(
  token: string,
  assignmentId: number,
): Promise<StudentAssignmentResponse> {
  const res = await fetch(
    `${API_BASE}/api/assignments/my/${assignmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentAssignmentResponse>(res);
}

/** Grade a student submission (teacher sets score, marks as graded). */
export async function gradeSubmission(
  token: string,
  assignmentId: number,
  submissionId: number,
  score: number | null,
  teacherFeedback?: string | null,
): Promise<SubmissionResponse> {
  const body: { score: number | null; teacher_feedback?: string | null } = { score };
  if (teacherFeedback !== undefined) {
    body.teacher_feedback = teacherFeedback;
  }
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}/submissions/${submissionId}`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    },
  );
  return handleResponse<SubmissionResponse>(res);
}

/** Start an assignment (creates a learning session). */
export async function startAssignment(
  token: string,
  assignmentId: number,
): Promise<StartAssignmentResponse> {
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}/start`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse<StartAssignmentResponse>(res);
}

/**
 * Submit a completed assignment. Call this when the student reaches the report page.
 * Idempotent: safe to call even if already submitted.
 * TODO: Backend will send Email notification to teacher on submission (future implementation).
 */
export async function submitAssignment(
  token: string,
  assignmentId: number,
): Promise<StudentAssignmentResponse> {
  const res = await fetch(
    `${API_BASE}/api/assignments/${assignmentId}/submit`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse<StudentAssignmentResponse>(res);
}
