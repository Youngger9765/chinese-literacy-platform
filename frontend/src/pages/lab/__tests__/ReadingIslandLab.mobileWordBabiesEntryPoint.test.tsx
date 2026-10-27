/**
 * #3780 手機/平板入口（team-lead 2026-10-28）：「文字寶寶」面板原本是
 * `lg:flex`（1024px+），跟這個檔案其餘所有響應式元素用的 `md:`（768px）
 * 二分法不一致——結果 768–1023px 之間（iPad 直向 820px 正好落在這段）
 * 兩邊都看不到入口：面板還沒出現（< lg），手機版工具列又已經收起（≥ md）。
 *
 * 修法：①「文字寶寶」面板斷點從 `lg:flex` 改成 `md:flex`，關掉 iPad 那段
 * 落差 ②工具列（清單模式/聲音）裡加一顆 `md:hidden` 的「我的寶貝」按鈕，
 * 給 768px 以下的手機用——兩個斷點合起來保證任何寬度都至少有一個入口。
 *
 * jsdom 不會真的套用 CSS media query（兩顆按鈕在 jsdom 裡都會被渲染出
 * 來，只是靠 class name 決定哪個斷點顯示），所以這支測試驗的是「結構
 * 正確」（存在、文字對、點擊會 navigate），真正的「哪個寬度看得到哪顆」
 * 用真瀏覽器截圖驗證過（819→1440 三種寬度各看到剛好一顆，見 G7 審查
 * 紀錄），不是這支單元測試的職責。
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

describe('ReadingIslandLab — 工具列裡的手機版「我的寶貝」入口（768px 以下用）', () => {
  it('工具列（清單模式/聲音旁邊）有一顆「我的寶貝」按鈕，帶 md:hidden（只在手機寬度顯示）', async () => {
    await enterIsland();

    const toolbar = document.querySelector('[aria-label="工具列"]');
    expect(toolbar, '工具列容器應該存在').toBeTruthy();
    const entryButton = Array.from(toolbar!.querySelectorAll('button')).find((b) => b.textContent === '我的寶貝');
    expect(entryButton, '工具列裡應該有一顆「我的寶貝」按鈕').toBeTruthy();
    expect(entryButton!.className).toContain('md:hidden');

    vi.useRealTimers();
  });

  it('點擊工具列裡的「我的寶貝」會導到 /lab/word-babies', async () => {
    await enterIsland();

    const toolbar = document.querySelector('[aria-label="工具列"]')!;
    const entryButton = Array.from(toolbar.querySelectorAll('button')).find((b) => b.textContent === '我的寶貝')!;
    act(() => { fireEvent.click(entryButton); });

    expect(navigate).toHaveBeenCalledWith('/lab/word-babies');

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
