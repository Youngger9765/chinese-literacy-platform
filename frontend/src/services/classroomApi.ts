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
  join_code?: string | null;
  school_name?: string | null;
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
  data: { name: string; school_id: number; grade?: number; teacher_id?: number },
): Promise<ClassroomResponse> {
  const res = await fetch(`${API_BASE}/api/classrooms`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<ClassroomResponse>(res);
}

/** @deprecated Use createClassroom instead -- same endpoint, kept for backward compatibility. */
export const createClassroomAdmin = createClassroom;

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

// --- Regenerate join code ---

export async function regenerateClassroomCode(
  token: string,
  classroomId: number,
): Promise<{ join_code: string }> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/regenerate-code`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse<{ join_code: string }>(res);
}

// --- Search students not in classroom ---

export interface StudentSearchResult {
  id: number;
  name: string;
  email: string;
}

export async function searchStudentsForClassroom(
  token: string,
  classroomId: number,
  query: string,
): Promise<StudentSearchResult[]> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/students/search`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ query }),
    },
  );
  return handleResponse<StudentSearchResult[]>(res);
}

// --- Join classroom by code (student) ---

export async function joinClassroomByCode(
  token: string,
  joinCode: string,
): Promise<{ message: string; classroom_id: number; classroom_name: string }> {
  const res = await fetch(`${API_BASE}/api/classrooms/join`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ join_code: joinCode }),
  });
  return handleResponse<{ message: string; classroom_id: number; classroom_name: string }>(res);
}

// --- Batch create students ---

export interface BatchStudentInput {
  name: string;
  seat_number?: string;
}

export interface BatchCreateResult {
  created: {
    name: string;
    seat_number: string;
    username: string;
    password: string;
    user_id: number;
  }[];
  errors: string[];
}

export async function batchCreateStudents(
  token: string,
  classroomId: number,
  students: BatchStudentInput[],
): Promise<BatchCreateResult> {
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/students/batch`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ students }),
    },
  );
  return handleResponse<BatchCreateResult>(res);
}

// --- CSV Upload ---

export interface CsvUploadError {
  name: string;
  seat_number: string;
  error: string;
}

export interface CsvUploadResult {
  created_count: number;
  skipped_count: number;
  errors: CsvUploadError[];
  created: {
    name: string;
    seat_number: string;
    username: string;
    password: string;
    user_id: number;
  }[];
}

export async function uploadCsvStudents(
  token: string,
  classroomId: number,
  file: File,
): Promise<CsvUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(
    `${API_BASE}/api/classrooms/${classroomId}/students/upload-csv`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
  );
  return handleResponse<CsvUploadResult>(res);
}

export function downloadCsvTemplate(token: string): void {
  const url = `${API_BASE}/api/classrooms/csv-template`;
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.blob())
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'student-import-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    });
}

// --- Export classroom report as CSV (#235) ---

export function exportClassroomReport(token: string, classroomId: number): void {
  const url = `${API_BASE}/api/teacher/classrooms/${classroomId}/export`;
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => {
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `classroom-${classroomId}-report-${today}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    })
    .catch((err) => {
      console.error('Failed to export classroom report:', err);
    });
}
