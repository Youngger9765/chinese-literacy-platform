import { API_BASE } from '../apiConfig';

// ---------------------------------------------------------------------------
// Sentence practice (Issue #109, #927)
// ---------------------------------------------------------------------------

export interface ExampleSentence {
  sentence: string;
  explanation: string;
}

export type ExampleSentenceSource = 'pregenerated' | 'ai';

export async function fetchExampleSentences(
  token: string,
  word: string,
  storyTitle: string,
): Promise<{ sentences: ExampleSentence[]; source: ExampleSentenceSource }> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/example-sentences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ word, story_title: storyTitle }),
  });
  if (!res.ok) throw new Error(`fetchExampleSentences failed: ${res.status}`);
  const data = await res.json();
  return { sentences: data.sentences as ExampleSentence[], source: (data.source ?? 'ai') as ExampleSentenceSource };
}

export async function validateSentence(
  token: string,
  word: string,
  studentSentence: string,
  storyTitle: string,
): Promise<{ is_correct: boolean; feedback: string; suggestion: string }> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ word, student_sentence: studentSentence, story_title: storyTitle }),
  });
  if (!res.ok) throw new Error(`validateSentence failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Reading-spotlight (閱讀聚光燈) free-text grading (Issue #2192 item 5)
// ---------------------------------------------------------------------------

export interface StrategyGradeResult {
  is_correct: boolean;
  feedback: string;
  suggestion: string;
}

/**
 * AI-grade a free_text guided step answer. Lenient (七八成對 → 正向回饋).
 * The backend fails closed (returns is_correct=true) on AI outage, so this
 * resolves with an encouraging result rather than blocking the student.
 */
export async function validateStrategyAnswer(
  token: string,
  payload: {
    question: string;
    studentAnswer: string;
    strategyName?: string | null;
    storyTitle?: string | null;
    passage?: string | null;
  },
): Promise<StrategyGradeResult> {
  const res = await fetch(`${API_BASE}/api/learning/strategy-practice/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question: payload.question,
      student_answer: payload.studentAnswer,
      strategy_name: payload.strategyName ?? null,
      story_title: payload.storyTitle ?? null,
      passage: payload.passage ?? null,
    }),
  });
  if (!res.ok) throw new Error(`validateStrategyAnswer failed: ${res.status}`);
  return res.json();
}
