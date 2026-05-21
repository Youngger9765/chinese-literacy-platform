import { API_BASE } from './apiConfig';
/**
 * Organization API service -- admin organization management.
 * Follows the same pattern as classroomApi.ts.
 */


// --- Response types ---

export interface OrganizationResponse {
  id: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  school_count: number;
  description: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  settings: Record<string, unknown> | null;
  total_points: number | null;
  used_points: number;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
}

export interface SchoolInOrgResponse {
  id: number;
  name: string;
  display_name: string | null;
  organization_id: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OrganizationDetailResponse extends OrganizationResponse {
  schools: SchoolInOrgResponse[];
}

export interface OrganizationListResponse {
  items: OrganizationResponse[];
  total: number;
}

export interface PointsLogResponse {
  id: number;
  organization_id: string;
  user_id: number | null;
  user_name: string | null;
  points_used: number;
  feature_type: string;
  description: string | null;
  created_at: string;
}

export interface PointsLogListResponse {
  items: PointsLogResponse[];
  total: number;
}

// --- Error class ---

export class OrganizationApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OrganizationApiError';
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
    throw new OrganizationApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export interface OrganizationBusinessFields {
  description?: string;
  tax_id?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  settings?: Record<string, unknown>;
}

export async function createOrganization(
  token: string,
  data: { name: string; display_name?: string } & OrganizationBusinessFields,
): Promise<OrganizationResponse> {
  const res = await fetch(`${API_BASE}/api/organizations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<OrganizationResponse>(res);
}

export async function listOrganizations(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<OrganizationListResponse> {
  const query = new URLSearchParams();
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.offset != null) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE}/api/organizations${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<OrganizationListResponse>(res);
}

export async function getOrganization(
  token: string,
  organizationId: string,
): Promise<OrganizationDetailResponse> {
  const res = await fetch(`${API_BASE}/api/organizations/${organizationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<OrganizationDetailResponse>(res);
}

export async function updateOrganization(
  token: string,
  organizationId: string,
  data: { name?: string; display_name?: string; is_active?: boolean } & OrganizationBusinessFields,
): Promise<OrganizationResponse> {
  const res = await fetch(`${API_BASE}/api/organizations/${organizationId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<OrganizationResponse>(res);
}

// --- Dashboard ---

export interface SchoolStatItem {
  school_id: number;
  school_name: string;
  teacher_count: number;
  student_count: number;
  session_count: number;
}

export interface OrgDashboardResponse {
  total_schools: number;
  total_teachers: number;
  total_students: number;
  total_sessions: number;
  completed_sessions: number;
  school_stats: SchoolStatItem[];
}

export async function getOrgDashboard(
  token: string,
  orgId: string,
): Promise<OrgDashboardResponse> {
  const res = await fetch(`${API_BASE}/api/organizations/${orgId}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<OrgDashboardResponse>(res);
}

export async function getPointsLogs(
  token: string,
  organizationId: string,
  params?: { limit?: number; offset?: number },
): Promise<PointsLogListResponse> {
  const query = new URLSearchParams();
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.offset != null) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE}/api/organizations/${organizationId}/points/logs${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<PointsLogListResponse>(res);
}
