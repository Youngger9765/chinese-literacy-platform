/**
 * TDD tests for 我的群島頁 (#3780 D3, PRD §5.7/§6)。
 *
 * 鎖住的驗收條件：
 * - 只打 fetchStories／getStudentProgress／fetchMyWordBabies 各一次（不逐課打 API）
 * - 完全沒碰過的課顯示「尚未探索」
 * - 已佔領的課顯示「已佔領」
 * - 探索中的課顯示「探索中 x/y 站」，x/y 來自伺服器欄位
 * - 文字寶貝數顯示在頁面上方，點擊導去 /lab/word-babies
 * - 年級篩選、課名搜尋都能正確縮小清單
 * - 點一座島導去 /lab/island/:storyId
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const user = { id: 7, roles: [{ role_name: 'student' }] };
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user }),
}));

const fetchStoriesMock = vi.fn();
vi.mock('../../../services/api', () => ({
  fetchStories: (...args: unknown[]) => fetchStoriesMock(...args),
}));

const getStudentProgressMock = vi.fn();
vi.mock('../../../services/progressApi', () => ({
  getStudentProgress: (...args: unknown[]) => getStudentProgressMock(...args),
}));

const fetchMyWordBabiesMock = vi.fn();
vi.mock('../../../services/wordBabyApi', () => ({
  fetchMyWordBabies: (...args: unknown[]) => fetchMyWordBabiesMock(...args),
}));

import StudentArchipelagoPage from '../StudentArchipelagoPage';

const STORIES_RES = {
  stories: [
    { id: '20011', title: '贏得喝采的輸家', level: '4', content: [], thumbnail: '', category: 'Fable', filename: '', grade: '4', genre: '記敘文' },
    { id: '20082', title: '從〈螞蟻與蟋蟀〉看生命的多樣性', level: '4', content: [], thumbnail: '', category: 'Fable', filename: '', grade: '4', genre: '說明文' },
    { id: '20200', title: '某篇文言文故事', level: '文言文', content: [], thumbnail: '', category: 'History', filename: '', grade: '文言文', genre: '文言文' },
  ],
  total: 3,
  grades: ['4', '文言文'],
};

const PROGRESS_RES = {
  student_id: 7,
  texts_attempted: 2,
  texts_completed: 1,
  average_score: null,
  texts: [
    {
      story_slug: '20011', story_title: '贏得喝采的輸家', latest_session_id: 1, status: 'completed',
      steps: [], completion_pct: 100, overall_score: null, accuracy: null, started_at: 'x', completed_at: null,
      next_step: { action: 'new_text', step: null, reason: '' },
      steps_completed: [], has_session: true, is_occupied: true, stations_done: 9, stations_total: 9,
    },
    {
      story_slug: '20082', story_title: '從〈螞蟻與蟋蟀〉看生命的多樣性', latest_session_id: 2, status: 'in_progress',
      steps: [], completion_pct: 40, overall_score: null, accuracy: null, started_at: 'x', completed_at: null,
      next_step: { action: 'continue', step: null, reason: '' },
      steps_completed: [], has_session: true, is_occupied: false, stations_done: 4, stations_total: 10,
    },
  ],
};

const BABIES_RES = { babies: [], babies_owned_count: 3, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0 };

describe('StudentArchipelagoPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    fetchStoriesMock.mockReset().mockResolvedValue(STORIES_RES);
    getStudentProgressMock.mockReset().mockResolvedValue(PROGRESS_RES);
    fetchMyWordBabiesMock.mockReset().mockResolvedValue(BABIES_RES);
  });

  it('只打三支 API 各一次（不逐課打）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    expect(fetchStoriesMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledWith('tok', 7);
    expect(fetchMyWordBabiesMock).toHaveBeenCalledTimes(1);
  });

  it('已佔領的課顯示「已佔領」，探索中的課顯示「探索中 x/y 站」，沒碰過的課顯示「尚未探索」', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    expect(screen.getByText('已佔領')).toBeTruthy();
    expect(screen.getByText('探索中 4/10 站')).toBeTruthy();
    expect(screen.getByText('尚未探索')).toBeTruthy();
  });

  it('頁面上方顯示文字寶貝數，點擊導去 /lab/word-babies', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText(/文字寶貝 3\/100 隻/)).toBeTruthy());

    act(() => { fireEvent.click(screen.getByText(/文字寶貝 3\/100 隻/)); });
    expect(navigate).toHaveBeenCalledWith('/lab/word-babies');
  });

  it('年級篩選只留該年級的島', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    act(() => { fireEvent.click(screen.getByRole('button', { name: '文言文' })); });

    expect(screen.queryByText('贏得喝采的輸家')).toBeNull();
    expect(screen.getByText('某篇文言文故事')).toBeTruthy();
  });

  it('搜尋課名只留符合的島', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    act(() => { fireEvent.change(screen.getByPlaceholderText('搜尋課名…'), { target: { value: '螞蟻' } }); });

    expect(screen.queryByText('贏得喝采的輸家')).toBeNull();
    expect(screen.getByText('從〈螞蟻與蟋蟀〉看生命的多樣性')).toBeTruthy();
  });

  it('搜尋沒有任何課符合時顯示提示文字，不是空白或錯誤', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    act(() => { fireEvent.change(screen.getByPlaceholderText('搜尋課名…'), { target: { value: '不存在的關鍵字xyz' } }); });

    expect(screen.getByText('找不到符合的課，換個關鍵字或年級看看')).toBeTruthy();
  });

  it('點一座島會導去 /lab/island/:storyId', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    act(() => { fireEvent.click(screen.getByText('贏得喝采的輸家')); });
    expect(navigate).toHaveBeenCalledWith('/lab/island/20011');
  });

  it('API 失敗時顯示錯誤訊息，不是白屏', async () => {
    fetchStoriesMock.mockRejectedValue(new Error('network down'));
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText(/載入群島資料失敗/)).toBeTruthy());
  });

  /**
   * PRD §6（D1／D3 前端，§5.7）：「Given /api/stories?page_size=300 回來，
   * Then 斷言回傳 stories.length === total」（code review 2026-10-28 要求補上）。
   */
  it('stories.length 跟 total 不相等時 console.error 一則警告，但畫面照樣正常渲染（不是白屏）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchStoriesMock.mockResolvedValue({ ...STORIES_RES, total: 999 });
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('999'));
    errorSpy.mockRestore();
  });

  it('stories.length 跟 total 相等時完全不印 console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeTruthy());

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
