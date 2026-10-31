/**
 * #3780 reading-babies phase 2：喝采島 HUD 的「文字寶寶」面板跟手機版工具列
 * 都要有一個「閱讀寶貝」入口連到 `/student/reading-babies`（取代 v1 的
 * 「我的寶貝」→ `/lab/word-babies`，見 game-design.md §5.3；替換 2026-10-31
 * 刪除的 ReadingIslandLab.wordBabiesEntryPoint.test.tsx /
 * .mobileWordBabiesEntryPoint.test.tsx）。
 *
 * 這支鎖：① 桌機/平板的「文字寶寶」面板跟手機版工具列裡都有一個「閱讀
 * 寶貝」按鈕（不是裝飾性死連結）② 點下去 navigate('/student/reading-babies')
 * ③ 不再出現任何「我的寶貝」字樣或 /lab/word-babies 路徑。
 *
 * jsdom 不會真的套用 CSS media query（兩顆按鈕在 jsdom 裡都會被渲染出
 * 來，只是靠 class name 決定哪個斷點顯示），所以這支測試驗的是「結構
 * 正確」，真正的「哪個寬度看得到哪顆」用真瀏覽器截圖驗證（G7 審查）。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/lesson-intro' }));
// #3780 reading-babies phase 2「進化分級回饋」(ReadingIslandLab.stageEvolution.test.tsx
// 才是真正測這個行為的檔案)：這支測試不關心寶貝進化，但 refreshProgress 現在
// 一定會呼叫 fetchReadingBabyCard 建立 stage 基準——不 mock 掉會打到真實網路
// （jsdom 沒有網路，會 hang/reject，拖慢或弄壞這支測試跟它完全無關的斷言）。
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: () => Promise.reject(new Error('not mocked in this test file')),
}));

const { createIslandWorld } = vi.hoisted(() => ({
  createIslandWorld: vi.fn((host: HTMLElement) => {
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

function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}
function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}

async function enterIsland() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalled());

  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy()); // 按鈕畫出來才換假時鐘（CI 忙時這拍會晚到）
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

describe('ReadingIslandLab — 文字寶寶面板有「閱讀寶貝」入口連到 /student/reading-babies', () => {
  it('面板裡有「閱讀寶貝」按鈕，不再是「我的寶貝」', async () => {
    await enterIsland();

    const panel = document.querySelector('[aria-label="文字寶寶"]');
    expect(panel).toBeTruthy();
    const entryButton = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent?.includes('閱讀寶貝'));
    expect(entryButton).toBeTruthy();
    expect(Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent?.includes('我的寶貝'))).toBeFalsy();

    vi.useRealTimers();
  });

  it('點擊「閱讀寶貝」會導到 /student/reading-babies，不是舊的 /lab/word-babies', async () => {
    await enterIsland();

    const panel = document.querySelector('[aria-label="文字寶寶"]')!;
    const entryButton = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent?.includes('閱讀寶貝'))!;
    act(() => { fireEvent.click(entryButton); });

    expect(navigate).toHaveBeenCalledWith('/student/reading-babies');

    vi.useRealTimers();
  });
});

describe('ReadingIslandLab — 工具列裡的手機版「閱讀寶貝」入口（768px 以下用）', () => {
  it('工具列（清單模式/聲音旁邊）有一顆「閱讀寶貝」按鈕，帶 md:hidden（只在手機寬度顯示）', async () => {
    await enterIsland();

    const toolbar = document.querySelector('[aria-label="工具列"]');
    expect(toolbar, '工具列容器應該存在').toBeTruthy();
    const entryButton = Array.from(toolbar!.querySelectorAll('button')).find((b) => b.textContent === '閱讀寶貝');
    expect(entryButton, '工具列裡應該有一顆「閱讀寶貝」按鈕').toBeTruthy();
    expect(entryButton!.className).toContain('md:hidden');

    vi.useRealTimers();
  });

  it('點擊工具列裡的「閱讀寶貝」會導到 /student/reading-babies', async () => {
    await enterIsland();

    const toolbar = document.querySelector('[aria-label="工具列"]')!;
    const entryButton = Array.from(toolbar.querySelectorAll('button')).find((b) => b.textContent === '閱讀寶貝')!;
    act(() => { fireEvent.click(entryButton); });

    expect(navigate).toHaveBeenCalledWith('/student/reading-babies');

    vi.useRealTimers();
  });

  it('「文字寶寶」面板的入口斷點是 md:flex（768px），不是 lg:flex（1024px）——這是關掉 iPad 落差的那一行', async () => {
    await enterIsland();

    const panel = document.querySelector('[aria-label="文字寶寶"]');
    expect(panel, '文字寶寶面板應該存在').toBeTruthy();
    expect(panel!.className).toContain('md:flex');
    expect(panel!.className).not.toContain('lg:flex');

    vi.useRealTimers();
  });
});
