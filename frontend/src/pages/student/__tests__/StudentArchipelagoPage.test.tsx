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
 * 2026-10-31（#3780 後續，依 108 課綱學習能力三層分群）：預設分群方式從
 * 'grade' 改成 'performance'，`defaultClusterKey()` 仍然是「最近一次學習
 * 的那一課所在的群」——測試用的兩個真實 story id（20011/20082）在
 * `lessonCurriculum.json`（AI 草稿）底下的學習表現代碼不同（5-Ⅱ-8 vs
 * 5-Ⅳ-6），所以預設落點只會看到 20082，不會像舊版 grade 分群那樣兩課都在
 * 同一群。需要同時看到兩課、或驗證 grade 模式特有行為的測試，先點「依年級」
 * 切回舊分群方式再操作。
 *
 * `createArchipelagoWorld` 整支 mock 掉（見下面 `createArchipelagoWorldMock`），
 * 不靠「jsdom 沒有真的 WebGL所以會自然回傳 null」這個環境細節——那個假設
 * 曾經不成立過（這支檔案舊版的文件註解就是這樣寫的，但實測這幾支測試
 * 全程走的是 3D 模式分支，不是 WebGL 降級分支，代表某個環境組合下
 * `createArchipelagoWorld` 並沒有乖乖回傳 null）。明確 mock 掉才能：
 * ① 不管環境怎麼變都是決定性的 ② 真的攔到 `loadCluster()` 收到的參數，
 * 驗證 category 有沒有在送進 3D 世界前正規化（code review 2026-10-30
 * blocker 1 的回歸鎖——舊版只驗了 `normalizeCategory()` 這個純函式本身，
 * 從沒驗過 call site 真的呼叫了它）。WebGL 降級分支本身另外用
 * `createArchipelagoWorldMock.mockReturnValueOnce(null)` 測。
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

// code review 2026-10-30 blocker 1 的回歸鎖：jsdom 沒有真的 WebGL，
// `createArchipelagoWorld` 在上面那支「不 mock」的測試裡必定回傳 `null`，
// `loadCluster()` 永遠不會真的被呼叫——意思是「category 有沒有正規化」
// 這個事實從來沒有被任何測試真正驗到過，只驗過 `normalizeCategory()`
// 這個純函式本身對不對。這裡額外 mock 掉 `createArchipelagoWorld`，讓它
// 回傳一個假世界物件，才能真的攔到 `loadCluster()` 收到的參數，驗證
// call site 真的做了正規化，不是只驗了被呼叫的函式本身。
const loadClusterMock = vi.fn();
type MockWorldEvents = { onSelectIsland: (slug: string) => void; onSelectPortal: (key: string) => void; onHoverIsland?: (slug: string | null) => void };
const createArchipelagoWorldMock = vi.fn((_container?: unknown, _events?: MockWorldEvents, _theme?: unknown) => ({
  loadCluster: loadClusterMock,
  dispose: vi.fn(),
  focusOnIsland: vi.fn(),
}));
// 2026-10-31 八次訂正（team-lead headless 實測「滑到島上完全沒反應」）：
// 舊版這個 mock 完全丟掉呼叫端傳進來的參數（`() => createArchipelagoWorldMock()`），
// 連「頁面到底有沒有傳 `onHoverIsland`」這個事實都測不到——根因本來就是
// `StudentArchipelagoPage.tsx` 從沒傳過這個回呼，但舊版測試的 mock 寫法
// 讓這件事永遠不可能被任何測試抓到。改成讓真正的 `container`/`events`/
// `theme` 參數流進 spy，才測得到「有沒有傳」跟「傳的回呼呼叫後畫面有沒有
// 反應」。
vi.mock('../archipelago/createArchipelagoWorld', () => ({
  createArchipelagoWorld: (container: unknown, events: MockWorldEvents, theme: unknown) =>
    createArchipelagoWorldMock(container, events, theme),
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
    loadClusterMock.mockReset();
    createArchipelagoWorldMock.mockClear();
  });

  it('只打三支 API 各一次（不逐課打）', async () => {
    render(<StudentArchipelagoPage />);
    // 2026-10-31：預設分群方式是 performance，20082 一定在預設落點（最近
    // 一次學習紀錄），20011 不一定——用保證會出現的那一課當掛載完成訊號。
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    expect(fetchStoriesMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledTimes(1);
    expect(getStudentProgressMock).toHaveBeenCalledWith('tok', 7);
    expect(fetchMyWordBabiesMock).toHaveBeenCalledTimes(1);
  });

  it('預設落在最近學過那一課所在的群（2026-10-31：預設分群方式是學習表現，20082 最近一次學習，落在它的學習表現群）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    // 20082 的學習表現代碼是 5-Ⅳ-6（lessonCurriculum.json AI 草稿）。
    expect(screen.getAllByText('資訊蒐集與組織（5-Ⅳ-6）')[0]).toBeTruthy();
    // 20011 學習表現代碼是 5-Ⅱ-8，不同群，不該出現在預設落點清單裡。
    expect(screen.queryAllByText('贏得喝采的輸家')[0] ?? null).toBeNull();
    // 20200 查無課綱資料（不在 179 課真實清單裡），歸「其他」群，也不該出現。
    expect(screen.queryAllByText('某篇文言文故事')[0] ?? null).toBeNull();
  });

  it('依年級分群（切換選項）：預設落在最近學過那一課所在的群——20011/20082 都是 4 年級，兩課裡最近的是 20082，右側清單顯示第 4 級群島的課，不是別群', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依年級' })[0]); });

    await waitFor(() => expect(screen.getAllByText('第 4 級群島')[0]).toBeTruthy());
    expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy();
    expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy();
    // 文言文那課屬於另一群，不該把它也列出來
    expect(screen.queryAllByText('某篇文言文故事')[0] ?? null).toBeNull();
  });

  it('站點清單用 aria-label 標示每一課的狀態：已佔領／探索中 x/y（切到依年級，讓兩課同群才能一起看到）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());
    expect(screen.getAllByLabelText('從〈螞蟻與蟋蟀〉看生命的多樣性（探索中 4/10 站）')[0]).toBeTruthy();

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依年級' })[0]); });
    await waitFor(() => expect(screen.getAllByLabelText('贏得喝采的輸家（已佔領）')[0]).toBeTruthy());
  });

  it('切到「古文群島」能看到尚未探索的那一課（先切回依年級，古文群島是年級分群才有的群）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依年級' })[0]); });
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
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    // 切到依年級，讓 20011／20082 同群，搜尋才有「縮小清單」的意義可驗
    // （兩課的學習表現代碼不同群，預設分群下清單本來就只有 20082 一課）。
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依年級' })[0]); });
    await waitFor(() => expect(screen.getAllByText('贏得喝采的輸家')[0]).toBeTruthy());

    act(() => { fireEvent.change(screen.getAllByPlaceholderText('搜尋課名…')[0], { target: { value: '螞蟻' } }); });

    expect(screen.queryAllByText('贏得喝采的輸家')[0] ?? null).toBeNull();
    expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy();
  });

  it('搜尋沒有任何課符合時顯示提示文字，不是空白或錯誤', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    act(() => { fireEvent.change(screen.getAllByPlaceholderText('搜尋課名…')[0], { target: { value: '不存在的關鍵字xyz' } }); });

    expect(screen.getAllByText('找不到符合的課')[0]).toBeTruthy();
  });

  it('點一座島出現島卡，按「登島」導去 /lab/island/:storyId 並帶上 from/group/cluster（PRD §3.4/§8-4）', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    // 20011 的學習表現群跟預設落點不同，先切回依年級才能看到它。
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: '依年級' })[0]); });
    await waitFor(() => expect(screen.getAllByLabelText('贏得喝采的輸家（已佔領）')[0]).toBeTruthy());

    act(() => { fireEvent.click(screen.getAllByLabelText('贏得喝采的輸家（已佔領）')[0]); });
    await waitFor(() => expect(screen.getByRole('button', { name: '登島' })).toBeTruthy());

    act(() => { fireEvent.click(screen.getByRole('button', { name: '登島' })); });
    expect(navigate).toHaveBeenCalledWith('/lab/island/20011?from=archipelago&group=grade&cluster=4');
  });

  it('依文體分群：切換後清單依文體重新分組，同一課只出現在一群', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

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
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

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
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('999'));
    errorSpy.mockRestore();
  });

  it('stories.length 跟 total 相等時完全不印 console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  /**
   * code review 2026-10-30 blocker 1 的回歸鎖：直接攔 `loadCluster()`
   * 收到的參數，驗證 call site 真的把 `/api/stories` 的原始類別碼
   * （Fable/History）正規化成中文標籤（寓言故事/歷史人文）才送進 3D
   * 世界——不是只驗 `normalizeCategory()` 這個純函式本身對不對。
   */
  it('送進 3D 世界的 category 是正規化過的中文標籤，不是 /api/stories 的原始類別碼', async () => {
    render(<StudentArchipelagoPage />);
    await waitFor(() => expect(loadClusterMock).toHaveBeenCalled());

    const [worldIslands] = loadClusterMock.mock.calls[0];
    const categories = (worldIslands as Array<{ storySlug: string; category: string }>)
      .map((i: { storySlug: string; category: string }) => i.category);

    expect(categories).not.toContain('Fable');
    expect(categories).not.toContain('History');
    expect(categories.every((c) => ['自然科學', '寓言故事', '歷史人文', '生活', '其他'].includes(c))).toBe(true);
  });

  /**
   * team-lead 2026-10-31 八次訂正（headless 在預覽站實測：滑到四座島，
   * canvas 游標全程是 `auto`，查出根因是這個頁面從沒把 `onHoverIsland`
   * 傳給 `createArchipelagoWorld`，骨架那邊 `if (!events.onHoverIsland)
   * return` 直接把整段 hover 處理擋掉）——這支鎖在「頁面接線」這一層：
   * ① 真的有傳 `onHoverIsland`（不是 `undefined`，純函式測試測不到這個
   * 事實，因為純函式不知道呼叫端有沒有傳參數）② 呼叫它之後，側欄清單裡
   * 對應的那一項要出現 hover 高亮樣式（`ArchipelagoSidePanel` 的
   * `hoveredSlug` prop）——這是目前這個 mock 測不到 3D 畫面本身視覺回饋
   * （上浮/亮邊/名牌）的前提下，唯一同時可觀察、可斷言的頁面層級效果。
   */
  it('有傳 onHoverIsland 給 createArchipelagoWorld，呼叫後側欄對應站點出現 hover 高亮', async () => {
    render(<StudentArchipelagoPage />);
    // 2026-10-31：預設分群是學習表現，20082 保證在預設落點裡（20011 不在）。
    await waitFor(() => expect(screen.getAllByText('從〈螞蟻與蟋蟀〉看生命的多樣性')[0]).toBeTruthy());

    expect(createArchipelagoWorldMock).toHaveBeenCalled();
    const events = createArchipelagoWorldMock.mock.calls[0][1]!;
    expect(typeof events.onHoverIsland).toBe('function');

    const button = screen.getAllByLabelText('從〈螞蟻與蟋蟀〉看生命的多樣性（探索中 4/10 站）')[0];
    expect(button).not.toHaveClass('bg-accent/5'); // hover 前：沒有高亮

    act(() => { events.onHoverIsland!('20082'); });
    await waitFor(() => expect(button).toHaveClass('bg-accent/5'));

    act(() => { events.onHoverIsland!(null); });
    await waitFor(() => expect(button).not.toHaveClass('bg-accent/5'));
  });

  it('WebGL 建不起來（createArchipelagoWorld 回傳 null）時自動降級清單模式，不是白屏', async () => {
    createArchipelagoWorldMock.mockReturnValueOnce(null);
    render(<StudentArchipelagoPage />);

    await waitFor(() => expect(screen.getByText('這台裝置目前無法顯示 3D 地圖，已自動切換成清單模式')).toBeTruthy());
    // 降級分支用的是卡片清單（IslandCard），不是 3D 模式的站點清單 <ul>。
    expect(screen.queryByLabelText('群島 3D 地圖')).toBeNull();
  });
});
