/**
 * #3780 接島上（team-lead 2026-10-27 授權）：過關回島時，若這一站掉了碎片／
 * 遇到寶貝，顯示一行小提示。資料來自嵌在 iframe 裡的學習頁透過
 * notifyIslandWordBabyReward 發出的獨立 postMessage（WORD_BABY_REWARD，見
 * storyMode.ts 的說明——故意跟 ISLAND_STEP_DONE 分開，因為獎勵資料來自
 * PUT /progress 的非同步回應，時間點跟「做完這一關、回到島上」的同步訊號
 * 天生不對齊）。
 *
 * 這支鎖：①收到 WORD_BABY_REWARD 訊息時畫面上會出現對應的提示文字
 * ②只顯示「第一件值得講的事」，不是每個站都疊一行 ③跟其他站無關的雜訊
 * 訊息（其他 postMessage 流量）不會讓畫面冒出東西。
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
vi.mock('../wordBabies/wordBabyDomain', () => ({
  getCatalogEntry: (id: string) => (id === 'wb-003' ? { id: 'wb-003', name: '咕嚕龍' } : undefined),
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
import { markRewardIdsSeen } from '../island/storyMode';

function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}
function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}

async function enterIsland() {
  render(<ReadingIslandLab />);
  // toHaveBeenCalled (not ...Times(1)) — this file has 4 tests each mounting
  // their own ReadingIslandLab, and createIslandWorld's call count is
  // cumulative across `it()`s within one file (no clearMocks config in
  // vite.config.ts). This assertion only needs "mount finished creating the
  // 3D world", not "this is the first-ever call across the whole file".
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalled());
  // 世界建好不代表冷開場按鈕已經畫出來——CI 全套一起跑機器忙時，這一拍
  // 常常還沒到，直接點會 `Unable to fire a "click" event`。等按鈕本身出現
  // 再換假時鐘（換了之後 waitFor 的輪詢就不會動了）。
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

function postWordBabyReward(rewards: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'word-baby-reward', rewards },
    }));
  });
}

describe('ReadingIslandLab — 過關掉碎片/遇到寶貝的小提示', () => {
  // 任一測試中途斷言失敗時，確保不會把 fake timers 洩漏給下一個測試
  // （否則下一個測試的 waitFor 永遠等不到真實的 microtask 推進而逾時）。
  afterEach(() => { vi.useRealTimers(); });

  it('收到碎片獎勵訊息時，畫面上出現對應文字', async () => {
    await enterIsland();

    postWordBabyReward([
      { id: 1, station: 'vocab-definition', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'none', encounter_baby_id: null },
    ]);

    expect(document.body.textContent).toContain('你拾獲了一片「語文基礎」碎片！');
    vi.useRealTimers();
  });

  it('收到遇到新寶貝的訊息時，顯示寶貝名字而不是碎片文案', async () => {
    await enterIsland();

    postWordBabyReward([
      { id: 2, station: 'lesson-intro', fragment_awarded: false, fragment_flavor: null, encounter_result: 'caught', encounter_baby_id: 'wb-003' },
    ]);

    expect(document.body.textContent).toContain('你遇到了新朋友：咕嚕龍！');
    vi.useRealTimers();
  });

  it('空陣列（這次 save 什麼都沒發放）不會冒出任何提示', async () => {
    await enterIsland();

    postWordBabyReward([]);

    expect(document.body.textContent).not.toContain('你拾獲了');
    expect(document.body.textContent).not.toContain('你遇到了');
    vi.useRealTimers();
  });

  /**
   * team-lead 二次修正（2026-10-28）：原本試過「延後拆 iframe 等
   * postMessage」的寬限期做法（code-reviewer 2026-10-27 finding），但那是
   * 在猜網路速度——慢網路一樣會輸，而且每次回島都平白拖長。改成不依賴
   * 任何訊息時序：回島後島自己用 GET /progress（`refreshProgress`）把這一
   * 課目前的獎勵紀錄「拉」出來。這支鎖驗證最關鍵的情境：**iframe 已經被
   * ISLAND_STEP_DONE 立刻拆掉、WORD_BABY_REWARD 這則訊息完全沒有送達**
   * （模擬「PUT 真的很慢，學習頁早就不在了」），回到島上之後靠
   * `loadStepProgress` 的回應照樣顯示提示。
   */
  it('ISLAND_STEP_DONE 立刻拆 iframe（不延遲），即使獎勵訊息完全沒送達，回島後仍透過 GET 顯示提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['full-text-annotate'], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 7, station: 'full-text-annotate', fragment_awarded: true, fragment_flavor: '書寫紀錄', encounter_result: 'none', encounter_baby_id: null },
      ],
    });

    await enterIsland();
    // 掛載時第一次 refreshProgress（announceNewRewards=false）已經把 id 7
    // 記成「看過了」——這代表的是「學生打開頁面時這筆獎勵早就存在」的情境，
    // 跟下面「本次回島才新出現」的情境不同，所以這支改用一個全新的 id。
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['full-text-annotate'], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 8, station: 'full-text-annotate', fragment_awarded: true, fragment_flavor: '書寫紀錄', encounter_result: 'none', encounter_baby_id: null },
      ],
    });

    // 進入第一站：world 回報「靠近」→ 顯示「進入」按鈕 → 點擊開門
    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    const enterBtn = byText('進入');
    expect(enterBtn, '靠近站點後應該出現「進入」按鈕').toBeTruthy();
    act(() => { fireEvent.click(enterBtn!); });
    act(() => { vi.advanceTimersByTime(1700); }); // openModule 的開門時間
    expect(document.querySelector('iframe'), '開門後應該看得到學習頁 iframe').toBeTruthy();

    // 學習頁回報這一站做完——**完全沒有發 WORD_BABY_REWARD**，模擬 PUT
    // 還沒回來、iframe 就被摧毀的最糟情境。
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'full-text-annotate' },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('iframe'), 'ISLAND_STEP_DONE 應該立刻拆掉 iframe，不再延遲').toBeNull();
    expect(document.body.textContent).toContain('你拾獲了一片「書寫紀錄」碎片！');

    vi.useRealTimers();
  });

  it('同一筆獎勵不會因為回島兩次就跳兩次提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 9, station: 'full-text-annotate', fragment_awarded: true, fragment_flavor: '書寫紀錄', encounter_result: 'none', encounter_baby_id: null },
      ],
    });

    await enterIsland(); // 掛載的第一次 refreshProgress 把 id 9 記成「看過了」

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });

    // 第一次回島：id 9 之前被標過「看過」，所以這裡本來就不該跳（它不是
    // 新的）——改用情境更貼近真實的做法：先清掉 sessionStorage 模擬
    // 「這是學生這次 session 第一次看到它」，回島一次 → 顯示；再回島
    // 一次（同一筆 id）→ 不該再跳第二次。
    sessionStorage.clear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'full-text-annotate' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(document.body.textContent).toContain('你拾獲了一片「書寫紀錄」碎片！');
    act(() => { vi.advanceTimersByTime(4000); }); // 提示 4 秒自動收掉
    expect(document.body.textContent).not.toContain('你拾獲了一片「書寫紀錄」碎片！');

    // 再進站、再回島——同一筆 id 9，這次不該再跳
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
    expect(document.body.textContent).not.toContain('你拾獲了一片「書寫紀錄」碎片！');

    vi.useRealTimers();
  });

  it('掛載當下不會把過去已經存在的獎勵當成新的跳出來', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 10, station: 'vocab-definition', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'none', encounter_baby_id: null },
      ],
    });

    await enterIsland();

    expect(document.body.textContent).not.toContain('你拾獲了一片「語文基礎」碎片！');

    vi.useRealTimers();
  });

  /**
   * code-reviewer finding（第二輪 PASS 前要求補的測試，2026-10-28）：同一次
   * 回島如果一次新增兩筆獎勵，`firstWordBabyRewardHint` 只會回傳一句（team-
   * lead：「顯示一行小提示」，不堆疊），但 `refreshProgress` 把「這次新
   * 出現的全部 id」一次標成已看過（不是只標被顯示的那一筆）。驗證這個
   * 刻意的設計決定：兩筆都記成已顯示→第二筆之後也不會補顯示，不是漏掉
   * 它，是一開始就決定「沒被選中講的那筆這次不會再有機會」。
   */
  it('同一次回島有 2 筆新獎勵時，只顯示 1 筆（優先序較高的），兩筆都記成已顯示，之後都不再跳', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      word_baby_rewards: [],
    });

    await enterIsland(); // 掛載時還沒有任何獎勵——確保下面兩筆都是「真的新」

    // 這次回島，GET 回來的已經是兩筆都存在（模擬同一次存檔掉了兩個東西）。
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition', 'key-passage-reading'], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 20, station: 'vocab-definition', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'none', encounter_baby_id: null },
        { id: 21, station: 'key-passage-reading', fragment_awarded: false, fragment_flavor: null, encounter_result: 'caught', encounter_baby_id: 'wb-003' },
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

    // firstWordBabyRewardHint 選的是「陣列裡第一個講得出話的」，不是跨筆
    // 排序出「最值得慶祝的那個」（wordBabyRewardHintText 的 caught-over-
    // fragment 優先序只套用在單一筆同時有兩種結果時）——這裡兩筆獎勵對應
    // 的是 word_baby_rewards 陣列裡 vocab-definition 排第一，所以只看得到
    // 它的碎片訊息，看不到 key-passage-reading 那筆的「遇到新朋友」。
    expect(document.body.textContent).toContain('你拾獲了一片「語文基礎」碎片！');
    expect(document.body.textContent).not.toContain('你遇到了新朋友：咕嚕龍！');

    act(() => { vi.advanceTimersByTime(4000); }); // 提示自動收掉

    // 再進站、再回島——同樣兩筆 id（20、21）還在 GET 回應裡，但兩筆都已經
    // 在上一次回島時被標成看過了，這次都不該再跳。
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

    expect(document.body.textContent).not.toContain('你遇到了新朋友：咕嚕龍！');
    expect(document.body.textContent).not.toContain('你拾獲了一片「語文基礎」碎片！');

    vi.useRealTimers();
  });

  /**
   * #3794 二次訂正（code-reviewer 2026-10-30 finding，1af86d25 blocker）：
   * 這筆跟 `useStepProgressPersistence.wordBabyRewardToast.test.ts` 裡對稱
   * 的那條合起來，才是完整的跨頁排重——那邊鎖的是「學習頁不會重複跳」，
   * 這邊鎖的是反過來：**學習頁已經先顯示過**（#3794 即時回饋，模擬
   * `onWordBabyRewarded` 已經呼叫過 `markRewardIdsSeen`）的 id，回到島上
   * 之後這條（`refreshProgress` GET 路徑）不會再跳第二次。兩邊呼叫的是
   * 同一組 `readSeenRewardIds`／`markRewardIdsSeen`（sessionStorage，同一
   * 分頁內同源 iframe 本來就共用），所以才鎖得住「跨學習頁和島嶼頁」。
   */
  it('學習頁已經當場顯示過這筆獎勵（模擬 #3794 即時回饋先跳了）→ 回島後 refreshProgress 不會再跳一次', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({
      items: [{ id: 1, story_slug: '20011' } as never],
      total: 1,
    });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      word_baby_rewards: [],
    });

    await enterIsland(); // 掛載時還沒有任何獎勵

    // 模擬學習頁的即時回饋（useStepProgressPersistence 的 onWordBabyRewarded）
    // 在這筆存檔回來的當下就已經顯示過、並標記成已看過——用的是這個元件
    // 的 user id（1）跟 storyId（'20011'，見本檔開頭 useParams mock），跟
    // 真實情境下兩邊共用同一把 key 一致。
    markRewardIdsSeen(1, '20011', [30]);

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      word_baby_rewards: [
        { id: 30, station: 'vocab-definition', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'none', encounter_baby_id: null },
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

    expect(document.body.textContent).not.toContain('你拾獲了一片「語文基礎」碎片！');

    vi.useRealTimers();
  });

  /**
   * code-reviewer finding（2026-10-27）：獎勵提示跟既有「這裡還沒讀到」
   * （迷霧提示）共用同一個畫面插槽，兩者觸發時機各自獨立，同時成立時會
   * 疊字看不清楚。優先序：獎勵提示贏——不管誰先到，畫面上只會看到獎勵
   * 那句。
   */
  it('獎勵提示跟迷霧提示（這裡還沒讀到）互斥，獎勵優先', async () => {
    await enterIsland();
    const world = worldConfigs[worldConfigs.length - 1]!;

    // 情境一：迷霧提示先出現，獎勵訊息後到——迷霧提示要讓位
    act(() => { world.onFogEdge(); });
    expect(document.body.textContent).toContain('這裡還沒讀到');
    postWordBabyReward([
      { id: 4, station: 'vocab-definition', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'none', encounter_baby_id: null },
    ]);
    expect(document.body.textContent).not.toContain('這裡還沒讀到');
    expect(document.body.textContent).toContain('你拾獲了一片「語文基礎」碎片！');

    // 情境二：獎勵提示還在倒數時，迷霧邊界又觸發——不該讓迷霧提示插進來
    act(() => { world.onFogEdge(); });
    expect(document.body.textContent).not.toContain('這裡還沒讀到');
    expect(document.body.textContent).toContain('你拾獲了一片「語文基礎」碎片！');

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

    expect(document.body.textContent).not.toContain('你拾獲了');
    expect(document.body.textContent).not.toContain('你遇到了');
    vi.useRealTimers();
  });
});
