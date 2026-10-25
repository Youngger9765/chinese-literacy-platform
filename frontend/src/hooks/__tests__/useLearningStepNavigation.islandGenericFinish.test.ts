/**
 * 喝采島故事模式 — task ③（team-lead 2026-10-26 指派）：逐站查「完成路徑」
 * 最後走哪個 handler，故事模式下必須呼叫 notifyIslandStepDone、不准 navigate。
 *
 * 9 個非 lesson-intro 的站（full-text-annotate／key-passage-reading／
 * vocab-definition／vocab-application／keypoints-table／comprehension／
 * vocab-review／knowledge-station／report）各自的 handleFinish* 全部呼叫
 * 同一個 dispatchStepFinish → navigateAfterFinish（見 useLearningStepNavigation.ts
 * 221-401 行逐一核對過，沒有任何一個繞過這條路徑另外自己 navigate）。
 * 這支測試鎖住共用的那個開關本身，而不是每個 handler 各寫一條重複測試：
 * 任何一個 handleFinish* 改壞這條共用邏輯，這裡就會紅，等於同時保護了全部 9 站。
 *
 * handleFinishKnowledgeStation 選來當代表是因為它是最簡單的無參數呼叫；
 * handleFinishComprehension 另外測一次是因為它的 payload 建構路徑不同
 * （經過 buildStepFinishPayload 的 nextStep 查表），確認兩條不同形狀的
 * dispatchStepFinish 呼叫在故事模式下行為一致。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storyMode = { on: false };
const notify = vi.fn();
const currentStepId = { value: 'knowledge-station' };

vi.mock('../../pages/lab/island/storyMode', () => ({
  isIslandStoryMode: () => storyMode.on,
  notifyIslandStepDone: (step: string) => notify(step),
}));
vi.mock('../useCurrentStepId', () => ({ default: () => currentStepId.value }));
vi.mock('../../services/learningStorageScope', () => ({ isToolboxMode: () => false }));

import { useLearningStepNavigation } from '../useLearningStepNavigation';

function setup() {
  const navigate = vi.fn();
  const persistStep = vi.fn();
  const persistStepProgressState = vi.fn();
  const { result } = renderHook(() =>
    useLearningStepNavigation({
      storyId: '20011',
      selectedStory: { id: '20011' } as never,
      token: null,
      user: null,
      dbSessionId: null,
      hasActiveAssignment: false,
      isAssignmentReadyForSubmit: false,
      navigate,
      setSession: vi.fn(),
      setLastAttempt: vi.fn(),
      setSelectedStory: vi.fn(),
      persistStepProgressState,
      persistStep,
      clearPersistedSession: vi.fn(),
      ensureDbSession: vi.fn(),
    }),
  );
  return { result, navigate, persistStep, persistStepProgressState };
}

describe('navigateAfterFinish (shared by all non-intro step handlers) in island story mode', () => {
  beforeEach(() => {
    notify.mockClear();
  });

  it('knowledge-station: notifies the island and does not navigate', () => {
    storyMode.on = true;
    currentStepId.value = 'knowledge-station';
    const { result, navigate, persistStepProgressState } = setup();
    act(() => result.current.handleFinishKnowledgeStation());
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('knowledge-station');
    // progress is still recorded so the server-side steps_completed check lights the station up
    expect(persistStepProgressState).toHaveBeenCalled();
  });

  it('positive control: knowledge-station outside the island still navigates to the next step', () => {
    storyMode.on = false;
    currentStepId.value = 'knowledge-station';
    const { result, navigate } = setup();
    act(() => result.current.handleFinishKnowledgeStation());
    expect(navigate).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('comprehension: a differently-shaped dispatchStepFinish call (has a result payload + session patch) behaves the same way', () => {
    storyMode.on = true;
    currentStepId.value = 'comprehension';
    const { result, navigate } = setup();
    act(() => result.current.handleFinishComprehension({ understoodCount: 3, requiredCount: 5 } as never));
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('comprehension');
  });
});
