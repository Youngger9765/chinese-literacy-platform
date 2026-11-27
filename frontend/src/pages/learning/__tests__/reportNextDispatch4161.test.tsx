/**
 * #4161 報告頁底部「再派一組」：做完一課一鍵再派 2 課，不含剛做完的這一課；作業流程不顯示
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = {
  selectedStory: { id: '20011', title: '測試課', stepSequence: null, content: [] },
  session: { readingAttempt: { accuracy: 90 } } as unknown,
  handleSessionComplete: vi.fn(),
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
vi.mock('../../../components/report/useReportProgress', () => ({
  useReportProgress: () => ({ loading: false, annotations: [], progress: { steps_completed: ['comprehension'], step_data: {} } }),
}));
const recApi = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../../services/progressApi', () => ({
  getStoryRecommendations: (...a: unknown[]) => recApi.fn(...a),
}));

import ReportPage from '../ReportPage';

const rec = (slug: string, title: string) => ({
  story_slug: slug, title, grade: 4, genre: '記敘文', difficulty_match_score: 90, reason: `推${title}的理由`,
});
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/learn/20011/report']}>
      <Routes><Route path="/learn/:storyId/report" element={<ReportPage />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  ctx.hasActiveAssignment = false;
  recApi.fn.mockResolvedValue({
    recommendations: [rec('20011', '剛做完的課'), rec('20012', '新課甲'), rec('20013', '新課乙'), rec('20014', '新課丙')],
    total: 4,
  });
});

describe('報告頁「再派一組」(#4161)', () => {
  it('底部有「再派一組」，按下去出現 2 張新的課，不含剛做完的這一課', async () => {
    renderPage();
    const section = await screen.findByTestId('report-next-dispatch');
    expect(recApi.fn).not.toHaveBeenCalled();
    fireEvent.click(section.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(screen.getAllByTestId('dispatch-card')).toHaveLength(2));
    const text = screen.getAllByTestId('dispatch-card').map((c) => c.textContent).join('|');
    expect(text).toContain('新課甲');
    expect(text).toContain('新課乙');
    expect(text).not.toContain('剛做完的課');
  });

  it('作業流程的報告頁不顯示（交件另有流程，不混進推薦）', async () => {
    ctx.hasActiveAssignment = true;
    ctx.isAssignmentReadyForSubmit = true; // 必做關卡做完才會畫出完整報告，這時也不能出現再派一組
    renderPage();
    // 頁面已畫出（有關卡完成進度）才斷言「沒有」，避免還沒畫就誤判沒有
    await screen.findByText(/完成 \d+ \/ \d+ 關/);
    expect(screen.queryByTestId('report-next-dispatch')).toBeNull();
  });
});
