/**
 * #3780 接島上（team-lead 2026-10-26）：喝采島 HUD 的「文字寶寶」面板要有
 * 一個「我的寶貝」入口連到真正的文字寶貝養成頁 `/lab/word-babies` ——
 * 目標是讓玩家從島上能實際走到餵食/圖鑑頁，而不是只在島上看裝飾性的字詞
 * 寶寶小圖示。
 *
 * 這支鎖：①「文字寶寶」面板裡有一個「我的寶貝」按鈕 ② 點下去會
 * navigate('/lab/word-babies')，不是裝飾性的死連結。
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
  loadStepProgress: vi.fn(),
}));
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/lesson-intro' }));

const { createIslandWorld, worldConfigs } = vi.hoisted(() => ({
  worldConfigs: [] as Array<{ onMove: (x: number, z: number) => void; onArrive: (index: number) => void }>,
  createIslandWorld: vi.fn((host: HTMLElement, config: { onMove: (x: number, z: number) => void; onArrive: (index: number) => void }) => {
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

function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}
function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}

async function enterIsland() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

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

describe('ReadingIslandLab — 文字寶寶面板有「我的寶貝」入口連到 /lab/word-babies', () => {
  it('面板裡有「我的寶貝」按鈕', async () => {
    await enterIsland();

    const panel = document.querySelector('[aria-label="文字寶寶"]');
    expect(panel).toBeTruthy();
    const entryButton = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent?.includes('我的寶貝'));
    expect(entryButton).toBeTruthy();

    vi.useRealTimers();
  });

  it('點擊「我的寶貝」會導到 /lab/word-babies，不是裝飾性死連結', async () => {
    await enterIsland();

    const panel = document.querySelector('[aria-label="文字寶寶"]')!;
    const entryButton = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent?.includes('我的寶貝'))!;
    act(() => { fireEvent.click(entryButton); });

    expect(navigate).toHaveBeenCalledWith('/lab/word-babies');

    vi.useRealTimers();
  });
});
