/**
 * 2026-10-26 真實預覽站抓到的沉默 bug：只要 `fetchStory` 沒有在第一次 render
 * 之前就 resolve（後端冷啟動、網路延遲——任何不是「快到來不及被看見」的情況），
 * 20011 這種走手刻覆蓋（STOPS_20011/BABIES_20011）的課，3D 世界永遠不會建立，
 * 畫面上卻完全正常、沒有任何錯誤、`doneIndexes`／進度列都對——因為 STOPS/BABIES
 * 在 `lesson` 還是 null 時就已經是同一顆穩定參照，`lesson` 從 null 變成真正資料
 * 那次重新渲染，createIslandWorld 那個 useEffect 的 deps 完全沒變，不會重跑；
 * 但 render-gate `if (!lesson || STOPS.length === 0) return <main>載入中` 在
 * `lesson` 還是 null 時根本不渲染 `<div ref={canvasRef}>`，所以 effect 第一次
 * 執行時 host 一定是 null、提早 return，之後也沒有第二次機會。
 *
 * 這支測試刻意讓 fetchStory 延遲 resolve（模擬後端還沒熱機），逼這個 race 每次
 * 都重現，不靠運氣。
 */
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-router-dom', () => ({ useParams: () => ({ storyId: '20011' }) }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'tok',
    user: { id: 1, roles: [{ role_name: 'student' }] },
  }),
}));

let resolveFetchStory: (story: { title: string; stepSequence: string[]; vocabulary: [] }) => void = () => {};
vi.mock('../../../services/api', () => ({
  fetchStory: () =>
    new Promise((resolve) => {
      resolveFetchStory = resolve;
    }),
}));
vi.mock('../../../services/learningApi', () => ({
  fetchLearningSessions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  loadStepProgress: vi.fn(),
}));
vi.mock('../../../config/stepPath', () => ({ stepPath: () => '/learn/20011/lesson-intro' }));

// 模擬真正的 createIslandWorld 會做的事：把 canvas 掛到 host、dispose 時拿掉——
// 這樣才測得出「dispose 有沒有真的清乾淨，host 最後只剩 1 個子元素」，
// 不是只信任 mock 的 dispose 被呼叫過就算數（team-lead 2026-10-26 要求）。
const { createIslandWorld } = vi.hoisted(() => ({
  createIslandWorld: vi.fn((host: HTMLElement) => {
    const fakeCanvas = document.createElement('canvas');
    host.appendChild(fakeCanvas);
    return {
      setProgress: vi.fn(),
      setMode: vi.fn(),
      setPaused: vi.fn(),
      setStick: vi.fn(),
      travelTo: vi.fn(),
      jump: vi.fn(),
      playIntro: vi.fn(),
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

describe('ReadingIslandLab — createIslandWorld must still mount after a slow fetchStory', () => {
  beforeEach(() => { createIslandWorld.mockClear(); });

  it('calls createIslandWorld once lesson data arrives, even when it resolves after the loading render', async () => {
    render(<ReadingIslandLab />);
    // 此刻 lesson 還是 null，component 正顯示「載入中」，canvasRef div 根本不存在，
    // createIslandWorld 一次都不該被呼叫過。
    expect(createIslandWorld).not.toHaveBeenCalled();

    // 模擬 fetchStory 現在才 resolve（後端冷啟動後的真實情況）。
    resolveFetchStory({ title: '贏得喝采的輸家', stepSequence: [], vocabulary: [] });

    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));
    const call = createIslandWorld.mock.calls[0] as unknown as [unknown, unknown, { stops: unknown[]; babies: unknown[] }];
    expect(call[2].stops).toHaveLength(10); // STOPS_20011
    expect(call[2].babies).toHaveLength(6); // BABIES_20011
  });

  /**
   * team-lead 2026-10-26 要求：加了 `lesson` 進 deps 之後，確認「loading → 真正
   * 掛上 canvasRef div」這個轉換只建立一次世界，不會留下兩個 canvas、也不會在
   * 根本沒有東西可以清的情況下誤呼叫 dispose（host 在 loading 階段本來就是
   * null，effect 第一次提早 return 時沒有註冊過任何 cleanup，所以不該有
   * 「先 dispose 再重建」這回事——這支測試把這個理解寫成斷言，不是只用文字講）。
   */
  it('mounts the world exactly once and leaves exactly one canvas behind — no dispose-then-rebuild double-mount on the loading→loaded transition', async () => {
    render(<ReadingIslandLab />);
    resolveFetchStory({ title: '贏得喝采的輸家', stepSequence: ['lesson-intro', 'full-text-annotate'], vocabulary: [] });
    await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));

    const worldInstance = createIslandWorld.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };
    // loading 階段 host 是 null、effect 提早 return，根本沒有世界可以 dispose——
    // 所以到這裡為止 dispose 不該被叫過一次。
    expect(worldInstance.dispose).not.toHaveBeenCalled();

    const host = document.querySelector('[aria-label*="喝采島"]');
    expect(host?.querySelectorAll('canvas').length).toBe(1);
  });
});
