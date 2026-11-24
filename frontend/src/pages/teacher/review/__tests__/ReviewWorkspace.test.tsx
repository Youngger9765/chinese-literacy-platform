/**
 * #4104 學習批閱 — 批閱畫面：退回 / 分數 / 評語 → 確認框 → 一次送出。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewDetail } from '../../../../services/lessonReviewApi';

const sendReview = vi.fn();
const saveReviewDraft = vi.fn();
let detail: ReviewDetail;

vi.mock('../../../../services/lessonReviewApi', () => ({
  fetchReviewDetail: vi.fn(() => Promise.resolve(detail)),
  sendReview: (...a: unknown[]) => sendReview(...a),
  saveReviewDraft: (...a: unknown[]) => saveReviewDraft(...a),
}));
vi.mock('../../../../services/api', () => ({
  fetchStory: vi.fn(() => Promise.reject(new Error('no story in test'))),
  storyForStep: () => undefined,
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: '李老師' } }) }));
vi.mock('../../../../config/stepConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../config/stepConfig')>();
  const all = actual.resolveActiveSteps(undefined);
  const pick = (id: string, suffix: string) => ({ ...all.find((s) => s.id === id)!, id: `${id}#${suffix}`, label: id === 'comprehension' ? '閱讀理解' : '閱讀聚光燈' });
  return { ...actual, resolveActiveSteps: () => [pick('comprehension', 'a'), pick('spotlight', 'b')] };
});

import ReviewWorkspace from '../ReviewWorkspace';

const base = (): ReviewDetail => ({
  student_id: 7,
  student_name: '小明',
  story_slug: '6',
  story_title: '贏得喝采的輸家',
  session_id: 1,
  step_progress: { current_step: null, steps_completed: ['comprehension#a'], step_data: {} },
  review: { sent_at: null, total_score: null, teacher_name: null, steps: {} },
  draft: null,
});

const renderIt = async () => {
  render(
    <ReviewWorkspace classroomId={3} studentId={7} storySlug="6" onBackToClass={vi.fn()} onBackToStudent={vi.fn()} />,
  );
  await screen.findByTestId('review-workspace');
};

beforeEach(() => {
  detail = base();
  sendReview.mockReset();
  saveReviewDraft.mockReset();
});

describe('ReviewWorkspace (#4104)', () => {
  it('return + score + comment, preview shows it, confirm, then sends everything in one call', async () => {
    await renderIt();
    const tools = screen.getAllByTestId('review-card-tools');
    fireEvent.click(within(tools[0]).getByTestId('toggle-return'));
    fireEvent.change(within(tools[0]).getByTestId('step-score'), { target: { value: '60' } });
    fireEvent.click(within(tools[0]).getByTestId('open-comment'));
    fireEvent.change(within(tools[0]).getByTestId('step-comment'), { target: { value: '再讀第二段' } });
    fireEvent.change(within(tools[1]).getByTestId('step-score'), { target: { value: '95' } });
    fireEvent.change(screen.getByTestId('total-score'), { target: { value: '88' } });

    // 預覽：學生會看到的紅色卡片與評語
    expect(screen.getByRole('button', { name: /閱讀理解：老師退回，要重做/ })).toBeInTheDocument();
    expect(screen.getByTestId('review-summary')).toHaveTextContent('退回 1 關・評語 1 則・已打分 2/2 關');

    fireEvent.click(screen.getByTestId('send-review'));
    const confirm = screen.getByTestId('review-confirm');
    expect(confirm).toHaveTextContent('退回 1 關：閱讀理解');
    expect(confirm).toHaveTextContent('88');

    sendReview.mockResolvedValue({
      ...detail,
      review: {
        sent_at: '2026-11-18T03:00:00Z', total_score: 88, teacher_name: '李老師',
        steps: { 'comprehension#a': { returned: true, redone: false, comment: '再讀第二段', score: 60 } },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-send'));
    });
    expect(sendReview).toHaveBeenCalledWith(3, 7, '6', {
      total_score: 88,
      steps: [
        { step_key: 'comprehension#a', returned: true, comment: '再讀第二段', score: 60 },
        { step_key: 'spotlight#b', returned: false, comment: null, score: 95 },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('review-notice')).toHaveTextContent('已送出'));
  });

  it('an invalid score blocks sending', async () => {
    await renderIt();
    fireEvent.change(screen.getByTestId('total-score'), { target: { value: '150' } });
    expect(screen.getByTestId('send-review')).toBeDisabled();
    expect(screen.getByTestId('review-notice')).toHaveTextContent('0 到 100');
  });

  it('a step the student redid after the return says so', async () => {
    detail = {
      ...base(),
      review: {
        sent_at: '2026-11-18T01:00:00Z', total_score: 70, teacher_name: '李老師',
        steps: { 'comprehension#a': { returned: false, redone: true, comment: '重做', score: 50 } },
      },
    };
    await renderIt();
    expect(screen.getByTestId('redone-note')).toBeInTheDocument();
    // 已重做的退回不再勾著
    expect(within(screen.getAllByTestId('review-card-tools')[0]).getByTestId('toggle-return')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
