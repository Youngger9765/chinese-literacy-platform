/**
 * 學習批閱（#4104）老師端的草稿狀態 —— 純函式，好測。
 */
import type { CardsReview } from '../../../components/report/StepReportCards';
import type { ReviewDetail, ReviewInput } from '../../../services/lessonReviewApi';

export interface StepDraft {
  returned: boolean;
  comment: string;
  /** 輸入框的字串；'' = 沒打分。 */
  score: string;
}

export interface ReviewDraft {
  total: string;
  steps: Record<string, StepDraft>;
}

export const EMPTY_STEP: StepDraft = { returned: false, comment: '', score: '' };

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

/**
 * 打開批閱畫面時的初始狀態：有沒送出的草稿就用草稿，否則用上次送出的內容。
 * 已經重做的退回不再勾著 —— 老師看過之後要再退，就再按一次（會是新的一次退回）。
 */
export function initialDraft(detail: ReviewDetail): ReviewDraft {
  if (detail.draft) {
    const steps: Record<string, StepDraft> = {};
    for (const s of detail.draft.steps) {
      steps[s.step_key] = { returned: s.returned, comment: s.comment ?? '', score: str(s.score) };
    }
    return { total: str(detail.draft.total_score), steps };
  }
  const steps: Record<string, StepDraft> = {};
  for (const [key, s] of Object.entries(detail.review.steps)) {
    steps[key] = { returned: s.returned, comment: s.comment ?? '', score: str(s.score) };
  }
  return { total: str(detail.review.total_score), steps };
}

/** 0–100 的整數；空白 = null；不合法 = undefined（擋送出）。 */
export function parseScore(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^\d{1,3}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : undefined;
}

export function invalidScores(d: ReviewDraft): string[] {
  const bad = Object.entries(d.steps)
    .filter(([, s]) => parseScore(s.score) === undefined)
    .map(([k]) => k);
  if (parseScore(d.total) === undefined) bad.push('__total');
  return bad;
}

export function toInput(d: ReviewDraft): ReviewInput {
  const steps = Object.entries(d.steps)
    .map(([step_key, s]) => ({
      step_key,
      returned: s.returned,
      comment: s.comment.trim() || null,
      score: parseScore(s.score) ?? null,
    }))
    .filter((s) => s.returned || s.comment !== null || s.score !== null);
  return { total_score: parseScore(d.total) ?? null, steps };
}

/** 給 StepReportCards 的預覽：學生按下送出後會看到的樣子。 */
export function previewOf(d: ReviewDraft, teacherName: string | null): CardsReview {
  const input = toInput(d);
  const steps: CardsReview['steps'] = {};
  for (const s of input.steps) steps[s.step_key] = { returned: s.returned, comment: s.comment, score: s.score };
  return { totalScore: input.total_score, teacherName, steps };
}

export function summaryOf(d: ReviewDraft, stepCount: number) {
  const input = toInput(d);
  const scores = input.steps.map((s) => s.score).filter((n): n is number => n != null);
  return {
    returned: input.steps.filter((s) => s.returned).length,
    comments: input.steps.filter((s) => s.comment).length,
    scored: scores.length,
    stepCount,
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    total: input.total_score,
  };
}

export function sameDraft(a: ReviewDraft, b: ReviewDraft): boolean {
  return JSON.stringify(toInput(a)) === JSON.stringify(toInput(b));
}
