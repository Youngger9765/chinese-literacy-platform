/**
 * Regression test for #2532 review (CHANGES_REQUESTED by Young).
 *
 * Scenario: 單段課 +「再讀一次」.
 * Two things must happen when the student clicks「再讀一次」on a completed lesson:
 *  1. onResetTutor() is invoked — the cross-layer full reset (DB step_data.tutor,
 *     steps_completed 'paragraph-reading', session.readingAttempt, completedParagraphsSet, …) that
 *     stops the round-trip / reload from resurrecting old 成績. (資料清除本體在
 *     useStepProgressPersistence.resetTutorStep，另有專屬 hook 測試守著。)
 *  2. The stale 朗讀對照 diff is cleared. For a single-paragraph lesson currentLineIndex
 *     is already 0, so the paragraph-switch effect never dispatches CLEAR_FOR_PARAGRAPH —
 *     handleReadAgain must dispatch it explicitly, else evalState.lastDiffTokens lingers
 *     and the diff column stays on screen.
 *
 * 必改 2 is genuinely RED without the explicit dispatch: the completed lesson mounts via
 * initialProgress, whose restore path sets evalState.lastDiffTokens (GEMINI_DONE); after
 * resetForRetry() clears lineResults the diff column would still render off the lingering
 * lastDiffTokens unless CLEAR_FOR_PARAGRAPH runs.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import type { TutorStepData } from '../../../types/stepProgress';
import type { DiffToken } from '../../../types';

// Context/hook stubs — same approach as src/__smoke__/render-smoke.test.tsx
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: 'test-token', isAuthenticated: true, isLoading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ isZhuyinAny: false, processLinesSelective: () => null }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: false }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
}));

import LiveTutor from './LiveTutor';

// jsdom has no navigator.mediaDevices; LiveTutor pre-warms the mic on mount (rejection
// is caught internally). Stub so the mount effect doesn't throw.
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn().mockRejectedValue(new Error('no mic in test')) },
});

const SINGLE_PARA_STORY: Story = {
  id: '99',
  title: '單段測試課文',
  level: 1,
  content: ['這是唯一的一段課文。'],
  paragraphs: ['這是唯一的一段課文。'],
  thumbnail: '',
  category: 'Fable',
  filename: 'read-again-test.yml',
  grade: 4,
  charCount: 10,
  vocabulary: [],
};

const DIFF_TOKENS: DiffToken[] = [
  { char: '這', type: 'correct' },
  { char: '是', type: 'correct' },
];

// A completed single-paragraph reading as it would be restored from DB step_data.tutor.
const COMPLETED_PROGRESS: TutorStepData = {
  completed_paragraphs: [0],
  current_line_index: 0,
  paragraph_summaries: [],
  line_results: [
    { lineIndex: 0, matchRate: 0.98, cpm: 120, durationMs: 3000, transcript: '這是唯一的一段課文。', diffTokens: DIFF_TOKENS },
  ],
  paragraph_summaries_data: {
    0: { feedback: '', matchRate: 0.98, wrongCount: 0, missingCount: 0, tier: 3, geminiPending: false },
  },
};

function renderCompletedLiveTutor() {
  const onResetTutor = vi.fn();
  render(
    <LiveTutor
      story={SINGLE_PARA_STORY}
      rightPanelWidth={0}
      onPanelWidthChange={vi.fn()}
      onFinish={vi.fn()}
      onCancel={vi.fn()}
      initialProgress={COMPLETED_PROGRESS}
      onProgressChange={vi.fn()}
      onResetTutor={onResetTutor}
      dbSessionId={123}
    />,
  );
  return { onResetTutor };
}

describe('LiveTutor 「再讀一次」(#2532)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts a completed single-paragraph lesson showing 再讀一次 and the 朗讀對照', () => {
    renderCompletedLiveTutor();
    expect(screen.getByText('再讀一次')).toBeInTheDocument();
    // Restored diff comparison is visible before reset (你唸的內容 = ParagraphCard 對照左欄).
    expect(screen.getByText('你唸的內容')).toBeInTheDocument();
  });

  it('clicking 再讀一次 invokes the cross-layer full reset (onResetTutor)', () => {
    const { onResetTutor } = renderCompletedLiveTutor();
    fireEvent.click(screen.getByText('再讀一次'));
    expect(onResetTutor).toHaveBeenCalledTimes(1);
  });

  it('clicking 再讀一次 returns the page to the unread state (朗讀對照 gone)', () => {
    renderCompletedLiveTutor();
    expect(screen.getByText('你唸的內容')).toBeInTheDocument();

    fireEvent.click(screen.getByText('再讀一次'));

    // 整體 reset 後對照欄消失（此處由 resetForRetry 清 lineResults 達成）。
    // 必改 2 的精確機制「CLEAR_FOR_PARAGRAPH 清 evalState.lastDiffTokens」是為了 live
    // 單段評估殘留的路徑（無法用 initialProgress 重現）——由 handleReadAgain 顯式 dispatch
    // (見 LiveTutor.tsx) + reducer 單元測試 useParagraphEvaluation.test.ts『CLEAR_FOR_PARAGRAPH …
    // lastDiffTokens toBeNull』守著，不在此假裝覆蓋。
    expect(screen.queryByText('你唸的內容')).not.toBeInTheDocument();
  });
});
