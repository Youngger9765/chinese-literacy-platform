/**
 * Classroom API service -- teacher classroom management.
 * Follows the same pattern as authApi.ts.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// --- Response types ---

export interface ClassroomResponse {
  id: number;
  name: string;
  school_id: number;
  teacher_id: number;
  grade: number | null;
  is_active: boolean;
  created_at: string;
  student_count: number;
}

export interface StudentInClassroomResponse {
  id: number;
  name: string;
  email: string;
  enrolled_at: string;
}

export interface ClassroomDetailResponse extends ClassroomResponse {
  students: StudentInClassroomResponse[];
}

export interface ClassroomListResponse {
  items: ClassroomResponse[];
  total: number;
}

// --- Error class ---

export class ClassroomApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClassroomApiError';
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
    throw new ClassroomApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export async function createClassroom(
  token: string,
  data: { name: string; school_id: number; grade?: number },
): Promise<ClassroomResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<ClassroomResponse>(res);
}

export async function listMyClassrooms(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<ClassroomListResponse> {
  const query = new URLSearchParams();
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.offset != null) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE}/api/classrooms${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ClassroomListResponse>(res);
}

export async function getClassroomDetail(
  token: string,
  classroomId: number,
): Promise<ClassroomDetailResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms/${classroomId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ClassroomDetailResponse>(res);
}

export async function updateClassroom(
  token: string,
  classroomId: number,
  data: { name?: string; grade?: number; is_active?: boolean },
): Promise<ClassroomResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms/${classroomId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<ClassroomResponse>(res);
}

export async function addStudent(
  token: string,
  classroomId: number,
  studentId: number,
): Promise<StudentInClassroomResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms/${classroomId}/students`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ student_id: studentId }),
  });
  return handleResponse<StudentInClassroomResponse>(res);
}

export async function removeStudent(
  token: string,
  classroomId: number,
  studentId: number,
): Promise<{ message: string }> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/students/${studentId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return handleResponse<{ message: string }>(res);
}
