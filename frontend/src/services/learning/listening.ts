import { API_BASE } from '../apiConfig';

// ---------------------------------------------------------------------------
// Listening comprehension (Issue #251)
// ---------------------------------------------------------------------------

export interface ListeningEvaluateResponse {
  score: number;
  key_points_covered: string[];
  key_points_missed: string[];
  feedback: string;
  encouragement: string;
}

export async function evaluateListeningRetelling(
  token: string,
  payload: {
    storyTitle: string;
    originalText: string;
    studentRetelling: string;
  },
): Promise<ListeningEvaluateResponse> {
  const res = await fetch(`${API_BASE}/api/learning/listening/evaluate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      original_text: payload.originalText,
      student_retelling: payload.studentRetelling,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(body.detail || `Listening evaluation failed: ${res.status}`);
  }
  return res.json();
}
