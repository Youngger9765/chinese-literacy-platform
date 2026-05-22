/**
 * Feedback API service — in-app feedback submission.
 */

import { API_BASE } from './apiConfig';
import { handle401Response } from './apiUnauthorized';
import { authToken } from '../utils/storage';

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
  // #1777 ground zero: previously hardcoded 'token' key → all feedback 401.
  // #1786: migrated to authToken.authHeader() — cannot hardcode wrong key again.
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

  if (resp.status === 401) await handle401Response(resp, 'submitFeedback: session expired');
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

  if (resp.status === 401) await handle401Response(resp, 'feedback list/update: session expired');
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

  if (resp.status === 401) await handle401Response(resp, 'feedback list/update: session expired');
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `Update feedback failed: ${resp.status}`);
  }

  return resp.json();
}
