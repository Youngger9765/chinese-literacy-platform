/**
 * KeypointsTablePage.test.tsx — 第一篇專屬加碼題有沒有真的被掛上 (#2752 Phase 3)
 *
 * `KeypointsFollowupQuestions.tsx` has its own isolated component test
 * (`components/reading-steps/__tests__/KeypointsFollowupQuestions.test.tsx`), but
 * nothing locked that `KeypointsTablePage.tsx` actually mounts it. Issue #2752's
 * own re-scoping comment called this out explicitly: "元件存在不等於有被掛上" — a
 * component file existing is not proof a page renders it. This is the wiring test
 * that closes that gap for `keypointsFollowupQuestions.questions` (the L0063 shape;
 * the sibling `.items` shape is 閱讀接力, wired into `FullTextAnnotate.tsx` instead
 * and locked there).
 *
 * fixture 是真實 L0063《物以稀為貴》(id 20063) 的 API 回應（`curl
 * .../api/stories/20063`，未竄改，只裁掉跟這個測試無關的欄位/段落以控制檔案大小）。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import rawStory20063 from './fixtures/story-20063-keypoints-followup.json';
import type { Story } from '../../../types';

vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ storyId: '20063' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useLearningContext } from '../../../layouts/LearningLayout';
import KeypointsTablePage from '../KeypointsTablePage';

const story: Story = {
  ...(rawStory20063 as unknown as Story),
  id: String((rawStory20063 as { id: number }).id),
  lesson_code: (rawStory20063 as { grade_code: string }).grade_code,
  content: (rawStory20063 as { paragraphs: string[] }).paragraphs,
  keypointsFollowupQuestions: (rawStory20063 as {
    keypoints_followup_questions: Story['keypointsFollowupQuestions'];
  }).keypoints_followup_questions,
} as Story;

const mockHandleFinishStoryStructure = vi.fn();
const mockSaveStepProgressPatch = vi.fn();

function setup(overrides: Partial<Story> = {}) {
  vi.mocked(useLearningContext).mockReturnValue({
    selectedStory: { ...story, ...overrides },
    handleFinishStoryStructure: mockHandleFinishStoryStructure,
    dbSessionId: 'sess-test',
    saveStepProgressPatch: mockSaveStepProgressPatch,
  } as unknown as ReturnType<typeof useLearningContext>);
  return render(<KeypointsTablePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // StoryStructureTable does its own internal fetch(`/api/stories/{id}/structure`) —
  // reject it immediately so the test stays deterministic and offline instead of
  // hitting a real network call or hanging on an unresolved promise.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
});

describe('第一篇專屬加碼題要真的被 KeypointsTablePage 掛上 (#2752)', () => {
  it('story 真的帶有 keypointsFollowupQuestions.questions（先確認 fixture 沒編錯）', () => {
    expect(story.keypointsFollowupQuestions?.questions?.length).toBeGreaterThan(0);
  });

  it('第一題的題幹要出現在畫面上', () => {
    const { container } = setup();
    expect(container.textContent).toContain('請從下列語詞中，選出用字正確的語詞。');
  });

  it('「第一篇加碼題」的區塊標題要出現（不是只有題目字面湊巧命中）', () => {
    setup();
    expect(screen.getByText('第一篇加碼題')).toBeTruthy();
  });

  it('三題全部都渲染出來，不是只有第一題', () => {
    const { container } = setup();
    for (const q of story.keypointsFollowupQuestions!.questions!) {
      expect(container.textContent).toContain(q.stem);
    }
  });

  it('沒有 keypointsFollowupQuestions 的課（例如一般白話課）不渲染這個區塊', () => {
    setup({ keypointsFollowupQuestions: undefined });
    expect(screen.queryByText('第一篇加碼題')).toBeNull();
  });
});
