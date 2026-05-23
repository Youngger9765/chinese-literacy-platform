/**
 * Shared types for SemesterPanel sub-components.
 */

export interface CreateFormState {
  name: string;
  start_date: string;
  end_date: string;
  grace_days: number;
  is_active: boolean;
}

export const DEFAULT_CREATE_FORM: CreateFormState = {
  name: '',
  start_date: '',
  end_date: '',
  grace_days: 7,
  is_active: false,
};

export interface EditFormState {
  name: string;
  start_date: string;
  end_date: string;
  grace_days: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
  return iso; // already YYYY-MM-DD
}

export function computeExpires(end: string, grace: number): string {
  if (!end) return '';
  const d = new Date(end);
  d.setDate(d.getDate() + grace);
  return d.toISOString().split('T')[0];
}
