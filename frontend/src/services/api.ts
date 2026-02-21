/**
 * API call layer — all backend communication goes through here.
 * Use fetch or axios to call the FastAPI backend at VITE_API_URL.
 *
 * Environment variable: VITE_API_URL (default: http://localhost:8000)
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export async function fetchStories() {
  const res = await fetch(`${API_BASE}/api/stories`);
  if (!res.ok) throw new Error(`fetchStories failed: ${res.status}`);
  return res.json();
}

export async function fetchStory(id: string) {
  const res = await fetch(`${API_BASE}/api/stories/${id}`);
  if (!res.ok) throw new Error(`fetchStory failed: ${res.status}`);
  return res.json();
}

export async function createLearningSession(payload: {
  studentId: string;
  storyId: string;
}) {
  const res = await fetch(`${API_BASE}/api/learning-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createLearningSession failed: ${res.status}`);
  return res.json();
}

export interface ConversationTurn {
  role: 'ai' | 'student';
  text: string;
}

export interface ComprehensionResponse {
  question: string;
  question_number: number;
}

export async function askComprehensionQuestion(payload: {
  storyTitle: string;
  storyText: string;
  conversation: ConversationTurn[];
}): Promise<ComprehensionResponse> {
  const res = await fetch(`${API_BASE}/api/comprehension/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      story_title: payload.storyTitle,
      story_text: payload.storyText,
      conversation: payload.conversation,
    }),
  });
  if (!res.ok) throw new Error(`askComprehensionQuestion failed: ${res.status}`);
  return res.json();
}
