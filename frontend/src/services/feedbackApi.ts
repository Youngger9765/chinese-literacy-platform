/**
 * Feedback API service — in-app feedback submission.
 */
import { authToken } from '../utils/storage';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export type FeedbackCategory = 'bug' | 'feature' | 'question' | 'other';
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface FeedbackSubmitRequest {
  category: FeedbackCategory;
  title: string;
  description?: string;
  page_url?: string;
}

export interface FeedbackResponse {
  id: number;
  user_id: number;
  user_name: string;
  category: FeedbackCategory;
  title: string;
  description: string | null;
  page_url: string | null;
  status: FeedbackStatus;
  created_at: string;
}

export interface FeedbackListResponse {
  items: FeedbackResponse[];
  total: number;
  page: number;
  page_size: number;
}

function getAuthHeaders(): Record<string, string> {
  // #1786: token key centralised in authToken — guards against #1777-style
  // regressions where this file hardcoded 'token' instead of 'lingoleap_token'.
  return authToken.authHeader();
}

/**
 * Submit feedback from the current authenticated user.
 */
export async function submitFeedback(data: FeedbackSubmitRequest): Promise<FeedbackResponse> {
  const resp = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(data),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `Submit feedback failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * List feedback entries (admin only).
 */
export async function listFeedback(params?: {
  page?: number;
  page_size?: number;
  category?: FeedbackCategory;
  status?: FeedbackStatus;
}): Promise<FeedbackListResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));
  if (params?.category) query.set('category', params.category);
  if (params?.status) query.set('status', params.status);

  const resp = await fetch(`${API_BASE}/api/feedback?${query}`, {
    headers: getAuthHeaders(),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `List feedback failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Update the status of a feedback entry (admin only).
 */
export async function updateFeedbackStatus(
  id: number,
  status: FeedbackStatus,
): Promise<FeedbackResponse> {
  const resp = await fetch(`${API_BASE}/api/feedback/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ status }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `Update feedback failed: ${resp.status}`);
  }

  return resp.json();
}
