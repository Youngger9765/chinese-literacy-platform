/**
 * #3780 reading-babies phase 2（取代 2026-10-31 刪除的
 * ReadingIslandLab.wordBabyRewardToast.test.tsx — v1 整套移除，見
 * game-design.md §5）：過關回島時，若這一站真的「做得好」（quality_passed
 * =true），顯示一行小提示「寶貝長大了一點！」。資料來自嵌在 iframe 裡的
 * 學習頁透過 notifyIslandReadingBabyGrowth 發出的獨立 postMessage
 * （READING_BABY_GROWTH，見 storyMode.ts 的說明——故意跟 ISLAND_STEP_DONE
 * 分開，因為成長資料來自 PUT /progress 的非同步回應，時間點跟「做完這一
 * 關、回到島上」的同步訊號天生不對齊）。
 *
 * 這支鎖：①收到 READING_BABY_GROWTH 訊息時畫面上會出現提示文字 ②
 * quality_passed=false／空陣列不會冒出任何提示 ③跟其他站無關的雜訊訊息
 * （其他 postMessage 流量）不會讓畫面冒出東西 ④ 排重：同一站不會因為回島
 * 兩次、或學習頁已經先顯示過，而跳兩次。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useParams: () => ({ storyId: '20011' }), useNavigate: () => navigate }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 1, roles: [{ role_name: 'student' }] } }),
}));
vi.mock('../../../services/api', () => ({
  fetchStory: () => Promise.resolve({
    title: '贏得喝采的輸家',
    stepSequence: ['lesson-intro', 'full-text-annotate', 'key-passage-reading'],
    vocabulary: [],
  }),
}));
vi.mock('../../../services/learningApi', () => ({
  fetchLearningSessions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  loadStepProgress: vi.fn().mockResolvedValue({ session_id: 1, step_progress: null }),
}));
import { fetchLearningSessions, loadStepProgress } from '../../../services/learningApi';
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/lesson-intro' }));
// #3780 reading-babies phase 2「進化分級回饋」(ReadingIslandLab.stageEvolution.test.tsx
// 才是真正測這個行為的檔案)：這支測試不關心寶貝進化，但 refreshProgress 現在
// 一定會呼叫 fetchReadingBabyCard 建立 stage 基準——不 mock 掉會打到真實網路
// （jsdom 沒有網路，會 hang/reject，拖慢或弄壞這支測試跟它完全無關的斷言）。
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: () => Promise.reject(new Error('not mocked in this test file')),
}));

const { createIslandWorld, worldConfigs } = vi.hoisted(() => ({
  worldConfigs: [] as Array<{ onArrive: (index: number) => void; onFogEdge: () => void }>,
  createIslandWorld: vi.fn((host: HTMLElement, config: { onArrive: (index: number) => void; onFogEdge: () => void }) => {
    worldConfigs.push(config);
    const fakeCanvas = document.createElement('canvas');
    host.appendChild(fakeCanvas);
    return {
      setProgress: vi.fn(), setMode: vi.fn(), setPaused: vi.fn(), setStick: vi.fn(),
      travelTo: vi.fn(), jump: vi.fn(), playIntro: vi.fn(),
      getPosition: vi.fn(() => ({ x: 0, z: 0 })),
      dispose: vi.fn(() => { host.removeChild(fakeCanvas); }),
    };
  }),
}));
vi.mock('../island/createIslandWorld', () => ({ createIslandWorld }));

vi.mock('../island/islandAudio', () => ({
  createIslandAudio: () => ({ start: vi.fn(), cue: vi.fn(), setMuted: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() }),
  readMuted: () => false,
  writeMuted: vi.fn(),
}));

import ReadingIslandLab from '../ReadingIslandLab';
import { markGrowthStationsSeen } from '../island/storyMode';

const GROWN = '寶貝長大了一點！';

function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}
function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}

async function enterIsland() {
  render(<ReadingIslandLab />);
  // toHaveBeenCalled (not ...Times(1)) — this file has multiple tests each
  // mounting their own ReadingIslandLab, and createIslandWorld's call count
  // is cumulative across `it()`s within one file.
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalled());
  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy());

  vi.useFakeTimers();
  const coldOpenBtn = byAriaLabel('點一下，進入喝采島');
  act(() => { fireEvent.click(coldOpenBtn!); });
  act(() => { vi.advanceTimersByTime(450); });

  for (let i = 0; i < 5; i++) {
    const cont = byText('繼續');
    if (!cont) break;
    act(() => { fireEvent.click(cont); });
  }
  const landBtn = byText('直接上岸走');
  act(() => { fireEvent.click(landBtn!); });
  act(() => { vi.advanceTimersByTime(3600); });
}

function postReadingBabyGrowth(events: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'reading-baby-growth', events },
    }));
  });
}

describe('ReadingIslandLab — 過關後「寶貝長大了」的小提示', () => {
  // v1 的同型測試用數字 id 當去重鍵（每筆全檔案唯一，天生不跨測試碰撞）；
  // 閱讀寶貝改用 `station` 字串（同一課的站名會跨測試重複，如
  // 'vocab-definition'），所以每個測試都要從乾淨的 sessionStorage 開始，
  // 否則前一個測試標記過的站會讓後一個測試誤判成「已經看過」。
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('收到 quality_passed=true 的成長事件時，畫面上出現「寶貝長大了一點！」', async () => {
    await enterIsland();

    postReadingBabyGrowth([
      { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
    ]);

    expect(document.body.textContent).toContain(GROWN);
    vi.useRealTimers();
  });

  it('quality_passed=false 的事件不會冒出提示', async () => {
    await enterIsland();

    postReadingBabyGrowth([
      { station: 'keypoints-table', ability_id: '5-Ⅱ-6', quality_passed: false },
    ]);

    expect(document.body.textContent).not.toContain(GROWN);
    vi.useRealTimers();
  });

  it('空陣列不會冒出任何提示', async () => {
    await enterIsland();

    postReadingBabyGrowth([]);

    expect(document.body.textContent).not.toContain(GROWN);
    vi.useRealTimers();
  });

  /**
   * 不依賴任何訊息時序：回島後島自己用 GET /progress（`refreshProgress`）
   * 把這一課目前的成長紀錄「拉」出來。這支鎖驗證最關鍵的情境：**iframe
   * 已經被 ISLAND_STEP_DONE 立刻拆掉、READING_BABY_GROWTH 這則訊息完全
   * 沒有送達**（模擬「PUT 真的很慢，學習頁早就不在了」），回到島上之後靠
   * `loadStepProgress` 的回應照樣顯示提示。
   */
  it('ISLAND_STEP_DONE 立刻拆 iframe（不延遲），即使成長訊息完全沒送達，回島後仍透過 GET 顯示提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['full-text-annotate'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'full-text-annotate', ability_id: '5-Ⅱ-4', quality_passed: true },
      ],
    });

    await enterIsland();
    // 掛載時第一次 refreshProgress（announceNewRewards=false）已經把這一站
    // 記成「看過了」——這代表的是「學生打開頁面時這筆成長早就存在」的情境，
    // 跟下面「本次回島才新出現」的情境不同，所以這支改用一個全新的站。
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['full-text-annotate', 'key-passage-reading'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'full-text-annotate', ability_id: '5-Ⅱ-4', quality_passed: true },
        { station: 'key-passage-reading', ability_id: '5-Ⅱ-1', quality_passed: true },
      ],
    });

    // 進入第一站：world 回報「靠近」→ 顯示「進入」按鈕 → 點擊開門
    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    const enterBtn = byText('進入');
    expect(enterBtn, '靠近站點後應該出現「進入」按鈕').toBeTruthy();
    act(() => { fireEvent.click(enterBtn!); });
    act(() => { vi.advanceTimersByTime(1700); }); // openModule 的開門時間
    expect(document.querySelector('iframe'), '開門後應該看得到學習頁 iframe').toBeTruthy();

    // 學習頁回報這一站做完——**完全沒有發 READING_BABY_GROWTH**，模擬 PUT
    // 還沒回來、iframe 就被摧毀的最糟情境。
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'key-passage-reading' },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('iframe'), 'ISLAND_STEP_DONE 應該立刻拆掉 iframe，不再延遲').toBeNull();
    expect(document.body.textContent).toContain(GROWN);

    vi.useRealTimers();
  });

  it('同一站的成長事件不會因為回島兩次就跳兩次提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'full-text-annotate', ability_id: '5-Ⅱ-4', quality_passed: true },
      ],
    });

    await enterIsland(); // 掛載的第一次 refreshProgress 把這一站記成「看過了」

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });

    // 清掉 sessionStorage 模擬「這是學生這次 session 第一次看到它」，回島
    // 一次 → 顯示；再回島一次（同一站）→ 不該再跳第二次。
    sessionStorage.clear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'full-text-annotate' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(document.body.textContent).toContain(GROWN);
    act(() => { vi.advanceTimersByTime(4000); }); // 提示 4 秒自動收掉
    expect(document.body.textContent).not.toContain(GROWN);

    // 再進站、再回島——同一站，這次不該再跳
    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'full-text-annotate' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain(GROWN);

    vi.useRealTimers();
  });

  it('掛載當下不會把過去已經存在的成長事件當成新的跳出來', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
      ],
    });

    await enterIsland();

    expect(document.body.textContent).not.toContain(GROWN);

    vi.useRealTimers();
  });

  /**
   * 同一次回島如果一次新增兩個站的成長事件，`firstReadingBabyGrowthHint`
   * 只會回傳一句（不堆疊），但 `refreshProgress` 把「這次新出現的全部站」
   * 一次標成已看過（不是只標被顯示的那一個）——驗證這個刻意的設計決定：
   * 兩站都記成已顯示，之後都不再跳。
   */
  it('同一次回島有 2 個新成長事件時，兩個都記成已顯示，之後都不再跳', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [],
    });

    await enterIsland(); // 掛載時還沒有任何成長事件——確保下面兩個都是「真的新」

    // 這次回島，GET 回來的已經是兩個站都存在（模擬同一次存檔完成了兩站）。
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition', 'key-passage-reading'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
        { station: 'key-passage-reading', ability_id: '5-Ⅱ-1', quality_passed: true },
      ],
    });

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'vocab-definition' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).toContain(GROWN);
    act(() => { vi.advanceTimersByTime(4000); }); // 提示自動收掉

    // 再進站、再回島——同樣兩個站還在 GET 回應裡，但兩個都已經在上一次
    // 回島時被標成看過了，這次都不該再跳。
    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(1); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'key-passage-reading' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain(GROWN);

    vi.useRealTimers();
  });

  /**
   * 這筆跟 `useStepProgressPersistence.readingBabyGrowth.test.ts` 裡對稱的
   * 那條合起來，才是完整的跨頁排重——那邊鎖的是「學習頁不會重複跳」，這邊
   * 鎖的是反過來：**學習頁已經先顯示過**（模擬 `onReadingBabyGrowth` 已經
   * 呼叫過 `markGrowthStationsSeen`）的站，回到島上之後這條
   * （`refreshProgress` GET 路徑）不會再跳第二次。兩邊呼叫的是同一組
   * `readSeenGrowthStations`／`markGrowthStationsSeen`（sessionStorage，
   * 同一分頁內同源 iframe 本來就共用），所以才鎖得住「跨學習頁和島嶼頁」。
   */
  it('學習頁已經當場顯示過這個成長事件（模擬即時回饋先跳了）→ 回島後 refreshProgress 不會再跳一次', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [],
    });

    await enterIsland(); // 掛載時還沒有任何成長事件

    // 模擬學習頁的即時回饋（useStepProgressPersistence 的 onReadingBabyGrowth）
    // 在這次存檔回來的當下就已經顯示過、並標記成已看過——用的是這個元件
    // 的 user id（1）跟 storyId（'20011'，見本檔開頭 useParams mock），跟
    // 真實情境下兩邊共用同一把 key 一致。
    markGrowthStationsSeen(1, '20011', ['vocab-definition']);

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
      ],
    });

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'vocab-definition' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain(GROWN);

    vi.useRealTimers();
  });

  /**
   * 成長提示跟既有「這裡還沒讀到」（迷霧提示）共用同一個畫面插槽，兩者
   * 觸發時機各自獨立，同時成立時會疊字看不清楚。優先序：成長提示贏——
   * 不管誰先到，畫面上只會看到成長那句。
   */
  it('成長提示跟迷霧提示（這裡還沒讀到）互斥，成長提示優先', async () => {
    // 這個檔案裡的 mock 不會在測試之間自動重置（vite.config.ts 沒設
    // clearMocks/restoreMocks）——明確重設回乾淨預設值，不依賴「剛好排在
    // 前面的測試留下什麼」，否則前一個測試留下的 reading_baby_events 會讓
    // 這裡掛載時就把 vocab-definition 標記成已看過。
    vi.mocked(fetchLearningSessions).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(loadStepProgress).mockResolvedValue({ session_id: 1, step_progress: null });

    await enterIsland();
    const world = worldConfigs[worldConfigs.length - 1]!;

    // 情境一：迷霧提示先出現，成長訊息後到——迷霧提示要讓位
    act(() => { world.onFogEdge(); });
    expect(document.body.textContent).toContain('這裡還沒讀到');
    postReadingBabyGrowth([
      { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
    ]);
    expect(document.body.textContent).not.toContain('這裡還沒讀到');
    expect(document.body.textContent).toContain(GROWN);

    // 情境二：成長提示還在倒數時，迷霧邊界又觸發——不該讓迷霧提示插進來
    act(() => { world.onFogEdge(); });
    expect(document.body.textContent).not.toContain('這裡還沒讀到');
    expect(document.body.textContent).toContain(GROWN);

    vi.useRealTimers();
  });

  it('不相關的 postMessage 流量（如 webpack-hmr）不會讓畫面冒出任何東西', async () => {
    await enterIsland();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'webpack-hmr' },
      }));
    });

    expect(document.body.textContent).not.toContain(GROWN);
    vi.useRealTimers();
  });
});
