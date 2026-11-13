/**
 * #4028 — 打開報告頁不能把「這次什麼都沒做」的自學 session 標成 completed。
 *
 * 以前 ReportPage 一掛載就呼叫 handleSessionComplete（→ PATCH status=completed），
 * 0/10 關也一樣（staging session 1529 實測）。下次再進這一課就一定開新 session、
 * 再把上次的勾整份帶過來（#2889），打勾就這樣一直累積。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleSessionComplete = vi.fn();
const ctx = {
  selectedStory: { id: '20011', title: '測試課', stepSequence: null, content: [] },
  session: null,
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
vi.mock('../../../services/gamificationApi', () => ({ reportSessionComplete: vi.fn(async () => ({ xp_earned: 0 })) }));

let reportState: Record<string, unknown>;
vi.mock('../../../components/report/useReportProgress', () => ({ useReportProgress: () => reportState }));

import ReportPage from '../ReportPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/learn/20011/report']}>
      <Routes>
        <Route path="/learn/:storyId/report" element={<ReportPage />} />
      </Routes>
    </MemoryRouter>,
  );

const carried = { session_id: 9, at: '2026-11-10T03:00:00Z', steps_completed: ['comprehension'] };

describe('ReportPage marks a self-practice session completed only when something was done (#4028)', () => {
  beforeEach(() => {
    handleSessionComplete.mockReset();
    ctx.hasActiveAssignment = false;
    ctx.isAssignmentReadyForSubmit = false;
  });

  it('a fresh session with nothing done stays in progress', async () => {
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: ['report'], session_steps_completed: ['report'], step_data: {} } };
    renderPage();
    await screen.findByText(/這次完成 0 \//);
    expect(handleSessionComplete).not.toHaveBeenCalled();
  });

  it('a reopened lesson showing the previous attempt stays in progress', async () => {
    reportState = { loading: false, annotations: [], viewingPrevious: { sessionId: 9, at: carried.at },
      progress: { steps_completed: ['comprehension'], step_data: {} } };
    renderPage();
    await screen.findByText(/最近一次的學習成果/);
    expect(handleSessionComplete).not.toHaveBeenCalled();
  });

  it('waits for the DB progress before deciding', async () => {
    reportState = { loading: true, annotations: null, viewingPrevious: null, progress: null };
    renderPage();
    await screen.findByText('載入學習成果…');
    expect(handleSessionComplete).not.toHaveBeenCalled();
  });

  it('a session where a step was completed this time is completed', async () => {
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: ['comprehension', 'spotlight'], session_steps_completed: ['spotlight'],
        step_data: {}, __meta: { carried_from: carried } } };
    renderPage();
    await waitFor(() => expect(handleSessionComplete).toHaveBeenCalled());
  });

  it('assignment flow is unchanged: completes once ready even with nothing new this session', async () => {
    ctx.hasActiveAssignment = true;
    ctx.isAssignmentReadyForSubmit = true;
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: ['report'], session_steps_completed: ['report'], step_data: {} } };
    renderPage();
    await waitFor(() => expect(handleSessionComplete).toHaveBeenCalled());
  });
});
