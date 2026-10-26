/**
 * #3780 P0-1（playtest 回饋，2026-10-26）：iPad 走不動。820 寬的 iPad
 * 之前用螢幕寬度的 `md:` 斷點判斷「是不是手機」，被套到桌機版面——
 * 搖桿被 `md:hidden` 藏起來，畫面卻顯示「WASD 移動」（iPad 沒有鍵盤）。
 *
 * 這支測試鎖的是「依輸入方式（`isCoarsePointerDevice`），不是螢幕寬度」：
 * 不管 jsdom 回報的視窗寬度是多少，只要輸入方式判斷是觸控，就要看得到
 * 搖桿、看不到 WASD 提示，而且搖桿要真的推得動（`setStick` 真的被呼叫到
 * 非零值）；輸入方式判斷是滑鼠鍵盤，就反過來。
 */
import { act, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

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

const { createIslandWorld, worldConfigs } = vi.hoisted(() => ({
  worldConfigs: [] as Array<{ setStick: ReturnType<typeof vi.fn> }>,
  createIslandWorld: vi.fn((host: HTMLElement) => {
    const fakeCanvas = document.createElement('canvas');
    host.appendChild(fakeCanvas);
    const world = {
      setProgress: vi.fn(), setMode: vi.fn(), setPaused: vi.fn(), setStick: vi.fn(),
      travelTo: vi.fn(), jump: vi.fn(), playIntro: vi.fn(),
      getPosition: vi.fn(() => ({ x: 0, z: 0 })),
      dispose: vi.fn(() => { host.removeChild(fakeCanvas); }),
    };
    worldConfigs.push(world);
    return world;
  }),
}));
vi.mock('../island/createIslandWorld', () => ({ createIslandWorld }));

vi.mock('../island/islandAudio', () => ({
  createIslandAudio: () => ({ start: vi.fn(), cue: vi.fn(), setMuted: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() }),
  readMuted: () => false,
  writeMuted: vi.fn(),
}));

const { isCoarsePointerDeviceMock, isFinePointerDeviceMock } = vi.hoisted(() => ({
  isCoarsePointerDeviceMock: vi.fn(),
  isFinePointerDeviceMock: vi.fn(),
}));
vi.mock('../island/inputMode', () => ({
  isCoarsePointerDevice: isCoarsePointerDeviceMock,
  isFinePointerDevice: isFinePointerDeviceMock,
}));

import ReadingIslandLab from '../ReadingIslandLab';

function byAriaLabel(label: string) {
  return document.querySelector(`[aria-label="${label}"]`);
}

describe('ReadingIslandLab — iPad 等觸控裝置依輸入方式顯示搖桿，不依螢幕寬度（P0-1）', () => {
  afterEach(() => {
    isCoarsePointerDeviceMock.mockReset();
    isFinePointerDeviceMock.mockReset();
    createIslandWorld.mockClear();
    worldConfigs.length = 0;
  });

  it('純觸控（模擬 iPad，沒有滑鼠/觸控板）→ 看得到可操作的搖桿和跳躍鍵，看不到 WASD 提示', async () => {
    isCoarsePointerDeviceMock.mockReturnValue(true);
    isFinePointerDeviceMock.mockReturnValue(false);
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    const stick = byAriaLabel('虛擬搖桿');
    expect(stick, '觸控輸入下搖桿必須存在').toBeTruthy();
    expect(document.body.textContent).toContain('用搖桿走、拖曳轉頭');
    expect(document.body.textContent).not.toContain('WASD / 方向鍵移動');

    // 搖桿要真的推得動：模擬一次拖曳，確認 setStick 真的被呼叫到非零值
    // （不是只是「畫面上有個圓圈」而已）。
    act(() => {
      Object.defineProperty(stick!, 'setPointerCapture', { value: vi.fn(), configurable: true });
      stick!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
      stick!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 100, pointerId: 1 }));
    });
    const calls = worldConfigs[0].setStick.mock.calls;
    expect(calls.some(([x]: [number, number]) => x > 0), '往右拖曳後 setStick 應該收到非零的 x').toBe(true);
  });

  it('純滑鼠鍵盤（桌機）→ 看得到 WASD 提示，看不到搖桿', async () => {
    isCoarsePointerDeviceMock.mockReturnValue(false);
    isFinePointerDeviceMock.mockReturnValue(true);
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    expect(byAriaLabel('虛擬搖桿'), '滑鼠鍵盤輸入下不該有搖桿').toBeFalsy();
    expect(document.body.textContent).toContain('WASD / 方向鍵移動');
    expect(document.body.textContent).not.toContain('用搖桿走、拖曳轉頭');
  });

  it('混合裝置（觸控 Chromebook：螢幕觸控 + 接了觸控板/滑鼠）→ 搖桿和 WASD 提示都要出現，缺一個都算退件原因重現', async () => {
    isCoarsePointerDeviceMock.mockReturnValue(true);
    isFinePointerDeviceMock.mockReturnValue(true);
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    expect(byAriaLabel('虛擬搖桿'), '混合裝置下搖桿要在').toBeTruthy();
    expect(document.body.textContent).toContain('WASD / 方向鍵移動');
    expect(document.body.textContent).toContain('用搖桿走、拖曳轉頭');
  });
});
