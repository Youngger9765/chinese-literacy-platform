/**
 * #3780 reading-babies phase 2（game-design.md §3.3「進化當下的回饋強度」）：
 * 回島時如果這一課剛好跨過中階／進階門檻，要比單次成長的小提示更強——不是
 * 每次 `quality_passed=true` 都講同一句「寶貝長大了一點！」。
 *
 * 做法：`refreshProgress` 偵測到有新的 passed 事件時，額外呼叫
 * `fetchReadingBabyCard` 查這一課目前的 stage，跟 sessionStorage 裡「上次
 * 看到的 stage」比較；真的跨過門檻才用 `stageEvolutionHintText` 蓋掉小
 * 提示，沒跨過（或查不到 lesson_uid／API 失敗）就維持原本的小提示，不讓
 * 這個加強功能變成新的失敗點。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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
import { fetchLearningSessions, loadStepProgress } from '../../../services/learningApi';

const fetchReadingBabyCardMock = vi.fn();
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: (...args: unknown[]) => fetchReadingBabyCardMock(...args),
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
  await waitFor(() => expect(byAriaLabel('點一下，進入喝采島')).toBeTruthy());

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

const CARD_BASIC = {
  lesson_uid: 'L0011', title: 'x', ability_family: 'A', ability_family_name: 'x', stage: 'basic' as const,
  assessable_total: 2, assessable_passed: 0, progress_ratio: 0, fragments_count: 0, next_step: null, all_cleared: false,
};
const CARD_INTERMEDIATE = { ...CARD_BASIC, stage: 'intermediate' as const, assessable_passed: 1, progress_ratio: 0.5 };
const CARD_ADVANCED = { ...CARD_BASIC, stage: 'advanced' as const, assessable_passed: 2, progress_ratio: 1, all_cleared: true };

describe('ReadingIslandLab — 進化當下的分級回饋（跨過中階/進階門檻）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fetchReadingBabyCardMock.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('掛載時第一次讀到的 stage 只建立基準，不跳進化提示（不然每次打開頁面都會慶祝一次）', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_BASIC);
    await enterIsland();

    expect(document.body.textContent).not.toContain('寶貝長大成中階囉');
    expect(document.body.textContent).not.toContain('寶貝變成最厲害的型態');
  });

  it('回島時 stage 從 basic 變成 intermediate → 顯示中階分級回饋，蓋掉小提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({ items: [{ id: 1, story_slug: '20011' } as never], total: 1 });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_BASIC); // mount baseline

    await enterIsland();

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['key-passage-reading'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'key-passage-reading', ability_id: '5-Ⅱ-1', quality_passed: true },
      ],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_INTERMEDIATE); // after this station

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'key-passage-reading' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).toContain('寶貝長大成中階囉！');
    expect(document.body.textContent).not.toContain('寶貝長大了一點！');
  });

  it('回島時 stage 從 intermediate 變成 advanced → 顯示最強的進階分級回饋', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({ items: [{ id: 1, story_slug: '20011' } as never], total: 1 });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['key-passage-reading'], step_data: {}, version: 1 },
      reading_baby_events: [],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_INTERMEDIATE); // mount baseline

    await enterIsland();

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['key-passage-reading', 'full-text-annotate'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'full-text-annotate', ability_id: '5-Ⅱ-4', quality_passed: true },
      ],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_ADVANCED);

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'full-text-annotate' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).toContain('太棒了！這一課你都學會了，寶貝變成最厲害的型態！');
  });

  it('stage 沒有跨過門檻（還是 basic）→ 維持原本的小提示，不講進化文案', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({ items: [{ id: 1, story_slug: '20011' } as never], total: 1 });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_BASIC);

    await enterIsland();

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
      ],
    });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_BASIC); // 還是 basic，沒跨過門檻

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'vocab-definition' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).toContain('寶貝長大了一點！');
    expect(document.body.textContent).not.toContain('寶貝長大成中階囉');
  });

  it('fetchReadingBabyCard 失敗（網路錯誤/這課不在 179 課對照）→ 不炸頁面，仍顯示原本的小提示', async () => {
    vi.mocked(fetchLearningSessions).mockResolvedValue({ items: [{ id: 1, story_slug: '20011' } as never], total: 1 });
    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      reading_baby_events: [],
    });
    fetchReadingBabyCardMock.mockRejectedValue(new Error('404'));

    await enterIsland();

    vi.mocked(loadStepProgress).mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
      ],
    });

    act(() => { worldConfigs[worldConfigs.length - 1]!.onArrive(0); });
    act(() => { fireEvent.click(byText('進入')!); });
    act(() => { vi.advanceTimersByTime(1700); });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'island-step-done', step: 'vocab-definition' },
      }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(document.body.textContent).toContain('寶貝長大了一點！');
  });
});
