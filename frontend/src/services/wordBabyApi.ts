/**
 * wordBabyApi.ts — API client for the word-baby pet system (#3780).
 *
 *   GET  /api/learning/students/{student_id}/word-babies          — my pets
 *   POST /api/learning/students/{student_id}/word-babies/{id}/feed — feed
 *
 * Types below are copied field-for-field from the REAL backend response —
 * captured by running backend/app/routes/learning/word_babies.py's own
 * Pydantic response models through a FastAPI TestClient (not guessed from
 * reading the route source). See wordBabyApi.test.ts for the captured
 * fixtures used as contract tests.
 */
import { API_BASE, ApiError } from './apiConfig';

// --- Response types (snake_case, matches backend verbatim) ---------------

export interface WordBabySummary {
  baby_id: string;
  name: string;
  rarity: string;
  stage_index: number;
  stage_count: number;
  fully_grown: boolean;
  dormant_type: string | null;
  weaken_state: 'healthy' | 'weak' | 'deep_sleep';
  fed_current_stage: number;
  /** null when not dormant; otherwise effective days still needed to hatch. */
  hatch_days_remaining: number | null;
  /** Per-flavor fed amount for structured-feeding species (epic/legendary,
   * `fragments_by_flavor` on the catalog stage) — null for shared-pool
   * rarities (common/uncommon/rare), where `fed_current_stage` alone is
   * enough. Review finding 2026-10-27 round 3: without this, the frontend
   * couldn't tell which specific flavor was still outstanding for a
   * structured-feeding baby, and could enable the feed button for a flavor
   * that was already capped off for this stage. */
  fed_by_flavor?: Record<string, number> | null;
}

export interface MyWordBabiesResponse {
  babies: WordBabySummary[];
  babies_owned_count: number;
  babies_total_species: number;
  /** flavor family name -> quantity currently in wallet (zero-quantity
   * flavors are only present once a row has ever been created for them —
   * callers should default missing flavors to 0, not assume absence means
   * "never seen this flavor name"). */
  wallet: Record<string, number>;
  fragments_in_wallet: number;
}

export interface FeedBabyResponse {
  baby_id: string;
  stage_index: number;
  stage_count: number;
  fully_grown: boolean;
  dormant_type: string | null;
  weaken_state: 'healthy' | 'weak' | 'deep_sleep';
  fed_current_stage: number;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Fetch the current student's own word-baby collection + wallet. */
export async function fetchMyWordBabies(
  studentId: number,
  token: string,
): Promise<MyWordBabiesResponse> {
  const res = await fetch(`${API_BASE}/api/learning/students/${studentId}/word-babies`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new ApiError(`fetchMyWordBabies failed: ${res.status}`, res.status);
  }
  return res.json();
}

/**
 * Feed a baby the student owns (greedy — consumes as many matching-flavor
 * fragments from the wallet as it can in one call, not just one fragment).
 *
 * Throws ApiError(404) if the student doesn't own this baby_id — the page
 * should never let this happen from its own feed button (it only renders
 * feed buttons for babies already present in `MyWordBabiesResponse.babies`),
 * but a defensive caller can still distinguish this via `error.status`.
 */
export async function feedWordBaby(
  studentId: number,
  babyId: string,
  token: string,
): Promise<FeedBabyResponse> {
  const res = await fetch(
    `${API_BASE}/api/learning/students/${studentId}/word-babies/${babyId}/feed`,
    { method: 'POST', headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new ApiError(`feedWordBaby failed: ${res.status}`, res.status);
  }
  return res.json();
}
