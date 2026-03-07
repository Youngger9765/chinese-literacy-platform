/**
 * Assignment API service -- teacher assignment management & student assignment access.
 * Follows the same pattern as teacherApi.ts.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// --- Response types ---

export interface AssignmentResponse {
  id: number;
  classroom_id: number;
  story_id: string;
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
}

export interface AssignmentDetailResponse extends AssignmentResponse {
  submissions: SubmissionResponse[];
}

export interface StudentAssignmentResponse {
  assignment_id: number;
  story_id: string;
  story_title: string;
  title: string | null;
  description: string | null;
  assignment_type: string;
  due_date: string | null;
  classroom_name: string;
  status: string;
  submitted_at: string | null;
  score: number | null;
}

export interface StartAssignmentResponse {
  session_id: number;
  story_id: string;
  status: string;
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

/** Create a new assignment for a classroom. */
export async function createAssignment(
  token: string,
  classroomId: number,
  data: {
    story_id: string;
    title?: string;
    description?: string;
    assignment_type?: string;
    due_date?: string;
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

/** Update an assignment. */
export async function updateAssignment(
  token: string,
  assignmentId: number,
  data: {
    title?: string;
    description?: string;
    due_date?: string | null;
    is_active?: boolean;
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
  const res = await fetch(
    `${API_BASE}/api/assignments/my`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<StudentAssignmentResponse[]>(res);
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
