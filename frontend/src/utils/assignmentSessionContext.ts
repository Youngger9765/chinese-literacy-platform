/**
 * assignmentSessionContext.ts
 *
 * Centralizes all sessionStorage key names and serialisation logic for the
 * LearningLayout ↔ MyAssignments session contract.
 *
 * ⚠️  COORDINATION NOTE (#1878 / #1881):
 * This file is the single source of truth for sessionStorage keys.
 * LearningLayout.tsx reads these keys directly — any rename here MUST be
 * reflected there.  The shape is intentionally minimal so both sides can
 * import the constants without circular deps.
 */

import type { ReadingGoals } from '../services/assignmentApi';

// ---------------------------------------------------------------------------
// Key names (share with LearningLayout)
// ---------------------------------------------------------------------------

/** The active assignment ID so LearningLayout can auto-submit on completion. */
export const SESSION_KEY_ACTIVE_ASSIGNMENT_ID = 'activeAssignmentId';

/** Serialised ReadingGoals so AssessmentReport can show goal comparison. */
export const SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS = 'activeAssignmentGoals';

/** Compound context blob (assignmentId + userId + storyKey + startedAt). */
export const SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT = 'activeAssignmentContext';

/** Prefix for the DB session-id lookup: `<PREFIX><assignmentId>-<storyKey>`. */
export const SESSION_KEY_DB_SESSION_PREFIX = 'assignment-db-session-';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the sessionStorage key that maps an (assignmentId, storyKey) pair
 * to a backend DB session_id.
 */
export function dbSessionKey(assignmentId: number, storyKey: string | number): string {
  return `${SESSION_KEY_DB_SESSION_PREFIX}${assignmentId}-${storyKey}`;
}

/** ReadingGoals subset stored in sessionStorage. */
export interface AssignmentGoalsPayload {
  target_cpm: number | null;
  target_accuracy: number | null;
  difficulty_label: string | null;
  effective_cpm: number;
  effective_accuracy: number;
}

/**
 * Write all sessionStorage entries required by LearningLayout for a given
 * assignment.  Call this before navigating to /learn/<storyKey>/<step>.
 *
 * @param assignmentId  - numeric assignment PK
 * @param storyKey      - story_id (string) or text_id (number)
 * @param userId        - current user id (null if anonymous)
 * @param goals         - reading-goal payload from the API response
 * @param sessionId     - optional backend session_id; omit when not yet known
 */
export function writeAssignmentSessionContext(params: {
  assignmentId: number;
  storyKey: string | number;
  userId: string | null;
  goals: AssignmentGoalsPayload;
  sessionId?: number | null;
}): void {
  const { assignmentId, storyKey, userId, goals, sessionId } = params;
  const key = String(storyKey);

  // 1. Simple scalar — LearningLayout picks this up to auto-submit.
  sessionStorage.setItem(SESSION_KEY_ACTIVE_ASSIGNMENT_ID, String(assignmentId));

  // 2. Goals blob — AssessmentReport reads this for goal comparison.
  sessionStorage.setItem(
    SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS,
    JSON.stringify({
      target_cpm: goals.target_cpm,
      target_accuracy: goals.target_accuracy,
      difficulty_label: goals.difficulty_label,
      effective_cpm: goals.effective_cpm,
      effective_accuracy: goals.effective_accuracy,
    } satisfies AssignmentGoalsPayload),
  );

  // 3. Compound context blob.
  try {
    sessionStorage.setItem(
      SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT,
      JSON.stringify({
        assignmentId,
        userId,
        storyKey: key,
        startedAt: Date.now(),
      }),
    );
  } catch {
    // QuotaExceededError — non-fatal; LearningLayout has a fallback.
  }

  // 4. DB session linkage.
  if (sessionId != null) {
    try {
      sessionStorage.setItem(dbSessionKey(assignmentId, key), String(sessionId));
      // Remove legacy ambiguous keys so LearningLayout doesn't pick up stale data.
      sessionStorage.removeItem(`${SESSION_KEY_DB_SESSION_PREFIX}${key}`);
      sessionStorage.removeItem(`db-session-${key}`);
    } catch {
      // non-fatal
    }
  }
}
