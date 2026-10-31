/**
 * 進關卡要暫停環境音、回島要恢復（team-lead 2026-10-26 明令）：
 * 學生在關卡裡要專心讀課文，而「重點朗讀」那一關會用麥克風錄音，島上的海浪
 * 跟底墊和弦若還在播會被錄進去，影響朗讀評分。
 *
 * `islandAudio.test.ts` 已經單獨鎖住 `pause()`/`resume()` 本身的行為（淡出到 0、
 * suspend context、尊重目前的靜音狀態）。這支測試鎖的是「接線」那一層——
 * `ReadingIslandLab.tsx` 的 `openModule`/`returnToIsland` 真的有在對的時機呼叫
 * 這兩個方法，不是只有 islandAudio 本身會動但沒人接上去。
 *
 * 走的是 20011 真實的冷開場→6 句旁白→自由探索流程（不是繞過去直接戳
 * state），所以全程用 fake timers 控制 `enterIsland`/`finishOpening` 裡的
 * `setTimeout`。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-router-dom', () => ({ useParams: () => ({ storyId: '20011' }), useNavigate: () => vi.fn() }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 1, roles: [{ role_name: 'student' }] } }),
}));
// stepSequence 要跟 STOPS_20011 的 .step 對上，否則 stepFor() 找不到對應步驟，
// openModule() 會在 `if (!stepFor(index)) { setError(...); return; }` 提早結束
// ——踩過一次：空陣列讓這支測試表面上一路跑到底，實際上 pause() 從沒被叫到。
vi.mock('../../../services/api', () => ({
  fetchStory: () => Promise.resolve({
    title: '贏得喝采的輸家',
    stepSequence: ['lesson-intro', 'full-text-annotate', 'key-passage-reading'],
    vocabulary: [],
  }),
}));
vi.mock('../../../services/learningApi', () => ({
  fetchLearningSessions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  loadStepProgress: vi.fn(),
}));
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/lesson-intro' }));
// #3780 reading-babies phase 2「進化分級回饋」(ReadingIslandLab.stageEvolution.test.tsx
// 才是真正測這個行為的檔案)：這支測試不關心寶貝進化，但 refreshProgress 現在
// 一定會呼叫 fetchReadingBabyCard 建立 stage 基準——不 mock 掉會打到真實網路
// （jsdom 沒有網路，會 hang/reject，拖慢或弄壞這支測試跟它完全無關的斷言）。
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: () => Promise.reject(new Error('not mocked in this test file')),
}));

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

/** 走完 20011 真實的冷開場 + 6 句旁白，回傳「發現新去處」卡片的「進入」按鈕。 */
async function renderWalkThroughOpeningAndArrive() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy()); // 按鈕畫出來才換假時鐘（CI 忙時這拍會晚到）
  vi.useFakeTimers();

  const coldOpenBtn = byAriaLabel('點一下，進入喝采島');
  expect(coldOpenBtn).toBeTruthy();
  act(() => { fireEvent.click(coldOpenBtn!); });
  act(() => { vi.advanceTimersByTime(450); }); // enterIsland → setColdOpen(false)

  // 6 句旁白：前 5 句按「繼續」，最後一句按「直接上岸走」（不進任何關卡）
  for (let i = 0; i < 5; i++) {
    const cont = byText('繼續');
    expect(cont, `第 ${i + 1} 句應該有「繼續」`).toBeTruthy();
    act(() => { fireEvent.click(cont!); });
  }
  const landBtn = byText('直接上岸走');
  expect(landBtn).toBeTruthy();
  act(() => { fireEvent.click(landBtn!); }); // finishOpening() → setOpening(-1)，同步生效
  act(() => { vi.advanceTimersByTime(3600); }); // 讓 titleReveal 相關 timer 跑完，避免殘留

  act(() => { worldConfigs[0].onArrive(0); }); // 模擬走到第一站
  const enterBtn = byText('進入');
  expect(enterBtn).toBeTruthy();
  return enterBtn!;
}

describe('ReadingIslandLab — 進關卡暫停環境音，回島恢復', () => {
  beforeEach(() => {
    worldConfigs.length = 0;
    mockAudio.pause.mockClear();
    mockAudio.resume.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('openModule → 1700ms 後（iframe 真正出現時）呼叫 audio.pause()，不是一開門就暫停', async () => {
    const enterBtn = await renderWalkThroughOpeningAndArrive();

    act(() => { fireEvent.click(enterBtn); });
    // 門剛打開那一刻，還不該暫停（door 音效要先播完整段過場，不能被 suspend 悶掉）
    expect(mockAudio.pause).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1700); });
    expect(mockAudio.pause).toHaveBeenCalledTimes(1);
  });

  it('returnToIsland → 立刻呼叫 audio.resume()', async () => {
    const enterBtn = await renderWalkThroughOpeningAndArrive();

    act(() => { fireEvent.click(enterBtn); });
    act(() => { vi.advanceTimersByTime(1700); }); // 門開、iframe 出現、pause() 已呼叫
    expect(mockAudio.pause).toHaveBeenCalledTimes(1);

    const backBtn = byText('回到島上');
    expect(backBtn).toBeTruthy();

    act(() => { fireEvent.click(backBtn!); });
    expect(mockAudio.resume).toHaveBeenCalledTimes(1);
  });
});
