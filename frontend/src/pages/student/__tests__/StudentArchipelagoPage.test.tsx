/**
 * StudentArchipelagoPage.test.tsx — #3780 群島模式
 * (docs/prd/2026-10-30-archipelago-clusters-prd.md).
 *
 * 這支測試鎖的是元件層的接線，不是分群/蜂巢座標數學（那些在
 * `archipelago/__tests__/archipelagoClusters.test.ts` 用真實 179 課資料
 * mutation-tested 過）：
 * - 只打 fetchStories／getStudentProgress／fetchMyWordBabies 各一次
 * - 已佔領／探索中／尚未探索三種狀態在右側站點清單正確顯示
 * - 點一座島 → 出現島卡 → 按「登島」→ 帶 `from=archipelago&group=&cluster=`
 *   導去 `/lab/island/:storyId`（PRD §3.4/§8-4）
 * - 文字寶貝數顯示、點擊導去 /lab/word-babies
 * - 搜尋課名能縮小站點清單
 * - 分群方式切換（依文體／依類別）會重新分群
 * - API 失敗時顯示錯誤訊息，不是白屏
 *
 * jsdom 沒有真的 WebGL，`createArchipelagoWorld` 在這個環境下必定回傳
 * `null`（`renderer.getContext()` 拿不到真的 context）——這正好讓元件走
 * PRD §6 的「WebGL 建不起來自動降級清單模式」那條路徑，省了額外 mock
 * three.js 的麻煩，也順便驗證了這條降級路徑本身沒有壞掉。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
// #3780 群島模式：元件新增 useSearchParams（網址 ?cluster= 記分群落點，
// PRD §5）——真正的 react-router-dom 需要 <Router> context 才能呼叫
// useSearchParams，測試沒包 Router 會直接炸掉，用一個最小假狀態就夠。
let fakeSearchParams = new URLSearchParams();
const setSearchParamsMock = vi.fn((updater: unknown) => {
  fakeSearchParams = typeof updater === 'function' ? updater(fakeSearchParams) : updater as URLSearchParams;
});
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [fakeSearchParams, setSearchParamsMock],
}));

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
      steps: [], completion_pct: 100, overall_score: null, accuracy: null, started_at: '2026-10-01T00:00:00Z', completed_at: null,
      next_step: { action: 'new_text', step: null, reason: '' },
      steps_completed: [], has_session: true, is_occupied: true, stations_done: 9, stations_total: 9,
    },
    {
      story_slug: '20082', story_title: '從〈螞蟻與蟋蟀〉看生命的多樣性', latest_session_id: 2, status: 'in_progress',
      steps: [], completion_pct: 40, overall_score: null, accuracy: null, started_at: '2026-10-29T00:00:00Z', completed_at: null,
      next_step: { action: 'continue', step: null, reason: '' },
      steps_completed: [], has_session: true, is_occupied: false, stations_done: 4, stations_total: 10,
    },
  ],
};

const BABIES_RES = { babies: [], babies_owned_count: 3, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0 };

describe('StudentArchipelagoPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    fakeSearchParams = new URLSearchParams();
    setSearchParamsMock.mockReset();
    fetchStoriesMock.mockReset().mockResolvedValue(STORIES_RES);
    getStudentProgressMock.mockReset().mockResolvedValue(PROGRESS_RES);
    fetchMyWordBabiesMock.mockReset().mockResolvedValue(BABIES_RES);
  });

  it('只打三支 API 各一次（不逐課打）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    expect(fetchStoriesMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledWith('tok', 7);
    expect(fetchMyWordBabiesMock).toHaveBeenCalledTimes(1);
  });

  it('預設落在最近學過那一課所在的群（20011/20082 都是 4 年級，兩課裡最近的是 20082）——右側清單顯示第 4 級群島的課，不是別群', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    expect(screen.getAllByText('第 4 級群島')[0]).toBeTruthy();
    expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy();
    // 文言文那課屬於另一群，預設落點不該把它也列出來
    expect(screen.queryAllByText('某篇文言文故事')[0] ?? null).toBeNull();
  });

  it('站點清單用 aria-label 標示每一課的狀態：已佔領／探索中 x/y／（文言文那課沒碰過，但它在別群，清單裡看不到）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    expect(screen.getAllByLabelText('贏得喝采的輸家（已佔領）')[0]).toBeTruthy();
    expect(screen.getAllByLabelText('從〈螞蟻與蟋蟀〉看生命的多樣性（探索中 4/10 站）')[0]).toBeTruthy();
  });

  it('切到「古文群島」能看到尚未探索的那一課', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => {
      fireEvent.change(screen.getAllByLabelText('群島導覽')[0], { target: { value: '文言文' } });
    });

    await waitFor(() => expect(screen.getAllByText('某篇文言文故事')[0]).toBeTruthy());
    expect(screen.getAllByLabelText('某篇文言文故事（尚未探索）')[0]).toBeTruthy();
  });

  it('頁面上顯示文字寶貝數，點擊導去 /lab/word-babies', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText(/文字寶貝 3\/100 隻/)[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByText(/文字寶貝 3\/100 隻/)[0]); });
    expect(navigate).toHaveBeenCalledWith('/lab/word-babies');
  });

  it('搜尋課名只留符合的課在清單裡', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.change(screen.getAllByPlaceholderText('搜尋課名…')[0], { target: { value: '螞蟻' } }); });

    expect(screen.queryAllByText('贏得喝采的輸家')[0] ?? null).toBeNull();
    expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy();
  });

  it('搜尋沒有任何課符合時顯示提示文字，不是空白或錯誤', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.change(screen.getAllByPlaceholderText('搜尋課名…')[0], { target: { value: '不存在的關鍵字xyz' } }); });

    expect(screen.getAllByText('找不到符合的課')[0]).toBeTruthy();
  });

  it('點一座島出現島卡，按「登島」導去 /lab/island/:storyId 並帶上 from/group/cluster（PRD §3.4/§8-4）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByLabelText('贏得喝采的輸家（已佔領）')[0]); });
    await waitFor(() => expect(screen.getByRole('button', { name: '登島' })).toBeTruthy());

    act(() => { fireEvent.click(screen.getByRole('button', { name: '登島' })); });
    expect(navigate).toHaveBeenCalledWith('/lab/island/20011?from=archipelago&group=grade&cluster=4');
  });

  it('依文體分群：切換後清單依文體重新分組，同一課只出現在一群', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依文體' })[0]); });

    // 20011 是記敘文，20082 是說明文——切成文體分群後兩課不會同時出現在
    // 同一群的清單裡（落點邏輯會選其中一群顯示）。
    await waitFor(() => {
      const hasA = screen.queryAllByText('贏得喝采的輸家').length > 0;
      const hasB = screen.queryAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性').length > 0;
      expect(hasA && hasB).toBe(false);
    });
  });

  /**
   * code review 2026-10-30 blocker 2：`?group=` 原本從頭到尾沒被讀，寫死
   * 'grade'——帶著 `group=genre&cluster=說明文` 掛載（例如從單課島按
   * 「回群島」回來）會落在錯的群，因為用 grade 模式分群根本不會有一群
   * 的 key 等於「說明文」。
   */
  it('帶 ?group=genre&cluster=說明文 掛載時，落在文體分群底下的「說明文群島」', async () => {
    fakeSearchParams = new URLSearchParams('group=genre&cluster=%E8%AA%AA%E6%98%8E%E6%96%87');
    render(<StudentArchipelagoPage />);

    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());
    expect(screen.getAllByText('說明文群島')[0]).toBeTruthy();
    // 20011 是記敘文，不在「說明文」群裡——落點真的照 group=genre 解析，
    // 不是巧合落在年級群又剛好顯示了這兩課。
    expect(screen.queryAllByText('贏得喝采的輸家')[0] ?? null).toBeNull();
  });

  it('切換分群方式（依文體）後，網址的 group 參數要更新成 genre，重新整理不會跳回年級', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依文體' })[0]); });

    await waitFor(() => expect(fakeSearchParams.get('group')).toBe('genre'));
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
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('999'));
    errorSpy.mockRestore();
  });

  it('stories.length 跟 total 相等時完全不印 console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
