/**
 * #3780 P0-3：回島先面向剛完成的站，停留期結束才轉向下一站——這段時序
 * 由 engine 的 `onCelebrate`/`onCelebrationEnd` 事件驅動（見
 * `createIslandWorld.ts` 的 `setProgress`），原本「doneIndexes 一變就立刻
 * 顯示下一站導引」的分支已經拿掉。這支測試鎖 `ReadingIslandLab.tsx` 收到
 * 這兩個事件時的反應：
 * ① `onCelebrate`：鏡頭正要轉過去面向剛完成站的那一刻——播 chime，不碰
 *    guide 文字（guide 是「下一站」導引，這時候都還不知道要不要顯示）。
 * ② `onCelebrationEnd` 帶有下一站：停留期結束，才顯示「下一站」導引文字
 *    （含站名、迷霧散開與否）、播 sparkle。
 * ③ `onCelebrationEnd` 的 nextStop 是 null（最後一站）：完全不處理——
 *    全螢幕結尾慶祝由另一條獨立的 effect 處理（見
 *    `ReadingIslandLab.finaleReplay.test.tsx`），這裡不能重複播 chime，
 *    否則兩邊加起來同一刻響兩次。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
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
// #3780 reading-babies phase 2「進化分級回饋」(ReadingIslandLab.stageEvolution.test.tsx
// 才是真正測這個行為的檔案)：這支測試不關心寶貝進化，但 refreshProgress 現在
// 一定會呼叫 fetchReadingBabyCard 建立 stage 基準——不 mock 掉會打到真實網路
// （jsdom 沒有網路，會 hang/reject，拖慢或弄壞這支測試跟它完全無關的斷言）。
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: () => Promise.reject(new Error('not mocked in this test file')),
}));

const { createIslandWorld, worldConfigs } = vi.hoisted(() => ({
  worldConfigs: [] as Array<{
    onCelebrate?: (index: number) => void;
    onCelebrationEnd?: (index: number, nextStop: number | null) => void;
  }>,
  createIslandWorld: vi.fn((host: HTMLElement, config: typeof worldConfigs[number]) => {
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

function cueNames(): string[] {
  return mockAudio.cue.mock.calls.map((call) => call[0]);
}

describe('ReadingIslandLab — onCelebrate / onCelebrationEnd 事件反應（P0-3）', () => {
  afterEach(() => {
    worldConfigs.length = 0;
    mockAudio.cue.mockClear();
    createIslandWorld.mockClear();
  });

  it('onCelebrate：播 chime，不觸發 guide 文字', async () => {
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    act(() => { worldConfigs[0].onCelebrate?.(0); });

    expect(cueNames()).toContain('chime');
    expect(document.body.textContent).not.toMatch(/跟著金色光柱/);
  });

  it('onCelebrationEnd 帶下一站：顯示「下一站」導引文字＋站名，播 sparkle', async () => {
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    act(() => { worldConfigs[0].onCelebrationEnd?.(0, 1); });

    expect(cueNames()).toContain('sparkle');
    expect(document.body.textContent).toMatch(/跟著金色光柱/);
  });

  it('onCelebrationEnd 的 nextStop 是 null（最後一站）：不處理，不額外播任何 cue——避免跟結尾慶祝的 chime 重複', async () => {
    render(<ReadingIslandLab />);
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    act(() => { worldConfigs[0].onCelebrationEnd?.(2, null); });

    expect(cueNames(), '最後一站不該觸發任何 cue，全螢幕慶祝由另一條獨立 effect 處理').toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/跟著金色光柱/);
  });
});
