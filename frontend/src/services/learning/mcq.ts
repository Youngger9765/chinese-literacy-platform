import { SessionExpiredError } from '../api';
import { API_BASE } from '../apiConfig';

// ---------------------------------------------------------------------------
// MCQ Rescue AI tutor (Issue #1387)
// ---------------------------------------------------------------------------

export interface McqRescueStartPayload {
  question_id: string;
  lesson_id: string;
  wrong_choice: string;
  question_text: string;
  correct_answer: string;
  strategy_type?: string | null;
}

export interface McqRescueStartResponse {
  session_id: string;
  ai_first_message: string;
  current_step: number;
}

export interface McqRescueRespondPayload {
  session_id: string;
  student_text: string;
}

export interface McqRescueRespondResponse {
  current_step: number;
  should_advance: boolean;
  should_terminate: boolean;
  give_up_detected: boolean;
  ai_feedback: string;
  next_question: string;
  reasoning: string;
}

/**
 * Start (or resume) an MCQ rescue session.
 * Called when a student answers an MCQ incorrectly.
 *
 * Integrates with SessionExpiredError pattern — throws SessionExpiredError on 401.
 */
export async function mcqRescueStart(
  token: string,
  payload: McqRescueStartPayload,
): Promise<McqRescueStartResponse> {
  const res = await fetch(`${API_BASE}/api/learning/mcq-rescue/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new SessionExpiredError('Token expired');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `mcqRescueStart failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Send a student response in an active MCQ rescue session.
 *
 * Integrates with SessionExpiredError pattern — throws SessionExpiredError on 401.
 */
export async function mcqRescueRespond(
  token: string,
  payload: McqRescueRespondPayload,
): Promise<McqRescueRespondResponse> {
  const res = await fetch(`${API_BASE}/api/learning/mcq-rescue/respond`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new SessionExpiredError('Token expired');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `mcqRescueRespond failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// MCQ Attempt telemetry (Issue #1507)
// ---------------------------------------------------------------------------

export interface McqAttemptPayload {
  lesson_id: string;
  question_id: string;
  choice: string;
  is_correct: boolean;
}

/**
 * Log a single MCQ choice click. Fire-and-forget — callers should not block
 * UI on this. Errors are swallowed and console-warned so a flaky network
 * never breaks the quiz flow.
 */
export function recordMcqAttempt(
  token: string,
  payload: McqAttemptPayload,
): void {
  fetch(`${API_BASE}/api/learning/mcq-attempt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`recordMcqAttempt failed: ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn('recordMcqAttempt error:', err);
    });
}
