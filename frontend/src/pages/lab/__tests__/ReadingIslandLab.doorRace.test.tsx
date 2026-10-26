/**
 * 開門動畫（door !== null，0–1700ms 之間）期間，「發現新去處／進入」卡片
 * 跟清單模式的「進入」按鈕都還點得到——team-lead 2026-10-26 明令修正。
 *
 * 根因：`openModule` 本身沒有「已經在開門/已經在關卡裡」的防護，而
 * `useEffect(() => worldRef.current?.setPaused(module !== null || opening >= 0))`
 * 沒有把 `door !== null` 算進暫停條件，所以 3D 世界在開門動畫期間仍可移動；
 * 「發現新去處」卡片的渲染條件 `near !== null && module === null && opening < 0`
 * 也沒擋 `door`。學生若在第一站的門打開期間移動到另一站、按下它的「進入」，
 * 會疊出第二組 `setTimeout`，最後兩個 `setModule` 都會觸發——較晚呼叫的
 * `openModule` 勝出，實際開啟的會是「別站」而不是先點的那一站。
 *
 * 這支測試重現 team-lead 描述的真實時序：按下第一站 → 門開期間（真的經過
 * 一段時間，不是同一瞬間）學生移動到另一站、按下它的「進入」。驗的是
 * `openModule`「防護」+「按鈕 disabled」這兩道合起來的修正效果——兩者在
 * 這支測試裡是同一個 commit 的同一組修正，不特別拆開驗哪一道單獨生效。
 *
 * ⚠️ 誠實揭露一個這支測試沒有覆蓋到的邊界：如果兩次點擊發生在**同一個
 * React 事件批次**裡（兩次 dispatch 之間完全沒有 re-render 機會），
 * `doorRef.current`/`moduleRef.current` 這兩個 ref 要到下一次 render 才會
 * 被 `doorRef.current = door` 這行更新到新值，兩次呼叫都會讀到舊值、防護
 * 形同沒擋到——實測驗證過（故意在同一個 `act()` 裡連續 `fireEvent.click`
 * 兩次同一顆按鈕）。但按鈕在真實瀏覽器裡，兩次分開的點擊事件之間一定會有
 * 至少一次 commit，加上 `disabled` 屬性本身在這支測試環境裡會直接擋掉
 * disabled 按鈕的 click 派送（也實測驗證過），所以這個邊界在真實情境與這
 * 支測試環境裡都不構成風險；只是記下來，不要之後有人以為這兩個 ref
 * 能擋住「完全同一瞬間」的重複呼叫。
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

async function renderAndWalkToIsland() {
  render(<ReadingIslandLab />);
  await waitFor(() => expect(createIslandWorld).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();

  const coldOpenBtn = byAriaLabel('點一下，進入喝采島');
  act(() => { fireEvent.click(coldOpenBtn!); });
  act(() => { vi.advanceTimersByTime(450); });

  for (let i = 0; i < 5; i++) {
    const cont = byText('繼續');
    if (cont) { act(() => { fireEvent.click(cont); }); continue; }
    break;
  }
  const landBtn = byText('直接上岸走');
  act(() => { fireEvent.click(landBtn!); });
  act(() => { vi.advanceTimersByTime(3600); });
}

describe('ReadingIslandLab — 開門期間移動到別站再按「進入」不會開錯站', () => {
  beforeEach(() => { worldConfigs.length = 0; mockAudio.pause.mockClear(); mockAudio.cue.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('門開期間（< 1700ms）移動到站 1 並按「進入」，最後開的仍是先點的站 0，而不是後按的站 1', async () => {
    await renderAndWalkToIsland();

    act(() => { worldConfigs[0].onArrive(0); }); // 到站 0：港口燈塔
    const enterBtn0 = byText('進入');
    expect(enterBtn0).toBeTruthy();
    act(() => { fireEvent.click(enterBtn0!); }); // 開始開門（door=0），這裡有一次 re-render 把按鈕變 disabled

    // 門還沒開完（< 1700ms），學生移動到站 1——真的經過 300ms，中間有過
    // re-render，所以「進入」按鈕此刻的 disabled 狀態是最新的（true）
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { worldConfigs[0].onArrive(1); });
    const enterBtn1 = byText('進入');
    // UI 層防呆（disabled）跟 openModule 自己的防護是兩道獨立防線，這裡只
    // 記錄 disabled 當下的狀態，不當成硬性斷言失敗點——就算 disabled 這道
    // 因為其他原因沒套用上，底下的斷言還是要能獨立抓到 openModule 沒被
    // 第二次呼叫蓋過，兩道防線都要各自撐得住。
    if (enterBtn1 && !enterBtn1.disabled) enterBtn1.click(); // 繞過 jsdom 對 disabled 的派送限制時才會走到這裡
    act(() => { fireEvent.click(enterBtn1!); });

    act(() => { vi.advanceTimersByTime(2000); });

    // door cue 只應該播過一次（站 0 那次）——沒有第二組計時器疊上來
    const doorCueCalls = mockAudio.cue.mock.calls.filter((call) => call[0] === 'door');
    expect(doorCueCalls, '門聲只該播一次——第二次點擊如果生效了會疊播第二次').toHaveLength(1);

    const moduleHeader = Array.from(document.querySelectorAll('span')).find((s) =>
      /平台原本的關卡/.test(s.textContent || ''),
    );
    expect(moduleHeader?.textContent, '門開期間的第二次進入不該蓋過先點的那一站').toContain('港口燈塔');
  });
});
