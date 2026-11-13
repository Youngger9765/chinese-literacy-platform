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
import { resolveActiveSteps } from '../../../config/stepConfig';

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

  // 手測踩到的（本機 session 29 → 30）：做兩關、看報告、回去做第三關，就被切成新
  // session，剛做的全部變「上次完成」。只做了一部分不能標 completed。
  it('a session with only some steps done this time stays in progress', async () => {
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: ['comprehension', 'spotlight'], session_steps_completed: ['spotlight'],
        step_data: {}, __meta: { carried_from: carried } } };
    renderPage();
    await screen.findByRole('progressbar');
    expect(handleSessionComplete).not.toHaveBeenCalled();
  });

  it('a session where every step was done this time is completed', async () => {
    const all = resolveActiveSteps(null).map((s) => s.id).filter((id) => id !== 'lesson-intro' && id !== 'report');
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: all, session_steps_completed: all, step_data: {} } };
    renderPage();
    await waitFor(() => expect(handleSessionComplete).toHaveBeenCalled());
  });

  it('every step done, but some only last time, is not this round finished', async () => {
    const all = resolveActiveSteps(null).map((s) => s.id).filter((id) => id !== 'lesson-intro' && id !== 'report');
    reportState = { loading: false, annotations: [], viewingPrevious: null,
      progress: { steps_completed: all, session_steps_completed: all.slice(1), step_data: {},
        __meta: { carried_from: { ...carried, steps_completed: [all[0]] } } } };
    renderPage();
    await screen.findByRole('progressbar');
    expect(handleSessionComplete).not.toHaveBeenCalled();
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
