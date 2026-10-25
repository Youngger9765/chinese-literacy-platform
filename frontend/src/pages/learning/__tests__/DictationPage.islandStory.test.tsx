/**
 * 喝采島故事模式 — 「返回」上一步按鈕不能出現（跟 Intro.islandStory.test.tsx
 * 同一條規則，換一個頁面驗）。dictation 這個 step 目前是全站停用、也不在任何
 * 島會用到的 15 種 step id 裡，所以今天沒有任何島會真的載入這個頁面；
 * 但 team-lead／Young 2026-10-26 明令：只要頁面「會不會被用到」還沒有程式碼
 * 層面的保證，就要照 PRD §2「一次一關」的規則防守，不能賭它不會被用到。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const storyMode = { on: false };
vi.mock('../../lab/island/storyMode', () => ({ isIslandStoryMode: () => storyMode.on }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ storyId: '20011' }),
}));

vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: () => ({
    selectedStory: { id: '20011', title: '測試課文', content: ['段落一'] },
    handleFinishDictation: vi.fn(),
    stepProgressData: { step_data: {} },
    saveStepProgressPatch: vi.fn(),
  }),
}));

import DictationPage from '../DictationPage';

describe('DictationPage in island story mode', () => {
  it('does not render a 返回 button that would navigate out of the current step', () => {
    storyMode.on = true;
    render(<DictationPage />);
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
  });

  it('positive control: outside the island, 返回 is still there and navigates to the previous step', () => {
    storyMode.on = false;
    render(<DictationPage />);
    screen.getByRole('button', { name: '返回' }).click();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('character-practice'));
  });
});
