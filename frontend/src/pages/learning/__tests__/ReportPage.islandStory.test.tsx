/**
 * 喝采島故事模式 — 報告頁不能給「前往這一關」的快速跳轉。
 *
 * 20011 的 zone 2（最後一區）同時有 comprehension／vocab-review／
 * knowledge-station／report 四站，解鎖順序只到「區」，同一區內站與站
 * 之間沒有強制順序——所以學生完全可能在還沒做完 vocab-review 時就先
 * 走進 report。這時報告頁本來就會列出「未完成」的卡片，而
 * StepReportCards 對未完成卡片會顯示「前往這一關」按鈕（見
 * StepReportCards.test.tsx），點了就會 `navigate(stepPath(...))`
 * 把 iframe 帶去別的 step —— 等於在故事模式裡繞過「一次一關」，
 * PRD §6「沒有…快速跳轉步驟」這條會被打破。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storyMode = { on: false };
vi.mock('../../lab/island/storyMode', () => ({
  isIslandStoryMode: () => storyMode.on,
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ storyId: '20011' }),
}));

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, token: 'tok' }) }));
vi.mock('../../../services/gamificationApi', () => ({ reportSessionComplete: vi.fn().mockResolvedValue({ xp_earned: 0 }) }));
vi.mock('../../../components/report/useReportProgress', () => ({
  useReportProgress: () => ({ loading: false, progress: { steps_completed: ['full-text-annotate'], step_data: {} }, annotations: null }),
}));
vi.mock('../../../config/stepConfig', () => ({
  resolveActiveSteps: () => [
    { id: 'full-text-annotate', label: '讀全文-做記號' },
    { id: 'vocab-review', label: '語詞複習' },
  ],
  resolveStepId: (id: string) => id,
}));

const learningContext = {
  isAssignmentReadyForSubmit: true,
  missingAssignmentSteps: [] as { id: string; label: string }[],
  firstIncompleteStepPath: 'vocab-review',
  hasActiveAssignment: false,
};
vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: () => ({
    selectedStory: { id: '20011', title: '贏得喝采的輸家', stepSequence: undefined, content: [] },
    session: null,
    handleSessionComplete: vi.fn(),
    dbSessionId: 1,
    saveStepProgressPatch: vi.fn(),
    stepProgressData: { step_data: {} },
    ...learningContext,
  }),
}));

import ReportPage from '../ReportPage';

describe('ReportPage in island story mode', () => {
  it('does not offer 前往這一關 on an unfinished step card (no escaping the island one-station-at-a-time rule)', () => {
    storyMode.on = true;
    render(<ReportPage />);
    fireEvent.click(screen.getByRole('button', { name: /語詞複習/ }));
    expect(screen.queryByRole('button', { name: '前往這一關' })).toBeNull();
  });

  it('positive control: outside the island, the jump button is still offered', () => {
    storyMode.on = false;
    render(<ReportPage />);
    fireEvent.click(screen.getByRole('button', { name: /語詞複習/ }));
    expect(screen.getByRole('button', { name: '前往這一關' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '前往這一關' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('vocab-review'));
  });
});

/**
 * zone 2 有多站、站與站之間沒有強制順序（createIslandWorld.ts 只檔 stop.zone >
 * unlockedZone），學生可能先進 report 站，而這一課又剛好是從「我的作業」用 SPA
 * 導航切過來（sessionStorage 的 activeAssignmentId 沒被整頁重載清掉）—— 這時
 * hasActiveAssignment=true 且還有未完成的必做步驟，ReportPage 會整頁換成
 * 「作業尚未完成」警示，裡面兩顆按鈕（繼續未完成關卡／返回班級作業）完全沒有
 * isIslandStoryMode() 守衛，一樣會把 iframe 導去別處。
 */
describe('ReportPage in island story mode — the assignment-incomplete branch', () => {
  beforeEach(() => {
    learningContext.hasActiveAssignment = true;
    learningContext.isAssignmentReadyForSubmit = false;
    learningContext.missingAssignmentSteps = [{ id: 'vocab-review', label: '語詞複習' }];
    navigate.mockClear();
  });

  it('does not show the 作業尚未完成 warning screen in story mode, falls through to the normal report', () => {
    storyMode.on = true;
    render(<ReportPage />);
    expect(screen.queryByText('作業尚未完成')).toBeNull();
    expect(screen.queryByRole('button', { name: '繼續未完成關卡' })).toBeNull();
    expect(screen.queryByRole('button', { name: '返回班級作業' })).toBeNull();
    // falls through to the normal card view instead
    expect(screen.getByText(/語詞複習/)).toBeTruthy();
  });

  it('positive control: outside the island, the assignment warning and its un-guarded navigates still work', () => {
    storyMode.on = false;
    render(<ReportPage />);
    expect(screen.getByText('作業尚未完成')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '繼續未完成關卡' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('vocab-review'));
    fireEvent.click(screen.getByRole('button', { name: '返回班級作業' }));
    expect(navigate).toHaveBeenCalledWith('/assignments');
  });
});
