/**
 * 喝采島故事模式：課程簡介按「開始學習」= 這一關做完，要回到島上，
 * 不能在教材框裡直接跳到下一關（預覽站實測：按下去就進了「書卷長廊」）。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storyMode = { on: false };
const notify = vi.fn();

vi.mock('../../pages/lab/island/storyMode', () => ({
  isIslandStoryMode: () => storyMode.on,
  notifyIslandStepDone: (step: string) => notify(step),
}));
vi.mock('../useCurrentStepId', () => ({ default: () => 'lesson-intro' }));
vi.mock('../../services/learningStorageScope', () => ({ isToolboxMode: () => false }));

import { useLearningStepNavigation } from '../useLearningStepNavigation';

function setup() {
  const navigate = vi.fn();
  const persistStep = vi.fn();
  const ensureDbSession = vi.fn();
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
      persistStepProgressState: vi.fn(),
      persistStep,
      clearPersistedSession: vi.fn(),
      ensureDbSession,
    }),
  );
  return { result, navigate, persistStep, ensureDbSession };
}

describe('handleStartReading in island story mode', () => {
  beforeEach(() => {
    notify.mockClear();
  });

  it('returns to the island instead of navigating to the next step', () => {
    storyMode.on = true;
    const { result, navigate, persistStep, ensureDbSession } = setup();
    act(() => result.current.handleStartReading());
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('lesson-intro');
    // 進度仍要記，島上才知道這一關做過
    expect(persistStep).toHaveBeenCalled();
    expect(ensureDbSession).toHaveBeenCalled();
  });

  it('positive control: outside the island it still goes to the first reading step', () => {
    storyMode.on = false;
    const { result, navigate } = setup();
    act(() => result.current.handleStartReading());
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('full-text-annotate'));
    expect(notify).not.toHaveBeenCalled();
  });
});
