/**
 * #3780 P0-4（playtest 回饋，2026-10-26）：開發者除錯用的字漏到學生畫面
 * ——關卡頂列寫「{站名}・平台原本的關卡」、右下角一整行「位置 -3,15・
 * 迷霧 未散」。學生看不懂這兩個東西是什麼，純粹是開發時留下的除錯輔助，
 * 要拿掉。
 *
 * 這支測試鎖兩件事：① 進關卡後頂列只有站名，沒有「平台原本的關卡」這幾個
 * 字 ② 主畫面（含關卡內／外）任何時候都不會出現「位置 -3」這類座標除錯字。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useParams: () => ({ storyId: '20011' }), useNavigate: () => vi.fn() }));
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

describe('ReadingIslandLab — 不漏開發者除錯字給學生看（P0-4）', () => {
  it('走完開場、模擬移動、進關卡——全程不出現「位置」座標除錯字或「平台原本的關卡」', async () => {
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

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

    // 模擬玩家移動（舊版的右下角除錯行會顯示 onMove 回報的座標）。
    act(() => { worldConfigs[0].onMove(7, -12); });
    expect(document.body.textContent).not.toMatch(/位置\s*-?\d/);
    expect(document.body.textContent).not.toMatch(/迷霧\s*(未散|正散開)/);

    // 走到第一站、進去——頂列只該有站名。
    act(() => { worldConfigs[0].onArrive(0); });
    const enterBtn = byText('進入');
    expect(enterBtn).toBeTruthy();
    act(() => { fireEvent.click(enterBtn!); });
    act(() => { vi.advanceTimersByTime(1700); }); // 門開、iframe 出現

    expect(document.body.textContent).not.toContain('平台原本的關卡');
    expect(document.body.textContent).not.toMatch(/位置\s*-?\d/);

    vi.useRealTimers();
  });
});
