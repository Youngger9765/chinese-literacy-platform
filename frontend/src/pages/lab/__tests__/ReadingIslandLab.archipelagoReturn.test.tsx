/**
 * #3780 群島模式（docs/prd/2026-10-30-archipelago-clusters-prd.md §9）：
 * 「單課島加『回群島』，帶回原 group/cluster」。
 *
 * 從群島頁點島登島時會帶 `?from=archipelago&group=...&cluster=...`
 * （見 archipelago/StudentArchipelagoPage.tsx 的 `goToSingleIsland`）。這支鎖：
 * ① 帶著這三個查詢參數進頁時，工具列會多一顆「回群島」按鈕
 * ② 點下去會 navigate 回 `/student/archipelago?group=...&cluster=...`，
 *   帶的是「進頁時」的那個 group/cluster，不是寫死的值
 * ③ 沒有 `from=archipelago`（例如從遊戲區卡片直接進島）時，工具列不會多
 *   這顆按鈕——不影響既有入口
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

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

function byAriaLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
}
function byText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
}

async function enterIsland() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy());
  vi.useFakeTimers();
  act(() => { fireEvent.click(byAriaLabel('點一下，進入喝采島')!); });
  act(() => { vi.advanceTimersByTime(450); });
  for (let i = 0; i < 5; i++) {
    const cont = byText('繼續');
    if (!cont) break;
    act(() => { fireEvent.click(cont); });
  }
  act(() => { fireEvent.click(byText('直接上岸走')!); });
  act(() => { vi.advanceTimersByTime(3600); });
}

afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

describe('ReadingIslandLab — #3780 回群島入口', () => {
  it('帶 from=archipelago 進頁時，工具列有「回群島」按鈕，點下去帶回原 group/cluster', async () => {
    window.history.pushState({}, '', '/lab/island/20011?from=archipelago&group=genre&cluster=%E8%AA%AA%E6%98%8E%E6%96%87');
    await enterIsland();

    const backButton = byText('回群島');
    expect(backButton).toBeTruthy();

    act(() => { fireEvent.click(backButton!); });
    expect(navigate).toHaveBeenCalledWith('/student/archipelago?group=genre&cluster=%E8%AA%AA%E6%98%8E%E6%96%87');
  });

  it('沒有 from=archipelago（例如從遊戲區卡片直接進島）時，不會多出「回群島」按鈕', async () => {
    window.history.pushState({}, '', '/lab/island/20011');
    await enterIsland();

    expect(byText('回群島')).toBeUndefined();
  });
});
