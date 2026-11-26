/**
 * 領 XP 不可以順便把自學 session 標成「已完成」。
 *
 * 報告頁打開就會呼叫 POST /gamification/session-complete 領 XP，而後端以前一律把
 * session 標成 completed，所以只做一關的自主練習在學習紀錄顯示「已完成」
 * （正式站 session 1531：紀錄寫已完成 11/11，報告卡片 1/10）。
 * 現在前端要把「整課是否做完」一起送上去（lessonFinished）。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleSessionComplete = vi.fn();
const ctx = {
  selectedStory: { id: '20011', title: '測試課', stepSequence: null, content: [] },
  session: { readingAttempt: { accuracy: 90 } } as unknown,
  handleSessionComplete,
  dbSessionId: 10,
  isAssignmentReadyForSubmit: false,
  missingAssignmentSteps: [],
  firstIncompleteStepPath: '',
  hasActiveAssignment: false,
  saveStepProgressPatch: vi.fn(),
  stepProgressData: null,
};
vi.mock('../../../layouts/LearningLayout', () => ({ useLearningContext: () => ctx }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, token: 'tok' }) }));
const reportSessionComplete = vi.fn(async () => ({ xp_earned: 0 }));
vi.mock('../../../services/gamificationApi', () => ({ reportSessionComplete: (...a: unknown[]) => (reportSessionComplete as unknown as (...x: unknown[]) => unknown)(...a) }));

let reportState: Record<string, unknown>;
vi.mock('../../../components/report/useReportProgress', () => ({ useReportProgress: () => reportState }));

import ReportPage from '../ReportPage';
import { resolveActiveSteps } from '../../../config/stepConfig';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/learn/20011/report']}>
      <Routes>
        <Route path="/learn/:storyId/report" element={<ReportPage />} />
      </Routes>
    </MemoryRouter>,
  );


describe('ReportPage 領 XP 時帶上「整課是否做完」', () => {
  beforeEach(() => {
    reportSessionComplete.mockClear();
    ctx.hasActiveAssignment = false;
    ctx.isAssignmentReadyForSubmit = false;
  });

  const lastOpts = () => (reportSessionComplete.mock.calls.at(-1) as unknown[])[3] as { lessonFinished?: boolean };

  it('只做了一關：照領 XP，但 lessonFinished=false（不標已完成）', async () => {
    reportState = { loading: false, annotations: [],
      progress: { steps_completed: ['comprehension'], step_data: {} } };
    renderPage();
    await waitFor(() => expect(reportSessionComplete).toHaveBeenCalled());
    expect(lastOpts().lessonFinished).toBe(false);
  });

  it('整課做完：lessonFinished=true', async () => {
    const all = resolveActiveSteps(null).map((s) => s.id).filter((id) => id !== 'lesson-intro' && id !== 'report');
    reportState = { loading: false, annotations: [], progress: { steps_completed: all, step_data: {} } };
    renderPage();
    await waitFor(() => expect(reportSessionComplete).toHaveBeenCalled());
    expect(lastOpts().lessonFinished).toBe(true);
  });

  it('DB 進度還沒讀完：先不送（不能拿空進度判斷成沒做完或做完）', async () => {
    reportState = { loading: true, annotations: null, progress: null };
    renderPage();
    await screen.findByText('載入學習成果…');
    expect(reportSessionComplete).not.toHaveBeenCalled();
  });

  it('作業流程：照舊視為已完成（交件條件另外把關）', async () => {
    ctx.hasActiveAssignment = true;
    ctx.isAssignmentReadyForSubmit = true;
    reportState = { loading: false, annotations: [],
      progress: { steps_completed: ['comprehension'], step_data: {} } };
    renderPage();
    await waitFor(() => expect(reportSessionComplete).toHaveBeenCalled());
    expect(lastOpts().lessonFinished).toBe(true);
  });
});
