/**
 * 全島亮完的結尾慶祝（鐘聲＋光柱/粒子＋慶祝層）只能在「這次 session 裡
 * 親眼看著完成數字從沒滿變滿」時放一次——審查員 2026-10-26 二次審查抓到
 * 的真 bug：`prevDone` 每次掛載都從 0 開始，`refreshProgress()` 一回來
 * 若直接回報「全部完成」，`doneIndexes.length(10) > prevDone.current(0)`
 * 跟舊版的「掛載時已有進度」條件會一起成立，鐘聲跟光柱/粒子就會被誤判成
 * 「剛完成」又播一次。
 *
 * 這支測試鎖兩個方向：① 學生很快跳過開場（比進度查詢先結束）、進度查詢
 * 回來才發現早就全部做完 → 不重播（本檔重點，修的就是這個）② 9/10 進來、
 * 完成最後一站變 10/10 → 真的會觸發（正向對照——沒有這條，①單獨存在時，
 * 把 finale 整個焊死「永遠不觸發」也會通過①）。
 *
 * ⚠️ ①第一版寫法錯了：原本在點開場之前就先 `await` 讓 `loadStepProgress`
 * resolve，這樣 `doneIndexes` 在 `opening` 還是初始值 `0`（不是 `-1`）
 * 時就已經變成 10，命中的是效果最下面那行無條件的
 * `prevDone.current = doneIndexes.length`，根本沒進到任何一個分支——
 * 測試對把 bug 修復拿掉的 mutation 完全沒反應（mutation 驗證抓到的）。
 * 真正會誤觸發的時機是「`opening` 已經變 `-1`（開場結束）了，
 * `loadStepProgress` 才回來」——要用可以手動控制何時 resolve 的 Promise
 * （`deferred()`），先把開場走完，才讓進度查詢回來。
 *
 * ⚠️ 斷言不能直接寫「沒叫過 chime」——`finishOpening()`（開場旁白結束、
 * 鏡頭推近主角那一刻）本來就會呼叫一次 `cue('chime')`，跟結尾慶祝完全
 * 無關，兩支測試都會先產生這一次。要數 `chime` 被呼叫的**次數**：
 * 開場固定 1 次，結尾慶祝多觸發一次就是 2 次。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-router-dom', () => ({ useParams: () => ({ storyId: '20011' }), useNavigate: () => vi.fn() }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 1, roles: [{ role_name: 'student' }] } }),
}));
vi.mock('../../../services/api', () => ({
  fetchStory: () => Promise.resolve({
    title: '贏得喝采的輸家',
    // 跟 STOPS_20011 的 10 個 .step 一一對應，順序一致——`stepFor()` 用
    // `.split('#')[0]` 比對前綴，這裡不帶錨點一樣能比對成功。
    stepSequence: [
      'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'vocab-definition',
      'vocab-application', 'keypoints-table', 'comprehension', 'vocab-review',
      'knowledge-station', 'report',
    ],
    vocabulary: [],
  }),
}));
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/report' }));
// #3780 reading-babies phase 2「進化分級回饋」(ReadingIslandLab.stageEvolution.test.tsx
// 才是真正測這個行為的檔案)：這支測試不關心寶貝進化，但 refreshProgress 現在
// 一定會呼叫 fetchReadingBabyCard 建立 stage 基準——不 mock 掉會打到真實網路
// （jsdom 沒有網路，會 hang/reject，拖慢或弄壞這支測試跟它完全無關的斷言）。
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: () => Promise.reject(new Error('not mocked in this test file')),
}));

const ALL_STEPS = [
  'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'vocab-definition',
  'vocab-application', 'keypoints-table', 'comprehension', 'vocab-review',
  'knowledge-station', 'report',
];

const { fetchLearningSessions, loadStepProgress } = vi.hoisted(() => ({
  fetchLearningSessions: vi.fn(),
  loadStepProgress: vi.fn(),
}));
vi.mock('../../../services/learningApi', () => ({ fetchLearningSessions, loadStepProgress }));

const { createIslandWorld, worldConfigs } = vi.hoisted(() => ({
  worldConfigs: [] as Array<{ onArrive: (index: number) => void }>,
  createIslandWorld: vi.fn((host: HTMLElement, config: { onArrive: (index: number) => void }) => {
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

const { mockAudio } = vi.hoisted(() => ({
  mockAudio: { start: vi.fn(), cue: vi.fn(), setMuted: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() },
}));
vi.mock('../island/islandAudio', () => ({
  createIslandAudio: () => mockAudio,
  readMuted: () => false,
  writeMuted: vi.fn(),
}));

import ReadingIslandLab from '../ReadingIslandLab';

function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}
function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}
function chimeCount(): number {
  return mockAudio.cue.mock.calls.filter((call) => call[0] === 'chime').length;
}

/** 可手動控制何時 resolve 的 Promise——用來重現「開場結束了，進度查詢才回來」的時序。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * 走完 20011 真實的冷開場 + 6 句旁白，回到主畫面（不進任何關卡）。
 *
 * ⚠️ `refreshProgress()`（掛載時呼叫 `loadStepProgress` 那個）要在切到
 * fake timers **之前**等它跑完——`waitFor` 內部靠 `setInterval` 輪詢，
 * fake timers 開了之後它自己的輪詢也會被凍住，變成真的卡死 5 秒逾時
 * （踩過一次）。切到 fake timers 之後要再等非同步結果，一律用
 * `vi.advanceTimersByTimeAsync`/`vi.runAllTimersAsync`，不要再用 `waitFor`。
 */
async function renderAndFinishOpening() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(loadStepProgress).toHaveBeenCalledTimes(1));
  // 讓 refreshProgress() 的 setCompleted 真正落地（這一步仍是 real timers）。
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy()); // 按鈕畫出來才換假時鐘（CI 忙時這拍會晚到）
  vi.useFakeTimers();
  const coldOpenBtn = byAriaLabel('點一下，進入喝采島');
  expect(coldOpenBtn).toBeTruthy();
  act(() => { fireEvent.click(coldOpenBtn!); });
  act(() => { vi.advanceTimersByTime(450); });

  for (let i = 0; i < 5; i++) {
    const cont = byText('繼續');
    expect(cont, `第 ${i + 1} 句應該有「繼續」`).toBeTruthy();
    act(() => { fireEvent.click(cont!); });
  }
  const landBtn = byText('直接上岸走');
  expect(landBtn).toBeTruthy();
  act(() => { fireEvent.click(landBtn!); });
  act(() => { vi.advanceTimersByTime(3600); });
}

describe('ReadingIslandLab — 結尾慶祝只在「這次 session 剛完成」時觸發，不重播', () => {
  beforeEach(() => {
    worldConfigs.length = 0;
    mockAudio.cue.mockClear();
    fetchLearningSessions.mockReset();
    loadStepProgress.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('學生比進度查詢更快跳過開場，進度查詢回來才發現早就全部做完——不觸發鐘聲/慶祝層', async () => {
    fetchLearningSessions.mockResolvedValue({ items: [{ id: 1, story_slug: '20011' }], total: 1 });
    const progress = deferred<{ step_progress: { steps_completed: string[] } }>();
    loadStepProgress.mockReturnValue(progress.promise); // 先不 resolve，模擬還在查詢中

    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy()); // 按鈕畫出來才換假時鐘（CI 忙時這拍會晚到）
    vi.useFakeTimers();
    const coldOpenBtn = byAriaLabel('點一下，進入喝采島');
    expect(coldOpenBtn).toBeTruthy();
    act(() => { fireEvent.click(coldOpenBtn!); });
    act(() => { vi.advanceTimersByTime(450); });
    for (let i = 0; i < 5; i++) {
      const cont = byText('繼續');
      expect(cont, `第 ${i + 1} 句應該有「繼續」`).toBeTruthy();
      act(() => { fireEvent.click(cont!); });
    }
    const landBtn = byText('直接上岸走');
    expect(landBtn).toBeTruthy();
    act(() => { fireEvent.click(landBtn!); }); // finishOpening() → opening 變 -1，這裡已經叫過一次 chime
    act(() => { vi.advanceTimersByTime(3600); });

    expect(chimeCount()).toBe(1); // 進度還沒回來，目前只有開場結束那一次

    // 開場已經結束（opening < 0）了，進度查詢現在才回來，回報全部做完——
    // 這正是審查員描述的時序：`prevDone.current` 還是初始值 0。
    await act(async () => {
      progress.resolve({ step_progress: { steps_completed: ALL_STEPS } });
      await vi.runAllTimersAsync();
    });

    expect(chimeCount()).toBe(1); // 不該多觸發結尾慶祝——這是本來就完成，不是剛完成
    expect(byText('回遊戲區')).toBeFalsy();
  });

  it('正向對照：9/10 進來，完成最後一站（report）變 10/10 → 真的會觸發鐘聲與慶祝層', async () => {
    const nineDone = ALL_STEPS.filter((s) => s !== 'report');
    fetchLearningSessions.mockResolvedValue({ items: [{ id: 1, story_slug: '20011' }], total: 1 });
    loadStepProgress
      .mockResolvedValueOnce({ step_progress: { steps_completed: nineDone } })
      .mockResolvedValueOnce({ step_progress: { steps_completed: ALL_STEPS } });

    await renderAndFinishOpening();

    // 還沒完成最後一站：不該觸發。
    expect(chimeCount()).toBe(1); // 只有開場結束那一次，沒有多觸發結尾慶祝

    // 走到最後一站（index 9 = report / 星空瞭望台）、進去、回到島上——
    // `returnToIsland()` 會再呼叫一次 `refreshProgress()`，這次回報全部完成。
    act(() => { worldConfigs[0].onArrive(9); });
    const enterBtn = byText('進入');
    expect(enterBtn).toBeTruthy();
    act(() => { fireEvent.click(enterBtn!); });
    act(() => { vi.advanceTimersByTime(1700); }); // 門開、iframe 出現

    const backBtn = byText('回到島上');
    expect(backBtn).toBeTruthy();
    // fake timers 生效中：用 runAllTimersAsync 同時推進計時器與微任務佇列，
    // 讓 fetchLearningSessions→loadStepProgress→setCompleted 這串 Promise
    // 鏈真的跑完，不要再用 waitFor（它自己的輪詢也會被 fake timers 凍住）。
    await act(async () => { fireEvent.click(backBtn!); await vi.runAllTimersAsync(); });

    expect(loadStepProgress).toHaveBeenCalledTimes(2);
    expect(chimeCount()).toBe(2); // 開場結束一次 + 結尾慶祝一次
    expect(byText('回遊戲區')).toBeTruthy();
  });
});
