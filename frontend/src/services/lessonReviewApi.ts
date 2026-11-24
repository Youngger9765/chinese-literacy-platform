/**
 * 學習批閱（#4104）API —— 老師批閱學生的一課成績單；學生只看得到「送出」的那一版。
 * 後端：backend/app/routes/teacher/teacher_lesson_review.py、
 *       backend/app/routes/learning/learning_reviews.py
 */
import { get, post, put } from './httpClient';
import type { StepProgressData } from './learningApi';

// ── 老師端 ────────────────────────────────────────────────────────────────

export interface ReviewStudentCard {
  student_id: number;
  name: string;
  seat_number: number | null;
  started_count: number;
  /** 有開始、但還沒送出過批閱的課。 */
  unreviewed_count: number;
  /** 退回了、學生還沒重做的關。 */
  returned_count: number;
  /** 退回後學生已重做、等老師看的關。 */
  redone_count: number;
}

export interface ReviewLessonRow {
  story_slug: string;
  title: string | null;
  session_id: number;
  steps_completed: number;
  last_activity_at: string | null;
  sent_at: string | null;
  total_score: number | null;
  returned_count: number;
  redone_count: number;
  has_draft: boolean;
}

export interface ReviewStepState {
  /** 退回了、學生還沒重做。 */
  returned: boolean;
  /** 退回後學生已經重做（含只訂正錯題）。 */
  redone: boolean;
  comment: string | null;
  score: number | null;
}

export interface SentReview {
  sent_at: string | null;
  total_score: number | null;
  teacher_name: string | null;
  steps: Record<string, ReviewStepState & { returned_at?: string | null }>;
}

export interface ReviewStepInput {
  step_key: string;
  returned: boolean;
  comment: string | null;
  score: number | null;
}

export interface ReviewInput {
  total_score: number | null;
  steps: ReviewStepInput[];
}

export interface ReviewDetail {
  student_id: number;
  student_name: string;
  story_slug: string;
  story_title: string | null;
  session_id: number | null;
  step_progress: StepProgressData | null;
  review: SentReview;
  draft: ReviewInput | null;
}

const base = (classroomId: number) => `/api/teacher/classrooms/${classroomId}/review/students`;

export const fetchReviewStudents = (classroomId: number) =>
  get<ReviewStudentCard[]>(base(classroomId));

export const fetchReviewLessons = (classroomId: number, studentId: number) =>
  get<ReviewLessonRow[]>(`${base(classroomId)}/${studentId}/lessons`);

const lessonPath = (classroomId: number, studentId: number, slug: string) =>
  `${base(classroomId)}/${studentId}/lessons/${encodeURIComponent(slug)}`;

export const fetchReviewDetail = (classroomId: number, studentId: number, slug: string) =>
  get<ReviewDetail>(lessonPath(classroomId, studentId, slug));

export const saveReviewDraft = (classroomId: number, studentId: number, slug: string, body: ReviewInput) =>
  put<ReviewDetail>(`${lessonPath(classroomId, studentId, slug)}/draft`, body);

export const sendReview = (classroomId: number, studentId: number, slug: string, body: ReviewInput) =>
  post<ReviewDetail>(`${lessonPath(classroomId, studentId, slug)}/send`, body);

// ── 學生端 ────────────────────────────────────────────────────────────────

export interface MyReviewSummary {
  total_score: number | null;
  returned_count: number;
  sent_at: string;
}

export interface MyReview {
  story_slug: string;
  sent_at: string | null;
  total_score: number | null;
  teacher_name: string | null;
  steps: Record<string, ReviewStepState>;
}

export const fetchMyReviews = () => get<Record<string, MyReviewSummary>>('/api/learning/reviews');

export const fetchMyReview = (storySlug: string) =>
  get<MyReview>(`/api/learning/reviews/${encodeURIComponent(storySlug)}`);
