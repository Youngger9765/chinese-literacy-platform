/**
 * parentApi.ts — Parent portal: invite codes, linked children, child dashboard.
 *
 * Split from api.ts (#646). Covers all endpoints under /api/parents/.
 */

import type { StudentDashboardData } from './learningApi';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface ParentInviteCode {
  id: number;
  code: string;
  student_id: number;
  student_name: string;
  expires_at: string;
  used: boolean;
}

export interface LinkedChild {
  student_id: number;
  student_name: string;
  linked_at: string;
}

export async function generateParentInviteCode(
  token: string,
  studentId: number,
): Promise<ParentInviteCode> {
  const res = await fetch(
    `${API_BASE}/api/parents/invite-codes?student_id=${studentId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `generateParentInviteCode failed: ${res.status}`);
  }
  return res.json();
}

export async function listParentInviteCodes(
  token: string,
  studentId: number,
): Promise<ParentInviteCode[]> {
  const res = await fetch(
    `${API_BASE}/api/parents/invite-codes/student/${studentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`listParentInviteCodes failed: ${res.status}`);
  const data = await res.json();
  return data.items;
}

export async function redeemParentInviteCode(
  token: string,
  code: string,
): Promise<LinkedChild> {
  const res = await fetch(`${API_BASE}/api/parents/link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `redeemParentInviteCode failed: ${res.status}`);
  }
  return res.json();
}

export async function listLinkedChildren(token: string): Promise<LinkedChild[]> {
  const res = await fetch(`${API_BASE}/api/parents/children`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`listLinkedChildren failed: ${res.status}`);
  const data = await res.json();
  return data.children;
}

export async function fetchChildDashboard(
  token: string,
  studentId: number,
): Promise<StudentDashboardData> {
  const res = await fetch(
    `${API_BASE}/api/parents/children/${studentId}/dashboard`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`fetchChildDashboard failed: ${res.status}`);
  return res.json();
}
